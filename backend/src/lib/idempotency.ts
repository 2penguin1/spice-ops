import { createHash } from 'node:crypto'

import { eq, sql } from 'drizzle-orm'

import { db } from '../db/client.ts'
import { idempotencyKeys } from '../db/schema.ts'
import { ApiError, fromPostgresError } from './errors.ts'
import type { Tx } from './orders.tx.ts'

/**
 * Makes a retried POST /orders safe, so a dropped connection does not become a
 * second order for the same food.
 *
 * The unique primary key does the work. The key row is written in the same
 * transaction as the order, so a concurrent retry blocks on it until that
 * transaction ends, then fails with 23505 and replays the stored response.
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
): Replay | null {
  // Claimed but not yet finished: the first request is still running.
  if (existing.statusCode === 0) return null

  // Same key, different request. Replaying would hide the caller's bug and
  // silently drop this order.
  if (existing.endpoint !== endpoint || existing.requestHash !== hashOf(body)) {
    throw ApiError.validation(
      'This Idempotency-Key was already used for a different request. Use a new key.',
    )
  }

  return { statusCode: existing.statusCode, body: existing.responseBody }
}

/**
 * Takes the key before the work starts, so a concurrent retry blocks here
 * instead of building a duplicate order first. statusCode 0 means in progress.
 */
export function claimKey(tx: Tx, entry: { key: string; endpoint: string; body: unknown }) {
  return tx.insert(idempotencyKeys).values({
    key: entry.key,
    endpoint: entry.endpoint,
    requestHash: hashOf(entry.body),
    statusCode: 0,
    responseBody: {},
  })
}

/** Stores what to replay, in the same transaction that did the work. */
export function recordResponse(tx: Tx, key: string, statusCode: number, response: unknown) {
  return tx
    .update(idempotencyKeys)
    .set({ statusCode, responseBody: response as object })
    .where(eq(idempotencyKeys.key, key))
}

/**
 * True only for a violation of the key itself. A duplicate phone raises the
 * same 23505, and treating that as a replay would return someone else's order.
 */
export function isDuplicateKey(error: unknown): boolean {
  if (fromPostgresError(error)?.code !== 'RESOURCE_ALREADY_EXISTS') return false

  const constraint = (error as { cause?: { constraint?: string }; constraint?: string })
  const name = constraint.constraint ?? constraint.cause?.constraint ?? ''

  return name.includes('idempotency_keys')
}

/** Postgres has no row expiry, so old keys are deleted by the drain loop. */
export async function prune() {
  await db.execute(sql`DELETE FROM idempotency_keys WHERE created_at < now() - interval '24 hours'`)
}
