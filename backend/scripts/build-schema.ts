/**
 * Builds `database/schema.sql` — the consolidated DDL deliverable — by
 * concatenating the drizzle-kit migrations in order.
 *
 * Why not `pg_dump`: it needs a running database, emits psql-only directives,
 * and its output changes with the client version. The migrations are already
 * the exact statements we ship, so joining them has no dependencies at all.
 *
 * Generated file. Never edit it by hand — change `src/db/schema.ts` and run
 * `npm run db:generate && npm run db:schema`.
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

// fileURLToPath, not .pathname: on Windows .pathname yields '/D:/Phase%20...'
const migrationsDir = fileURLToPath(new URL('../../database/migrations/', import.meta.url))
const outFile = fileURLToPath(new URL('../../database/schema.sql', import.meta.url))

const files = readdirSync(migrationsDir)
  .filter((name) => name.endsWith('.sql'))
  .sort()

const header = [
  '-- Spice Garden OMS — consolidated schema.',
  '--',
  '-- GENERATED FILE. Do not edit.',
  '-- Source of truth: backend/src/db/schema.ts',
  '-- Rebuild:        cd backend && npm run db:generate && npm run db:schema',
  '--',
  '-- Apply to an empty database with:',
  '--   psql "$DATABASE_URL" -f database/schema.sql',
  '',
]

const body = files.map((name) => {
  const sql = readFileSync(join(migrationsDir, name), 'utf8')
    .split('--> statement-breakpoint')
    .map((statement) => statement.trim())
    .filter(Boolean)
    .join('\n\n')
  return `-- ─── ${name} ${'─'.repeat(Math.max(0, 60 - name.length))}\n\n${sql}`
})

writeFileSync(outFile, `${header.join('\n')}\n${body.join('\n\n')}\n`)

console.log(`database/schema.sql written from ${files.length} migration(s)`)
