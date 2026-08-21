import { and, eq } from 'drizzle-orm'

import { db } from '../db/client.ts'
import { orders, orderStatusEvents } from '../db/schema.ts'
import { ApiError } from './errors.ts'
import { emitOrderUpdated } from './events.ts'
import { loadOrderDetail } from './orders.query.ts'
import type { OrderDetail } from './serialize.ts'
import { assertTransition, isNoop, type OrderStatus } from './status.ts'

/** A transaction handle, as Drizzle hands it to a `db.transaction` callback. */
export type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0]

/**
 * Records a status change in the log.
 *
 * Always called with the transaction that made the change, never on its own —
 * that is what makes it impossible for the log and the order to disagree.
 */
export function recordEvent(
  tx: Tx,
  event: { orderId: string; from: OrderStatus | null; to: OrderStatus; staffId?: string | null },
) {
  return tx.insert(orderStatusEvents).values({
    orderId: event.orderId,
    fromStatus: event.from,
    toStatus: event.to,
    staffId: event.staffId ?? null,
  })
}

/**
 * The only way an order's status changes.
 *
 * Routes call this rather than issuing their own UPDATE, so every transition
 * is checked, logged, and — from phase 13 — announced from one place.
 */
export async function transitionOrder(
  orderId: string,
  to: OrderStatus,
  staffId: string | null = null,
): Promise<OrderDetail> {
  const [current] = await db.select({ status: orders.status }).from(orders).where(eq(orders.id, orderId))
  if (!current) throw ApiError.notFound('Order')

  // Setting the status it already has changes nothing and is not an error.
  if (isNoop(current.status, to)) return loadOrderDetail(orderId)

  assertTransition(current.status, to)

  await db.transaction(async (tx) => {
    // The expected status sits in the WHERE clause, so this is atomic without
    // a lock: if another request moved the order first, zero rows match and we
    // report the conflict rather than overwriting their change.
    const moved = await tx
      .update(orders)
      .set({ status: to })
      .where(and(eq(orders.id, orderId), eq(orders.status, current.status)))
      .returning({ id: orders.id })

    if (moved.length === 0) {
      throw new ApiError(
        'INVALID_STATUS_TRANSITION',
        'The order status changed in another request — reload and try again',
      )
    }

    await recordEvent(tx, { orderId, from: current.status, to, staffId })
  })

  const order = await loadOrderDetail(orderId)

  // After the commit, never inside it: announcing a change that then rolled
  // back would tell every screen something untrue.
  emitOrderUpdated({ orderId, orderNumber: order.orderNumber, status: order.status })

  return order
}
