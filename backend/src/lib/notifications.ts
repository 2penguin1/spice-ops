import { and, eq, lt, sql } from 'drizzle-orm'

import { db } from '../db/client.ts'
import { notifications } from '../db/schema.ts'
import { prune as pruneIdempotencyKeys } from './idempotency.ts'
import { driver } from './notifications.drivers.ts'
import type { Tx } from './orders.tx.ts'
import type { OrderStatus } from './status.ts'

/**
 * Customer messages, sent through a transactional outbox.
 *
 * The row goes in with the status change that caused it, so a crash between
 * committing the change and sending the message cannot lose it. This loop
 * drains the table afterwards and retries what fails.
 */

const MAX_ATTEMPTS = 3
const DRAIN_INTERVAL_MS = 5000
const BATCH = 20

// Only the steps a customer cares about.
const MESSAGES: Partial<Record<OrderStatus, (orderNumber: string) => string>> = {
  CONFIRMED: (n) => `Spice Garden: we have your order ${n}. We will let you know when it is ready.`,
  READY: (n) => `Spice Garden: order ${n} is ready.`,
  CANCELLED: (n) => `Spice Garden: order ${n} has been cancelled. Please speak to a member of staff.`,
}

// ─── Writing ─────────────────────────────────────────────────────────────────

/** Queues a message in the caller's transaction. Sends nothing itself. */
export function queueNotification(
  tx: Tx,
  order: { orderId: string; orderNumber: string; status: OrderStatus; phone: string },
) {
  const compose = MESSAGES[order.status]
  if (!compose) return Promise.resolve()

  return tx.insert(notifications).values({
    orderId: order.orderId,
    channel: driver.name,
    recipient: order.phone,
    body: compose(order.orderNumber),
  })
}

// ─── Draining ────────────────────────────────────────────────────────────────

type Claimed = { id: string; recipient: string; body: string; attempts: number }

/**
 * Takes a batch in one statement. SKIP LOCKED lets a second worker step over
 * rows this one holds, so neither waits and no message is sent twice.
 */
async function claimBatch(): Promise<Claimed[]> {
  const { rows } = await db.execute(sql`
    UPDATE notifications SET
      status = 'SENDING',
      attempts = attempts + 1,
      claimed_at = now()
    WHERE id IN (
      SELECT id FROM notifications
      WHERE status = 'PENDING'
      ORDER BY created_at
      LIMIT ${BATCH}
      FOR UPDATE SKIP LOCKED
    )
    RETURNING id, recipient, body, attempts
  `)

  return rows as unknown as Claimed[]
}

async function drainOnce(): Promise<{ sent: number; failed: number }> {
  let sent = 0
  let failed = 0

  for (const message of await claimBatch()) {
    try {
      await driver.send({ recipient: message.recipient, body: message.body })

      await db
        .update(notifications)
        .set({ status: 'SENT', sentAt: new Date(), lastError: null })
        .where(eq(notifications.id, message.id))

      sent++
    } catch (error) {
      const reason = (error as Error).message
      const exhausted = message.attempts >= MAX_ATTEMPTS

      await db
        .update(notifications)
        .set({ status: exhausted ? 'FAILED' : 'PENDING', lastError: reason })
        .where(eq(notifications.id, message.id))

      if (exhausted) failed++
    }
  }

  return { sent, failed }
}

/**
 * Frees messages stuck in SENDING by a process that died mid-send.
 *
 * Compares claimed_at, not created_at. An old message being sent right now has
 * an old created_at, and resetting it would send a second copy.
 */
async function recoverStuck() {
  const cutoff = new Date(Date.now() - 60_000)

  await db
    .update(notifications)
    .set({ status: 'PENDING' })
    .where(and(eq(notifications.status, 'SENDING'), lt(notifications.claimedAt, cutoff)))
}

let timer: ReturnType<typeof setInterval> | undefined
let draining = false

export function startNotificationWorker() {
  if (timer) return

  console.log(`Notifications: ${driver.name} driver, draining every ${DRAIN_INTERVAL_MS / 1000}s`)

  timer = setInterval(async () => {
    // A slow provider can make a cycle outlast the interval, and overlapping
    // cycles race over the same rows.
    if (draining) return
    draining = true

    try {
      await recoverStuck()
      await drainOnce()
      await pruneIdempotencyKeys()
    } catch (error) {
      console.error('Notification drain failed:', (error as Error).message)
    } finally {
      draining = false
    }
  }, DRAIN_INTERVAL_MS)

  // Must not hold the process open at shutdown.
  timer.unref()
}

export function stopNotificationWorker() {
  clearInterval(timer)
  timer = undefined
}
