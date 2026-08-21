import { eq, inArray } from 'drizzle-orm'

import { db } from '../db/client.ts'
import { customers, orderItems, orders } from '../db/schema.ts'
import { ApiError } from './errors.ts'
import { toOrderDetail, type OrderDetail } from './serialize.ts'

export type OrderWithCustomer = {
  orders: typeof orders.$inferSelect
  customers: typeof customers.$inferSelect
}

/**
 * Fetches the items for a whole page of orders in ONE query, then groups them
 * in memory. Twenty orders cost two queries, never twenty-one.
 */
export async function attachItems(rows: OrderWithCustomer[]): Promise<OrderDetail[]> {
  if (rows.length === 0) return []

  const items = await db
    .select()
    .from(orderItems)
    .where(
      inArray(
        orderItems.orderId,
        rows.map((row) => row.orders.id),
      ),
    )
    .orderBy(orderItems.createdAt)

  const byOrderId = Map.groupBy(items, (item) => item.orderId)

  return rows.map((row) =>
    toOrderDetail(row.orders, row.customers, byOrderId.get(row.orders.id) ?? []),
  )
}

/**
 * Loads one order in its full contract shape. Every write endpoint returns
 * this, so the response of a status change and of a plain read are built by
 * the same code and cannot drift apart.
 */
export async function loadOrderDetail(id: string): Promise<OrderDetail> {
  const rows = await db
    .select()
    .from(orders)
    .innerJoin(customers, eq(customers.id, orders.customerId))
    .where(eq(orders.id, id))

  const [order] = await attachItems(rows)
  if (!order) throw ApiError.notFound('Order')

  return order
}
