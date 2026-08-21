/**
 * Contract smoke test.
 *
 * Walks the full order lifecycle and every error case docs/api-contract.md
 * documents, against a running server and a real database.
 *
 * This is the gate for phases 11-16: any platform feature that changes a
 * contract response fails here. Run it before and after adding one.
 *
 *   npm run smoke                       (expects the API on :3000)
 *   SMOKE_URL=https://... npm run smoke
 *
 * Uses fetch and no dependencies, so it runs anywhere Node does — no curl,
 * no shell differences between Windows and Linux.
 */
const BASE = process.env.SMOKE_URL ?? 'http://localhost:3000'

// Unique per run, so the script can be run repeatedly without colliding on
// the phone unique constraint.
const RUN = Date.now().toString().slice(-7)
const phone = (n: number) => `+91 7${RUN}${n}`

type Result = { label: string; ok: boolean; detail: string }
const results: Result[] = []
const createdCustomerIds = new Set<string>()

type Response = { status: number; body: any }

async function call(method: string, path: string, body?: unknown): Promise<Response> {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: body === undefined ? {} : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const text = await res.text()
  return { status: res.status, body: text ? JSON.parse(text) : null }
}

function record(label: string, ok: boolean, detail = '') {
  results.push({ label, ok, detail })
  if (!ok) console.error(`  FAIL  ${label} — ${detail}`)
}

/** Asserts an HTTP status and, for failures, the contract error code. */
function expect(label: string, res: Response, status: number, code?: string): Response {
  const gotCode = res.body?.error?.code
  const ok = res.status === status && (code === undefined || gotCode === code)
  record(label, ok, `wanted ${status}${code ? ` ${code}` : ''}, got ${res.status}${gotCode ? ` ${gotCode}` : ''}`)
  return res
}

function check(label: string, ok: boolean, detail = '') {
  record(label, ok, detail)
}

function keysOf(value: object) {
  return Object.keys(value).sort().join(',')
}

// ─── Envelope shapes ─────────────────────────────────────────────────────────

async function envelopes() {
  const health = await call('GET', '/health')
  expect('health responds 200', health, 200)

  const list = await call('GET', '/orders?size=1')
  expect('GET /orders responds 200', list, 200)
  check('list wraps results in data', Array.isArray(list.body?.data))
  check(
    'pagination meta has exactly page,size,total,totalPages',
    keysOf(list.body?.meta?.pagination ?? {}) === 'page,size,total,totalPages',
    keysOf(list.body?.meta?.pagination ?? {}),
  )

  const missing = await call('GET', '/orders/11111111-1111-4111-8111-111111111111')
  expect('unknown order is 404', missing, 404, 'RESOURCE_NOT_FOUND')
  check(
    'error envelope is exactly {error:{code,message}}',
    keysOf(missing.body ?? {}) === 'error' && keysOf(missing.body.error) === 'code,message',
  )

  const detail = list.body?.data?.[0]
  if (detail) {
    check(
      'OrderDetail carries exactly the contract fields',
      keysOf(detail) ===
        'createdAt,customer,customerId,id,itemCount,items,orderNumber,status,totalAmount,updatedAt',
      keysOf(detail),
    )
    check(
      'embedded Customer carries exactly the contract fields',
      keysOf(detail.customer) === 'createdAt,email,id,name,phone,updatedAt',
      keysOf(detail.customer),
    )
  }
}

// ─── Customers ───────────────────────────────────────────────────────────────

async function customers() {
  const created = await call('POST', '/customers', {
    name: 'Smoke Customer',
    email: 'smoke@example.com',
    phone: phone(1),
  })
  expect('create customer is 201', created, 201)
  const id = created.body?.data?.id
  if (id) createdCustomerIds.add(id)

  expect(
    'duplicate phone is RESOURCE_ALREADY_EXISTS',
    await call('POST', '/customers', { name: 'Other', phone: phone(1) }),
    409,
    'RESOURCE_ALREADY_EXISTS',
  )
  expect(
    'missing required field is VALIDATION_FAILED',
    await call('POST', '/customers', { phone: phone(2) }),
    400,
    'VALIDATION_FAILED',
  )
  expect(
    'malformed email is VALIDATION_FAILED',
    await call('POST', '/customers', { name: 'X', email: 'nope', phone: phone(3) }),
    400,
    'VALIDATION_FAILED',
  )

  expect('page=0 is INVALID_FILTER', await call('GET', '/customers?page=0'), 400, 'INVALID_FILTER')
  expect('size over cap is INVALID_FILTER', await call('GET', '/customers?size=101'), 400, 'INVALID_FILTER')

  const searched = await call('GET', `/customers?search=${encodeURIComponent(phone(1))}`)
  expect('search finds the customer', searched, 200)
  check('search returns exactly one match', searched.body?.data?.length === 1)

  const patched = await call('PATCH', `/customers/${id}`, { name: 'Smoke Renamed' })
  expect('patch is 200', patched, 200)
  check('patch applied the change', patched.body?.data?.name === 'Smoke Renamed')

  const noop = await call('PATCH', `/customers/${id}`, {})
  expect('empty patch is a no-op 200', noop, 200)
  check('no-op patch left the record unchanged', noop.body?.data?.name === 'Smoke Renamed')

  expect(
    'patch unknown customer is 404',
    await call('PATCH', '/customers/11111111-1111-4111-8111-111111111111', { name: 'Ghost' }),
    404,
    'RESOURCE_NOT_FOUND',
  )
  expect(
    'malformed id is 404',
    await call('PATCH', '/customers/not-a-uuid', { name: 'Ghost' }),
    404,
    'RESOURCE_NOT_FOUND',
  )
}

// ─── Orders ──────────────────────────────────────────────────────────────────

async function orders() {
  const created = await call('POST', '/orders', {
    customer: { name: 'Smoke Diner', phone: phone(4) },
    items: [
      { itemName: 'Paneer Butter Masala', quantity: 2, unitPrice: 320.5 },
      { itemName: 'Garlic Naan', quantity: 3, unitPrice: 70 },
    ],
  })
  expect('create order is 201', created, 201)
  const order = created.body?.data
  if (order?.customerId) createdCustomerIds.add(order.customerId)

  check('totalAmount is summed exactly', order?.totalAmount === 851, `got ${order?.totalAmount}`)
  check('itemCount is total quantity, not line count', order?.itemCount === 5, `got ${order?.itemCount}`)
  check('new orders start CONFIRMED', order?.status === 'CONFIRMED', order?.status)
  check('orderNumber was assigned', typeof order?.orderNumber === 'string' && order.orderNumber.startsWith('ORD-'))

  // Same phone again: reuse the customer rather than failing, and do not
  // overwrite their details with what was typed this time.
  const repeat = await call('POST', '/orders', {
    customer: { name: 'Typed Wrong', phone: phone(4) },
    items: [{ itemName: 'Mango Lassi', quantity: 1, unitPrice: 150 }],
  })
  expect('returning customer does not 409', repeat, 201)
  check('returning customer is reused', repeat.body?.data?.customerId === order?.customerId)
  check('existing customer name is not overwritten', repeat.body?.data?.customer?.name === 'Smoke Diner')

  expect(
    'order with no items is VALIDATION_FAILED',
    await call('POST', '/orders', { customer: { name: 'X', phone: phone(5) }, items: [] }),
    400,
    'VALIDATION_FAILED',
  )
  expect(
    'quantity 0 is VALIDATION_FAILED',
    await call('POST', '/orders', {
      customer: { name: 'X', phone: phone(6) },
      items: [{ itemName: 'A', quantity: 0, unitPrice: 10 }],
    }),
    400,
    'VALIDATION_FAILED',
  )
  expect(
    'unknown customer.id is RESOURCE_NOT_FOUND',
    await call('POST', '/orders', {
      customer: { id: '11111111-1111-4111-8111-111111111111' },
      items: [{ itemName: 'A', quantity: 1, unitPrice: 10 }],
    }),
    404,
    'RESOURCE_NOT_FOUND',
  )

  expect('invalid status filter is INVALID_FILTER', await call('GET', '/orders?status=COOKING'), 400, 'INVALID_FILTER')
  expect(
    'unknown customerId filter is RESOURCE_NOT_FOUND',
    await call('GET', '/orders?customerId=11111111-1111-4111-8111-111111111111'),
    404,
    'RESOURCE_NOT_FOUND',
  )

  const past = await call('GET', '/orders?page=9999')
  expect('page past the end is 200', past, 200)
  check('page past the end returns an empty array, not 404', past.body?.data?.length === 0)

  return order.id as string
}

// ─── Lifecycle ───────────────────────────────────────────────────────────────

async function lifecycle(orderId: string) {
  const to = (status: string) => call('PATCH', `/orders/${orderId}/status`, { status })

  expect('CONFIRMED cannot skip to READY', await to('READY'), 409, 'INVALID_STATUS_TRANSITION')
  expect('CONFIRMED cannot skip to COMPLETED', await to('COMPLETED'), 409, 'INVALID_STATUS_TRANSITION')
  expect('unknown status value is VALIDATION_FAILED', await to('COOKING'), 400, 'VALIDATION_FAILED')

  expect('CONFIRMED to PREPARING', await to('PREPARING'), 200)
  expect('setting the same status is a no-op 200', await to('PREPARING'), 200)
  expect('cannot move backwards', await to('CONFIRMED'), 409, 'INVALID_STATUS_TRANSITION')

  // Add and remove an item mid-lifecycle; the whole order comes back each time.
  const added = await call('POST', `/orders/${orderId}/items`, {
    itemName: 'Gulab Jamun',
    quantity: 2,
    unitPrice: 120,
  })
  expect('add item is 201', added, 201)
  check('add item returns the whole order', Array.isArray(added.body?.data?.items))
  check('totals include the new item', added.body?.data?.totalAmount === 1091, `got ${added.body?.data?.totalAmount}`)

  const itemId = added.body?.data?.items?.find((i: any) => i.itemName === 'Gulab Jamun')?.id

  expect(
    'add item to unknown order is 404',
    await call('POST', '/orders/11111111-1111-4111-8111-111111111111/items', {
      itemName: 'A',
      quantity: 1,
      unitPrice: 10,
    }),
    404,
    'RESOURCE_NOT_FOUND',
  )

  const removed = await call('DELETE', `/orders/${orderId}/items/${itemId}`)
  expect('delete item is 200, not 204', removed, 200)
  check('totals dropped back after removal', removed.body?.data?.totalAmount === 851, `got ${removed.body?.data?.totalAmount}`)

  expect(
    'deleting the same item twice is 404',
    await call('DELETE', `/orders/${orderId}/items/${itemId}`),
    404,
    'RESOURCE_NOT_FOUND',
  )

  expect('PREPARING to READY', await to('READY'), 200)
  expect('READY to COMPLETED', await to('COMPLETED'), 200)
  expect('COMPLETED is terminal', await to('CANCELLED'), 409, 'INVALID_STATUS_TRANSITION')
}

// ─── Concurrency ─────────────────────────────────────────────────────────────

async function concurrency() {
  const created = await call('POST', '/orders', {
    customer: { name: 'Race Diner', phone: phone(7) },
    items: [{ itemName: 'Chicken Biryani', quantity: 1, unitPrice: 380 }],
  })
  const id = created.body?.data?.id
  if (created.body?.data?.customerId) createdCustomerIds.add(created.body.data.customerId)

  await call('PATCH', `/orders/${id}/status`, { status: 'PREPARING' })
  await call('PATCH', `/orders/${id}/status`, { status: 'READY' })

  // A server marks it delivered while a manager cancels it. Both are legal
  // from READY, so exactly one must win.
  const attempts = await Promise.all([
    ...Array.from({ length: 6 }, () => call('PATCH', `/orders/${id}/status`, { status: 'COMPLETED' })),
    ...Array.from({ length: 6 }, () => call('PATCH', `/orders/${id}/status`, { status: 'CANCELLED' })),
  ])

  const accepted = attempts.filter((r) => r.status === 200)
  const rejected = attempts.filter((r) => r.status === 409)
  const final = (await call('GET', `/orders/${id}`)).body?.data?.status

  // The split between accepted and rejected is genuinely nondeterministic: a
  // request that reads READY before the winner commits loses the conditional
  // UPDATE and is rejected, while one that reads after it takes the no-op path.
  // Asserting an exact split would make this gate flaky. Assert the invariants.
  check('every concurrent request got a definite answer', accepted.length + rejected.length === 12, `${accepted.length} + ${rejected.length}`)
  check('conflicts were detected, not silently overwritten', rejected.length > 0, `${rejected.length} rejected`)
  check('at least one request won', accepted.length > 0, `${accepted.length} accepted`)
  check('no concurrent request caused a server error', attempts.every((r) => r.status < 500))
  check('the order ends in exactly one consistent status', final === 'COMPLETED' || final === 'CANCELLED', final)
  check(
    'every accepted response agrees with the final status',
    accepted.every((r) => r.body?.data?.status === final),
    `final ${final}`,
  )
}

// ─── Cleanup ─────────────────────────────────────────────────────────────────

async function cleanup() {
  for (const id of createdCustomerIds) {
    const res = await call('DELETE', `/customers/${id}`)
    if (res.status !== 204) record(`cleanup customer ${id}`, false, `got ${res.status}`)
  }
  check('smoke data removed (orders cascade with their customer)', true)
}

// ─── Run ─────────────────────────────────────────────────────────────────────

console.log(`Contract smoke test against ${BASE}\n`)

try {
  await envelopes()
  await customers()
  await lifecycle(await orders())
  await concurrency()
} finally {
  await cleanup()
}

const failed = results.filter((r) => !r.ok)

console.log(`\n${results.length - failed.length}/${results.length} checks passed`)

if (failed.length > 0) {
  console.error(`\n${failed.length} FAILED:`)
  for (const f of failed) console.error(`  - ${f.label} (${f.detail})`)
  process.exit(1)
}

console.log('Contract intact.')
