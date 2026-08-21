import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'

import { ApiError, api } from '../api/client'
import type { OrderDetail as Order, OrderStatus } from '../api/types'
import { ErrorBanner } from '../components/ErrorBanner'
import { StatusBadge } from '../components/StatusBadge'
import { Timeline } from '../components/Timeline'
import { useApi } from '../hooks/useApi'
import { useOrderStream } from '../hooks/useOrderStream'
import { formatAge, formatMoney, formatWhen } from '../lib/format'
import { MENU } from '../lib/menu'
import { useAuth } from '../lib/auth'
import { canSetStatus, canTakeOrders } from '../lib/permissions'
import { ACTION_LABEL, nextStatuses } from '../lib/status'

const SPINE: Record<OrderStatus, string> = {
  CONFIRMED: 'var(--confirmed)',
  PREPARING: 'var(--preparing)',
  READY: 'var(--ready)',
  COMPLETED: 'var(--completed)',
  CANCELLED: 'var(--cancelled)',
}

export function OrderDetail() {
  const { staff } = useAuth()
  const { id = '' } = useParams()
  const { data, error, loading, reload } = useApi(() => api.orders.get(id), [id])

  // Kept apart from the load error so a failed action does not blank the order
  // already on screen.
  const [actionError, setActionError] = useState<ApiError | null>(null)
  const [busy, setBusy] = useState(false)

  const current = data

  // Another member of staff moving this order updates the page.
  useOrderStream((update) => {
    if (update.orderId === id) reload()
  })

  async function run(action: () => Promise<Order>) {
    setBusy(true)
    setActionError(null)
    try {
      await action()
      reload()
    } catch (caught) {
      setActionError(caught as ApiError)
    } finally {
      setBusy(false)
    }
  }

  if (loading && !current) return <div className="page">Loading order…</div>
  if (error) {
    return (
      <div className="page">
        <ErrorBanner error={error} onRetry={reload} />
        <Link className="btn ghost" to="/orders">
          Back to orders
        </Link>
      </div>
    )
  }
  if (!current) return null

  // Only the moves this role is allowed to make. The server re-checks.
  const allMoves = nextStatuses(current.status)
  const moves = allMoves.filter((next) => canSetStatus(staff!.role, next))
  const mayEditItems = canTakeOrders(staff!.role)

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <p className="eyebrow">
            <Link to="/orders">Orders</Link> / {current.orderNumber}
          </p>
          <h1>{current.customer.name}</h1>
        </div>
        <Link className="btn ghost" to="/orders">
          Back to orders
        </Link>
      </div>

      {actionError && <ErrorBanner error={actionError} />}

      <div className="ticket-grid">
        <div className="ticket" style={{ ['--spine' as string]: SPINE[current.status] }}>
          <div className="ticket-head">
            <div>
              <p className="eyebrow">Order</p>
              <div className="ticket-number">{current.orderNumber}</div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <StatusBadge status={current.status} />
              <div className="muted small" style={{ marginTop: 6 }}>
                Placed {formatWhen(current.createdAt)} · {formatAge(current.createdAt)}
              </div>
            </div>
          </div>

          <hr className="perforation" />

          {current.items.length === 0 ? (
            <p className="muted">No items on this order. Add one below.</p>
          ) : (
            <div className="lines">
              {current.items.map((item) => (
                <div className="line" key={item.id}>
                  <span className="line-qty num">{item.quantity} ×</span>
                  <span>
                    {item.itemName}
                    <div className="muted line-unit num">{formatMoney(item.unitPrice)} each</div>
                  </span>
                  <span className="num">{formatMoney(item.totalPrice)}</span>
                  {mayEditItems ? (
                    <button
                      className="link-btn"
                      disabled={busy}
                      onClick={() => run(() => api.orders.removeItem(current.id, item.id))}
                      aria-label={`Remove ${item.itemName}`}
                    >
                      Remove
                    </button>
                  ) : (
                    <span />
                  )}
                </div>
              ))}
            </div>
          )}

          <div className="total-row">
            <span>Total</span>
            <span>{formatMoney(current.totalAmount)}</span>
          </div>
          <div className="muted small num" style={{ textAlign: 'right' }}>
            {current.itemCount} item{current.itemCount === 1 ? '' : 's'}
          </div>
        </div>

        <div>
          <div className="panel">
            <h2>Move this order on</h2>
            {moves.length === 0 ? (
              <p className="muted small" style={{ margin: 0 }}>
                {allMoves.length === 0
                  ? `This order is ${current.status.toLowerCase()}. Nothing further to do.`
                  : `Moving a ${current.status.toLowerCase()} order on is not your role.`}
              </p>
            ) : (
              <div className="actions">
                {moves.map((next) => (
                  <button
                    key={next}
                    className={`btn${next === 'CANCELLED' ? ' danger' : ''}`}
                    disabled={busy}
                    onClick={() => run(() => api.orders.setStatus(current.id, next))}
                  >
                    {ACTION_LABEL[next]}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="panel">
            <h2>Customer</h2>
            <dl className="dl">
              <dt>Name</dt>
              <dd>{current.customer.name}</dd>
              <dt>Phone</dt>
              <dd className="num">{current.customer.phone}</dd>
              <dt>Email</dt>
              <dd>{current.customer.email ?? <span className="muted">Not given</span>}</dd>
            </dl>
            <div style={{ marginTop: 12 }}>
              <Link className="link-btn" to={`/orders?search=${encodeURIComponent(current.customer.phone)}`}>
                See their other orders
              </Link>
            </div>
          </div>

          {mayEditItems && (
            <AddItem busy={busy} onAdd={(item) => run(() => api.orders.addItem(current.id, item))} />
          )}

          <Timeline orderId={current.id} status={current.status} />
        </div>
      </div>
    </div>
  )
}

function AddItem({
  busy,
  onAdd,
}: {
  busy: boolean
  onAdd: (item: { itemName: string; quantity: number; unitPrice: number }) => void
}) {
  const [name, setName] = useState<string>(MENU[0].itemName)
  const [quantity, setQuantity] = useState(1)

  const price = MENU.find((entry) => entry.itemName === name)?.unitPrice ?? 0

  return (
    <div className="panel">
      <h2>Add an item</h2>
      <form
        onSubmit={(event) => {
          event.preventDefault()
          onAdd({ itemName: name, quantity, unitPrice: price })
          setQuantity(1)
        }}
      >
        <label className="field">
          <span>Dish</span>
          <select value={name} onChange={(event) => setName(event.target.value)} style={{ width: '100%' }}>
            {MENU.map((entry) => (
              <option key={entry.itemName} value={entry.itemName}>
                {entry.itemName} — {formatMoney(entry.unitPrice)}
              </option>
            ))}
          </select>
        </label>

        <label className="field">
          <span>Quantity</span>
          <input
            type="number"
            min={1}
            value={quantity}
            onChange={(event) => setQuantity(Number(event.target.value) || 1)}
          />
        </label>

        <button className="btn" disabled={busy}>
          Add {formatMoney(price * quantity)}
        </button>
      </form>
    </div>
  )
}
