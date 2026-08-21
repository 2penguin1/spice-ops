import { Redis } from 'ioredis'

import { config } from '../config.ts'

/**
 * Caches the analytics aggregates. Nothing else is cached — order lists change
 * on every status tap and are already pushed live.
 *
 * Without Redis, every call just runs the query.
 */
const client = config.REDIS_URL ? new Redis(config.REDIS_URL, { maxRetriesPerRequest: 1 }) : null

client?.on('error', (error) => console.error('Redis cache:', error.message))

const VERSION_KEY = 'analytics:version'


/**
 * Retires every cached key at once by bumping a counter that is part of each
 * key name. Deleting by pattern would need SCAN over the whole keyspace.
 */
export async function invalidateAnalytics() {
  if (!client) return

  try {
    await client.incr(VERSION_KEY)
  } catch {
    // A cache that cannot be invalidated must not break a write.
  }
}

// Read every time. Remembering it would miss another process's invalidation.
async function currentVersion(): Promise<string> {
  return String((await client!.get(VERSION_KEY)) ?? '1')
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
