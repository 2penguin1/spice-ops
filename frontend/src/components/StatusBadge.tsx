import type { OrderStatus } from '../api/types'

export function StatusBadge({ status }: { status: OrderStatus }) {
  return <span className={`status status-${status}`}>{status}</span>
}
