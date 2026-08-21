import { and, count, desc, eq, ilike, inArray, or, type SQL } from 'drizzle-orm'
import { Hono } from 'hono'
import { z } from 'zod'

import { db } from '../db/client.ts'
import { customers, orderItems, orders } from '../db/schema.ts'
import { ApiError } from '../lib/errors.ts'
import { toOrderDetail, type OrderDetail } from '../lib/serialize.ts'
import {
  orderStatusSchema,
  paginationMeta,
  paginationQuery,
  toLimitOffset,
  uuidParam,
  validate,
} from '../lib/validation.ts'

// ─── Schemas ─────────────────────────────────────────────────────────────────

const listQuery = paginationQuery.extend({
  search: z.string().trim().min(1).optional(),
  status: orderStatusSchema.optional(),
  // Not validated as a uuid here: the contract's only listed error for this
  // parameter is RESOURCE_NOT_FOUND, and an id that cannot name a customer is
  // a customer that does not exist. Checked in the handler.
  customerId: z.string().trim().min(1).optional(),
})

const contains = (term: string) => `%${term.replace(/[\\%_]/g, '\\$&')}%`

// ─── Loading ─────────────────────────────────────────────────────────────────

type OrderWithCustomer = { orders: typeof orders.$inferSelect; customers: typeof customers.$inferSelect }

/**
 * Fetches the items for a whole page of orders in ONE query, then groups them
 * in memory. Twenty orders cost two queries, never twenty-one.
 */
async function attachItems(rows: OrderWithCustomer[]): Promise<OrderDetail[]> {
  if (rows.length === 0) return []

  const items = await db
    .select()
    .from(orderItems)
    .where(inArray(orderItems.orderId, rows.map((row) => row.orders.id)))
    .orderBy(orderItems.createdAt)

  const byOrderId = Map.groupBy(items, (item) => item.orderId)

  return rows.map((row) => toOrderDetail(row.orders, row.customers, byOrderId.get(row.orders.id) ?? []))
}

/** Rejects a customerId that is malformed or unknown — both mean "no such customer". */
async function assertCustomerExists(customerId: string) {
  if (!z.uuid().safeParse(customerId).success) throw ApiError.notFound('Customer')

  const [found] = await db
    .select({ id: customers.id })
    .from(customers)
    .where(eq(customers.id, customerId))

  if (!found) throw ApiError.notFound('Customer')
}

// ─── Routes ──────────────────────────────────────────────────────────────────

export const orderRoutes = new Hono()

  /** GET /orders — paginated list with search, status and customer filters. */
  .get('/', validate('query', listQuery, 'INVALID_FILTER'), async (c) => {
    const { search, status, customerId, ...pagination } = c.req.valid('query')

    if (customerId) await assertCustomerExists(customerId)

    const filters: (SQL | undefined)[] = [
      status ? eq(orders.status, status) : undefined,
      customerId ? eq(orders.customerId, customerId) : undefined,
      search
        ? or(
            ilike(orders.orderNumber, contains(search)),
            ilike(customers.name, contains(search)),
            ilike(customers.phone, contains(search)),
          )
        : undefined,
    ]
    const where = and(...filters)

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
    const { id } = c.req.valid('param')

    const rows = await db
      .select()
      .from(orders)
      .innerJoin(customers, eq(customers.id, orders.customerId))
      .where(eq(orders.id, id))

    const [order] = await attachItems(rows)
    if (!order) throw ApiError.notFound('Order')

    return c.json({ data: order })
  })
