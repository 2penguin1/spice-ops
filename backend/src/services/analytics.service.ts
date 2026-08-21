import { sql } from 'drizzle-orm'

import { db } from '../db/client.ts'

/**
 * Every number on the dashboard, as SQL over the tables we already have.
 *
 * There is no reporting store and no denormalised rollup: at this data size
 * (see docs/hld.md §2) aggregating live is both simpler and always correct.
 * The upgrade path, if it is ever needed, is an hourly rollup table fed by the
 * same event log — not a second copy of the truth.
 */

const toNumber = (value: unknown) => Number(value ?? 0)

export type Summary = {
  revenue: { net: number; incoming: number }
  orders: { total: number; today: number }
  funnel: { status: string; count: number }[]
  cancellationRate: number
  averagePrepSeconds: number | null
}

export async function summary(): Promise<Summary> {
  const { rows } = await db.execute(sql`
    WITH order_totals AS (
      SELECT o.id, o.status, o.created_at,
             coalesce(sum(i.total_price), 0) AS total
      FROM orders o
      LEFT JOIN order_items i ON i.order_id = o.id
      GROUP BY o.id
    ),
    prep AS (
      -- Prep time comes from the event log, which is why those timestamps are
      -- not duplicated onto orders. Orders still cooking have no READY event
      -- and are excluded rather than counted as zero.
      SELECT ready.created_at - started.created_at AS took
      FROM order_status_events started
      JOIN order_status_events ready
        ON ready.order_id = started.order_id AND ready.to_status = 'READY'
      WHERE started.to_status = 'PREPARING'
    )
    SELECT
      (SELECT coalesce(sum(total), 0) FROM order_totals WHERE status = 'COMPLETED')            AS net,
      (SELECT coalesce(sum(total), 0) FROM order_totals WHERE status IN ('PREPARING','READY')) AS incoming,
      (SELECT count(*) FROM orders)                                                            AS total_orders,
      (SELECT count(*) FROM orders WHERE created_at >= date_trunc('day', now()))               AS today_orders,
      (SELECT count(*) FROM orders WHERE status = 'CANCELLED')                                 AS cancelled,
      (SELECT extract(epoch FROM avg(took)) FROM prep)                                         AS avg_prep_seconds
  `)

  const row = rows[0] as Record<string, unknown>

  const funnel = await db.execute(sql`
    SELECT status::text AS status, count(*)::int AS count
    FROM orders GROUP BY status ORDER BY status
  `)

  const total = toNumber(row.total_orders)

  return {
    revenue: { net: toNumber(row.net), incoming: toNumber(row.incoming) },
    orders: { total, today: toNumber(row.today_orders) },
    funnel: funnel.rows.map((entry) => ({
      status: String((entry as Record<string, unknown>).status),
      count: toNumber((entry as Record<string, unknown>).count),
    })),
    cancellationRate: total === 0 ? 0 : toNumber(row.cancelled) / total,
    averagePrepSeconds: row.avg_prep_seconds === null ? null : toNumber(row.avg_prep_seconds),
  }
}

export type DailyPoint = { day: string; orders: number; revenue: number }

/**
 * Orders and revenue per day.
 *
 * generate_series supplies the days, so a day with no trade appears as a zero
 * rather than a gap the chart would draw straight through.
 */
export async function daily(days: number): Promise<DailyPoint[]> {
  const { rows } = await db.execute(sql`
    WITH calendar AS (
      SELECT generate_series(
        date_trunc('day', now()) - make_interval(days => ${days - 1}),
        date_trunc('day', now()),
        interval '1 day'
      ) AS day
    ),
    totals AS (
      SELECT date_trunc('day', o.created_at) AS day,
             count(DISTINCT o.id) AS orders,
             coalesce(sum(i.total_price), 0) AS revenue
      FROM orders o
      LEFT JOIN order_items i ON i.order_id = o.id
      WHERE o.status <> 'CANCELLED'
      GROUP BY 1
    )
    SELECT to_char(calendar.day, 'YYYY-MM-DD') AS day,
           coalesce(totals.orders, 0)::int     AS orders,
           coalesce(totals.revenue, 0)         AS revenue
    FROM calendar
    LEFT JOIN totals ON totals.day = calendar.day
    ORDER BY calendar.day
  `)

  return rows.map((row) => {
    const entry = row as Record<string, unknown>
    return {
      day: String(entry.day),
      orders: toNumber(entry.orders),
      revenue: toNumber(entry.revenue),
    }
  })
}

export type HourPoint = { hour: number; orders: number }

/** When the kitchen is busy. Every hour is present, so the shape is honest. */
export async function byHour(): Promise<HourPoint[]> {
  const { rows } = await db.execute(sql`
    WITH hours AS (SELECT generate_series(0, 23) AS hour)
    SELECT hours.hour,
           count(orders.id)::int AS orders
    FROM hours
    LEFT JOIN orders ON extract(hour FROM orders.created_at) = hours.hour
    GROUP BY hours.hour
    ORDER BY hours.hour
  `)

  return rows.map((row) => {
    const entry = row as Record<string, unknown>
    return { hour: toNumber(entry.hour), orders: toNumber(entry.orders) }
  })
}

export type StaffPoint = {
  id: string
  name: string
  role: string
  started: number
  finished: number
  averagePrepSeconds: number | null
}

/**
 * Per-cook throughput and speed.
 *
 * Deliberately not a utilization percentage. That needs a scheduled-shift
 * denominator, and a metric about a person built on data nobody keeps accurate
 * is worse than no metric — see questions.md §3.7. These two numbers come
 * from what the system actually recorded.
 */
export async function byStaff(): Promise<StaffPoint[]> {
  const { rows } = await db.execute(sql`
    WITH work AS (
      SELECT started.staff_id,
             started.order_id,
             ready.created_at - started.created_at AS took
      FROM order_status_events started
      LEFT JOIN order_status_events ready
        ON ready.order_id = started.order_id AND ready.to_status = 'READY'
      WHERE started.to_status = 'PREPARING' AND started.staff_id IS NOT NULL
    )
    SELECT s.id, s.name, s.role::text AS role,
           count(work.order_id)::int                        AS started,
           count(work.took)::int                            AS finished,
           extract(epoch FROM avg(work.took))               AS avg_prep_seconds
    FROM staff s
    JOIN work ON work.staff_id = s.id
    GROUP BY s.id, s.name, s.role
    ORDER BY started DESC
  `)

  return rows.map((row) => {
    const entry = row as Record<string, unknown>
    return {
      id: String(entry.id),
      name: String(entry.name),
      role: String(entry.role),
      started: toNumber(entry.started),
      finished: toNumber(entry.finished),
      averagePrepSeconds: entry.avg_prep_seconds === null ? null : toNumber(entry.avg_prep_seconds),
    }
  })
}

export type TopItem = { itemName: string; quantity: number; revenue: number }

export async function topItems(limit: number): Promise<TopItem[]> {
  const { rows } = await db.execute(sql`
    SELECT i.item_name AS item_name,
           sum(i.quantity)::int AS quantity,
           sum(i.total_price)   AS revenue
    FROM order_items i
    JOIN orders o ON o.id = i.order_id
    WHERE o.status <> 'CANCELLED'
    GROUP BY i.item_name
    ORDER BY quantity DESC
    LIMIT ${limit}
  `)

  return rows.map((row) => {
    const entry = row as Record<string, unknown>
    return {
      itemName: String(entry.item_name),
      quantity: toNumber(entry.quantity),
      revenue: toNumber(entry.revenue),
    }
  })
}
