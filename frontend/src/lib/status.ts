import type { OrderStatus } from '../api/types'

/**
 * Which buttons to offer for an order's current status.
 *
 * The server is the authority — it re-checks every transition and rejects an
 * illegal one with INVALID_STATUS_TRANSITION. This exists only so the UI can
 * avoid offering a control that would certainly fail.
 */
const NEXT: Record<OrderStatus, OrderStatus[]> = {
  CONFIRMED: ['PREPARING', 'CANCELLED'],
  PREPARING: ['READY', 'CANCELLED'],
  READY: ['COMPLETED', 'CANCELLED'],
  COMPLETED: [],
  CANCELLED: [],
}

export const nextStatuses = (status: OrderStatus): OrderStatus[] => NEXT[status]

/** The words staff use for the action, not the name of the state it lands in. */
export const ACTION_LABEL: Record<OrderStatus, string> = {
  CONFIRMED: 'Reopen',
  PREPARING: 'Start prep',
  READY: 'Mark ready',
  COMPLETED: 'Complete',
  CANCELLED: 'Cancel order',
}
