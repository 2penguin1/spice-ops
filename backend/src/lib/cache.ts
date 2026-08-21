import { Redis } from 'ioredis'

import { config } from '../config.ts'

/**
 * Caches the analytics aggregates, and nothing else.
 *
 * Order lists are deliberately not cached: they change on every status tap and
 * are already pushed live over the event stream, so a cache there would spend
 * all its effort on invalidation to make the app less current. Aggregates are
 * the opposite — nobody makes a decision on revenue that is 30 seconds stale.
 *
 * Without Redis every call simply runs the query. That is the whole fallback.
 */
const client = config.REDIS_URL ? new Redis(config.REDIS_URL, { maxRetriesPerRequest: 1 }) : null

client?.on('error', (error) => console.error('Redis cache:', error.message))

const VERSION_KEY = 'analytics:version'

let version: string | null = null

/**
 * Invalidation by version, not by deletion.
 *
 * Deleting keys by pattern is O(keyspace) and needs SCAN. Bumping a counter
 * that forms part of every key retires the whole set at once, and the old
 * entries expire on their own TTL.
 */
export async function invalidateAnalytics() {
  if (!client) return
  try {
    version = String(await client.incr(VERSION_KEY))
  } catch {
    // A cache that cannot be invalidated must not break a write. Forget the
    // version so the next read re-reads it.
    version = null
  }
}

async function currentVersion(): Promise<string> {
  if (version !== null) return version
  version = String((await client!.get(VERSION_KEY)) ?? '1')
  return version
}

/** Runs `load`, or returns the cached result of a recent identical call. */
export async function cached<T>(key: string, ttlSeconds: number, load: () => Promise<T>): Promise<T> {
  if (!client) return load()

  try {
    const versioned = `analytics:v${await currentVersion()}:${key}`
    const hit = await client.get(versioned)
    if (hit) return JSON.parse(hit) as T

    const value = await load()
    await client.set(versioned, JSON.stringify(value), 'EX', ttlSeconds)
    return value
  } catch (error) {
    // Redis being unreachable is a slower dashboard, never a broken one.
    console.error('Cache read failed, querying directly:', (error as Error).message)
    return load()
  }
}

export async function closeCache() {
  await client?.quit().catch(() => undefined)
}
