import { Hono } from 'hono'
import { z } from 'zod'

import { authenticate, requireAuth, signToken, type AuthVariables } from '../lib/auth.ts'
import { validate } from '../lib/validation.ts'

const loginBody = z.object({
  email: z.email(),
  password: z.string().min(1),
})

export const authRoutes = new Hono<{ Variables: AuthVariables }>()

  /** POST /auth/login — exchange credentials for a 12 hour token. */
  .post('/login', validate('json', loginBody), async (c) => {
    const { email, password } = c.req.valid('json')
    const staff = await authenticate(email, password)

    return c.json({ data: { token: await signToken(staff), staff } })
  })

  /** GET /auth/me — who the current token belongs to. */
  .get('/me', requireAuth, (c) => c.json({ data: c.get('staff') }))
