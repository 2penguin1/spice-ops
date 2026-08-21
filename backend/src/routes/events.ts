import { Hono } from 'hono'
import { streamSSE } from 'hono/streaming'

import { onOrderUpdated, trackStream } from '../lib/events.ts'
import { ApiError } from '../lib/errors.ts'
import { requireAuth, verifyStreamTicket, type AuthVariables } from '../lib/auth.ts'

// Proxies drop idle connections, often at 60s.
const HEARTBEAT_MS = 25_000

export const eventRoutes = new Hono<{ Variables: AuthVariables }>()

  /**
   * A 60 second ticket for the stream. EventSource cannot send an Authorization
   * header, and a 12 hour token in a URL would outlive the logs it lands in.
   */
  .post('/ticket', requireAuth, async (c) => {
    const { issueStreamTicket } = await import('../lib/auth.ts')
    return c.json({ data: { ticket: await issueStreamTicket(c.get('staff')) } })
  })

  /** One long-lived connection per screen. */
  .get('/', async (c) => {
    const ticket = c.req.query('ticket')
    if (!ticket) throw new ApiError('UNAUTHORIZED', 'A stream ticket is required')

    await verifyStreamTicket(ticket)

    return streamSSE(c, async (stream) => {
      let finish: () => void = () => {}

      const unsubscribe = onOrderUpdated((payload) => {
        // An id, not the order: the client refetches, which keeps authorization
        // on the fetch path.
        // A write to a socket the peer already dropped rejects; unhandled,
        // that takes the process down.
        void stream
          .writeSSE({ event: 'order:updated', data: JSON.stringify(payload) })
          .catch(() => finish())
      })

      const heartbeat = setInterval(() => {
        void stream.writeSSE({ event: 'ping', data: '' }).catch(() => finish())
      }, HEARTBEAT_MS)

      await stream.writeSSE({ event: 'ready', data: JSON.stringify({ ok: true }) })

      // Returning from this callback closes the stream, so wait for the client
      // to leave instead.
      await new Promise<void>((resolve) => {
        finish = resolve
        const untrack = trackStream(() => {
          clearInterval(heartbeat)
          unsubscribe()
          resolve()
        })

        // The only cleanup point: without it every reconnect leaks a listener.
        stream.onAbort(() => {
          untrack()
          clearInterval(heartbeat)
          unsubscribe()
          resolve()
        })
      })
    })
  })
