import type { customers, orderItems, orders } from '../db/schema.ts'
import type { OrderStatus } from './status.ts'

type CustomerRow = typeof customers.$inferSelect
type OrderRow = typeof orders.$inferSelect
type OrderItemRow = typeof orderItems.$inferSelect

// ─── Contract response shapes ────────────────────────────────────────────────
// These mirror docs/api-contract.md exactly. Adding a field here changes the
// contract, so do not add one without changing that document first.

export type Customer = {
  id: string
  name: string
  email: string | null
  phone: string
  createdAt: string
  updatedAt: string
}

export type OrderItem = {
  id: string
  itemName: string
  quantity: number
  unitPrice: number
  totalPrice: number
}

export type OrderDetail = {
  id: string
  orderNumber: string
  customerId: string
  status: OrderStatus
  totalAmount: number
  itemCount: number
  createdAt: string
  updatedAt: string
  customer: Customer
  items: OrderItem[]
}

// ─── Mappers ─────────────────────────────────────────────────────────────────

/**
 * node-postgres returns `numeric` as a string to avoid the precision loss of
 * a float. This is the one place it becomes a number.
 */
const toMoney = (value: string | null) => Number(value ?? 0)

export function toCustomer(row: CustomerRow): Customer {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    phone: row.phone,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}

export function toOrderItem(row: OrderItemRow): OrderItem {
  return {
    id: row.id,
    itemName: row.itemName,
    quantity: row.quantity,
    unitPrice: toMoney(row.unitPrice),
    totalPrice: toMoney(row.totalPrice),
  }
}

export function toOrderDetail(
  order: OrderRow,
  customer: CustomerRow,
  itemRows: OrderItemRow[],
): OrderDetail {
  const items = itemRows.map(toOrderItem)

  // Summed in whole paise, then divided once. Adding 0.1 + 0.2 in floating
  // point gives 0.30000000000000004; adding 10 + 20 does not.
  const totalPaise = items.reduce((sum, item) => sum + Math.round(item.totalPrice * 100), 0)

  return {
    id: order.id,
    orderNumber: order.orderNumber,
    customerId: order.customerId,
    status: order.status,
    totalAmount: totalPaise / 100,
    // itemCount is the total quantity, not the number of lines — questions.md §1.3.
    itemCount: items.reduce((sum, item) => sum + item.quantity, 0),
    createdAt: order.createdAt.toISOString(),
    updatedAt: order.updatedAt.toISOString(),
    customer: toCustomer(customer),
    items,
  }
}
