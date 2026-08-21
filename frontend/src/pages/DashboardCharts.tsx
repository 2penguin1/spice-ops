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

import { ORDER_STATUSES, type OrderStatus } from '../api/types'
import { formatMoney } from '../lib/format'

/**
 * The four charts on the dashboard, and the chrome they share.
 *
 * Literal hex rather than var(--confirmed): Recharts writes these into SVG
 * presentation attributes, where var() resolves to nothing and the mark simply
 * does not paint. Same values as the stylesheet.
 */
const STATUS_COLOR: Record<OrderStatus, string> = {
  CONFIRMED: '#2f6bb0',
  PREPARING: '#c2410c',
  READY: '#157f4b',
  COMPLETED: '#6a4c93',
  CANCELLED: '#a11742',
}

/**
 * Marks on a single-series chart are ink, not a hue.
 *
 * Colour means status everywhere else in this app. A chart with one series has
 * no identity to encode, so borrowing a status hue for it would say something
 * untrue — these bars are not "confirmed orders", they are just orders.
 */
const SERIES = '#37424e'

const MUTED = '#5a6b78'
const GRID = '#e3e8eb'

/** Recessive by design: the data should be the only thing with weight. */
const axis = {
  tick: { fill: MUTED, fontSize: 11 },
  axisLine: false,
  tickLine: false,
} as const

const grid = <CartesianGrid stroke={GRID} strokeDasharray="3 3" vertical={false} />

const tooltip = {
  contentStyle: {
    background: '#fff',
    border: '1px solid #d3dade',
    borderRadius: 8,
    boxShadow: '0 10px 28px -8px rgb(18 23 28 / 0.16)',
    fontSize: 12,
    padding: '8px 11px',
  },
  labelStyle: { color: MUTED, fontSize: 11, marginBottom: 3 },
  itemStyle: { color: '#12171c', padding: 0 },
  cursor: { fill: 'rgb(18 23 28 / 0.05)' },
} as const

const line = (color: string) =>
  ({
    type: 'monotone',
    strokeWidth: 2,
    stroke: color,
    dot: false,
    activeDot: { r: 4, fill: color, stroke: '#fff', strokeWidth: 2 },
  }) as const

const shortDay = (iso: string) => iso.slice(5).replace('-', '/')

type Daily = { day: string; orders: number; revenue: number }[]
type Hourly = { hour: number; orders: number }[]
type Funnel = { status: string; count: number }[]

export function OrdersPerDay({ data }: { data: Daily }) {
  return (
    <Plot>
      <LineChart data={data} margin={{ top: 6, right: 10, bottom: 0, left: -20 }}>
        {grid}
        <XAxis dataKey="day" tickFormatter={shortDay} minTickGap={26} {...axis} />
        <YAxis allowDecimals={false} {...axis} />
        <Tooltip {...tooltip} formatter={(value) => [Number(value), 'orders']} />
        <Line dataKey="orders" {...line(SERIES)} />
      </LineChart>
    </Plot>
  )
}

export function RevenuePerDay({ data }: { data: Daily }) {
  return (
    <Plot>
      <LineChart data={data} margin={{ top: 6, right: 10, bottom: 0, left: -4 }}>
        {grid}
        <XAxis dataKey="day" tickFormatter={shortDay} minTickGap={26} {...axis} />
        <YAxis tickFormatter={(value) => `₹${value / 1000}k`} {...axis} />
        <Tooltip {...tooltip} formatter={(value) => [formatMoney(Number(value)), 'revenue']} />
        <Line dataKey="revenue" {...line(SERIES)} />
      </LineChart>
    </Plot>
  )
}

export function OrdersByHour({ data }: { data: Hourly }) {
  return (
    <Plot>
      <BarChart data={data} margin={{ top: 6, right: 10, bottom: 0, left: -20 }}>
        {grid}
        <XAxis dataKey="hour" tickFormatter={(hour) => `${hour}:00`} interval={2} {...axis} />
        <YAxis allowDecimals={false} {...axis} />
        <Tooltip
          {...tooltip}
          labelFormatter={(hour) => `${hour}:00 – ${Number(hour) + 1}:00`}
          formatter={(value) => [Number(value), 'orders']}
        />
        <Bar dataKey="orders" fill={SERIES} radius={[3, 3, 0, 0]} barSize={13} />
      </BarChart>
    </Plot>
  )
}

export function StatusFunnel({ data }: { data: Funnel }) {
  // Lifecycle order, not whatever order the GROUP BY came back in. A funnel
  // read top to bottom should follow the path an order actually takes.
  const ordered = ORDER_STATUSES.map((status) => ({
    status,
    count: data.find((entry) => entry.status === status)?.count ?? 0,
  }))

  return (
    <Plot>
      <BarChart data={ordered} layout="vertical" margin={{ top: 6, right: 14, bottom: 0, left: 22 }}>
        <CartesianGrid stroke={GRID} strokeDasharray="3 3" horizontal={false} />
        <XAxis type="number" allowDecimals={false} {...axis} />
        {/* Named on the axis. Five saturated hues cannot all be told apart under
            colour blindness, so the label is what carries identity here. */}
        <YAxis type="category" dataKey="status" width={84} {...axis} />
        <Tooltip {...tooltip} formatter={(value) => [Number(value), 'orders']} />
        <Bar dataKey="count" radius={[0, 3, 3, 0]} barSize={15}>
          {ordered.map((entry) => (
            <Cell key={entry.status} fill={STATUS_COLOR[entry.status as OrderStatus]} />
          ))}
        </Bar>
      </BarChart>
    </Plot>
  )
}

/** A recessed well behind every plot, so the chart reads as an instrument. */
function Plot({ children }: { children: React.ReactElement }) {
  return (
    <div className="chart-plot">
      <ResponsiveContainer width="100%" height={196}>
        {children}
      </ResponsiveContainer>
    </div>
  )
}
