import { count, desc, eq } from 'drizzle-orm'
import { Hono } from 'hono'
import { z } from 'zod'

import { db } from '../db/client.ts'
import { staff, staffRole } from '../db/schema.ts'
import { ApiError } from '../lib/errors.ts'
import { hashPassword, requireRole, type AuthVariables } from '../lib/auth.ts'
import { paginationMeta, paginationQuery, toLimitOffset, uuidParam, validate } from '../lib/validation.ts'

const staffBody = z.object({
  name: z.string().trim().min(1),
  email: z.email().transform((value) => value.toLowerCase()),
  password: z.string().min(8, 'Use at least 8 characters'),
  role: z.enum(staffRole.enumValues),
})

const patchBody = staffBody.partial()

/** The password hash never leaves the server, so it is stripped here. */
const toStaff = (row: typeof staff.$inferSelect) => ({
  id: row.id,
  name: row.name,
  email: row.email,
  role: row.role,
  isActive: row.isActive,
  createdAt: row.createdAt.toISOString(),
  updatedAt: row.updatedAt.toISOString(),
})

export const staffRoutes = new Hono<{ Variables: AuthVariables }>()

  .get('/', requireRole('ADMIN', 'MANAGER'), validate('query', paginationQuery, 'INVALID_FILTER'), async (c) => {
    const pagination = c.req.valid('query')
    const { limit, offset } = toLimitOffset(pagination)

    const [rows, [totals]] = await Promise.all([
      db.select().from(staff).orderBy(desc(staff.createdAt)).limit(limit).offset(offset),
      db.select({ total: count() }).from(staff),
    ])

    return c.json({ data: rows.map(toStaff), meta: paginationMeta(pagination, totals?.total ?? 0) })
  })

  .post('/', requireRole('ADMIN', 'MANAGER'), validate('json', staffBody), async (c) => {
    const body = c.req.valid('json')

    const [created] = await db
      .insert(staff)
      .values({
        name: body.name,
        email: body.email,
        passwordHash: hashPassword(body.password),
        role: body.role,
      })
      .returning()

    return c.json({ data: toStaff(created!) }, 201)
  })

  .patch(
    '/:id',
    requireRole('ADMIN', 'MANAGER'),
    validate('param', uuidParam, 'RESOURCE_NOT_FOUND'),
    validate('json', patchBody.extend({ isActive: z.boolean().optional() })),
    async (c) => {
      const { id } = c.req.valid('param')
      const { password, ...rest } = c.req.valid('json')

      const changes = Object.fromEntries(
        Object.entries({ ...rest, ...(password ? { passwordHash: hashPassword(password) } : {}) }).filter(
          ([, value]) => value !== undefined,
        ),
      )

      if (Object.keys(changes).length === 0) {
        const [existing] = await db.select().from(staff).where(eq(staff.id, id))
        if (!existing) throw ApiError.notFound('Staff member')
        return c.json({ data: toStaff(existing) })
      }

      const [updated] = await db.update(staff).set(changes).where(eq(staff.id, id)).returning()
      if (!updated) throw ApiError.notFound('Staff member')

      return c.json({ data: toStaff(updated) })
    },
  )

  /**
   * Only an admin removes people. A manager deactivates instead, which keeps
   * their name on the order history they are attached to.
   */
  .delete('/:id', requireRole('ADMIN'), validate('param', uuidParam, 'RESOURCE_NOT_FOUND'), async (c) => {
    const { id } = c.req.valid('param')

    if (id === c.get('staff').id) {
      throw ApiError.validation('You cannot delete your own account')
    }

    const deleted = await db.delete(staff).where(eq(staff.id, id)).returning({ id: staff.id })
    if (deleted.length === 0) throw ApiError.notFound('Staff member')

    return c.body(null, 204)
  })
