import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { ApiError } from '../src/lib/errors.ts'
import { assertTransition, canTransition, type OrderStatus } from '../src/lib/status.ts'

const STATUSES = ['CONFIRMED', 'PREPARING', 'READY', 'COMPLETED', 'CANCELLED'] as const

/**
 * The transition table from docs/lld.md §5, written out by hand rather than
 * derived from the implementation — otherwise the test would agree with a bug.
 * Rows are `from`, columns are `to`.
 */
const EXPECTED: Record<OrderStatus, Record<OrderStatus, boolean>> = {
  //            CONFIRMED PREPARING READY  COMPLETED CANCELLED
  CONFIRMED: { CONFIRMED: true,  PREPARING: true,  READY: false, COMPLETED: false, CANCELLED: true  },
  PREPARING: { CONFIRMED: false, PREPARING: true,  READY: true,  COMPLETED: false, CANCELLED: true  },
  READY:     { CONFIRMED: false, PREPARING: false, READY: true,  COMPLETED: true,  CANCELLED: true  },
  COMPLETED: { CONFIRMED: false, PREPARING: false, READY: false, COMPLETED: true,  CANCELLED: false },
  CANCELLED: { CONFIRMED: false, PREPARING: false, READY: false, COMPLETED: false, CANCELLED: true  },
}

describe('order status machine', () => {
  it('matches the documented table for all 25 transitions', () => {
    for (const from of STATUSES) {
      for (const to of STATUSES) {
        assert.equal(
          canTransition(from, to),
          EXPECTED[from][to],
          `${from} -> ${to} should be ${EXPECTED[from][to] ? 'allowed' : 'rejected'}`,
        )
      }
    }
  })

  it('treats setting the same status as a no-op, not an error', () => {
    // A double-tap in a busy kitchen must not raise an error.
    for (const status of STATUSES) {
      assert.doesNotThrow(() => assertTransition(status, status))
    }
  })

  it('never lets a terminal status move anywhere else', () => {
    for (const terminal of ['COMPLETED', 'CANCELLED'] as const) {
      for (const to of STATUSES.filter((s) => s !== terminal)) {
        assert.equal(canTransition(terminal, to), false, `${terminal} must not move to ${to}`)
      }
    }
  })

  it('never allows moving backwards', () => {
    const order = ['CONFIRMED', 'PREPARING', 'READY', 'COMPLETED'] as const
    for (let i = 0; i < order.length; i++) {
      for (let j = 0; j < i; j++) {
        assert.equal(canTransition(order[i]!, order[j]!), false)
      }
    }
  })

  it('never allows skipping a step forward', () => {
    assert.equal(canTransition('CONFIRMED', 'READY'), false)
    assert.equal(canTransition('CONFIRMED', 'COMPLETED'), false)
    assert.equal(canTransition('PREPARING', 'COMPLETED'), false)
  })

  it('throws INVALID_STATUS_TRANSITION with a message naming the legal moves', () => {
    assert.throws(
      () => assertTransition('CONFIRMED', 'COMPLETED'),
      (error: unknown) => {
        assert.ok(error instanceof ApiError)
        assert.equal(error.code, 'INVALID_STATUS_TRANSITION')
        assert.equal(error.status, 409)
        assert.match(error.message, /PREPARING or CANCELLED/)
        return true
      },
    )
  })

  it('says so plainly when the order is already finished', () => {
    assert.throws(
      () => assertTransition('COMPLETED', 'PREPARING'),
      /final status/,
    )
  })
})
