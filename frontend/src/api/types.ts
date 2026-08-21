/**
 * Mirrors docs/api-contract.md. These are the shapes the API returns; changing
 * one here without changing the contract is a bug on one side or the other.
 */
export type OrderStatus = 'CONFIRMED' | 'PREPARING' | 'READY' | 'COMPLETED' | 'CANCELLED'

export const ORDER_STATUSES: OrderStatus[] = [
  'CONFIRMED',
  'PREPARING',
  'READY',
  'COMPLETED',
  'CANCELLED',
]

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

/** One entry in an order's status history. `fromStatus` is null for its creation. */
export type OrderEvent = {
  id: string
  fromStatus: OrderStatus | null
  toStatus: OrderStatus
  createdAt: string
}

export type Summary = {
  revenue: { net: number; incoming: number }
  orders: { total: number; today: number }
  funnel: { status: string; count: number }[]
  cancellationRate: number
  averagePrepSeconds: number | null
}

export type DailyPoint = { day: string; orders: number; revenue: number }
export type HourPoint = { hour: number; orders: number }
export type StaffPoint = {
  id: string
  name: string
  role: string
  started: number
  finished: number
  averagePrepSeconds: number | null
}
export type TopItem = { itemName: string; quantity: number; revenue: number }

export type Insights = { narrative: string | null; model: string | null; unavailable: string | null }

export type Pagination = { page: number; size: number; total: number; totalPages: number }

export type Page<T> = { data: T[]; meta: { pagination: Pagination } }
