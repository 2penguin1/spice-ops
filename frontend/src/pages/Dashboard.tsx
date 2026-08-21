import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'

import { api } from '../api/client'
import type { OrderStatus } from '../api/types'
import { ErrorBanner } from '../components/ErrorBanner'
import { useApi } from '../hooks/useApi'
import { useOrderStream } from '../hooks/useOrderStream'
import { formatMoney } from '../lib/format'

/**
 * Literal hex, not var(--confirmed): Recharts writes these into SVG
 * presentation attributes, where var() resolves to nothing and the mark simply
 * does not paint. Same five values as the stylesheet.
 */
const STATUS_COLOR: Record<OrderStatus, string> = {
  CONFIRMED: '#2f6bb0',
  PREPARING: '#c2410c',
  READY: '#157f4b',
  COMPLETED: '#6a4c93',
  CANCELLED: '#a11742',
}

const INK = '#5c666e'
const GRID = '#ddd6c8'
const SERIES = '#2f6bb0'

const axis = { stroke: GRID, tick: { fill: INK, fontSize: 12 }, tickLine: false }

const tooltipStyle = {
  background: '#fbf9f4',
  border: '1px solid #d8d2c6',
  borderRadius: 3,
  fontSize: 13,
}

const minutes = (seconds: number | null) => (seconds === null ? '—' : `${Math.round(seconds / 60)} min`)

const shortDay = (iso: string) => iso.slice(5).replace('-', '/')

export function Dashboard() {
  const summary = useApi(() => api.analytics.summary(), [])
  const daily = useApi(() => api.analytics.daily(14), [])
  const hours = useApi(() => api.analytics.hours(), [])
  const staff = useApi(() => api.analytics.staff(), [])
  const items = useApi(() => api.analytics.items(), [])
  // Not reloaded on the stream: it costs a model call, and the reading does
  // not change because one order moved.
  const insights = useApi(() => api.analytics.insights(), [])

  useOrderStream(() => {
    summary.reload()
    daily.reload()
    staff.reload()
  })

  const error = summary.error ?? daily.error ?? hours.error ?? staff.error ?? items.error
  const s = summary.data

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <p className="eyebrow">Live · updates as orders change</p>
          <h1>Dashboard</h1>
        </div>
      </div>

      {error && <ErrorBanner error={error} onRetry={summary.reload} />}

      {/* No key, no panel — never an error where the numbers should be. */}
      {insights.data?.narrative && (
        <section className="panel insight">
          <h2>
            What the numbers say <span className="chip">AI</span>
          </h2>
          <div className="insight-body">
            {insights.data.narrative
              .split(/\r?\n/)
              .map((line) => line.replace(/^[-•]\s*/, '').trim())
              .filter(Boolean)
              .map((line) => (
                <p key={line}>{line}</p>
              ))}
          </div>
          <p className="insight-note">Read from the totals above. No customer or staff records leave the building.</p>
        </section>
      )}

      <div className="tiles">
        <Tile label="Taken today" value={s ? formatMoney(s.revenue.net) : '—'} note="Completed orders" />
        <Tile
          label="Still cooking"
          value={s ? formatMoney(s.revenue.incoming) : '—'}
          note="Preparing and ready"
        />
        <Tile label="Orders today" value={s ? String(s.orders.today) : '—'} note={`${s?.orders.total ?? 0} all time`} />
        <Tile
          label="Average prep"
          value={s ? minutes(s.averagePrepSeconds) : '—'}
          note="Start of cooking to ready"
        />
        <Tile
          label="Cancelled"
          value={s ? `${(s.cancellationRate * 100).toFixed(1)}%` : '—'}
          note="Of all orders"
        />
      </div>

      {/* Separate charts, not two y-axes on one: a dual axis lets the lines
          cross wherever the scales happen to put them. */}
      <div className="charts">
        <Panel title="Orders per day" subtitle="Last 14 days, excluding cancelled">
          <ResponsiveContainer width="100%" height={200}>
            <LineChart data={daily.data ?? []} margin={{ top: 6, right: 12, bottom: 0, left: -18 }}>
              <CartesianGrid stroke={GRID} strokeDasharray="2 4" vertical={false} />
              <XAxis dataKey="day" tickFormatter={shortDay} {...axis} />
              <YAxis allowDecimals={false} {...axis} />
              <Tooltip
                contentStyle={tooltipStyle}
                labelFormatter={(day) => `${day}`}
                formatter={(value) => [Number(value), 'orders']}
              />
              <Line
                type="monotone"
                dataKey="orders"
                stroke={SERIES}
                strokeWidth={2}
                dot={{ r: 3, fill: SERIES, strokeWidth: 0 }}
                activeDot={{ r: 5 }}
              />
            </LineChart>
          </ResponsiveContainer>
        </Panel>

        <Panel title="Revenue per day" subtitle="Last 14 days, excluding cancelled">
          <ResponsiveContainer width="100%" height={200}>
            <LineChart data={daily.data ?? []} margin={{ top: 6, right: 12, bottom: 0, left: 2 }}>
              <CartesianGrid stroke={GRID} strokeDasharray="2 4" vertical={false} />
              <XAxis dataKey="day" tickFormatter={shortDay} {...axis} />
              <YAxis tickFormatter={(value) => `₹${value / 1000}k`} {...axis} />
              <Tooltip
                contentStyle={tooltipStyle}
                formatter={(value) => [formatMoney(Number(value)), 'revenue']}
              />
              <Line
                type="monotone"
                dataKey="revenue"
                stroke={STATUS_COLOR.READY}
                strokeWidth={2}
                dot={{ r: 3, fill: STATUS_COLOR.READY, strokeWidth: 0 }}
                activeDot={{ r: 5 }}
              />
            </LineChart>
          </ResponsiveContainer>
        </Panel>

        <Panel title="When orders arrive" subtitle="Every order ever placed, by hour of day">
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={hours.data ?? []} margin={{ top: 6, right: 12, bottom: 0, left: -18 }}>
              <CartesianGrid stroke={GRID} strokeDasharray="2 4" vertical={false} />
              <XAxis dataKey="hour" tickFormatter={(hour) => `${hour}:00`} interval={2} {...axis} />
              <YAxis allowDecimals={false} {...axis} />
              <Tooltip
                contentStyle={tooltipStyle}
                labelFormatter={(hour) => `${hour}:00 – ${Number(hour) + 1}:00`}
                formatter={(value) => [Number(value), 'orders']}
              />
              <Bar dataKey="orders" fill={SERIES} radius={[4, 4, 0, 0]} barSize={14} />
            </BarChart>
          </ResponsiveContainer>
        </Panel>

        <Panel title="Where orders stand" subtitle="Every order, by status">
          <ResponsiveContainer width="100%" height={200}>
            <BarChart
              data={summary.data?.funnel ?? []}
              layout="vertical"
              margin={{ top: 6, right: 16, bottom: 0, left: 24 }}
            >
              <CartesianGrid stroke={GRID} strokeDasharray="2 4" horizontal={false} />
              <XAxis type="number" allowDecimals={false} {...axis} />
              {/* Named on the axis, so status never depends on colour alone. */}
              <YAxis type="category" dataKey="status" width={86} {...axis} />
              <Tooltip contentStyle={tooltipStyle} formatter={(value) => [Number(value), 'orders']} />
              <Bar dataKey="count" radius={[0, 4, 4, 0]} barSize={16}>
                {(summary.data?.funnel ?? []).map((entry) => (
                  <Cell key={entry.status} fill={STATUS_COLOR[entry.status as OrderStatus]} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </Panel>
      </div>

      <div className="charts">
        <Panel title="Kitchen" subtitle="Orders each person started cooking, and how long they took">
          <table>
            <thead>
              <tr>
                <th>Staff member</th>
                <th className="right">Started</th>
                <th className="right">Finished</th>
                <th className="right">Average prep</th>
              </tr>
            </thead>
            <tbody>
              {(staff.data ?? []).map((cook) => (
                <tr key={cook.id}>
                  <td>{cook.name}</td>
                  <td className="right num">{cook.started}</td>
                  <td className="right num">{cook.finished}</td>
                  <td className="right num">{minutes(cook.averagePrepSeconds)}</td>
                </tr>
              ))}
              {(staff.data ?? []).length === 0 && (
                <tr>
                  <td colSpan={4} className="muted">
                    No prep recorded yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
          <p className="muted small" style={{ marginBottom: 0 }}>
            Orders each person started and finished, and how long they took.
          </p>
        </Panel>

        <Panel title="Most ordered" subtitle="By quantity, excluding cancelled orders">
          <table>
            <thead>
              <tr>
                <th>Dish</th>
                <th className="right">Sold</th>
                <th className="right">Revenue</th>
              </tr>
            </thead>
            <tbody>
              {(items.data ?? []).map((item) => (
                <tr key={item.itemName}>
                  <td>{item.itemName}</td>
                  <td className="right num">{item.quantity}</td>
                  <td className="right num">{formatMoney(item.revenue)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
      </div>
    </div>
  )
}

function Tile({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <div className="tile">
      <p className="eyebrow">{label}</p>
      <p className="tile-value num">{value}</p>
      <p className="muted small">{note}</p>
    </div>
  )
}

function Panel({
  title,
  subtitle,
  children,
}: {
  title: string
  subtitle: string
  children: React.ReactNode
}) {
  return (
    <section className="panel chart-panel">
      <h2>{title}</h2>
      <p className="muted small chart-subtitle">{subtitle}</p>
      {children}
    </section>
  )
}
