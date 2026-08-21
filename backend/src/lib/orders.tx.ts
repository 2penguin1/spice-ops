import { and, eq } from 'drizzle-orm'

import { db } from '../db/client.ts'
import { orders, orderStatusEvents } from '../db/schema.ts'
import { ApiError } from './errors.ts'
import { invalidateAnalytics } from './cache.ts'
import { emitOrderUpdated } from './events.ts'
import { queueNotification } from './notifications.ts'
import { loadOrderDetail } from './orders.query.ts'
import type { OrderDetail } from './serialize.ts'
import { assertTransition, isNoop, type OrderStatus } from './status.ts'

/** A transaction handle, as Drizzle passes it to a `db.transaction` callback. */
export type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0]

/** Records a status change. Always called with the transaction that made it. */
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
 * The only way an order's status changes. Every transition is checked, logged,
 * queued for notification and announced from here.
 */
export async function transitionOrder(
  orderId: string,
  to: OrderStatus,
  staffId: string | null = null,
): Promise<OrderDetail> {
  const [current] = await db.select({ status: orders.status }).from(orders).where(eq(orders.id, orderId))
  if (!current) throw ApiError.notFound('Order')

  // A double-tap in a busy kitchen should not be an error.
  if (isNoop(current.status, to)) return loadOrderDetail(orderId)

  assertTransition(current.status, to)

  await db.transaction(async (tx) => {
    // The expected status is in the WHERE clause, so no lock is needed: if
    // someone moved it first, no rows match and we report the conflict.
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

    // Queued in this transaction, so a crash cannot lose the message.
    const detail = await loadOrderDetail(orderId, tx)
    await queueNotification(tx, {
      orderId,
      orderNumber: detail.orderNumber,
      status: to,
      phone: detail.customer.phone,
    })
  })

  const order = await loadOrderDetail(orderId)

  // After the commit. Announcing a change that then rolled back would tell
  // every screen something untrue.
  emitOrderUpdated({ orderId, orderNumber: order.orderNumber, status: order.status })
  void invalidateAnalytics()

  return order
}
