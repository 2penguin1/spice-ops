import { Hono } from 'hono'
import { streamSSE } from 'hono/streaming'

import { onOrderUpdated, trackStream } from '../lib/events.ts'
import { ApiError } from '../lib/errors.ts'
import { requireAuth, verifyStreamTicket, type AuthVariables } from '../lib/auth.ts'

// Proxies and load balancers close a connection that has been idle too long,
// often at 60 seconds. A comment every 25s keeps it open without meaning anything.
const HEARTBEAT_MS = 25_000

export const eventRoutes = new Hono<{ Variables: AuthVariables }>()

  /**
   * A short-lived ticket for the event stream.
   *
   * EventSource cannot send an Authorization header, and putting a 12 hour
   * session token in a URL would leave it in access logs and Referer headers.
   * This ticket lasts 60 seconds and is accepted on no other route.
   */
  .post('/ticket', requireAuth, async (c) => {
    const { issueStreamTicket } = await import('../lib/auth.ts')
    return c.json({ data: { ticket: await issueStreamTicket(c.get('staff')) } })
  })

  /** GET /events — one long-lived connection per screen. */
  .get('/', async (c) => {
    const ticket = c.req.query('ticket')
    if (!ticket) throw new ApiError('UNAUTHORIZED', 'A stream ticket is required')

    await verifyStreamTicket(ticket)

    return streamSSE(c, async (stream) => {
      let finish: () => void = () => {}

      const unsubscribe = onOrderUpdated((payload) => {
        // The frame carries an id, not the order. The client refetches, which
        // keeps authorization on the fetch path and the response shape in one
        // place.
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

      // Stay open until the client goes away. Returning from this callback
      // closes the stream, so it cannot be a long sleep: Node's setTimeout
      // overflows above 2^31-1 milliseconds and fires immediately, which would
      // hang up on every screen the moment it connected.
      await new Promise<void>((resolve) => {
        finish = resolve
        const untrack = trackStream(() => {
          clearInterval(heartbeat)
          unsubscribe()
          resolve()
        })

        // Also the only cleanup point — without it every reconnect leaves its
        // listener and timer behind, a leak that grows for as long as the
        // process runs.
        stream.onAbort(() => {
          untrack()
          clearInterval(heartbeat)
          unsubscribe()
          resolve()
        })
      })
    })
  })
