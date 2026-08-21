import { useEffect, useState } from 'react'

import type { OrderStatus } from '../api/types'
import { TARGET_MINUTES } from '../lib/status'

/**
 * How long an order has sat in its current status, as a bar and a clock.
 *
 * A kitchen does not read timestamps, it scans for what is late. The bar fills
 * as an order approaches the time that status should take, so a column of
 * tickets sorts itself by urgency without anyone doing arithmetic.
 */

const pad = (n: number) => String(n).padStart(2, '0')

export function AgeRail({ since, status }: { since: string; status: OrderStatus }) {
  const seconds = useSecondsSince(since)
  const target = TARGET_MINUTES[status] * 60

  return (
    <div className={`rail status-${status}`} aria-hidden="true">
      <div
        className="rail-fill"
        style={{ height: target > 0 ? `${Math.min(100, (seconds / target) * 100)}%` : 0 }}
      />
    </div>
  )
}

/** The clock on its own, for rows with no room for a bar. */
export function Clock({ since, status }: { since: string; status: OrderStatus }) {
  const seconds = useSecondsSince(since)
  const target = TARGET_MINUTES[status] * 60

  return (
    <span className={target > 0 && seconds > target ? 'clock late' : 'clock'}>
      {seconds >= 3600
        ? `${Math.floor(seconds / 3600)}h ${pad(Math.floor((seconds % 3600) / 60))}m`
        : `${pad(Math.floor(seconds / 60))}:${pad(seconds % 60)}`}
    </span>
  )
}

/**
 * Seconds elapsed since `iso`.
 *
 * The clock is the state, not the elapsed time — so a ticket that changes
 * status re-reads correctly on the next render without an effect to resync it.
 */
function useSecondsSince(iso: string): number {
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [])

  return Math.max(0, Math.floor((now - new Date(iso).getTime()) / 1000))
}
