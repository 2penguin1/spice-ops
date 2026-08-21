import { api } from '../api/client'
import type { OrderStatus } from '../api/types'
import { ErrorBanner } from './ErrorBanner'
import { useApi } from '../hooks/useApi'
import { formatWhen } from '../lib/format'

/** Reloads on a status change, so an advance made here shows up immediately. */
export function Timeline({ orderId, status }: { orderId: string; status: OrderStatus }) {
  const { data, error, loading } = useApi(() => api.orders.timeline(orderId), [orderId, status])

  return (
    <div className="panel">
      <h2>History</h2>

      {loading && !data && <div className="skeleton" style={{ width: '70%' }} />}
      {error && <ErrorBanner error={error} />}

      {data && (
        <ol className="timeline">
          {data.map((event) => (
            <li key={event.id} className={`timeline-entry status-${event.toStatus}`}>
              <div>
                <span className="timeline-status">{event.toStatus}</span>
                {event.fromStatus && <span className="muted small"> from {event.fromStatus}</span>}
                {!event.fromStatus && <span className="muted small"> order placed</span>}
              </div>
              <time className="muted small num" dateTime={event.createdAt}>
                {formatWhen(event.createdAt)}
              </time>
            </li>
          ))}
        </ol>
      )}
    </div>
  )
}
