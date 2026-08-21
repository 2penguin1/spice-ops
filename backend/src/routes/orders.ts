import { and, count, desc, eq, ilike, or, type SQL } from 'drizzle-orm'
import { Hono } from 'hono'
import { z } from 'zod'

import { db } from '../db/client.ts'
import { customers, orderItems, orders, orderStatusEvents } from '../db/schema.ts'
import { assertCanSetStatus, attributableId, requireRole, type AuthVariables } from '../lib/auth.ts'
import { ApiError, fromPostgresError } from '../lib/errors.ts'
import { attachItems, loadOrderDetail } from '../lib/orders.query.ts'
import { invalidateAnalytics } from '../lib/cache.ts'
import { claimKey, findReplay, isDuplicateKey, recordResponse } from '../lib/idempotency.ts'
import { queueNotification } from '../lib/notifications.ts'
import { emitOrderUpdated } from '../lib/events.ts'
import { recordEvent, transitionOrder, type Tx } from '../lib/orders.tx.ts'
import {
  orderStatusSchema,
  searchTerm,
  shortText,
  paginationMeta,
  paginationQuery,
  toLimitOffset,
  uuidParam,
  validate,
} from '../lib/validation.ts'

// ─── Schemas ─────────────────────────────────────────────────────────────────

const listQuery = paginationQuery.extend({
  search: searchTerm,
  status: orderStatusSchema.optional(),
  // Not validated as a uuid here: the contract's only listed error for this
  // parameter is RESOURCE_NOT_FOUND, and an id that cannot name a customer is
  // a customer that does not exist. Checked in the handler.
  customerId: z.string().trim().min(1).optional(),
})

const itemBody = z.object({
  itemName: shortText(120),
  quantity: z.number().int().positive().max(999),
  unitPrice: z
    .number()
    .nonnegative()
    .refine((value) => Number(value.toFixed(2)) === value, 'unitPrice supports at most 2 decimal places'),
})

const createOrderBody = z.object({
  customer: z
    .object({
      id: z.uuid().nullable().optional(),
      name: shortText(120).optional(),
      email: z.email().max(160).nullable().optional(),
      phone: shortText(30).optional(),
    })
    .refine(
      (value) => Boolean(value.id) || Boolean(value.name && value.phone),
      'customer.name and customer.phone are required when customer.id is not given',
    ),
  // Capped: one request should not be able to insert unbounded rows.
  items: z.array(itemBody).min(1, 'Order must contain at least one item').max(60),
})

const statusBody = z.object({ status: orderStatusSchema })

const itemIdParam = z.object({ id: z.uuid(), itemId: z.uuid() })

const ENDPOINT = 'POST /orders'

const contains = (term: string) => `%${term.replace(/[\\%_]/g, '\\$&')}%`

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Rejects a customerId that is malformed or unknown — both mean "no such customer". */
async function assertCustomerExists(customerId: string) {
  if (!z.uuid().safeParse(customerId).success) throw ApiError.notFound('Customer')

  const [found] = await db
    .select({ id: customers.id })
    .from(customers)
    .where(eq(customers.id, customerId))

  if (!found) throw ApiError.notFound('Customer')
}

type CustomerInput = z.infer<typeof createOrderBody>['customer']

/**
 * Attaches the order to an existing customer, or creates one.
 *
 * When an id is given the other fields are ignored rather than applied as an
 * update — a typo at the counter must not overwrite a good record.
 *
 * When only details are given and the phone is already on file, we reuse that
 * customer. Taking an order should not fail because someone came back a second
 * time, and the contract lists no RESOURCE_ALREADY_EXISTS for order creation.
 * See questions.md §1.4.
 */
async function resolveCustomer(tx: Tx, input: CustomerInput): Promise<string> {
  if (input.id) {
    const [existing] = await tx
      .select({ id: customers.id })
      .from(customers)
      .where(eq(customers.id, input.id))

    if (!existing) throw ApiError.notFound('Customer')
    return existing.id
  }

  const phone = input.phone!

  // Upsert rather than select-then-insert. Two requests with the same new
  // phone would otherwise race, and the loser's 23505 aborts the surrounding
  // transaction, leaving nothing to recover with.
  const [row] = await tx
    .insert(customers)
    .values({ name: input.name!, email: input.email ?? null, phone })
    .onConflictDoUpdate({ target: customers.phone, set: { phone } })
    .returning({ id: customers.id })

  return row!.id
}

// ─── Routes ──────────────────────────────────────────────────────────────────

// Reading is open to any signed-in role; the guards below cover the actions
// that change something.
export const orderRoutes = new Hono<{ Variables: AuthVariables }>()

  /** GET /orders — paginated list with search, status and customer filters. */
  .get('/', validate('query', listQuery, 'INVALID_FILTER'), async (c) => {
    const { search, status, customerId, ...pagination } = c.req.valid('query')

    if (customerId) await assertCustomerExists(customerId)

    const where = and(
      status ? eq(orders.status, status) : undefined,
      customerId ? eq(orders.customerId, customerId) : undefined,
      search
        ? or(
            ilike(orders.orderNumber, contains(search)),
            ilike(customers.name, contains(search)),
            ilike(customers.phone, contains(search)),
          )
        : undefined,
    )

    const { limit, offset } = toLimitOffset(pagination)

    const [rows, [totals]] = await Promise.all([
      db
        .select()
        .from(orders)
        .innerJoin(customers, eq(customers.id, orders.customerId))
        .where(where)
        // orderNumber breaks ties: without a unique tiebreaker, two orders
        // sharing a timestamp can repeat or vanish across page boundaries.
        .orderBy(desc(orders.createdAt), desc(orders.orderNumber))
        .limit(limit)
        .offset(offset),
      db
        .select({ total: count() })
        .from(orders)
        .innerJoin(customers, eq(customers.id, orders.customerId))
        .where(where),
    ])

    return c.json({
      data: await attachItems(rows),
      meta: paginationMeta(pagination, totals?.total ?? 0),
    })
  })

  /** GET /orders/{order_id} — one order with its customer and items. */
  .get('/:id', validate('param', uuidParam, 'RESOURCE_NOT_FOUND'), async (c) => {
    return c.json({ data: await loadOrderDetail(c.req.valid('param').id) })
  })

  /** POST /orders — create, attaching to an existing customer or making one. */
  .post('/', requireRole('ADMIN', 'MANAGER', 'SERVICE'), validate('json', createOrderBody), async (c) => {
    const body = c.req.valid('json')

    // Optional. Absent, nothing about this endpoint changes.
    const key = z.string().min(1).max(200).safeParse(c.req.header('Idempotency-Key')).data

    if (key) {
      const replay = await findReplay(key, ENDPOINT, body)
      if (replay) return c.json(replay.body as object, replay.statusCode as 201)
    }

    // One transaction: a half-written order with no items must never exist.
    const created = await db.transaction(async (tx) => {
      // Taken before any work, so a concurrent retry waits here rather than
      // building a duplicate order and rolling it back.
      if (key) await claimKey(tx, { key, endpoint: ENDPOINT, body })

      const customerId = await resolveCustomer(tx, body.customer)

      const [order] = await tx.insert(orders).values({ customerId }).returning({ id: orders.id })

      await tx.insert(orderItems).values(
        body.items.map((item) => ({
          orderId: order!.id,
          itemName: item.itemName,
          quantity: item.quantity,
          // numeric is passed as a string: sending a float would reintroduce
          // the precision loss the column type exists to avoid.
          unitPrice: item.unitPrice.toFixed(2),
        })),
      )

      // The order came from nowhere, so this event has no previous status.
      await recordEvent(tx, { orderId: order!.id, from: null, to: 'CONFIRMED' })

      // Read back inside the transaction, so the response we store under the
      // idempotency key is byte for byte the one we are about to return.
      const detail = await loadOrderDetail(order!.id, tx)

      await queueNotification(tx, {
        orderId: detail.id,
        orderNumber: detail.orderNumber,
        status: 'CONFIRMED',
        phone: detail.customer.phone,
      })

      if (key) await recordResponse(tx, key, 201, { data: detail })

      return detail
    }).catch(async (error) => {
      // A second request with the same key blocked on the primary key until
      // the first committed, and now finds it taken. Replay theirs.
      if (key && isDuplicateKey(error)) {
        const replay = await findReplay(key, ENDPOINT, body)
        if (replay) return null
      }
      throw error
    })

    if (created === null) {
      const replay = (await findReplay(key!, ENDPOINT, body))!
      return c.json(replay.body as object, replay.statusCode as 201)
    }

    emitOrderUpdated({
      orderId: created.id,
      orderNumber: created.orderNumber,
      status: created.status,
    })
    void invalidateAnalytics()

    return c.json({ data: created }, 201)
  })

  /** PATCH /orders/{order_id}/status — advance the order through its lifecycle. */
  .patch(
    '/:id/status',
    validate('param', uuidParam, 'RESOURCE_NOT_FOUND'),
    validate('json', statusBody),
    async (c) => {
      const staff = c.get('staff')
      const { status } = c.req.valid('json')

      // Who may make this move depends on the status being requested, so the
      // check lives with the other authorization rules, not in this handler.
      assertCanSetStatus(staff, status)

      const order = await transitionOrder(c.req.valid('param').id, status, attributableId(staff))
      return c.json({ data: order })
    },
  )

  /** GET /orders/{order_id}/timeline — every status this order has been through. */
  .get('/:id/timeline', validate('param', uuidParam, 'RESOURCE_NOT_FOUND'), async (c) => {
    const { id } = c.req.valid('param')

    await loadOrderDetail(id)

    const events = await db
      .select()
      .from(orderStatusEvents)
      .where(eq(orderStatusEvents.orderId, id))
      .orderBy(orderStatusEvents.createdAt)

    return c.json({
      data: events.map((event) => ({
        id: event.id,
        fromStatus: event.fromStatus,
        toStatus: event.toStatus,
        createdAt: event.createdAt.toISOString(),
      })),
    })
  })

  /** POST /orders/{order_id}/items — returns the whole order, per the contract. */
  .post(
    '/:id/items',
    requireRole('ADMIN', 'MANAGER', 'SERVICE'),
    validate('param', uuidParam, 'RESOURCE_NOT_FOUND'),
    validate('json', itemBody),
    async (c) => {
      const { id } = c.req.valid('param')
      const item = c.req.valid('json')

      // Loaded first so an unknown order is a 404 rather than a foreign key error.
      await loadOrderDetail(id)

      await db.insert(orderItems).values({
        orderId: id,
        itemName: item.itemName,
        quantity: item.quantity,
        unitPrice: item.unitPrice.toFixed(2),
      })

      const updated = await loadOrderDetail(id)

      // The total changed, so screens and cached figures are now stale.
      emitOrderUpdated({ orderId: id, orderNumber: updated.orderNumber, status: updated.status })
      void invalidateAnalytics()

      return c.json({ data: updated }, 201)
    },
  )

  /** DELETE /orders/{order_id}/items/{item_id} — 200 with the order, not 204. */
  .delete(
    '/:id/items/:itemId',
    requireRole('ADMIN', 'MANAGER', 'SERVICE'),
    validate('param', itemIdParam, 'RESOURCE_NOT_FOUND'),
    async (c) => {
    const { id, itemId } = c.req.valid('param')

    await loadOrderDetail(id)

    // Scoped to the order as well as the item, so an item id from another
    // order cannot be deleted through this one.
    const deleted = await db
      .delete(orderItems)
      .where(and(eq(orderItems.id, itemId), eq(orderItems.orderId, id)))
      .returning({ id: orderItems.id })

      if (deleted.length === 0) throw ApiError.notFound('Order item')

      const updated = await loadOrderDetail(id)

      emitOrderUpdated({ orderId: id, orderNumber: updated.orderNumber, status: updated.status })
      void invalidateAnalytics()

      return c.json({ data: updated })
    },
  )
