import { defineConfig } from 'drizzle-kit'

// process.loadEnvFile is built into Node — no dotenv dependency needed.
process.loadEnvFile('.env')

export default defineConfig({
  schema: './src/db/schema.ts',
  out: '../database/migrations',
  dialect: 'postgresql',
  dbCredentials: { url: process.env.DATABASE_URL! },
})
