import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { cors } from 'hono/cors'
import { logger } from 'hono/logger'
import { requestId, type RequestIdVariables } from 'hono/request-id'

import { config } from './config.ts'
import { pool } from './db/client.ts'
import { closeCache } from './lib/cache.ts'
import { startNotificationWorker, stopNotificationWorker } from './lib/notifications.ts'
import { closeAllStreams, closeEventBus } from './lib/events.ts'
import { requireAuth, type AuthVariables } from './lib/auth.ts'
import { errorHandler, notFoundHandler } from './lib/errors.ts'
import { authRoutes } from './routes/auth.ts'
import { analyticsRoutes } from './routes/analytics.ts'
import { eventRoutes } from './routes/events.ts'
import { notificationRoutes } from './routes/notifications.ts'
import { staffRoutes } from './routes/staff.ts'
import { customerRoutes } from './routes/customers.ts'
import { orderRoutes } from './routes/orders.ts'

const app = new Hono<{ Variables: RequestIdVariables & AuthVariables }>()

app.use(requestId())
app.use(logger())
app.use(cors({ origin: config.CORS_ORIGIN }))

// Nothing here is large. Reject the rest before parsing it.
app.use(bodyLimit({ maxSize: 256 * 1024 }))

app.get('/health', async (c) => {
  const db = await pool
    .query('select 1')
    .then(() => 'up' as const)
    .catch(() => 'down' as const)

  return c.json({ data: { status: db === 'up' ? 'ok' : 'degraded', db } }, db === 'up' ? 200 : 503)
})

// /health, /auth/login and the event stream are the routes reachable without
// a session token; the stream carries its own short-lived ticket instead.
app.route('/auth', authRoutes)

app.route('/events', eventRoutes)

app.use('/customers/*', requireAuth)
app.use('/orders/*', requireAuth)
app.use('/staff/*', requireAuth)
app.use('/analytics/*', requireAuth)
app.use('/notifications/*', requireAuth)

app.route('/customers', customerRoutes)
app.route('/orders', orderRoutes)
app.route('/staff', staffRoutes)
app.route('/analytics', analyticsRoutes)
app.route('/notifications', notificationRoutes)

app.notFound(notFoundHandler)
app.onError(errorHandler)

startNotificationWorker()

const server = serve({ fetch: app.fetch, port: config.PORT }, ({ port }) => {
  console.log(`API listening on http://localhost:${port}`)
})

/**
 * Stop taking new connections, let the open ones finish, close the pool.
 * Without this a deploy cuts requests that were mid-flight.
 */
let shuttingDown = false

function shutdown(signal: string) {
  if (shuttingDown) return
  shuttingDown = true

  console.log(`${signal} received — draining connections`)
  stopNotificationWorker()

  // Streams stay open by design, so server.close() would wait for ever.
  closeAllStreams()

  server.close(() => {
    void Promise.all([pool.end(), closeEventBus(), closeCache()]).then(() => process.exit(0))
  })

  // A hung request must not block the deploy for ever.
  setTimeout(() => {
    console.error('Shutdown timed out after 10s — exiting anyway')
    process.exit(1)
  }, 10_000).unref()
}

process.on('SIGTERM', () => shutdown('SIGTERM'))
process.on('SIGINT', () => shutdown('SIGINT'))

export default app
