import { config } from '../config.ts'

/**
 * How a customer message actually leaves the building.
 *
 * One interface, three implementations, chosen by NOTIFY_DRIVER. The outbox in
 * notifications.ts decides *what* to send and when to retry; this file only
 * knows how to hand one message to the outside world.
 */

// ─── Drivers ─────────────────────────────────────────────────────────────────

type Message = { recipient: string; body: string }

type Driver = { name: string; send: (message: Message) => Promise<void> }

const drivers: Record<string, Driver> = {
  /** The default. Works with no account and no network. */
  console: {
    name: 'console',
    async send({ recipient, body }) {
      console.log(`[notify] ${recipient}: ${body}`)
    },
  },

  /** Posts to any URL: a Slack webhook, an automation tool, an SMS gateway. */
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

  /**
   * Real WhatsApp, through GREEN-API.
   *
   * The instance is a phone that GREEN-API keeps logged in, so there is no
   * template to get approved — it sends as the restaurant's own number. Free
   * instances are rate limited, which is the reason for the retry ceiling
   * above rather than anything about this driver.
   */
  whatsapp: {
    name: 'whatsapp',
    async send({ recipient, body }) {
      const { GREENAPI_URL, GREENAPI_ID, GREENAPI_TOKEN } = config
      if (!GREENAPI_URL || !GREENAPI_ID || !GREENAPI_TOKEN) {
        throw new Error('GREENAPI_URL, GREENAPI_ID and GREENAPI_TOKEN must all be set')
      }

      const response = await fetch(
        `${GREENAPI_URL}/waInstance${GREENAPI_ID}/sendMessage/${GREENAPI_TOKEN}`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ chatId: toChatId(recipient), message: body }),
          signal: AbortSignal.timeout(15_000),
        },
      )

      // The body carries the reason; the status alone does not say enough to
      // tell a bad number from an instance that has been logged out.
      const text = await response.text()
      if (!response.ok) throw new Error(`GREEN-API ${response.status}: ${text.slice(0, 200)}`)
    },
  },
}

/**
 * "+91 98200 11223" and "9820011223" both become "919820011223@c.us".
 *
 * Customer phones are stored as typed, because a format rule would lose to
 * real data. A ten-digit number is assumed to be Indian, which is true of
 * every branch this runs in.
 */
function toChatId(phone: string): string {
  const digits = phone.replace(/\D/g, '')
  return `${digits.length === 10 ? `91${digits}` : digits}@c.us`
}

/** What each driver cannot run without. Console needs nothing, which is why it is the fallback. */
const REQUIRES: Record<string, string[]> = {
  webhook: ['NOTIFY_WEBHOOK_URL'],
  whatsapp: ['GREENAPI_URL', 'GREENAPI_ID', 'GREENAPI_TOKEN'],
}

/**
 * Picks the driver named in the environment, or falls back to the log.
 *
 * Half-configured is the interesting case: an operator sets NOTIFY_DRIVER but
 * forgets a key. Failing per message would bury that in the outbox three
 * attempts at a time. One warning at boot says it once, and the restaurant
 * keeps taking orders.
 */
function resolveDriver(): Driver {
  const chosen = drivers[config.NOTIFY_DRIVER]
  if (!chosen) return drivers.console!

  const missing = (REQUIRES[config.NOTIFY_DRIVER] ?? []).filter(
    (key) => !config[key as keyof typeof config],
  )

  if (missing.length === 0) return chosen

  console.warn(
    `NOTIFY_DRIVER=${config.NOTIFY_DRIVER} needs ${missing.join(', ')} — logging messages instead.`,
  )
  return drivers.console!
}

export const driver = resolveDriver()
