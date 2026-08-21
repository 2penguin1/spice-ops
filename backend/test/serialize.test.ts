import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { toCustomer, toOrderDetail, toOrderItem } from '../src/lib/serialize.ts'

const CREATED = new Date('2026-08-01T09:30:00.000Z')
const UPDATED = new Date('2026-08-01T10:00:00.000Z')

const customerRow = {
  id: 'c1',
  name: 'Aarav Sharma',
  email: null,
  phone: '+91 98200 11223',
  createdAt: CREATED,
  updatedAt: UPDATED,
}

const orderRow = {
  id: 'o1',
  orderNumber: 'ORD-000042',
  customerId: 'c1',
  status: 'PREPARING' as const,
  createdAt: CREATED,
  updatedAt: UPDATED,
}

// node-postgres hands back `numeric` as a string. These rows mimic that.
const item = (id: string, quantity: number, unitPrice: string, totalPrice: string) => ({
  id,
  orderId: 'o1',
  itemName: `Dish ${id}`,
  quantity,
  unitPrice,
  totalPrice,
  createdAt: CREATED,
})

describe('serialize', () => {
  it('converts numeric strings to numbers and dates to ISO strings', () => {
    const result = toOrderItem(item('i1', 2, '320.00', '640.00'))

    assert.equal(result.unitPrice, 320)
    assert.equal(result.totalPrice, 640)
    assert.equal(typeof result.unitPrice, 'number')
  })

  it('keeps a null email as null rather than undefined or an empty string', () => {
    // The contract types email as `string | null`, so it must be present.
    const result = toCustomer(customerRow)

    assert.equal(result.email, null)
    assert.ok('email' in result)
    assert.equal(result.createdAt, '2026-08-01T09:30:00.000Z')
  })

  it('sums money without floating point drift', () => {
    // 0.1 + 0.2 === 0.30000000000000004 in floating point. Summing in whole
    // paise and dividing once avoids it.
    const result = toOrderDetail(orderRow, customerRow, [
      item('i1', 1, '0.10', '0.10'),
      item('i2', 1, '0.20', '0.20'),
    ])

    assert.equal(result.totalAmount, 0.3)
  })

  it('sums a realistic order exactly', () => {
    const result = toOrderDetail(orderRow, customerRow, [
      item('i1', 2, '320.00', '640.00'),
      item('i2', 3, '70.00', '210.00'),
      item('i3', 1, '380.50', '380.50'),
    ])

    assert.equal(result.totalAmount, 1230.5)
  })

  it('counts itemCount as total quantity, not number of lines', () => {
    // questions.md §1.3 — an order of 2 naan and 1 biryani is 3 items.
    const result = toOrderDetail(orderRow, customerRow, [
      item('i1', 2, '70.00', '140.00'),
      item('i2', 1, '380.00', '380.00'),
    ])

    assert.equal(result.itemCount, 3)
    assert.equal(result.items.length, 2)
  })

  it('reports an order with no items as zero, not NaN', () => {
    const result = toOrderDetail(orderRow, customerRow, [])

    assert.equal(result.totalAmount, 0)
    assert.equal(result.itemCount, 0)
    assert.deepEqual(result.items, [])
  })

  it('emits exactly the contract fields and no others', () => {
    // A platform-layer column leaking into an order response would break the
    // contract silently. This test fails if that ever happens.
    const result = toOrderDetail(orderRow, customerRow, [item('i1', 1, '10.00', '10.00')])

    assert.deepEqual(Object.keys(result).sort(), [
      'createdAt',
      'customer',
      'customerId',
      'id',
      'itemCount',
      'items',
      'orderNumber',
      'status',
      'totalAmount',
      'updatedAt',
    ])

    assert.deepEqual(Object.keys(result.customer).sort(), [
      'createdAt',
      'email',
      'id',
      'name',
      'phone',
      'updatedAt',
    ])

    assert.deepEqual(Object.keys(result.items[0]!).sort(), [
      'id',
      'itemName',
      'quantity',
      'totalPrice',
      'unitPrice',
    ])
  })
})
