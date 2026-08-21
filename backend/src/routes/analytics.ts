import { Hono } from 'hono'
import { z } from 'zod'

import { cached } from '../lib/cache.ts'
import { requireRole, type AuthVariables } from '../lib/auth.ts'
import { validate } from '../lib/validation.ts'
import * as analytics from '../services/analytics.service.ts'
import { insights } from '../services/ai.service.ts'

// Long enough to absorb a dashboard poll, short enough that nobody makes a
// decision on a stale number.
const TTL_SECONDS = 30

const rangeQuery = z.object({
  days: z.coerce.number().int().min(1).max(90).default(14),
})

export const analyticsRoutes = new Hono<{ Variables: AuthVariables }>()

  .use('*', requireRole('ADMIN', 'MANAGER'))

  .get('/summary', async (c) => c.json({ data: await cached('summary', TTL_SECONDS, analytics.summary) }))

  .get('/daily', validate('query', rangeQuery, 'INVALID_FILTER'), async (c) => {
    const { days } = c.req.valid('query')
    return c.json({ data: await cached(`daily:${days}`, TTL_SECONDS, () => analytics.daily(days)) })
  })

  .get('/hours', async (c) => c.json({ data: await cached('hours', TTL_SECONDS, analytics.byHour) }))

  .get('/staff', async (c) => c.json({ data: await cached('staff', TTL_SECONDS, analytics.byStaff) }))

  .get('/items', async (c) =>
    c.json({ data: await cached('items', TTL_SECONDS, () => analytics.topItems(8)) }),
  )

  /**
   * A written read of the same numbers. Cached far longer than the figures
   * themselves — they do not move fast enough to justify a model call per page
   * load, and each one costs money and a second of latency.
   */
  .get('/insights', async (c) => {
    const data = await cached('insights', 15 * 60, async () => {
      const [summary, daily, hours, items] = await Promise.all([
        analytics.summary(),
        analytics.daily(14),
        analytics.byHour(),
        analytics.topItems(8),
      ])

      return insights({ summary, daily, hours, items })
    })

    return c.json({ data })
  })
