import type { Context } from 'hono'

/** Every error code the API returns, and the HTTP status each one maps to. */
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
  // Not a constructor parameter property: Node's type stripping rejects those,
  // and the tests run these files without a compiler.
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
 * Messages for the constraints callers actually hit. Catching the violation is
 * race-free; a SELECT before the INSERT lets two requests both pass.
 */
const CONSTRAINT_MESSAGES: Record<string, string> = {
  customers_phone_idx: 'A customer with this phone number already exists',
  orders_order_number_idx: 'An order with this number already exists',
  order_items_quantity_positive: 'quantity must be greater than 0',
  order_items_unit_price_non_negative: 'unitPrice must be 0 or greater',
}

function mapConstraintViolation(error: unknown): ApiError | null {
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
 * Turns a Postgres error into an API error, or null if it is not one we know.
 *
 * Walks the cause chain: Drizzle wraps driver errors, and the wrapper carries
 * no error code, so reading only the outer error turns every constraint
 * violation into a 500.
 */
export function fromPostgresError(error: unknown): ApiError | null {
  let current = error

  for (let depth = 0; current != null && depth < 5; depth++) {
    const mapped = mapConstraintViolation(current)
    if (mapped) return mapped
    current = (current as { cause?: unknown }).cause
  }

  return null
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
