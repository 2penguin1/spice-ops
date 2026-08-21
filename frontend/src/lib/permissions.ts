import type { OrderStatus } from '../api/types'

export type Role = 'ADMIN' | 'MANAGER' | 'SERVICE' | 'KITCHEN'

/**
 * Mirrors the server's rules so the UI does not offer a control that would be
 * refused. The server re-checks every one of these; this is a hint, not the
 * enforcement.
 */
const STATUS_ROLES: Record<OrderStatus, Role[]> = {
  CONFIRMED: ['ADMIN', 'MANAGER'],
  PREPARING: ['ADMIN', 'MANAGER', 'KITCHEN'],
  READY: ['ADMIN', 'MANAGER', 'KITCHEN'],
  COMPLETED: ['ADMIN', 'MANAGER', 'SERVICE'],
  CANCELLED: ['ADMIN', 'MANAGER'],
}

export const canSetStatus = (role: Role, to: OrderStatus) => STATUS_ROLES[to].includes(role)

export const canTakeOrders = (role: Role) => role !== 'KITCHEN'

export const canEditCustomers = (role: Role) => role !== 'KITCHEN'

export const canDeleteCustomers = (role: Role) => role === 'ADMIN' || role === 'MANAGER'
