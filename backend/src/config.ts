import { z } from 'zod'

/**
 * Environment is validated once, at boot. A missing variable should stop the
 * process with a readable message, not surface later as a connection timeout
 * or an undefined secret.
 */
const EnvSchema = z.object({
  DATABASE_URL: z.string().min(1),
  JWT_SECRET: z.string().min(1),

  PORT: z.coerce.number().int().positive().default(3000),
  CORS_ORIGIN: z.string().default('http://localhost:5173'),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),

  // Optional. Each of these degrades to a working fallback — see CLAUDE.md.
  REDIS_URL: z.string().optional(),
  NOTIFY_DRIVER: z.enum(['console', 'twilio']).default('console'),
  GROQ_API_KEY: z.string().optional(),
  GROQ_MODEL: z.string().default('openai/gpt-oss-120b'),
  AUTH_DISABLED: z
    .enum(['true', 'false'])
    .default('false')
    .transform((value) => value === 'true'),
})

const parsed = EnvSchema.safeParse(process.env)

if (!parsed.success) {
  const missing = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`)
  console.error(`Invalid environment:\n${missing.join('\n')}\n\nCopy .env.example to .env.`)
  process.exit(1)
}

export const config = parsed.data

// A flag that skips authentication must never reach production, so the process
// refuses to start rather than starting insecurely.
if (config.AUTH_DISABLED && config.NODE_ENV === 'production') {
  console.error('AUTH_DISABLED cannot be used with NODE_ENV=production.')
  process.exit(1)
}

if (config.AUTH_DISABLED) {
  console.warn('AUTH_DISABLED=true — every route is unauthenticated. Development only.')
}

if (!config.REDIS_URL) {
  console.warn('REDIS_URL not set — no cache, single-instance events, jobs run inline.')
}
