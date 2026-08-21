import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto'
import { promisify } from 'node:util'

import { eq } from 'drizzle-orm'
import { createMiddleware } from 'hono/factory'
import { jwtVerify, SignJWT } from 'jose'

import { config } from '../config.ts'
import { db } from '../db/client.ts'
import { staff, type staffRole } from '../db/schema.ts'
import { ApiError } from './errors.ts'
import type { OrderStatus } from './status.ts'

export type Role = (typeof staffRole.enumValues)[number]

export type Staff = {
  id: string
  name: string
  role: Role
  /** False for the AUTH_DISABLED stand-in, which has no row in `staff`. */
  persisted: boolean
}

/** The id to attribute a change to, or null when there is no real account behind it. */
export const attributableId = (member: Staff) => (member.persisted ? member.id : null)

export type AuthVariables = { staff: Staff }

const secret = new TextEncoder().encode(config.JWT_SECRET)

// Async, not scryptSync: hashing takes ~100ms, and doing it synchronously
// on an unauthenticated route stalls every other request in the process.
const derive = promisify(scrypt) as (p: string, s: string, len: number) => Promise<Buffer>

const TOKEN_LIFETIME = '12h'

// ─── Passwords ───────────────────────────────────────────────────────────────

/** Stored as `scrypt$<salt>$<hash>`, so the parameters travel with the hash. */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString('hex')
  return `scrypt$${salt}$${(await derive(password, salt, 64)).toString('hex')}`
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, salt, expected] = stored.split('$')
  if (scheme !== 'scrypt' || !salt || !expected) return false

  const actual = await derive(password, salt, 64)
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
 * There is no revocation list. Deactivating someone stops the next sign-in but
 * does not end a session already running, so a token is live for up to 12 hours
 * after that.
 */
async function staffFromToken(token: string): Promise<Staff> {
  try {
    const { payload } = await jwtVerify(token, secret, { algorithms: ['HS256'] })

    if (payload.scope === 'events') throw new Error('stream ticket used as a session token')

    return {
      id: String(payload.sub),
      name: String(payload.name),
      role: payload.role as Role,
      persisted: true,
    }
  } catch {
    throw new ApiError('UNAUTHORIZED', 'Your session has expired. Sign in again.')
  }
}

/**
 * A 60 second token that works on the event stream and nowhere else.
 *
 * EventSource cannot set headers, so this has to travel in the URL where access
 * logs will keep it. Scoping and a short life are what make that survivable.
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

    return {
      id: String(payload.sub),
      name: String(payload.name),
      role: payload.role as Role,
      persisted: true,
    }
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
  persisted: false,
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
 * Who may move an order to a given status. requireRole cannot express this on
 * its own, because the answer depends on which status is being asked for.
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

/** A real hash to compare against when the email is unknown, so timing matches. */
const DUMMY_HASH = `scrypt$${'0'.repeat(32)}$${'0'.repeat(128)}`

export async function authenticate(email: string, password: string): Promise<Staff> {
  const [found] = await db.select().from(staff).where(eq(staff.email, email.toLowerCase()))

  // Same message either way, so a caller cannot use it to find out which
  // addresses have accounts.
  const rejected = new ApiError('UNAUTHORIZED', 'Those details do not match an account')

  // Hash even when there is no account, so an unknown email takes as long as a
  // wrong password. Returning early here is a timing oracle for which addresses
  // exist, which is exactly what the shared message is meant to prevent.
  const stored = found?.passwordHash ?? DUMMY_HASH
  const correct = await verifyPassword(password, stored)

  if (!found || !found.isActive || !correct) throw rejected

  return { id: found.id, name: found.name, role: found.role, persisted: true }
}
