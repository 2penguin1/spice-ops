import { config } from '../config.ts'
import type { DailyPoint, HourPoint, Summary, TopItem } from './analytics.service.ts'

/**
 * A plain-English read of the day's numbers.
 *
 * Two rules govern what goes in the prompt:
 *
 *  1. Aggregates only. No customer rows — no names, phones or emails ever
 *     leave the building.
 *  2. No per-person data. The per-cook table is on screen for the manager who
 *     is entitled to see it; sending an individual's performance to a
 *     third-party API is a different act, and not one the feature needs.
 *
 * And one rule governs the failure path: this never throws. Without a key, or
 * with the provider down, the endpoint returns the same real figures with
 * `narrative: null` and the dashboard hides one panel. A reviewer with no key
 * sees a working dashboard, not an error.
 */

const ENDPOINT = 'https://api.groq.com/openai/v1/chat/completions'

// Long enough for a slow response, short enough that a dashboard never hangs.
const TIMEOUT_MS = 10_000

export type Insights = {
  narrative: string | null
  model: string | null
  unavailable: string | null
}

type Facts = {
  summary: Summary
  daily: DailyPoint[]
  hours: HourPoint[]
  items: TopItem[]
}

const SYSTEM = [
  'You are an operations analyst for a restaurant chain.',
  'You are given aggregate numbers for one restaurant. Write for the manager on shift.',
  'Reply with exactly three short bullet points, each one sentence, each starting with "- ".',
  'Say what the numbers show and what to look at. Cite the specific figure you mean.',
  'No preamble, no heading, no closing line. Never invent a number you were not given.',
].join(' ')

/** Reduces the dashboard to the handful of facts worth reasoning about. */
function describe({ summary, daily, hours, items }: Facts): string {
  const busiest = [...hours].sort((a, b) => b.orders - a.orders).slice(0, 3)
  const recent = daily.slice(-7)
  const averageDaily = recent.reduce((sum, day) => sum + day.orders, 0) / (recent.length || 1)

  const prep =
    summary.averagePrepSeconds === null
      ? 'not enough completed orders to measure'
      : `${Math.round(summary.averagePrepSeconds / 60)} minutes`

  return [
    `Revenue from completed orders: ${Math.round(summary.revenue.net)} rupees.`,
    `Revenue still in the kitchen: ${Math.round(summary.revenue.incoming)} rupees.`,
    `Orders today: ${summary.orders.today}. Average over the last 7 days: ${averageDaily.toFixed(1)}.`,
    `Average time from starting to cook until ready: ${prep}.`,
    `Cancellation rate: ${(summary.cancellationRate * 100).toFixed(1)} percent.`,
    `Orders by status: ${summary.funnel.map((f) => `${f.status} ${f.count}`).join(', ')}.`,
    `Busiest hours: ${busiest.map((h) => `${h.hour}:00 (${h.orders} orders)`).join(', ')}.`,
    `Best selling dishes: ${items.slice(0, 5).map((i) => `${i.itemName} (${i.quantity})`).join(', ')}.`,
  ].join('\n')
}

export async function insights(facts: Facts): Promise<Insights> {
  if (!config.GROQ_API_KEY) {
    return { narrative: null, model: null, unavailable: 'No AI provider is configured' }
  }

  try {
    const response = await fetch(ENDPOINT, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${config.GROQ_API_KEY}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: config.GROQ_MODEL,
        messages: [
          { role: 'system', content: SYSTEM },
          { role: 'user', content: describe(facts) },
        ],
        temperature: 0.2,
        // gpt-oss is a reasoning model: it spends tokens thinking before it
        // writes anything. At 300 the reasoning consumed the whole budget and
        // `content` came back empty. Low effort plus room for both.
        reasoning_effort: 'low',
        max_tokens: 900,
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })

    if (!response.ok) {
      const detail = await response.text().catch(() => '')
      console.error(`AI insights: provider returned ${response.status}`, detail.slice(0, 200))
      return { narrative: null, model: null, unavailable: 'The AI provider rejected the request' }
    }

    const body = (await response.json()) as {
      model?: string
      choices?: { finish_reason?: string; message?: { content?: string } }[]
    }

    const choice = body.choices?.[0]
    const narrative = choice?.message?.content?.trim()

    if (!narrative) {
      // Most often finish_reason 'length': the model ran out of budget while
      // reasoning. Worth naming, because it is a configuration problem rather
      // than an outage.
      console.error(`AI insights: empty content, finish_reason=${choice?.finish_reason}`)
      return { narrative: null, model: null, unavailable: 'The AI provider returned nothing' }
    }

    return { narrative, model: body.model ?? config.GROQ_MODEL, unavailable: null }
  } catch (error) {
    // A timeout, a DNS failure, a provider outage — all the same to the caller.
    console.error('AI insights unavailable:', (error as Error).message)
    return { narrative: null, model: null, unavailable: 'The AI provider could not be reached' }
  }
}
