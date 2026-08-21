import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { ApiError, fromPostgresError } from '../src/lib/errors.ts'
import { paginationMeta, paginationQuery, toLimitOffset } from '../src/lib/validation.ts'

describe('pagination', () => {
  it('defaults to page 1, size 20 when nothing is supplied', () => {
    assert.deepEqual(paginationQuery.parse({}), { page: 1, size: 20 })
  })

  it('accepts numbers arriving as query strings', () => {
    assert.deepEqual(paginationQuery.parse({ page: '3', size: '50' }), { page: 3, size: 50 })
  })

  it('rejects the values a bad client actually sends', () => {
    for (const bad of [
      { page: '0' }, // below the first page
      { page: '-1' },
      { page: 'abc' },
      { page: '1.5' }, // not an integer
      { page: '' }, // ?page= with nothing after it
      { size: '0' },
      { size: '101' }, // above the cap
    ]) {
      assert.equal(paginationQuery.safeParse(bad).success, false, `${JSON.stringify(bad)} should be rejected`)
    }
  })

  it('turns a page into LIMIT and OFFSET', () => {
    assert.deepEqual(toLimitOffset({ page: 1, size: 20 }), { limit: 20, offset: 0 })
    assert.deepEqual(toLimitOffset({ page: 3, size: 20 }), { limit: 20, offset: 40 })
  })

  it('rounds totalPages up so a partial last page is counted', () => {
    assert.deepEqual(paginationMeta({ page: 1, size: 20 }, 41).pagination, {
      page: 1,
      size: 20,
      total: 41,
      totalPages: 3,
    })
  })

  it('reports zero pages for an empty result rather than one empty page', () => {
    assert.equal(paginationMeta({ page: 1, size: 20 }, 0).pagination.totalPages, 0)
  })
})

describe('postgres error mapping', () => {
  it('maps a duplicate phone to RESOURCE_ALREADY_EXISTS with a readable message', () => {
    const mapped = fromPostgresError({ code: '23505', constraint: 'customers_phone_idx' })

    assert.ok(mapped instanceof ApiError)
    assert.equal(mapped.code, 'RESOURCE_ALREADY_EXISTS')
    assert.equal(mapped.status, 409)
    assert.match(mapped.message, /phone number/)
  })

  it('finds the driver error inside a wrapper', () => {
    // Drizzle wraps driver errors in DrizzleQueryError, which has no `code` of
    // its own. Reading only the outermost error turned every constraint
    // violation into a 500.
    const wrapped = new Error('Failed query: insert into "customers" ...', {
      cause: { code: '23505', constraint: 'customers_phone_idx' },
    })

    assert.equal(fromPostgresError(wrapped)?.code, 'RESOURCE_ALREADY_EXISTS')
  })

  it('stops walking a self-referencing cause chain', () => {
    const looping: { code: string; cause?: unknown } = { code: 'not-a-pg-code' }
    looping.cause = looping

    assert.equal(fromPostgresError(looping), null)
  })

  it('maps a broken foreign key to RESOURCE_NOT_FOUND', () => {
    assert.equal(fromPostgresError({ code: '23503' })?.code, 'RESOURCE_NOT_FOUND')
  })

  it('maps a check violation to VALIDATION_FAILED', () => {
    const mapped = fromPostgresError({ code: '23514', constraint: 'order_items_quantity_positive' })

    assert.equal(mapped?.code, 'VALIDATION_FAILED')
    assert.match(mapped!.message, /greater than 0/)
  })

  it('returns null for anything it does not recognise, so it becomes a 500', () => {
    // Silently mapping an unknown database error to a 4xx would tell the caller
    // they made a mistake when the fault is ours.
    assert.equal(fromPostgresError({ code: '42P01' }), null)
    assert.equal(fromPostgresError(new Error('boom')), null)
    assert.equal(fromPostgresError(null), null)
  })
})
