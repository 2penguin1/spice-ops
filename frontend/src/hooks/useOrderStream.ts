import { useEffect, useRef } from 'react'

import { BASE, api } from '../api/client'
import type { OrderStatus } from '../api/types'

export type OrderUpdate = { orderId: string; orderNumber: string; status: OrderStatus }

const RECONNECT_MS = 3000

/**
 * Keeps one connection to the server's event stream open and calls `onUpdate`
 * whenever an order changes anywhere in the restaurant.
 *
 * The browser's own EventSource reconnect is deliberately not relied on: it
 * replays the original URL, and the ticket in it expires after a minute. So a
 * dropped connection is closed and reopened with a fresh ticket instead.
 */
export function useOrderStream(onUpdate: (update: OrderUpdate) => void) {
  const handler = useRef(onUpdate)

  // Assigned after render, not during it: React may render a component more
  // than once before committing, and a ref written in that window can be
  // thrown away.
  useEffect(() => {
    handler.current = onUpdate
  })

  useEffect(() => {
    let source: EventSource | null = null
    let retry: ReturnType<typeof setTimeout> | undefined
    let cancelled = false

    async function connect() {
      try {
        const { ticket } = await api.events.ticket()
        if (cancelled) return

        source = new EventSource(`${BASE}/events?ticket=${encodeURIComponent(ticket)}`)

        source.addEventListener('order:updated', (event) => {
          handler.current(JSON.parse((event as MessageEvent).data))
        })

        source.onerror = () => {
          source?.close()
          if (!cancelled) retry = setTimeout(connect, RECONNECT_MS)
        }
      } catch {
        if (!cancelled) retry = setTimeout(connect, RECONNECT_MS)
      }
    }

    void connect()

    return () => {
      cancelled = true
      source?.close()
      clearTimeout(retry)
    }
  }, [])
}
