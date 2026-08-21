import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { logger } from 'hono/logger'
import { requestId, type RequestIdVariables } from 'hono/request-id'

import { config } from './config.ts'
import { pool } from './db/client.ts'
import { errorHandler, notFoundHandler } from './lib/errors.ts'
import { customerRoutes } from './routes/customers.ts'

const app = new Hono<{ Variables: RequestIdVariables }>()

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

app.route('/customers', customerRoutes)

app.notFound(notFoundHandler)
app.onError(errorHandler)

serve({ fetch: app.fetch, port: config.PORT }, ({ port }) => {
  console.log(`API listening on http://localhost:${port}`)
})

export default app
