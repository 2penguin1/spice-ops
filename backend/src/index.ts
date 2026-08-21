import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { logger } from 'hono/logger'
import { requestId, type RequestIdVariables } from 'hono/request-id'

import { config } from './config.ts'
import { pool } from './db/client.ts'
import { requireAuth, type AuthVariables } from './lib/auth.ts'
import { errorHandler, notFoundHandler } from './lib/errors.ts'
import { authRoutes } from './routes/auth.ts'
import { staffRoutes } from './routes/staff.ts'
import { customerRoutes } from './routes/customers.ts'
import { orderRoutes } from './routes/orders.ts'

const app = new Hono<{ Variables: RequestIdVariables & AuthVariables }>()

app.use(requestId())
app.use(logger())
app.use(cors({ origin: config.CORS_ORIGIN }))

app.get('/health', async (c) => {
  const db = await pool
    .query('select 1')
    .then(() => 'up' as const)
    .catch(() => 'down' as const)

  return c.json({ data: { status: db === 'up' ? 'ok' : 'degraded', db } }, db === 'up' ? 200 : 503)
})

// /health and /auth/login are the only routes reachable without a token.
app.route('/auth', authRoutes)

app.use('/customers/*', requireAuth)
app.use('/orders/*', requireAuth)
app.use('/staff/*', requireAuth)

app.route('/customers', customerRoutes)
app.route('/orders', orderRoutes)
app.route('/staff', staffRoutes)

app.notFound(notFoundHandler)
app.onError(errorHandler)

const server = serve({ fetch: app.fetch, port: config.PORT }, ({ port }) => {
  console.log(`API listening on http://localhost:${port}`)
})

/**
 * Every hosting platform stops a container by sending SIGTERM and killing it
 * shortly after. Without this, a deploy cuts requests that were mid-flight and
 * leaves database connections for the server to time out.
 *
 * Stop accepting new connections, let the open ones finish, close the pool.
 */
function shutdown(signal: string) {
  console.log(`${signal} received — draining connections`)

  server.close(() => {
    void pool.end().then(() => process.exit(0))
  })

  // If a request hangs, do not block the deploy for ever. unref() so this
  // timer alone never keeps the process alive.
  setTimeout(() => {
    console.error('Shutdown timed out after 10s — exiting anyway')
    process.exit(1)
  }, 10_000).unref()
}

process.on('SIGTERM', () => shutdown('SIGTERM'))
process.on('SIGINT', () => shutdown('SIGINT'))

export default app
