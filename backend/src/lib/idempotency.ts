import { createHash } from 'node:crypto'

import { eq, sql } from 'drizzle-orm'

import { db } from '../db/client.ts'
import { idempotencyKeys } from '../db/schema.ts'
import { ApiError, fromPostgresError } from './errors.ts'
import type { Tx } from './orders.tx.ts'

/**
 * Makes a retried request safe.
 *
 * Restaurant wifi drops mid-request. The client cannot tell a lost response
 * from a lost request, so it retries — and without this that retry becomes a
 * second order for the same food.
 *
 * The mechanism is the unique primary key, not a lock or a Redis entry:
 *
 *   1. The key row is inserted inside the same transaction as the order, so
 *      the two commit together or not at all.
 *   2. A second request with the same key BLOCKS on that primary key until the
 *      first transaction finishes — Postgres does that for us, for exactly the
 *      right duration.
 *   3. It then fails with 23505, reads the stored response, and replays it.
 *
 * No polling, no state column, no distributed lock.
 */

const hashOf = (body: unknown) => createHash('sha256').update(JSON.stringify(body)).digest('hex')

export type Replay = { statusCode: number; body: unknown }

/** Returns a previous response for this key, or null if it is new. */
export async function findReplay(key: string, endpoint: string, body: unknown): Promise<Replay | null> {
  const [existing] = await db.select().from(idempotencyKeys).where(eq(idempotencyKeys.key, key))
  if (!existing) return null

  return asReplay(existing, endpoint, body)
}

function asReplay(
  existing: typeof idempotencyKeys.$inferSelect,
  endpoint: string,
  body: unknown,
): Replay {
  // Same key, different request: the client has a bug, and replaying the old
  // response would hide it while quietly dropping the new order.
  if (existing.endpoint !== endpoint || existing.requestHash !== hashOf(body)) {
    throw ApiError.validation(
      'This Idempotency-Key was already used for a different request. Use a new key.',
    )
  }

  return { statusCode: existing.statusCode, body: existing.responseBody }
}

/** Claims the key inside the caller's transaction. Throws 23505 if it is taken. */
export function claimKey(
  tx: Tx,
  entry: { key: string; endpoint: string; body: unknown; statusCode: number; response: unknown },
) {
  return tx.insert(idempotencyKeys).values({
    key: entry.key,
    endpoint: entry.endpoint,
    requestHash: hashOf(entry.body),
    statusCode: entry.statusCode,
    responseBody: entry.response as object,
  })
}

/**
  * True only for the unique violation on the key itself.
  *
  * Checks the constraint name, not just the SQLSTATE: a duplicate phone raises
  * the same 23505 from inside the same transaction, and treating that as a
  * replay would return someone else's order.
  */
export function isDuplicateKey(error: unknown): boolean {
  if (fromPostgresError(error)?.code !== 'RESOURCE_ALREADY_EXISTS') return false

  const constraint = (error as { cause?: { constraint?: string }; constraint?: string })
  const name = constraint.constraint ?? constraint.cause?.constraint ?? ''

  return name.includes('idempotency_keys')
}

/**
 * Postgres has no row expiry, so "TTL" is a delete. Run alongside the
 * notification drain rather than as its own schedule.
 */
export async function prune() {
  await db.execute(sql`DELETE FROM idempotency_keys WHERE created_at < now() - interval '24 hours'`)
}
