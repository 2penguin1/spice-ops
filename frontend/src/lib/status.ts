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

/**
 * How long an order should spend in each status before it counts as late.
 *
 * Drives the fill on the kitchen board's age rail. These are service targets,
 * not rules the API enforces — nothing rejects a slow order.
 */
export const TARGET_MINUTES: Record<OrderStatus, number> = {
  CONFIRMED: 5,
  PREPARING: 20,
  READY: 10,
  COMPLETED: 0,
  CANCELLED: 0,
}
