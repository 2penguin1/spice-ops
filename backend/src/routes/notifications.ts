import { desc, eq } from 'drizzle-orm'
import { Hono } from 'hono'
import { z } from 'zod'

import { db } from '../db/client.ts'
import { notifications } from '../db/schema.ts'
import { requireRole, type AuthVariables } from '../lib/auth.ts'
import { validate } from '../lib/validation.ts'

/** What was sent to customers, and whether it worked. */
const listQuery = z.object({ orderId: z.uuid().optional() })

export const notificationRoutes = new Hono<{ Variables: AuthVariables }>()

  .get('/', requireRole('ADMIN', 'MANAGER'), validate('query', listQuery, 'INVALID_FILTER'), async (c) => {
    const { orderId } = c.req.valid('query')

    const rows = await db
      .select()
      .from(notifications)
      .where(orderId ? eq(notifications.orderId, orderId) : undefined)
      .orderBy(desc(notifications.createdAt))
      .limit(50)

    return c.json({
      data: rows.map((row) => ({
        id: row.id,
        orderId: row.orderId,
        channel: row.channel,
        recipient: row.recipient,
        body: row.body,
        status: row.status,
        attempts: row.attempts,
        lastError: row.lastError,
        createdAt: row.createdAt.toISOString(),
        sentAt: row.sentAt?.toISOString() ?? null,
      })),
    })
  })
