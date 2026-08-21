import type { OrderStatus } from '../api/types'

/** Which buttons to offer next. See permissions.ts for who may press them. */
const NEXT: Record<OrderStatus, OrderStatus[]> = {
  CONFIRMED: ['PREPARING', 'CANCELLED'],
  PREPARING: ['READY', 'CANCELLED'],
  READY: ['COMPLETED', 'CANCELLED'],
  COMPLETED: [],
  CANCELLED: [],
}

export const nextStatuses = (status: OrderStatus): OrderStatus[] => NEXT[status]

/** What staff call the action, not the state it lands in. */
export const ACTION_LABEL: Record<OrderStatus, string> = {
  CONFIRMED: 'Reopen',
  PREPARING: 'Start prep',
  READY: 'Mark ready',
  COMPLETED: 'Complete',
  CANCELLED: 'Cancel order',
}
