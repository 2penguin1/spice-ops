import { useState } from 'react'
import { useNavigate } from 'react-router-dom'

import { ApiError, api } from '../api/client'
import type { Customer } from '../api/types'
import { ErrorBanner } from '../components/ErrorBanner'
import { useApi, useDebounced } from '../hooks/useApi'
import { formatMoney } from '../lib/format'
import { MENU } from '../lib/menu'

type Line = { itemName: string; unitPrice: number; quantity: number }

export function NewOrder() {
  const navigate = useNavigate()

  const [lookup, setLookup] = useState('')
  const [chosen, setChosen] = useState<Customer | null>(null)
  const [walkIn, setWalkIn] = useState({ name: '', phone: '', email: '' })
  const [lines, setLines] = useState<Line[]>([])
  const [error, setError] = useState<ApiError | null>(null)
  const [saving, setSaving] = useState(false)

  const debounced = useDebounced(lookup)
  const { data: matches } = useApi(
    () => (debounced ? api.customers.list({ search: debounced, size: 5 }) : Promise.resolve(null)),
    [debounced],
  )

  const total = lines.reduce((sum, line) => sum + line.unitPrice * line.quantity, 0)
  const itemCount = lines.reduce((sum, line) => sum + line.quantity, 0)

  function addLine(itemName: string, unitPrice: number) {
    setLines((current) => {
      const existing = current.findIndex((line) => line.itemName === itemName)
      if (existing === -1) return [...current, { itemName, unitPrice, quantity: 1 }]

      return current.map((line, index) =>
        index === existing ? { ...line, quantity: line.quantity + 1 } : line,
      )
    })
  }

  function setQuantity(itemName: string, quantity: number) {
    setLines((current) =>
      quantity <= 0
        ? current.filter((line) => line.itemName !== itemName)
        : current.map((line) => (line.itemName === itemName ? { ...line, quantity } : line)),
    )
  }

  const customerReady = chosen !== null || (walkIn.name.trim() !== '' && walkIn.phone.trim() !== '')
  const canSubmit = customerReady && lines.length > 0 && !saving

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    setSaving(true)
    setError(null)

    try {
      const order = await api.orders.create({
        customer: chosen
          ? { id: chosen.id }
          : {
              name: walkIn.name.trim(),
              phone: walkIn.phone.trim(),
              email: walkIn.email.trim() || null,
            },
        items: lines,
      })
      navigate(`/orders/${order.id}`)
    } catch (caught) {
      setError(caught as ApiError)
      setSaving(false)
    }
  }

  return (
    <form className="page" onSubmit={submit}>
      <div className="page-head">
        <div>
          <p className="eyebrow">New order</p>
          <h1>Take an order</h1>
        </div>
      </div>

      {error && <ErrorBanner error={error} />}

      <div className="ticket-grid">
        <div className="panel">
          <h2>Menu</h2>
          <div className="row">
            {MENU.map((entry) => (
              <button
                type="button"
                key={entry.itemName}
                className="btn ghost small"
                onClick={() => addLine(entry.itemName, entry.unitPrice)}
              >
                {entry.itemName}
                <span className="muted num">{formatMoney(entry.unitPrice)}</span>
              </button>
            ))}
          </div>

          <hr className="perforation" />

          <h2>This order</h2>
          {lines.length === 0 ? (
            <p className="muted small">Pick a dish above to start the order.</p>
          ) : (
            <div className="lines">
              {lines.map((line) => (
                <div className="line" key={line.itemName}>
                  <input
                    type="number"
                    min={0}
                    value={line.quantity}
                    aria-label={`Quantity of ${line.itemName}`}
                    onChange={(event) => setQuantity(line.itemName, Number(event.target.value))}
                    style={{ width: '3.2rem' }}
                  />
                  <span>
                    {line.itemName}
                    <div className="muted line-unit num">{formatMoney(line.unitPrice)} each</div>
                  </span>
                  <span className="num">{formatMoney(line.unitPrice * line.quantity)}</span>
                  <button
                    type="button"
                    className="link-btn"
                    onClick={() => setQuantity(line.itemName, 0)}
                    aria-label={`Remove ${line.itemName}`}
                  >
                    Remove
                  </button>
                </div>
              ))}
            </div>
          )}

          <div className="total-row">
            <span>Total</span>
            <span>{formatMoney(total)}</span>
          </div>
          <div className="muted small num" style={{ textAlign: 'right' }}>
            {itemCount} item{itemCount === 1 ? '' : 's'}
          </div>
        </div>

        <div>
          <div className="panel">
            <h2>Customer</h2>

            {chosen ? (
              <div>
                <strong>{chosen.name}</strong>
                <div className="muted small num">{chosen.phone}</div>
                <button
                  type="button"
                  className="link-btn"
                  style={{ marginTop: 10 }}
                  onClick={() => setChosen(null)}
                >
                  Choose someone else
                </button>
              </div>
            ) : (
              <>
                <label className="field">
                  <span>Find an existing customer</span>
                  <input
                    type="search"
                    placeholder="Name or phone"
                    value={lookup}
                    onChange={(event) => setLookup(event.target.value)}
                  />
                </label>

                {matches && matches.data.length > 0 && (
                  <div className="lines" style={{ marginBottom: 14 }}>
                    {matches.data.map((customer) => (
                      <button
                        type="button"
                        key={customer.id}
                        className="btn ghost small"
                        onClick={() => {
                          setChosen(customer)
                          setLookup('')
                        }}
                      >
                        {customer.name}
                        <span className="muted num">{customer.phone}</span>
                      </button>
                    ))}
                  </div>
                )}

                {debounced && matches?.data.length === 0 && (
                  <p className="muted small">
                    Nobody matches “{debounced}”. Enter their details below and they will be added.
                  </p>
                )}

                <hr className="perforation" />

                <label className="field">
                  <span>Name</span>
                  <input
                    value={walkIn.name}
                    onChange={(event) => setWalkIn({ ...walkIn, name: event.target.value })}
                  />
                </label>
                <label className="field">
                  <span>Phone</span>
                  <input
                    value={walkIn.phone}
                    onChange={(event) => setWalkIn({ ...walkIn, phone: event.target.value })}
                  />
                </label>
                <label className="field">
                  <span>Email (optional)</span>
                  <input
                    type="email"
                    value={walkIn.email}
                    onChange={(event) => setWalkIn({ ...walkIn, email: event.target.value })}
                  />
                </label>
                <p className="muted small" style={{ margin: 0 }}>
                  If this phone is already on file, the order joins that customer.
                </p>
              </>
            )}
          </div>

          <div className="panel">
            <button className="btn" disabled={!canSubmit} style={{ width: '100%' }}>
              {saving ? 'Placing order…' : `Place order · ${formatMoney(total)}`}
            </button>
            {!canSubmit && !saving && (
              <p className="muted small" style={{ marginTop: 10, marginBottom: 0 }}>
                {lines.length === 0
                  ? 'Add at least one dish.'
                  : 'Choose a customer, or enter a name and phone.'}
              </p>
            )}
          </div>
        </div>
      </div>
    </form>
  )
}
