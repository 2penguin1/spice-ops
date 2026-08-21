import { useEffect, useRef } from 'react'

import { BASE, api } from '../api/client'
import type { OrderStatus } from '../api/types'

export type OrderUpdate = { orderId: string; orderNumber: string; status: OrderStatus }

const RECONNECT_MS = 3000

/**
 * Calls `onUpdate` whenever an order changes anywhere in the restaurant.
 *
 * EventSource's own reconnect replays the original URL, and the ticket in it
 * lasts a minute — so a dropped connection is reopened with a fresh one.
 */
export function useOrderStream(onUpdate: (update: OrderUpdate) => void) {
  const handler = useRef(onUpdate)

  // Assigned after render, for the same reason as in useApi.
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
          try {
            handler.current(JSON.parse((event as MessageEvent).data))
          } catch {
            // A bad frame is not worth tearing the connection down for.
          }
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
