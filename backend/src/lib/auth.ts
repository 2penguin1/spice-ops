import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'

import { eq } from 'drizzle-orm'
import { createMiddleware } from 'hono/factory'
import { jwtVerify, SignJWT } from 'jose'

import { config } from '../config.ts'
import { db } from '../db/client.ts'
import { staff, type staffRole } from '../db/schema.ts'
import { ApiError } from './errors.ts'
import type { OrderStatus } from './status.ts'

export type Role = (typeof staffRole.enumValues)[number]

export type Staff = { id: string; name: string; role: Role }

export type AuthVariables = { staff: Staff }

const secret = new TextEncoder().encode(config.JWT_SECRET)

const TOKEN_LIFETIME = '12h'

// ─── Passwords ───────────────────────────────────────────────────────────────

/**
 * scrypt from node:crypto — memory-hard, salted per user, and part of the
 * standard library. argon2id is marginally stronger but needs a compiled
 * native module, which is a poor trade for a project that must install
 * cleanly on any machine.
 *
 * Stored as `scrypt$<salt>$<hash>` so the parameters travel with the hash.
 */
export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('hex')
  return `scrypt$${salt}$${scryptSync(password, salt, 64).toString('hex')}`
}

export function verifyPassword(password: string, stored: string): boolean {
  const [scheme, salt, expected] = stored.split('$')
  if (scheme !== 'scrypt' || !salt || !expected) return false

  const actual = scryptSync(password, salt, 64)
  const expectedBuffer = Buffer.from(expected, 'hex')

  if (actual.length !== expectedBuffer.length) return false

  // Constant time: a plain === leaks how much of the hash matched.
  return timingSafeEqual(actual, expectedBuffer)
}

// ─── Tokens ──────────────────────────────────────────────────────────────────

export function signToken(member: Staff): Promise<string> {
  return new SignJWT({ role: member.role, name: member.name })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(member.id)
    .setIssuedAt()
    .setExpirationTime(TOKEN_LIFETIME)
    .sign(secret)
}

/**
 * No revocation list. A token is valid for 12 hours, so deactivating someone
 * stops them logging in again but does not end a session already in progress.
 * Acceptable for an internal tool where staff sign in per shift; the upgrade
 * path is a Redis set of revoked ids checked here — see docs/hld.md §9.
 */
async function staffFromToken(token: string): Promise<Staff> {
  try {
    const { payload } = await jwtVerify(token, secret, { algorithms: ['HS256'] })

    if (payload.scope === 'events') throw new Error('stream ticket used as a session token')

    return {
      id: String(payload.sub),
      name: String(payload.name),
      role: payload.role as Role,
    }
  } catch {
    throw new ApiError('UNAUTHORIZED', 'Your session has expired. Sign in again.')
  }
}

/**
 * A 60 second token scoped to the event stream only.
 *
 * EventSource cannot set headers, so the token has to travel in the URL, where
 * it lands in access logs. Scoping and expiry make that acceptable: this
 * ticket opens a stream that carries only order ids, and it is worthless a
 * minute later.
 */
export function issueStreamTicket(member: Staff): Promise<string> {
  return new SignJWT({ role: member.role, name: member.name, scope: 'events' })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(member.id)
    .setIssuedAt()
    .setExpirationTime('60s')
    .sign(secret)
}

export async function verifyStreamTicket(ticket: string): Promise<Staff> {
  try {
    const { payload } = await jwtVerify(ticket, secret, { algorithms: ['HS256'] })

    // A session token must not open a stream, and a ticket must not open
    // anything else.
    if (payload.scope !== 'events') throw new Error('wrong scope')

    return { id: String(payload.sub), name: String(payload.name), role: payload.role as Role }
  } catch {
    throw new ApiError('UNAUTHORIZED', 'That stream ticket is not valid. Reconnecting.')
  }
}

// ─── Middleware ──────────────────────────────────────────────────────────────

/** Stands in for a signed-in admin when AUTH_DISABLED is set. */
const CONTRACT_TESTER: Staff = {
  id: '00000000-0000-4000-8000-000000000000',
  name: 'Auth disabled',
  role: 'ADMIN',
}

export const requireAuth = createMiddleware<{ Variables: AuthVariables }>(async (c, next) => {
  if (config.AUTH_DISABLED) {
    c.set('staff', CONTRACT_TESTER)
    return next()
  }

  const header = c.req.header('Authorization')
  if (!header?.startsWith('Bearer ')) {
    throw new ApiError('UNAUTHORIZED', 'Sign in to use this API')
  }

  c.set('staff', await staffFromToken(header.slice('Bearer '.length)))
  return next()
})

/**
 * Route-level authorization. Reading is open to any signed-in role; this
 * guards the actions that change something.
 */
export const requireRole = (...allowed: Role[]) =>
  createMiddleware<{ Variables: AuthVariables }>(async (c, next) => {
    const member = c.get('staff')

    if (!allowed.includes(member.role)) {
      throw new ApiError(
        'FORBIDDEN',
        `This needs ${allowed.join(' or ')}. You are signed in as ${member.role}.`,
      )
    }

    return next()
  })

/**
 * Who may move an order to a given status.
 *
 * A plain requireRole cannot express this, because the answer depends on the
 * status being requested: the kitchen cooks, the floor delivers, and only a
 * manager cancels. Kept here with the other authorization rules rather than
 * as an `if` inside the route handler.
 */
const STATUS_ROLES: Record<OrderStatus, Role[]> = {
  CONFIRMED: ['ADMIN', 'MANAGER'],
  PREPARING: ['ADMIN', 'MANAGER', 'KITCHEN'],
  READY: ['ADMIN', 'MANAGER', 'KITCHEN'],
  COMPLETED: ['ADMIN', 'MANAGER', 'SERVICE'],
  CANCELLED: ['ADMIN', 'MANAGER'],
}

export function assertCanSetStatus(member: Staff, to: OrderStatus) {
  const allowed = STATUS_ROLES[to]

  if (!allowed.includes(member.role)) {
    throw new ApiError(
      'FORBIDDEN',
      `Moving an order to ${to} needs ${allowed.join(' or ')}. You are signed in as ${member.role}.`,
    )
  }
}

// ─── Sign in ─────────────────────────────────────────────────────────────────

export async function authenticate(email: string, password: string): Promise<Staff> {
  const [found] = await db.select().from(staff).where(eq(staff.email, email.toLowerCase()))

  // One message for both cases, so the response cannot be used to discover
  // which email addresses exist.
  const rejected = new ApiError('UNAUTHORIZED', 'Those details do not match an account')

  if (!found || !found.isActive) throw rejected
  if (!verifyPassword(password, found.passwordHash)) throw rejected

  return { id: found.id, name: found.name, role: found.role }
}
