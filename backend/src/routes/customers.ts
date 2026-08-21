import { and, count, desc, eq, ilike, or, type SQL } from 'drizzle-orm'
import { Hono } from 'hono'
import { z } from 'zod'

import { db } from '../db/client.ts'
import { customers } from '../db/schema.ts'
import { requireRole, type AuthVariables } from '../lib/auth.ts'
import { ApiError } from '../lib/errors.ts'
import { toCustomer } from '../lib/serialize.ts'
import {
  paginationMeta,
  searchTerm,
  shortText,
  paginationQuery,
  toLimitOffset,
  uuidParam,
  validate,
} from '../lib/validation.ts'

// ─── Schemas ─────────────────────────────────────────────────────────────────

const listQuery = paginationQuery.extend({ search: searchTerm })

const customerBody = z.object({
  name: shortText(120),
  // The contract types email as `string | null`, so null is a value, not an absence.
  email: z.email().max(160).nullable().optional(),
  phone: shortText(30),
})

const patchBody = customerBody.partial()

/** Escapes LIKE wildcards, so searching for "50%" finds "50%". */
const contains = (term: string) => `%${term.replace(/[\\%_]/g, '\\$&')}%`

const omitUndefined = <T extends object>(value: T) =>
  Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined))

// ─── Routes ──────────────────────────────────────────────────────────────────

export const customerRoutes = new Hono<{ Variables: AuthVariables }>()

  /** GET /customers — paginated list, optionally filtered by a search term. */
  .get('/', validate('query', listQuery, 'INVALID_FILTER'), async (c) => {
    const { search, ...pagination } = c.req.valid('query')

    const where: SQL | undefined = search
      ? or(
          ilike(customers.name, contains(search)),
          ilike(customers.email, contains(search)),
          ilike(customers.phone, contains(search)),
        )
      : undefined

    const { limit, offset } = toLimitOffset(pagination)

    const [rows, [totals]] = await Promise.all([
      db
        .select()
        .from(customers)
        .where(where)
        .orderBy(desc(customers.createdAt))
        .limit(limit)
        .offset(offset),
      db.select({ total: count() }).from(customers).where(where),
    ])

    return c.json({
      data: rows.map(toCustomer),
      meta: paginationMeta(pagination, totals?.total ?? 0),
    })
  })

  /** POST /customers — a duplicate phone surfaces as 23505 from the unique index. */
  .post('/', requireRole('ADMIN', 'MANAGER', 'SERVICE'), validate('json', customerBody), async (c) => {
    const body = c.req.valid('json')

    const [created] = await db
      .insert(customers)
      .values({ name: body.name, email: body.email ?? null, phone: body.phone })
      .returning()

    return c.json({ data: toCustomer(created!) }, 201)
  })

  /** PATCH /customers/{id} — every field optional; an empty body is a no-op. */
  .patch(
    '/:id',
    requireRole('ADMIN', 'MANAGER', 'SERVICE'),
    validate('param', uuidParam, 'RESOURCE_NOT_FOUND'),
    validate('json', patchBody),
    async (c) => {
      const { id } = c.req.valid('param')
      const changes = omitUndefined(c.req.valid('json'))

      if (Object.keys(changes).length === 0) {
        const [existing] = await db.select().from(customers).where(eq(customers.id, id))
        if (!existing) throw ApiError.notFound('Customer')
        return c.json({ data: toCustomer(existing) })
      }

      const [updated] = await db
        .update(customers)
        .set(changes)
        .where(eq(customers.id, id))
        .returning()

      if (!updated) throw ApiError.notFound('Customer')
      return c.json({ data: toCustomer(updated) })
    },
  )

  /**
   * DELETE /customers/{id} — 204, no body.
   *
   * Cascades to their orders. There is no error code for "still has orders", so
   * deleting a customer necessarily deletes their history.
   */
  .delete(
    '/:id',
    requireRole('ADMIN', 'MANAGER'),
    validate('param', uuidParam, 'RESOURCE_NOT_FOUND'),
    async (c) => {
    const { id } = c.req.valid('param')

    const deleted = await db
      .delete(customers)
      .where(eq(customers.id, id))
      .returning({ id: customers.id })

      if (deleted.length === 0) throw ApiError.notFound('Customer')
      return c.body(null, 204)
    },
  )
