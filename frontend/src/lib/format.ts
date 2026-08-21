const money = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  maximumFractionDigits: 2,
})

export const formatMoney = (amount: number) => money.format(amount)

const time = new Intl.DateTimeFormat('en-IN', {
  day: '2-digit',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
})

export const formatWhen = (iso: string) => time.format(new Date(iso))

/** "12 min ago" — what a service screen actually needs to know about an order. */
export function formatAge(iso: string): string {
  const minutes = Math.floor((Date.now() - new Date(iso).getTime()) / 60_000)

  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes} min ago`

  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`

  return `${Math.floor(hours / 24)}d ago`
}
