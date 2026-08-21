import { useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'

import { ApiError, api } from '../api/client'
import type { Customer } from '../api/types'
import { ErrorBanner } from '../components/ErrorBanner'
import { Pagination } from '../components/Pagination'
import { SkeletonRows } from '../components/Skeleton'
import { useApi, useDebounced } from '../hooks/useApi'
import { formatWhen } from '../lib/format'

const BLANK = { name: '', phone: '', email: '' }

export function Customers() {
  const [params, setParams] = useSearchParams()
  const search = params.get('search') ?? ''
  const page = Number(params.get('page') ?? 1)
  const debounced = useDebounced(search)

  const { data, error, loading, reload } = useApi(
    () => api.customers.list({ search: debounced || undefined, page, size: 20 }),
    [debounced, page],
  )

  const [form, setForm] = useState(BLANK)
  const [editing, setEditing] = useState<Customer | null>(null)
  const [actionError, setActionError] = useState<ApiError | null>(null)
  const [busy, setBusy] = useState(false)

  function update(changes: Record<string, string | undefined>) {
    const next = new URLSearchParams(params)
    for (const [key, value] of Object.entries(changes)) {
      if (value) next.set(key, value)
      else next.delete(key)
    }
    if (!('page' in changes)) next.delete('page')
    setParams(next)
  }

  async function run(action: () => Promise<unknown>) {
    setBusy(true)
    setActionError(null)
    try {
      await action()
      reload()
      return true
    } catch (caught) {
      setActionError(caught as ApiError)
      return false
    } finally {
      setBusy(false)
    }
  }

  async function save(event: React.FormEvent) {
    event.preventDefault()

    const payload = {
      name: form.name.trim(),
      phone: form.phone.trim(),
      email: form.email.trim() || null,
    }

    const ok = await run(() =>
      editing ? api.customers.update(editing.id, payload) : api.customers.create(payload),
    )

    if (ok) {
      setForm(BLANK)
      setEditing(null)
    }
  }

  const customers = data?.data ?? []

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <p className="eyebrow">Directory</p>
          <h1>Customers</h1>
        </div>
      </div>

      {actionError && <ErrorBanner error={actionError} />}
      {error && <ErrorBanner error={error} onRetry={reload} />}

      <div className="split">
        <div>
          <div className="toolbar">
            <input
              className="search"
              type="search"
              placeholder="Name, email or phone"
              aria-label="Search customers"
              value={search}
              onChange={(event) => update({ search: event.target.value })}
            />
          </div>

          <div className="card table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Phone</th>
                  <th>Email</th>
                  <th>Added</th>
                  <th />
                </tr>
              </thead>

              {loading && !data ? (
                <SkeletonRows columns={5} />
              ) : (
                <tbody>
                  {customers.map((customer) => (
                    <tr key={customer.id}>
                      <td className="nowrap">{customer.name}</td>
                      <td className="num">{customer.phone}</td>
                      <td className="muted">{customer.email ?? '—'}</td>
                      <td className="muted small nowrap">{formatWhen(customer.createdAt)}</td>
                      <td className="right">
                        <div className="actions" style={{ justifyContent: 'flex-end' }}>
                          <Link
                            className="btn ghost small"
                            to={`/orders?search=${encodeURIComponent(customer.phone)}`}
                          >
                            Orders
                          </Link>
                          <button
                            className="btn ghost small"
                            onClick={() => {
                              setEditing(customer)
                              setForm({
                                name: customer.name,
                                phone: customer.phone,
                                email: customer.email ?? '',
                              })
                            }}
                          >
                            Edit
                          </button>
                          <button
                            className="btn danger small"
                            disabled={busy}
                            onClick={() => {
                              // Deleting a customer removes their orders too —
                              // say so plainly before it happens.
                              const sure = window.confirm(
                                `Delete ${customer.name}? Their past orders are deleted with them, and this cannot be undone.`,
                              )
                              if (sure) void run(() => api.customers.remove(customer.id))
                            }}
                          >
                            Delete
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              )}
            </table>

            {!loading && customers.length === 0 && (
              <div className="empty">
                <p>{search ? `Nobody matches “${search}”.` : 'No customers yet.'}</p>
              </div>
            )}
          </div>

          {data && (
            <Pagination
              meta={data.meta.pagination}
              noun="customers"
              onPage={(next) => update({ page: String(next) })}
            />
          )}
        </div>

        <div className="panel">
          <h2>{editing ? `Edit ${editing.name}` : 'Add a customer'}</h2>
          <form onSubmit={save}>
            <label className="field">
              <span>Name</span>
              <input
                required
                value={form.name}
                onChange={(event) => setForm({ ...form, name: event.target.value })}
              />
            </label>
            <label className="field">
              <span>Phone</span>
              <input
                required
                value={form.phone}
                onChange={(event) => setForm({ ...form, phone: event.target.value })}
              />
            </label>
            <label className="field">
              <span>Email (optional)</span>
              <input
                type="email"
                value={form.email}
                onChange={(event) => setForm({ ...form, email: event.target.value })}
              />
            </label>

            <div className="actions">
              <button className="btn" disabled={busy}>
                {editing ? 'Save changes' : 'Add customer'}
              </button>
              {editing && (
                <button
                  type="button"
                  className="btn ghost"
                  onClick={() => {
                    setEditing(null)
                    setForm(BLANK)
                  }}
                >
                  Cancel
                </button>
              )}
            </div>
          </form>
        </div>
      </div>
    </div>
  )
}
