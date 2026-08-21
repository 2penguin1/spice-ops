import { useState } from 'react'
import { Link } from 'react-router-dom'

import { ApiError, api } from '../api/client'
import type { OrderDetail, OrderStatus } from '../api/types'
import { ErrorBanner } from '../components/ErrorBanner'
import { useApi } from '../hooks/useApi'
import { useOrderStream } from '../hooks/useOrderStream'
import { useAuth } from '../lib/auth'
import { formatAge } from '../lib/format'
import { canSetStatus } from '../lib/permissions'

/**
 * The three columns a kitchen cares about. Completed and cancelled orders
 * leave the board — a screen above the pass should show only work outstanding.
 */
const COLUMNS: { status: OrderStatus; title: string; hint: string; action?: OrderStatus }[] = [
  { status: 'CONFIRMED', title: 'Waiting', hint: 'Ordered, not started', action: 'PREPARING' },
  { status: 'PREPARING', title: 'Cooking', hint: 'On the pass', action: 'READY' },
  { status: 'READY', title: 'Ready', hint: 'Waiting to be taken out', action: 'COMPLETED' },
]

const ACTION_TEXT: Partial<Record<OrderStatus, string>> = {
  PREPARING: 'Start prep',
  READY: 'Mark ready',
  COMPLETED: 'Picked up',
}

export function Kitchen() {
  const { staff } = useAuth()
  const [error, setError] = useState<ApiError | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)

  // Everything still in play. 100 is comfortably above a real service; the
  // board is not a place for pagination.
  const { data, error: loadError, loading, reload } = useApi(
    () => api.orders.list({ size: 100 }),
    [],
  )

  // Any change anywhere refreshes the board, including one made by another
  // member of staff on another screen.
  useOrderStream(() => reload())

  async function advance(order: OrderDetail, to: OrderStatus) {
    setBusyId(order.id)
    setError(null)
    try {
      await api.orders.setStatus(order.id, to)
      reload()
    } catch (caught) {
      setError(caught as ApiError)
    } finally {
      setBusyId(null)
    }
  }

  const open = (data?.data ?? []).filter((order) =>
    COLUMNS.some((column) => column.status === order.status),
  )

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <p className="eyebrow">Live · updates as orders change</p>
          <h1>Kitchen</h1>
        </div>
        <span className="muted small">
          {open.length} order{open.length === 1 ? '' : 's'} on the board
        </span>
      </div>

      {error && <ErrorBanner error={error} />}
      {loadError && <ErrorBanner error={loadError} onRetry={reload} />}

      <div className="board">
        {COLUMNS.map((column) => {
          const orders = open.filter((order) => order.status === column.status)
          const mayAct = column.action ? canSetStatus(staff!.role, column.action) : false

          return (
            <section className="board-column" key={column.status}>
              <header>
                <span className={`status status-${column.status}`}>{column.title}</span>
                <span className="num muted small">{orders.length}</span>
              </header>
              <p className="muted small board-hint">{column.hint}</p>

              {orders.length === 0 && !loading && (
                <p className="muted small board-empty">Nothing here.</p>
              )}

              {orders.map((order) => (
                <article className={`ticket-card status-${order.status}`} key={order.id}>
                  <div className="ticket-card-head">
                    <Link className="num ticket-card-number" to={`/orders/${order.id}`}>
                      {order.orderNumber}
                    </Link>
                    <span className="muted small">{formatAge(order.createdAt)}</span>
                  </div>

                  <p className="muted small">{order.customer.name}</p>

                  <ul className="ticket-card-items">
                    {order.items.map((item) => (
                      <li key={item.id}>
                        <span className="num">{item.quantity}×</span> {item.itemName}
                      </li>
                    ))}
                    {order.items.length === 0 && <li className="muted">No items</li>}
                  </ul>

                  {column.action && mayAct && (
                    <button
                      className="btn small"
                      disabled={busyId === order.id}
                      onClick={() => advance(order, column.action!)}
                    >
                      {ACTION_TEXT[column.action]}
                    </button>
                  )}
                </article>
              ))}
            </section>
          )
        })}
      </div>
    </div>
  )
}
