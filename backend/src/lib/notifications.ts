import { and, asc, eq, lt, sql } from 'drizzle-orm'

import { config } from '../config.ts'
import { db } from '../db/client.ts'
import { notifications } from '../db/schema.ts'
import type { Tx } from './orders.tx.ts'
import type { OrderStatus } from './status.ts'

/**
 * Telling a customer their order is ready, without letting that get in the way
 * of the order itself.
 *
 * The pattern is a transactional outbox. The intent to send is written in the
 * same transaction as the status change, so a crash between committing the
 * change and dispatching the message cannot lose it. A loop drains the table
 * afterwards.
 *
 * There is no BullMQ. A queue earns its place by absorbing load and retrying
 * slow external calls — but the outbox is needed for correctness whatever else
 * we do, and draining it gives exactly those two properties. A job queue in
 * front of it would be a second queue doing the first one's work.
 */

const MAX_ATTEMPTS = 3
const DRAIN_INTERVAL_MS = 5000
const BATCH = 20

// Not every step is worth a message. Nobody wants a text saying their food has
// started cooking.
const MESSAGES: Partial<Record<OrderStatus, (orderNumber: string) => string>> = {
  CONFIRMED: (n) => `Spice Garden: we have your order ${n}. We will let you know when it is ready.`,
  READY: (n) => `Spice Garden: order ${n} is ready.`,
  CANCELLED: (n) => `Spice Garden: order ${n} has been cancelled. Please speak to a member of staff.`,
}

// ─── Drivers ─────────────────────────────────────────────────────────────────

type Message = { recipient: string; body: string }

type Driver = { name: string; send: (message: Message) => Promise<void> }

const drivers: Record<string, Driver> = {
  /** The default. Demonstrable with no account, no key and no network. */
  console: {
    name: 'console',
    async send({ recipient, body }) {
      console.log(`[notify] ${recipient}: ${body}`)
    },
  },

  /**
   * Posts to any URL — a Slack incoming webhook, an automation tool, or a real
   * SMS gateway's HTTP endpoint. A second implementation that can actually be
   * tested, unlike a Twilio driver nobody here has credentials for.
   */
  webhook: {
    name: 'webhook',
    async send({ recipient, body }) {
      if (!config.NOTIFY_WEBHOOK_URL) throw new Error('NOTIFY_WEBHOOK_URL is not set')

      const response = await fetch(config.NOTIFY_WEBHOOK_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ to: recipient, text: body }),
        signal: AbortSignal.timeout(5000),
      })

      if (!response.ok) throw new Error(`webhook returned ${response.status}`)
    },
  },
}

const driver = drivers[config.NOTIFY_DRIVER] ?? drivers.console!

// ─── Writing ─────────────────────────────────────────────────────────────────

/** Queues a message inside the caller's transaction. Never sends anything itself. */
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

/**
 * Claims one message so that two workers cannot send it twice.
 *
 * The guard is in the WHERE clause, the same shape as the order status update:
 * whoever changes the row owns it, and everyone else gets zero rows.
 */
async function claim(id: string) {
  const [claimed] = await db
    .update(notifications)
    .set({ status: 'SENDING', attempts: sql`${notifications.attempts} + 1` })
    .where(and(eq(notifications.id, id), eq(notifications.status, 'PENDING')))
    .returning()

  return claimed
}

export async function drainOnce(): Promise<{ sent: number; failed: number }> {
  const pending = await db
    .select({ id: notifications.id })
    .from(notifications)
    .where(eq(notifications.status, 'PENDING'))
    .orderBy(asc(notifications.createdAt))
    .limit(BATCH)

  let sent = 0
  let failed = 0

  for (const row of pending) {
    const message = await claim(row.id)
    if (!message) continue // Another worker took it.

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

      // Back to PENDING for another go, or FAILED with the reason recorded.
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
 * Recovers messages left mid-flight by a process that died between claiming
 * one and recording the outcome. Without this they would sit in SENDING for
 * ever, which is the failure mode an outbox exists to prevent.
 */
async function recoverStuck() {
  const cutoff = new Date(Date.now() - 60_000)

  await db
    .update(notifications)
    .set({ status: 'PENDING' })
    .where(and(eq(notifications.status, 'SENDING'), lt(notifications.createdAt, cutoff)))
}

let timer: ReturnType<typeof setInterval> | undefined

export function startNotificationWorker() {
  if (timer) return

  console.log(`Notifications: ${driver.name} driver, draining every ${DRAIN_INTERVAL_MS / 1000}s`)

  timer = setInterval(() => {
    void recoverStuck()
      .then(drainOnce)
      .catch((error) => console.error('Notification drain failed:', (error as Error).message))
  }, DRAIN_INTERVAL_MS)

  // The drain alone must not hold the process open at shutdown.
  timer.unref()
}

export function stopNotificationWorker() {
  clearInterval(timer)
  timer = undefined
}
