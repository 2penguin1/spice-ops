import { zValidator } from '@hono/zod-validator'
import type { ValidationTargets } from 'hono'
import { z, type ZodType } from 'zod'

import { orderStatus } from '../db/schema.ts'
import { ApiError, type ErrorCode } from './errors.ts'

/** The five statuses, taken from the database enum so there is one source of truth. */
export const orderStatusSchema = z.enum(orderStatus.enumValues)

export const uuidParam = z.object({ id: z.uuid() })

export const PAGE_SIZE_DEFAULT = 20
export const PAGE_SIZE_MAX = 100

export const paginationQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  size: z.coerce.number().int().min(1).max(PAGE_SIZE_MAX).default(PAGE_SIZE_DEFAULT),
})

export type Pagination = z.infer<typeof paginationQuery>

// Takes the issues rather than the ZodError itself: ZodError is generic over
// its schema, so a parameter typed `ZodError` would not accept the
// `ZodError<Schema>` the validator hook hands us.
function formatIssues(issues: readonly { path: PropertyKey[]; message: string }[]): string {
  return issues
    .map((issue) =>
      issue.path.length ? `${issue.path.map(String).join('.')}: ${issue.message}` : issue.message,
    )
    .join('; ')
}

/**
 * Validation happens here, in the route definition, so handlers can assume
 * their input is already valid.
 *
 * The error code is a parameter because the contract uses different ones for
 * the same kind of failure: a bad body is VALIDATION_FAILED, a bad query
 * parameter is INVALID_FILTER, and a malformed path id means the resource
 * cannot exist, so it is RESOURCE_NOT_FOUND.
 */
export const validate = <Target extends keyof ValidationTargets, Schema extends ZodType>(
  target: Target,
  schema: Schema,
  code: ErrorCode = 'VALIDATION_FAILED',
) =>
  zValidator(target, schema, (result) => {
    if (!result.success) throw new ApiError(code, formatIssues(result.error.issues))
  })

/** Translates a page/size pair into the LIMIT and OFFSET the query needs. */
export function toLimitOffset({ page, size }: Pagination) {
  return { limit: size, offset: (page - 1) * size }
}

/**
 * The `meta.pagination` block. A page past the end returns an empty array with
 * correct meta rather than a 404 — see questions.md §3.
 */
export function paginationMeta({ page, size }: Pagination, total: number) {
  return {
    pagination: { page, size, total, totalPages: Math.ceil(total / size) },
  }
}
