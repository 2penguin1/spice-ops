import type { Context } from 'hono'

/**
 * Every error code the API can return, and the HTTP status it maps to.
 * The brief names the codes but not the statuses — see questions.md §3.
 *
 * The first five are the contract's. UNAUTHORIZED and FORBIDDEN belong to the
 * platform layer and never appear on a contract route for an authenticated
 * caller. INTERNAL_ERROR is the catch-all.
 */
export const ERROR_STATUS = {
  VALIDATION_FAILED: 400,
  INVALID_FILTER: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  RESOURCE_NOT_FOUND: 404,
  RESOURCE_ALREADY_EXISTS: 409,
  INVALID_STATUS_TRANSITION: 409,
  INTERNAL_ERROR: 500,
} as const

export type ErrorCode = keyof typeof ERROR_STATUS

export class ApiError extends Error {
  // Declared and assigned explicitly rather than as a constructor parameter
  // property: Node's built-in TypeScript stripping rejects those, and keeping
  // this file runnable by plain `node` is what lets the tests need no compiler.
  readonly code: ErrorCode

  constructor(code: ErrorCode, message: string) {
    super(message)
    this.name = 'ApiError'
    this.code = code
  }

  get status() {
    return ERROR_STATUS[this.code]
  }

  static notFound(resource: string) {
    return new ApiError('RESOURCE_NOT_FOUND', `${resource} not found`)
  }

  static validation(message: string) {
    return new ApiError('VALIDATION_FAILED', message)
  }
}

/**
 * Messages for the database constraints we expect callers to hit. Letting
 * Postgres be the guard and mapping its error is the only race-free way to
 * check uniqueness — a SELECT before an INSERT lets two requests both pass.
 */
const CONSTRAINT_MESSAGES: Record<string, string> = {
  customers_phone_idx: 'A customer with this phone number already exists',
  orders_order_number_idx: 'An order with this number already exists',
  order_items_quantity_positive: 'quantity must be greater than 0',
  order_items_unit_price_non_negative: 'unitPrice must be 0 or greater',
}

/** Translates a Postgres error into a contract error, or null if we do not recognise it. */
export function fromPostgresError(error: unknown): ApiError | null {
  if (typeof error !== 'object' || error === null || !('code' in error)) return null

  const { code, constraint } = error as { code?: string; constraint?: string }
  const detail = constraint ? CONSTRAINT_MESSAGES[constraint] : undefined

  switch (code) {
    case '23505': // unique_violation
      return new ApiError('RESOURCE_ALREADY_EXISTS', detail ?? 'Resource already exists')
    case '23503': // foreign_key_violation
      return new ApiError('RESOURCE_NOT_FOUND', detail ?? 'Referenced resource does not exist')
    case '23514': // check_violation
      return new ApiError('VALIDATION_FAILED', detail ?? 'A value failed a database constraint')
    default:
      return null
  }
}

/**
 * The single place a response body is built for a failure. Handlers throw;
 * they never format an error themselves.
 */
export function errorHandler(error: Error, c: Context) {
  const apiError = error instanceof ApiError ? error : fromPostgresError(error)

  if (apiError) {
    return c.json({ error: { code: apiError.code, message: apiError.message } }, apiError.status)
  }

  // Unrecognised: log it with the request id, tell the caller nothing useful.
  console.error(`[${c.get('requestId')}]`, error)
  return c.json({ error: { code: 'INTERNAL_ERROR', message: 'Something went wrong' } }, 500)
}

export function notFoundHandler(c: Context) {
  return c.json({ error: { code: 'RESOURCE_NOT_FOUND', message: 'Route not found' } }, 404)
}
