import { EventEmitter } from 'node:events'
import { randomUUID } from 'node:crypto'

import { Redis } from 'ioredis'

import { config } from '../config.ts'
import type { OrderStatus } from './status.ts'

export type OrderUpdated = {
  orderId: string
  orderNumber: string
  status: OrderStatus
}

const CHANNEL = 'spice:order:updated'

/** Identifies this process, so it can ignore its own messages coming back. */
const INSTANCE = randomUUID()

const bus = new EventEmitter()

// One listener per open connection; the default cap of 10 is far too low.
bus.setMaxListeners(0)

// ─── Redis fan-out (optional) ────────────────────────────────────────────────

/**
 * With one API process the in-memory bus is enough. With several, a client
 * connected to one must still see a change made on another — that is all Redis
 * does here.
 */
let publisher: Redis | null = null

if (config.REDIS_URL) {
  const options = { maxRetriesPerRequest: null, lazyConnect: false }

  publisher = new Redis(config.REDIS_URL, options)
  const subscriber = new Redis(config.REDIS_URL, options)

  // A dropped Redis connection must never take the API down with it.
  publisher.on('error', (error) => console.error('Redis publisher:', error.message))
  subscriber.on('error', (error) => console.error('Redis subscriber:', error.message))

  void subscriber.subscribe(CHANNEL)

  subscriber.on('message', (_channel, raw) => {
    try {
      const { from, ...payload } = JSON.parse(raw) as OrderUpdated & { from: string }

      // Redis echoes our own publish back; re-emitting would double every change.
      if (from === INSTANCE) return

      bus.emit(CHANNEL, payload)
    } catch (error) {
      console.error('Ignoring malformed event:', error)
    }
  })
}

// ─── Publish and subscribe ───────────────────────────────────────────────────

/** Announces that an order changed. Only ever called after a commit. */
export function emitOrderUpdated(payload: OrderUpdated) {
  bus.emit(CHANNEL, payload)
  void publisher?.publish(CHANNEL, JSON.stringify({ ...payload, from: INSTANCE }))
}

/** Subscribes to order changes. Returns the function that unsubscribes. */
const openStreams = new Set<() => void>()

/** Registers a stream so shutdown can close it. Returns the deregister. */
export function trackStream(close: () => void) {
  openStreams.add(close)
  return () => openStreams.delete(close)
}

/** Streams stay open by design, so shutdown has to end them explicitly. */
export function closeAllStreams() {
  for (const close of openStreams) close()
  openStreams.clear()
}

export function onOrderUpdated(handler: (payload: OrderUpdated) => void) {
  bus.on(CHANNEL, handler)
  return () => bus.off(CHANNEL, handler)
}

export async function closeEventBus() {
  await publisher?.quit().catch(() => undefined)
}
