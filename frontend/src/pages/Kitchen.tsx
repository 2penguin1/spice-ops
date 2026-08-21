import { useState } from 'react'
import { Link } from 'react-router-dom'

import { ApiError, api } from '../api/client'
import type { OrderDetail, OrderStatus } from '../api/types'
import { ErrorBanner } from '../components/ErrorBanner'
import { useApi } from '../hooks/useApi'
import { useOrderStream } from '../hooks/useOrderStream'
import { useAuth } from '../lib/auth'
import { AgeRail, Clock } from '../components/AgeRail'
import { canSetStatus } from '../lib/permissions'
import { ACTION_LABEL } from '../lib/status'

/** Completed and cancelled orders leave the board: it shows work outstanding. */
const COLUMNS: { status: OrderStatus; title: string; hint: string; action?: OrderStatus }[] = [
  { status: 'CONFIRMED', title: 'Waiting', hint: 'Ordered, not started · target 5 min', action: 'PREPARING' },
  { status: 'PREPARING', title: 'Cooking', hint: 'With a cook · target 20 min', action: 'READY' },
  { status: 'READY', title: 'Ready', hint: 'At the pass · target 10 min', action: 'COMPLETED' },
]

export function Kitchen() {
  const { staff } = useAuth()
  const [error, setError] = useState<ApiError | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)

  // One request per column, filtered server-side. Fetching the newest hundred
  // of any status and filtering here would drop an order that had been waiting
  // a while, which is the one the kitchen most needs to see.
  const { data, error: loadError, loading, reload } = useApi(
    () =>
      Promise.all(COLUMNS.map((column) => api.orders.list({ status: column.status, size: 100 }))),
    [],
  )

  useOrderStream(() => reload())

  async function advance(order: OrderDetail, to: OrderStatus) {
    setBusyId(order.id)
    setError(null)
    try {
      // No reload here: the change announces itself on the stream, which is
      // already wired to reload. Calling both fetches the board twice.
      await api.orders.setStatus(order.id, to)
    } catch (caught) {
      setError(caught as ApiError)
    } finally {
      setBusyId(null)
    }
  }

  const byColumn = COLUMNS.map((column, index) => ({
    column,
    orders: data?.[index]?.data ?? [],
  }))

  const openCount = byColumn.reduce((total, entry) => total + entry.orders.length, 0)

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <p className="eyebrow">Live · updates as orders change</p>
          <h1>Kitchen</h1>
        </div>
        <span className="muted small" aria-live="polite">
          {openCount} order{openCount === 1 ? '' : 's'} on the board
        </span>
      </div>

      {error && <ErrorBanner error={error} />}
      {loadError && <ErrorBanner error={loadError} onRetry={reload} />}

      <div className="board">
        {byColumn.map(({ column, orders }) => {
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
                  <AgeRail since={order.updatedAt} status={order.status} />

                  <div className="ticket-card-body">
                    <div className="ticket-card-head">
                      <Link className="num ticket-card-number" to={`/orders/${order.id}`}>
                        {order.orderNumber}
                      </Link>
                      <Clock since={order.updatedAt} status={order.status} />
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
                        {ACTION_LABEL[column.action]}
                      </button>
                    )}
                  </div>
                </article>
              ))}
            </section>
          )
        })}
      </div>
    </div>
  )
}
