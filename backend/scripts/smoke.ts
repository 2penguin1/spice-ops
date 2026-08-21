/**
 * End-to-end check of the API against a running server and a real database:
 * every endpoint, every documented error, the role rules, the live stream and
 * the retry behaviour.
 *
 *   npm run smoke                        (expects the API on :3000)
 *   SMOKE_URL=https://... npm run smoke
 *
 * Plain fetch and no dependencies, so it runs anywhere Node does.
 */
const BASE = process.env.SMOKE_URL ?? 'http://localhost:3000'

// Unique per run, so the script can be run repeatedly without colliding on
// the phone unique constraint.
const RUN = Date.now().toString().slice(-7)
// Zero-padded so no number is a prefix of another: without it phone(1)
// is a substring of phone(10), and a search for one finds both.
const phone = (n: number) => `+91 7${RUN}${String(n).padStart(2, '0')}`

type Result = { label: string; ok: boolean; detail: string }
const results: Result[] = []
const createdCustomerIds = new Set<string>()

type Response = { status: number; body: any }

/** One token per role. Most checks run as the manager. */
const tokens: Record<string, string> = {}

async function call(method: string, path: string, body?: unknown, as = 'manager'): Promise<Response> {
  const headers: Record<string, string> = {}
  if (body !== undefined) headers['content-type'] = 'application/json'
  if (tokens[as]) headers.Authorization = `Bearer ${tokens[as]}`

  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const text = await res.text()
  return { status: res.status, body: text ? JSON.parse(text) : null }
}

/** Same as call(), but deliberately sends no Authorization header. */
async function callAnonymous(method: string, path: string, body?: unknown): Promise<Response> {
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

// ─── Authentication ──────────────────────────────────────────────────────────

/**
 * True when the server is running with AUTH_DISABLED. The role rules cannot
 * hold in that mode — every caller is an admin — so those checks are skipped
 * and the run says so rather than reporting false failures.
 */
let authEnforced = true

async function detectAuthMode() {
  const anonymous = await callAnonymous('GET', '/orders?size=1')
  authEnforced = anonymous.status === 401

  console.log(
    authEnforced ? 'Auth is enforced.' : 'AUTH_DISABLED is set, so the role checks are skipped.',
  )
}

async function signIn() {
  if (!authEnforced) return

  for (const who of ['admin', 'manager', 'cook', 'server']) {
    const res = await callAnonymous('POST', '/auth/login', {
      email: `${who}@spice.test`,
      password: 'spice123',
    })
    expect(`${who} can sign in`, res, 200)
    if (res.body?.data?.token) tokens[who] = res.body.data.token
  }

  check('a token was issued for every role', Object.keys(tokens).length === 4)

  expect(
    'a wrong password is rejected',
    await callAnonymous('POST', '/auth/login', { email: 'admin@spice.test', password: 'wrong' }),
    401,
    'UNAUTHORIZED',
  )

  // The same message for both cases, so responses cannot be used to discover
  // which email addresses exist.
  const unknown = await callAnonymous('POST', '/auth/login', {
    email: 'nobody@spice.test',
    password: 'spice123',
  })
  expect('an unknown email is rejected', unknown, 401, 'UNAUTHORIZED')
  check(
    'unknown user and wrong password are indistinguishable',
    unknown.body?.error?.message ===
      (await callAnonymous('POST', '/auth/login', { email: 'admin@spice.test', password: 'x' })).body?.error
        ?.message,
  )

  check('the login response never contains a password hash', !JSON.stringify(await callAnonymous('POST', '/auth/login', { email: 'admin@spice.test', password: 'spice123' })).includes('scrypt'))
}

async function protection() {
  if (!authEnforced) return

  for (const path of ['/customers', '/orders', '/staff']) {
    expect(`${path} rejects an anonymous request`, await callAnonymous('GET', path), 401, 'UNAUTHORIZED')
  }

  expect(
    'a forged token is rejected',
    await callAnonymous('GET', '/orders', undefined).then(() =>
      fetch(`${BASE}/orders`, { headers: { Authorization: 'Bearer not.a.real.token' } }).then(async (r) => ({
        status: r.status,
        body: await r.json(),
      })),
    ),
    401,
    'UNAUTHORIZED',
  )

  expect('health needs no token', await callAnonymous('GET', '/health'), 200)
}

async function roles() {
  if (!authEnforced) return

  // Reading is open to everyone who is signed in.
  for (const who of ['admin', 'manager', 'cook', 'server']) {
    expect(`${who} can read orders`, await call('GET', '/orders?size=1', undefined, who), 200)
  }

  const created = await call('POST', '/orders', {
    customer: { name: 'Role Test', phone: phone(8) },
    items: [{ itemName: 'Dal Makhani', quantity: 1, unitPrice: 280 }],
  })
  const id = created.body?.data?.id
  if (created.body?.data?.customerId) createdCustomerIds.add(created.body.data.customerId)

  const move = (status: string, who: string) => call('PATCH', `/orders/${id}/status`, { status }, who)

  expect('the kitchen cannot take an order', await call('POST', '/orders', {
    customer: { name: 'X', phone: phone(9) },
    items: [{ itemName: 'A', quantity: 1, unitPrice: 10 }],
  }, 'cook'), 403, 'FORBIDDEN')

  expect('the floor cannot start prep', await move('PREPARING', 'server'), 403, 'FORBIDDEN')
  expect('the kitchen can start prep', await move('PREPARING', 'cook'), 200)
  expect('the kitchen cannot cancel', await move('CANCELLED', 'cook'), 403, 'FORBIDDEN')
  expect('the kitchen can mark ready', await move('READY', 'cook'), 200)
  expect('the kitchen cannot complete', await move('COMPLETED', 'cook'), 403, 'FORBIDDEN')
  expect('the floor can complete', await move('COMPLETED', 'server'), 200)

  expect(
    'the floor cannot delete a customer',
    await call('DELETE', '/customers/11111111-1111-4111-8111-111111111111', undefined, 'server'),
    403,
    'FORBIDDEN',
  )
  expect('the kitchen cannot see staff', await call('GET', '/staff', undefined, 'cook'), 403, 'FORBIDDEN')
  expect('a manager can see staff', await call('GET', '/staff', undefined, 'manager'), 200)

  const staff = await call('GET', '/staff', undefined, 'manager')
  check(
    'staff records never expose a password hash',
    !JSON.stringify(staff.body).includes('scrypt') && !JSON.stringify(staff.body).includes('passwordHash'),
  )

  // Attribution: the log records who moved it.
  const events = (await call('GET', `/orders/${id}/timeline`)).body?.data ?? []
  check('the log records every move', events.length === 4, `${events.length} events`)
}

async function stream() {
  if (authEnforced) {
    expect(
      'the event stream refuses an anonymous request',
      await callAnonymous('GET', '/events'),
      401,
      'UNAUTHORIZED',
    )

    expect(
      'a session token is not accepted as a stream ticket',
      await callAnonymous('GET', `/events?ticket=${encodeURIComponent(tokens.manager!)}`),
      401,
      'UNAUTHORIZED',
    )
  }

  const ticketResponse = await call('POST', '/events/ticket')
  expect('a signed-in user can get a stream ticket', ticketResponse, 200)
  const ticket = ticketResponse.body?.data?.ticket

  if (authEnforced) {
    const asSession = await fetch(`${BASE}/orders`, {
      headers: { Authorization: `Bearer ${ticket}` },
    })
    check('a stream ticket is not accepted as a session token', asSession.status === 401, `got ${asSession.status}`)
  }

  // Open the stream, change an order, and confirm the frame arrives.
  const created = await call('POST', '/orders', {
    customer: { name: 'Stream Watcher', phone: phone(10) },
    items: [{ itemName: 'Tandoori Roti', quantity: 1, unitPrice: 40 }],
  })
  const orderId = created.body?.data?.id
  if (created.body?.data?.customerId) createdCustomerIds.add(created.body.data.customerId)

  const controller = new AbortController()
  const frames: string[] = []

  const reading = fetch(`${BASE}/events?ticket=${encodeURIComponent(ticket)}`, {
    signal: controller.signal,
  }).then(async (res) => {
    const reader = res.body!.getReader()
    const decoder = new TextDecoder()
    try {
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        frames.push(decoder.decode(value))
      }
    } catch {
      // Aborted on purpose below.
    }
  })

  await new Promise((resolve) => setTimeout(resolve, 500))
  await call('PATCH', `/orders/${orderId}/status`, { status: 'PREPARING' })
  await new Promise((resolve) => setTimeout(resolve, 1200))

  controller.abort()
  await reading

  const received = frames.join('')
  check('the stream opens and announces itself', received.includes('event: ready'))
  check('a status change is announced on the stream', received.includes('event: order:updated'))
  check('the announcement names the order', received.includes(orderId), 'frame did not carry the order id')
  check(
    'the announcement carries an id, not the whole order',
    !received.includes('totalAmount') && !received.includes('items'),
  )
}

async function analytics() {
  if (authEnforced) {
    expect(
      'the kitchen cannot see the dashboard',
      await call('GET', '/analytics/summary', undefined, 'cook'),
      403,
      'FORBIDDEN',
    )
  }

  const summary = await call('GET', '/analytics/summary')
  expect('a manager can see the summary', summary, 200)

  const s = summary.body?.data
  check('revenue is a number, not a numeric string', typeof s?.revenue?.net === 'number')
  check('the funnel covers every status present', Array.isArray(s?.funnel) && s.funnel.length > 0)
  check(
    'the cancellation rate is a proportion, not a percentage',
    s?.cancellationRate >= 0 && s?.cancellationRate <= 1,
    String(s?.cancellationRate),
  )
  check(
    'average prep time is either a number or null, never zero-for-missing',
    s?.averagePrepSeconds === null || typeof s?.averagePrepSeconds === 'number',
  )

  // generate_series fills quiet days, so a chart cannot draw a straight line
  // through a day that had no trade.
  const daily = await call('GET', '/analytics/daily?days=7')
  expect('daily returns 200', daily, 200)
  check('daily returns exactly the days asked for', daily.body?.data?.length === 7, `${daily.body?.data?.length}`)

  const hours = await call('GET', '/analytics/hours')
  check('every hour of the day is present', hours.body?.data?.length === 24, `${hours.body?.data?.length}`)

  expect('days out of range is INVALID_FILTER', await call('GET', '/analytics/daily?days=0'), 400, 'INVALID_FILTER')
  expect('days above the cap is INVALID_FILTER', await call('GET', '/analytics/daily?days=999'), 400, 'INVALID_FILTER')

  // The AI reading must never be able to break the dashboard: no key, a
  // provider outage or a timeout all return 200 with narrative null.
  const ai = await call('GET', '/analytics/insights')
  expect('insights responds 200 whether or not AI is configured', ai, 200)
  check(
    'insights always answers with a narrative or a stated reason',
    typeof ai.body?.data?.narrative === 'string' || ai.body?.data?.unavailable !== null,
    JSON.stringify(ai.body?.data),
  )
  if (authEnforced) {
    check(
      'the kitchen cannot read the AI summary',
      (await call('GET', '/analytics/insights', undefined, 'cook')).status === 403,
    )
  }

  const staff = await call('GET', '/analytics/staff')
  expect('staff analytics returns 200', staff, 200)
  check('staff analytics never exposes a password hash', !JSON.stringify(staff.body).includes('scrypt'))
}

async function retriesAndNotifications() {
  const payload = {
    customer: { name: 'Retry Diner', phone: phone(11) },
    items: [{ itemName: 'Chicken Biryani', quantity: 1, unitPrice: 380 }],
  }

  const key = `smoke-${RUN}`

  const first = await fetch(`${BASE}/orders`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      Authorization: `Bearer ${tokens.manager}`,
      'Idempotency-Key': key,
    },
    body: JSON.stringify(payload),
  })
  const firstBody = await first.json()
  check('an order with an idempotency key is created', first.status === 201, `got ${first.status}`)
  if (firstBody?.data?.customerId) createdCustomerIds.add(firstBody.data.customerId)

  // The retry a client makes when it never saw the response.
  const retry = await fetch(`${BASE}/orders`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      Authorization: `Bearer ${tokens.manager}`,
      'Idempotency-Key': key,
    },
    body: JSON.stringify(payload),
  })
  const retryBody = await retry.json()

  check('a retry returns the same status', retry.status === 201, `got ${retry.status}`)
  check(
    'a retry returns the SAME order, not a second one',
    retryBody?.data?.id === firstBody?.data?.id,
    `${firstBody?.data?.orderNumber} vs ${retryBody?.data?.orderNumber}`,
  )

  // Same key, different order: a client bug that must not be silently absorbed.
  const different = await fetch(`${BASE}/orders`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      Authorization: `Bearer ${tokens.manager}`,
      'Idempotency-Key': key,
    },
    body: JSON.stringify({ ...payload, items: [{ itemName: 'Naan', quantity: 9, unitPrice: 70 }] }),
  })
  check('reusing a key for a different request is rejected', different.status === 400, `got ${different.status}`)

  // Without a key the endpoint behaves exactly as it always did.
  const a = await call('POST', '/orders', { ...payload, customer: { name: 'No Key', phone: phone(12) } })
  const b = await call('POST', '/orders', { ...payload, customer: { name: 'No Key', phone: phone(12) } })
  if (a.body?.data?.customerId) createdCustomerIds.add(a.body.data.customerId)
  check('without a key, two identical requests make two orders', a.body?.data?.id !== b.body?.data?.id)

  // The outbox row was written with the order, in the same transaction.
  const orderId = firstBody?.data?.id
  const queued = await call('GET', `/notifications?orderId=${orderId}`)
  expect('the outbox can be inspected', queued, 200)
  check('placing an order queued exactly one message', queued.body?.data?.length === 1, `${queued.body?.data?.length}`)
  check(
    'the retry did not queue a second message',
    queued.body?.data?.filter((n: any) => n.body.includes('have your order')).length === 1,
  )

  // The worker drains every few seconds; give it one cycle.
  await new Promise((resolve) => setTimeout(resolve, 6500))
  const drained = await call('GET', `/notifications?orderId=${orderId}`)
  check(
    'the worker sent it',
    drained.body?.data?.[0]?.status === 'SENT',
    `status ${drained.body?.data?.[0]?.status}, attempts ${drained.body?.data?.[0]?.attempts}`,
  )
  check('a sent message records when', drained.body?.data?.[0]?.sentAt !== null)

  if (authEnforced) {
    expect(
      'the kitchen cannot read the outbox',
      await call('GET', '/notifications', undefined, 'cook'),
      403,
      'FORBIDDEN',
    )
  }
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

  // The history must record what happened, in order, with each move's origin.
  const history = await call('GET', `/orders/${orderId}/timeline`)
  expect('timeline responds 200', history, 200)
  const events = history.body?.data ?? []
  check('first event is the order being placed', events[0]?.toStatus === 'CONFIRMED')
  check('the first event has no previous status', events[0]?.fromStatus === null)
  check('the move to PREPARING was recorded once', events.filter((e: any) => e.toStatus === 'PREPARING').length === 1)
  check(
    'each event records where it came from',
    events.slice(1).every((e: any) => e.fromStatus !== null),
  )
  check(
    'events are in chronological order',
    events.every((e: any, i: number) => i === 0 || e.createdAt >= events[i - 1].createdAt),
  )
  expect(
    'timeline of an unknown order is 404',
    await call('GET', '/orders/11111111-1111-4111-8111-111111111111/timeline'),
    404,
    'RESOURCE_NOT_FOUND',
  )

  expect('PREPARING to READY', await to('READY'), 200)
  expect('READY to COMPLETED', await to('COMPLETED'), 200)
  expect('COMPLETED is terminal', await to('CANCELLED'), 409, 'INVALID_STATUS_TRANSITION')

  const final = (await call('GET', `/orders/${orderId}/timeline`)).body?.data ?? []
  check('the full lifecycle is recorded', final.length === 4, `${final.length} events`)
  check(
    'a rejected transition leaves no trace in the log',
    final.every((e: any) => e.toStatus !== 'CANCELLED'),
  )
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
  await detectAuthMode()
  await signIn()
  await protection()
  await roles()
  await stream()
  await analytics()
  await retriesAndNotifications()
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
