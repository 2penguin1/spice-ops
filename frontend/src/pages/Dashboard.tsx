import { api } from '../api/client'
import { ErrorBanner } from '../components/ErrorBanner'
import { Icon, type IconName } from '../components/Icon'
import { useApi } from '../hooks/useApi'
import { useOrderStream } from '../hooks/useOrderStream'
import { formatMoney } from '../lib/format'
import { OrdersByHour, OrdersPerDay, RevenuePerDay, StatusFunnel } from './DashboardCharts'

const minutes = (seconds: number | null) => (seconds === null ? '—' : `${Math.round(seconds / 60)} min`)

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

      <div className="kpis">
        <Kpi
          icon="rupee"
          tone="#157f4b"
          label="Taken today"
          value={s ? formatMoney(s.revenue.net) : '—'}
          note="Completed orders"
        />
        <Kpi
          icon="kitchen"
          tone="#c2410c"
          label="Still cooking"
          value={s ? formatMoney(s.revenue.incoming) : '—'}
          note="Preparing and ready"
        />
        <Kpi
          icon="orders"
          tone="#2f6bb0"
          label="Orders today"
          value={s ? String(s.orders.today) : '—'}
          note={`${s?.orders.total ?? 0} all time`}
        />
        <Kpi
          icon="clock"
          tone="#6a4c93"
          label="Average prep"
          value={s ? minutes(s.averagePrepSeconds) : '—'}
          note="Start of cooking to ready"
        />
        <Kpi
          icon="ban"
          tone="#a11742"
          label="Cancelled"
          value={s ? `${(s.cancellationRate * 100).toFixed(1)}%` : '—'}
          note="Of all orders"
        />
      </div>

      {/* No key, no panel — never an error where the numbers should be. */}
      {insights.data?.narrative && (
        <section className="panel insight">
          <h2>
            What the numbers say <span className="chip">AI</span>
          </h2>
          {/* The model returns one observation per line, already bulleted. */}
          <ul className="insight-body">
            {insights.data.narrative
              .split(/\r?\n/)
              .map((line) => line.replace(/^[-•*]\s*/, '').trim())
              .filter(Boolean)
              .map((line) => (
                <li key={line}>{line}</li>
              ))}
          </ul>
        </section>
      )}

      <SectionLabel>Trends</SectionLabel>

      {/* Separate charts, not two y-axes on one: a dual axis lets the lines
          cross wherever the scales happen to put them. */}
      <div className="charts">
        <Panel title="Orders per day" subtitle="Last 14 days, excluding cancelled">
          <OrdersPerDay data={daily.data ?? []} />
        </Panel>

        <Panel title="Revenue per day" subtitle="Last 14 days, excluding cancelled">
          <RevenuePerDay data={daily.data ?? []} />
        </Panel>

        <Panel title="When orders arrive" subtitle="Every order ever placed, by hour of day">
          <OrdersByHour data={hours.data ?? []} />
        </Panel>

        <Panel title="Where orders stand" subtitle="Every order, by status">
          <StatusFunnel data={summary.data?.funnel ?? []} />
        </Panel>
      </div>

      <SectionLabel>Kitchen and menu</SectionLabel>

      <div className="charts">
        <Panel title="Who cooked what" subtitle="Orders each person started and finished">
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
          <p className="panel-note">
            Counts what each person did, not how hard they worked. There is no shift schedule to
            divide by, so this is deliberately not a utilisation figure.
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

function Kpi({
  icon,
  tone,
  label,
  value,
  note,
}: {
  icon: IconName
  tone: string
  label: string
  value: string
  note: string
}) {
  return (
    <div className="kpi" style={{ ['--tone' as string]: tone }}>
      <div className="kpi-top">
        <span className="kpi-icon">
          <Icon name={icon} className="kpi-glyph" />
        </span>
        <span className="kpi-label">{label}</span>
      </div>
      <div>
        <p className="kpi-value num">{value}</p>
        <p className="kpi-note">{note}</p>
      </div>
    </div>
  )
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return <h2 className="section-label">{children}</h2>
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
      <p className="chart-subtitle">{subtitle}</p>
      {children}
    </section>
  )
}
