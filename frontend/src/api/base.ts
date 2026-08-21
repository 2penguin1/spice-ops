/**
 * Where the API lives, from VITE_API_URL, which arrives in three shapes.
 *
 * A path means the API is behind the same web server as this app, which is how
 * it is deployed behind a reverse proxy. A bare hostname is what a platform
 * hands over when it links two services together, and needs a scheme. A full
 * URL is used as given. Nothing set at all means a developer's own machine.
 *
 * Kept apart from client.ts so it can be tested: reading import.meta.env is a
 * Vite-only trick, and a test runner has no idea what that is.
 */
export function resolveApiBase(configured: string | undefined): string {
  if (!configured) return 'http://localhost:3000'
  if (configured.startsWith('/')) return configured.replace(/\/$/, '')
  if (configured.includes('://')) return configured.replace(/\/$/, '')
  return `https://${configured}`
}
