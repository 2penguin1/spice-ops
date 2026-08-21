import { defineConfig } from 'drizzle-kit'

// process.loadEnvFile is built into Node — no dotenv dependency needed. It
// throws when the file is absent, which is the normal case in CI or on a
// hosting platform where the variables are already set, so absence is fine.
try {
  process.loadEnvFile('.env')
} catch {
  // No .env — expect DATABASE_URL from the environment instead.
}

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL is not set. Copy backend/.env.example to backend/.env.')
}

export default defineConfig({
  schema: './src/db/schema.ts',
  out: '../database/migrations',
  dialect: 'postgresql',
  dbCredentials: { url: process.env.DATABASE_URL },
})
