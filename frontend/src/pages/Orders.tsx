import { Link, useNavigate } from 'react-router-dom'

import { api } from '../api/client'
import { ORDER_STATUSES, type OrderStatus } from '../api/types'
import { ErrorBanner } from '../components/ErrorBanner'
import { Pagination } from '../components/Pagination'
import { SkeletonRows } from '../components/Skeleton'
import { StatusBadge } from '../components/StatusBadge'
import { useApi, useDebounced } from '../hooks/useApi'
import { useFilterParams } from '../hooks/useFilterParams'
import { useOrderStream } from '../hooks/useOrderStream'
import { useAuth } from '../lib/auth'
import { canTakeOrders } from '../lib/permissions'
import { formatAge, formatMoney } from '../lib/format'

const SIZE = 20

export function Orders() {
  const { staff } = useAuth()
  const { params, update, clear, page } = useFilterParams()
  const navigate = useNavigate()

  const search = params.get('search') ?? ''
  const status = (params.get('status') as OrderStatus | null) ?? undefined

  const debouncedSearch = useDebounced(search)

  const { data, error, loading, reload } = useApi(
    () => api.orders.list({ search: debouncedSearch || undefined, status, page, size: SIZE }),
    [debouncedSearch, status, page],
  )

  // Someone else advancing an order updates this list without a refresh.
  useOrderStream(() => reload())

  const orders = data?.data ?? []

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <p className="eyebrow">Service floor</p>
          <h1>Orders</h1>
        </div>
        {canTakeOrders(staff!.role) && (
          <Link className="btn" to="/orders/new">
            Take an order
          </Link>
        )}
      </div>

      <div className="toolbar">
        <input
          className="search"
          type="search"
          placeholder="Order number, customer name or phone"
          aria-label="Search orders"
          value={search}
          onChange={(event) => update({ search: event.target.value })}
        />

        <div className="filters" role="group" aria-label="Filter by status">
          <button aria-pressed={!status} onClick={() => update({ status: undefined })}>
            All
          </button>
          {ORDER_STATUSES.map((value) => (
            <button
              key={value}
              aria-pressed={status === value}
              onClick={() => update({ status: status === value ? undefined : value })}
            >
              {value}
            </button>
          ))}
        </div>
      </div>

      {error && <ErrorBanner error={error} onRetry={reload} />}

      <div className="card table-wrap">
        <table>
          <thead>
            <tr>
              <th>Order</th>
              <th>Customer</th>
              <th className="right">Items</th>
              <th className="right">Total</th>
              <th>Status</th>
              <th className="right">Placed</th>
            </tr>
          </thead>

          {loading && !data ? (
            <SkeletonRows />
          ) : (
            <tbody>
              {orders.map((order) => (
                <tr
                  key={order.id}
                  className="clickable"
                  onClick={() => navigate(`/orders/${order.id}`)}
                >
                  <td className="num">
                    {/* A link, not only a row click: this is how keyboard and
                        screen-reader users open an order. */}
                    <Link className="row-link" to={`/orders/${order.id}`}>
                      {order.orderNumber}
                    </Link>
                  </td>
                  <td>
                    {order.customer.name}
                    <div className="muted small num">{order.customer.phone}</div>
                  </td>
                  <td className="right num">{order.itemCount}</td>
                  <td className="right num">{formatMoney(order.totalAmount)}</td>
                  <td>
                    <StatusBadge status={order.status} />
                  </td>
                  <td className="right muted small">{formatAge(order.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          )}
        </table>

        {!loading && orders.length === 0 && (
          <div className="empty">
            <p>
              {search || status
                ? 'No orders match these filters.'
                : 'No orders yet. The first one starts here.'}
            </p>
            {search || status ? (
              <button className="btn ghost" onClick={clear}>
                Clear filters
              </button>
            ) : (
              canTakeOrders(staff!.role) && (
                <Link className="btn" to="/orders/new">
                  Take an order
                </Link>
              )
            )}
          </div>
        )}
      </div>

      {data && (
        <Pagination
          meta={data.meta.pagination}
          noun="orders"
          onPage={(next) => update({ page: String(next) })}
        />
      )}
    </div>
  )
}
