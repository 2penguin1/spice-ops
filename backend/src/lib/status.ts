import { orderStatus } from '../db/schema.ts'
import { ApiError } from './errors.ts'

export type OrderStatus = (typeof orderStatus.enumValues)[number]

/**
 * The order lifecycle.
 *
 *   CONFIRMED -> PREPARING -> READY -> COMPLETED
 *       |            |          |
 *       +------------+----------+---> CANCELLED
 */
const ALLOWED: Record<OrderStatus, readonly OrderStatus[]> = {
  CONFIRMED: ['PREPARING', 'CANCELLED'],
  PREPARING: ['READY', 'CANCELLED'],
  READY: ['COMPLETED', 'CANCELLED'],
  COMPLETED: [],
  CANCELLED: [],
}

export function isNoop(from: OrderStatus, to: OrderStatus): boolean {
  return from === to
}

export function canTransition(from: OrderStatus, to: OrderStatus): boolean {
  return isNoop(from, to) || ALLOWED[from].includes(to)
}

export function assertTransition(from: OrderStatus, to: OrderStatus): void {
  if (!canTransition(from, to)) {
    const allowed = ALLOWED[from]
    const options = allowed.length ? allowed.join(' or ') : 'nothing — it is a final status'
    throw new ApiError(
      'INVALID_STATUS_TRANSITION',
      `An order that is ${from} can only move to ${options}, not ${to}`,
    )
  }
}
