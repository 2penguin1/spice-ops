import { and, count, desc, eq, ilike, or, type SQL } from 'drizzle-orm'
import { Hono } from 'hono'
import { z } from 'zod'

import { db } from '../db/client.ts'
import { customers } from '../db/schema.ts'
import { ApiError } from '../lib/errors.ts'
import { toCustomer } from '../lib/serialize.ts'
import {
  paginationMeta,
  paginationQuery,
  toLimitOffset,
  uuidParam,
  validate,
} from '../lib/validation.ts'

// ─── Schemas ─────────────────────────────────────────────────────────────────

const listQuery = paginationQuery.extend({ search: z.string().trim().min(1).optional() })

const customerBody = z.object({
  name: z.string().trim().min(1),
  // The contract types email as `string | null`, so null is a value, not an absence.
  email: z.email().nullable().optional(),
  phone: z.string().trim().min(1),
})

const patchBody = customerBody.partial()

/**
 * Escapes the LIKE wildcards so a customer searching for "50%" gets what they
 * asked for. Backslash is Postgres's default LIKE escape character.
 */
const contains = (term: string) => `%${term.replace(/[\\%_]/g, '\\$&')}%`

/** Drops keys the caller omitted, so PATCH updates only what was sent. */
const omitUndefined = <T extends object>(value: T) =>
  Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined))

// ─── Routes ──────────────────────────────────────────────────────────────────

export const customerRoutes = new Hono()

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

    // Two queries, both filtered the same way: the page, and how many there are.
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

  /** POST /customers — create. A duplicate phone surfaces as 23505 from the unique index. */
  .post('/', validate('json', customerBody), async (c) => {
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
   * The foreign key cascades, so this also removes the customer's orders. The
   * contract lists no conflict error for a customer who still has orders, which
   * forces that behaviour — it is the top open question in questions.md §1.1.
   */
  .delete('/:id', validate('param', uuidParam, 'RESOURCE_NOT_FOUND'), async (c) => {
    const { id } = c.req.valid('param')

    const deleted = await db
      .delete(customers)
      .where(eq(customers.id, id))
      .returning({ id: customers.id })

    if (deleted.length === 0) throw ApiError.notFound('Customer')
    return c.body(null, 204)
  })
