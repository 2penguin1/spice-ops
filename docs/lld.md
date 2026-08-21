# Low Level Design — Spice Garden OMS

Module boundaries, sequences, algorithms, and the exact rules each piece
enforces. System-level context is in [hld.md](hld.md); the endpoint spec is in
[api-contract.md](api-contract.md).

---

## 1. Module map

Every module has one job. Arrows point the only direction dependencies flow.

```
routes/        ← HTTP shape only. No SQL, no business rules.
   │
   ├──▶ lib/validation.ts   Zod schemas, shared across routes
   ├──▶ lib/auth.ts         verify token → context; requireRole guard
   ├──▶ lib/status.ts       the transition machine (pure, no I/O)
   ├──▶ lib/orders.tx.ts    the ONLY way an order's status changes
   ├──▶ lib/serialize.ts    DB row → contract shape (pure)
   ├──▶ lib/errors.ts       ApiError + the error middleware
   ├──▶ services/           analytics SQL, AI narrative
   │
   └──▶ db/schema.ts        Drizzle tables — single source of truth
```

**No repository or service layer over plain CRUD.** Drizzle *is* the data
access layer; routes call it directly. `services/` exists only where there is
real logic beyond a query — analytics aggregation and the LLM call.

### Key signatures

```ts
// lib/status.ts — pure, fully unit-testable, zero imports
type OrderStatus = 'CONFIRMED'|'PREPARING'|'READY'|'COMPLETED'|'CANCELLED'
function canTransition(from: OrderStatus, to: OrderStatus): boolean
function assertTransition(from: OrderStatus, to: OrderStatus): void  // throws ApiError

// lib/orders.tx.ts — the single write path for status
async function transitionOrder(opts: {
  orderId: string
  to: OrderStatus
  expected?: OrderStatus     // omit = derive from the machine
  staffId: string | null
  claim?: boolean            // also take ownership if unassigned
}): Promise<OrderDetail>

// lib/errors.ts
class ApiError extends Error {
  constructor(public code: ErrorCode, message: string, public status: number)
  static notFound(what: string): ApiError
  static validation(message: string): ApiError
  static conflict(code: ErrorCode, message: string): ApiError
}

// lib/serialize.ts — pure
function toCustomer(row: CustomerRow): Customer
function toOrderDetail(order: OrderRow, customer: CustomerRow, items: ItemRow[]): OrderDetail
```

`transitionOrder` being the only status write path is what guarantees the event
log, the outbox, and the SSE stream can never fall out of step with the order.

---

## 2. Request pipeline

Middleware order matters. Cheapest and most likely to reject runs first.

```
request
  │
  ├─ 1. requestId        attach a uuid, thread it into every log line
  ├─ 2. cors             preflight short-circuits here
  ├─ 3. auth             verify JWT → c.set('staff', {...})    401 if bad
  ├─ 4. requireRole      per-route guard                       403 if wrong
  ├─ 5. zValidator       body / query / params                 400 VALIDATION_FAILED
  ├─ 6. handler          business logic, assumes valid input
  ├─ 7. serialize        row → contract shape
  └─ 8. onError          ApiError → envelope; anything else → 500 + log stack
response
```

**Rule:** a handler never validates and never formats an error. If a handler
contains a `try/catch` that builds a response, that logic belongs in step 8.

---

## 3. Sequence: create order

The most complex path. Every numbered step is deliberate.

```
Client                API                          Postgres
  │  POST /orders      │                              │
  │  Idempotency-Key   │                              │
  ├───────────────────▶│                              │
  │                    │ 1. verify JWT (no DB hit)    │
  │                    │ 2. Zod: ≥1 item, qty>0, …    │
  │                    │                              │
  │                    │ 3. BEGIN ───────────────────▶│
  │                    │ 4. INSERT idempotency_keys   │  ← unique index is the lock
  │                    │      (key, endpoint, hash)   │
  │                    │ 5. resolve customer:         │
  │                    │      id given → SELECT       │
  │                    │      else     → SELECT by phone
  │                    │      else     → INSERT       │
  │                    │ 6. INSERT orders             │  ← order_number from sequence
  │                    │ 7. INSERT order_items        │  ← total_price generated
  │                    │ 8. INSERT order_status_events│  (null → CONFIRMED)
  │                    │ 9. INSERT notifications      │  (PENDING)
  │                    │10. UPDATE idempotency_keys   │  store response body
  │                    │      SET response_body = …   │
  │                    │11. COMMIT ──────────────────▶│
  │                    │                              │
  │                    │12. queue.add(notify)   ─┐ after commit.
  │                    │13. events.emit(created) ─┘ failure here is recoverable
  │ ◀──────201─────────┤                              │
```

**Steps 4 and 10 in the same transaction** is what makes idempotency exact. The
key row and the order commit together or not at all.

**Steps 12–13 after commit** is what keeps a Redis outage from failing an order.

### Customer resolution rules

| Input | Behaviour | On failure |
|---|---|---|
| `customer.id` present | attach to it. Other fields **ignored** — a typo must not overwrite good data | `RESOURCE_NOT_FOUND` |
| `id` null, phone exists | **reuse** that customer | — |
| `id` null, phone new | insert a new customer | `23505` → retry the lookup once (lost race) |

---

## 4. Sequence: status transition

```
Client              API                      Postgres            Redis/Worker
  │ PATCH /status     │                          │                    │
  ├──────────────────▶│                          │                    │
  │                   │ 1. load current status ─▶│                    │
  │                   │ 2. assertTransition()    │  pure check first: a bad
  │                   │    ✗ → 409               │  request never opens a tx
  │                   │ 3. BEGIN ───────────────▶│                    │
  │                   │ 4. UPDATE orders         │                    │
  │                   │    WHERE id=$1           │                    │
  │                   │      AND status=$expected│  ← the guard       │
  │                   │    → rowCount 0? ROLLBACK, 409 INVALID_STATUS_TRANSITION
  │                   │ 5. INSERT status_event   │                    │
  │                   │ 6. INSERT notifications  │                    │
  │                   │ 7. COMMIT ──────────────▶│                    │
  │                   │ 8. emit ─────────────────────────────────────▶│ PUBLISH
  │                   │ 9. queue.add ────────────────────────────────▶│ job
  │ ◀───200 order─────┤                          │                    │
```

Step 2 checks the machine; step 4 re-checks against the database. Both are
needed: step 2 gives a clear error cheaply, step 4 is the one that is actually
race-proof.

---

## 5. State machine

```
        ┌──────────────┐
        │  CONFIRMED   │──────┐
        └──────┬───────┘      │
               ▼              │
        ┌──────────────┐      │
        │  PREPARING   │──────┤
        └──────┬───────┘      │
               ▼              ▼
        ┌──────────────┐   ┌───────────┐
        │    READY     │──▶│ CANCELLED │ (terminal)
        └──────┬───────┘   └───────────┘
               ▼
        ┌──────────────┐
        │  COMPLETED   │ (terminal)
        └──────────────┘
```

| From \ To | CONFIRMED | PREPARING | READY | COMPLETED | CANCELLED |
|---|:--:|:--:|:--:|:--:|:--:|
| **CONFIRMED** | no-op | ✓ | ✗ | ✗ | ✓ |
| **PREPARING** | ✗ | no-op | ✓ | ✗ | ✓ |
| **READY** | ✗ | ✗ | no-op | ✓ | ✓ |
| **COMPLETED** | ✗ | ✗ | ✗ | no-op | ✗ |
| **CANCELLED** | ✗ | ✗ | ✗ | ✗ | no-op |

- **no-op** returns `200` with the unchanged order. Setting a status it already
  has is idempotent — a double-tap in a busy kitchen must not raise an error.
- ✗ returns `409 INVALID_STATUS_TRANSITION`.
- No skipping forward, no going backward, no leaving a terminal state.

---

## 6. Transaction boundaries

The single most important table in this document.

| Operation | Inside the transaction | After commit |
|---|---|---|
| Create order | idempotency key, customer, order, items, first event, outbox row, stored response | enqueue job, emit SSE |
| Status change | order update (guarded), event, outbox row | enqueue job, emit SSE |
| Claim order | order update (guarded on `assigned_staff_id IS NULL`), event | emit SSE |
| Add / delete item | item write, order `updated_at` | emit SSE |
| Delete customer | cascade handled by Postgres | — |

**Rule:** anything that must be atomic goes inside. Anything that can be retried
goes outside. Nothing that talks to a network other than Postgres is ever
inside a transaction — an external call holding a row lock is how a database
stalls.

---

## 7. Error taxonomy

One table, one place, no ad-hoc error construction.

| Source | Detection | Code | HTTP |
|---|---|---|---|
| Zod failure | `zValidator` hook | `VALIDATION_FAILED` | 400 |
| Bad `page` / `size` / `status` filter | pagination schema | `INVALID_FILTER` | 400 |
| Missing row | `rowCount === 0` on select | `RESOURCE_NOT_FOUND` | 404 |
| Duplicate phone / email | Postgres **`23505`** unique violation | `RESOURCE_ALREADY_EXISTS` | 409 |
| FK to a missing customer | Postgres **`23503`** | `RESOURCE_NOT_FOUND` | 404 |
| `quantity <= 0` | Postgres **`23514`** check violation | `VALIDATION_FAILED` | 400 |
| Guarded update matched 0 rows | `rowCount === 0` on update | `INVALID_STATUS_TRANSITION` | 409 |
| Missing / bad token | `jose` throws | `UNAUTHORIZED` | 401 |
| Wrong role | `requireRole` | `FORBIDDEN` | 403 |
| Anything else | `onError` catch-all | `INTERNAL_ERROR` | 500 |

**Catch the Postgres error code, never check-then-insert.** A `SELECT` before an
`INSERT` to test uniqueness is a race: two requests both see "free", both
insert, one crashes with an unhandled 500. The unique index is the only honest
check.

---

## 8. Concurrency cases

Each one has a named mechanism, not a hope.

| Case | Mechanism | Outcome |
|---|---|---|
| Two cooks claim one order | `UPDATE … WHERE assigned_staff_id IS NULL` | One wins, other gets 409 |
| Two status updates race | `UPDATE … WHERE status = $expected` | One wins, other gets 409 |
| Client double-submits an order | `Idempotency-Key` unique index | Second **blocks**, then replays the stored response |
| Two customers created with one phone | `customers.phone` unique index | `23505` → mapped to 409, or reused on the order path |
| Item added while status changes | Row-level locks, different rows | Both succeed; totals derived at read, so no lost update |
| Order number collision | `nextval()` is atomic and non-transactional | Impossible. Rollbacks leave gaps — accepted |

### The idempotency race, precisely

Two requests arrive with the same key at the same instant:

1. Request A inserts the key row inside its transaction. Uncommitted.
2. Request B tries the same insert. Postgres **blocks it on the unique index**
   until A commits or rolls back.
3. A commits. B's insert now fails with `23505`.
4. B catches `23505`, selects the row, returns A's stored response.

No polling, no state column, no distributed lock. The unique index is the lock,
and Postgres already blocks for exactly the right duration.

---

## 9. Algorithms

### 9.1 Order number

```sql
order_number DEFAULT 'ORD-' || lpad(nextval('order_number_seq')::text, 6, '0')
```

Readable, sequential, generated by the database so concurrent inserts cannot
collide. `nextval` is non-transactional, so a rolled-back insert burns a number
— gaps are fine, duplicates would not be.

### 9.2 List query — two round trips, never N+1

```sql
-- 1. the page, with its customer
SELECT o.*, c.* FROM orders o JOIN customers c ON c.id = o.customer_id
WHERE ($status IS NULL OR o.status = $status)
  AND ($customerId IS NULL OR o.customer_id = $customerId)
  AND ($search IS NULL OR o.order_number ILIKE $q OR c.name ILIKE $q OR c.phone ILIKE $q)
ORDER BY o.created_at DESC LIMIT $size OFFSET $offset;

-- 2. every item for that page, one query
SELECT * FROM order_items WHERE order_id = ANY($ids);
```

Group in JS, compute `totalAmount` and `itemCount` from the items already in
hand. **20 orders = 2 queries + 1 count, never 21.**

`OFFSET` is fine here: staff filter rather than page deeply, and `size` caps at
100. Keyset pagination (`WHERE created_at < $cursor`) is the upgrade if deep
paging ever appears.

### 9.3 Utilization — interval union, not sum

The formula from the original plan, `shift − Σ(ready − claimed)`, is wrong. A
cook with three pans has three overlapping intervals; the sum exceeds
wall-clock time and utilization reads over 100%.

Three things have to be right, not just the overlap:

1. **Merge overlaps** — `range_agg`, not `SUM`.
2. **An unfinished order has no end.** `tstzrange(preparing_at, NULL)` is an
   *unbounded* range, `upper()` returns `NULL`, and the whole `SUM` collapses to
   `NULL`. Clamp the open end to `now()`.
3. **Clip every interval to the shift.** Prep that runs past clock-off still
   counts against an 8-hour denominator, so without clipping the result can
   exceed 1.0 — which is exactly the failure this was meant to prevent.

```sql
-- one row per prep interval, open intervals closed at now()
WITH prep AS (
  SELECT e.staff_id,
         tstzrange(e.created_at, COALESCE(nxt.created_at, now())) AS span
  FROM order_status_events e
  LEFT JOIN LATERAL (
    SELECT n.created_at FROM order_status_events n
    WHERE n.order_id = e.order_id AND n.created_at > e.created_at
    ORDER BY n.created_at LIMIT 1
  ) nxt ON true
  WHERE e.to_status = 'PREPARING' AND e.staff_id IS NOT NULL
),
-- intersect with the shift window; `*` is range intersection
clipped AS (
  SELECT p.staff_id, s.id AS shift_id, s.shift_start, s.shift_end,
         p.span * tstzrange(s.shift_start, s.shift_end) AS span
  FROM prep p
  JOIN staff_shifts s
    ON s.staff_id = p.staff_id
   AND p.span && tstzrange(s.shift_start, s.shift_end)
),
merged AS (
  SELECT staff_id, shift_id, shift_start, shift_end,
         unnest(range_agg(span)) AS span
  FROM clipped GROUP BY staff_id, shift_id, shift_start, shift_end
)
SELECT staff_id, shift_id,
       SUM(upper(span) - lower(span))                      AS active_time,
       shift_end - shift_start                             AS shift_length,
       SUM(upper(span) - lower(span)) / (shift_end - shift_start) AS utilization
FROM merged
GROUP BY staff_id, shift_id, shift_start, shift_end;
```

`range_agg` (Postgres 14+) merges the overlaps. With every interval clipped to
the shift, `utilization` cannot exceed 1.0 — now genuinely by construction.

Unit-tested with hand-built cases (shift `[0,100]`):

| Input intervals | Sum (wrong) | Union + clip (correct) | Catches |
|---|---|---|---|
| `[0,10], [5,15]` | 20 | **15** | overlap |
| `[0,10], [10,20]` | 20 | **20** | touching, not overlapping |
| `[0,30], [5,10]` | 35 | **30** | full containment |
| `[90,∞)` (unfinished) | `NULL` | **10** | open interval → clamped |
| `[80,130]` (ran past clock-off) | 50 | **20** | clipped to the shift |

The last two rows are the bugs this rewrite fixes.

Labelled in the UI as *"share of shift with at least one order in preparation"*.
Not "time working" — a cook restocking is not idle.

**Related:** avg prep time has the same open-interval trap. It must be
`AVG(ready_at - preparing_at) FILTER (WHERE ready_at IS NOT NULL)`, otherwise
orders still cooking silently drop out or poison the average.

### 9.4 Cache keys

Deleting by pattern is O(keyspace). A version counter avoids it:

```
INCR analytics:v              on any order event
GET  analytics:v3:summary     read at the current version
```

Old versions are never deleted; their 30-second TTL retires them. Invalidation
becomes one atomic increment.

---

## 10. SSE connection lifecycle

The part most implementations get wrong.

```ts
app.get('/events', requireAuth, (c) => streamSSE(c, async (stream) => {
  const onUpdate = (payload) => stream.writeSSE({ event: 'order:updated', data: JSON.stringify(payload) })
  bus.on('order:updated', onUpdate)

  // 1. heartbeat — proxies kill idle connections at 30-60s
  const beat = setInterval(() => stream.writeSSE({ event: 'ping', data: '' }), 25_000)

  // 2. cleanup — without this, listeners leak on every reconnect
  stream.onAbort(() => { clearInterval(beat); bus.off('order:updated', onUpdate) })

  await stream.sleep(Infinity)
}))
```

| Concern | Handling |
|---|---|
| Idle proxy timeout | 25 s heartbeat comment |
| Listener leak | `onAbort` removes the handler and the timer |
| Reconnect | Native `EventSource`, ~3 s browser backoff |
| Missed events while disconnected | **Ignored by design** — the client refetches the list on reconnect. No replay buffer to size or expire |
| Slow consumer | Frames are ~60 bytes, no backpressure risk at 100 connections |
| Auth | Token checked at connect. 12 h TTL bounds a stale connection; frames carry ids only, so nothing leaks |

---

## 11. Pluggable notification driver

The one interface in the codebase — because there are genuinely two
implementations, and the default must work with no account.

```ts
interface NotificationDriver {
  send(msg: { to: string; body: string }): Promise<void>
}

const drivers = {
  console: { send: async (m) => console.log(`[notify] ${m.to}: ${m.body}`) },
  twilio:  { send: async (m) => twilioClient.messages.create({ ... }) },
}
const driver = drivers[process.env.NOTIFY_DRIVER ?? 'console']
```

Worker loop, with the claim that makes it safe under multiple workers:

```sql
-- claim: only one worker can win this row
UPDATE notifications SET status='SENDING', attempts = attempts + 1
WHERE id = $1 AND status = 'PENDING' RETURNING *;
```

Then send → mark `SENT`, or record `last_error` and return it to `PENDING`.
Three attempts with exponential backoff, then `FAILED`. A crash between send
and `SENT` can repeat one message — at-least-once, stated in
[hld.md §5](hld.md).

The same worker prunes on each run, which is the "TTL" the idempotency table
needs — Postgres has no row expiry:

```sql
DELETE FROM idempotency_keys WHERE created_at < now() - interval '24 hours';
```

---

## 12. Index → query mapping

Every index earns its place against a named query. No speculative indexes.

| Index | Query it serves |
|---|---|
| `customers(phone)` unique | duplicate check, attach-by-phone on order create |
| `orders(status, created_at DESC)` | kitchen board — filter and sort satisfied by one index, no sort step |
| `orders(created_at DESC)` | unfiltered list pagination |
| `orders(customer_id)` | `GET /orders?customerId=` |
| `orders(assigned_staff_id)` partial, not null | a cook's own queue |
| `order_items(order_id)` | the `ANY($ids)` item fan-out |
| `order_status_events(order_id, created_at)` | order timeline |
| `order_status_events(staff_id, to_status, created_at)` | every staff analytics query |
| `notifications(status, created_at)` partial on PENDING | outbox drain — index only covers rows that need work |

`ILIKE '%…%'` search is a deliberate full scan at this data size. `pg_trgm` +
GIN is the upgrade, marked with a `ponytail:` comment in the code.

---

## 13. Test plan

Small and targeted. No framework, no fixtures.

| Test | Type | Proves |
|---|---|---|
| `status.test.ts` | unit, pure | All 25 transition pairs match §5 |
| `serialize.test.ts` | unit, pure | `numeric` string → number, `Date` → ISO, no extra fields leak into `OrderDetail` |
| `utilization.test.ts` | unit, pure | All five cases in §9.3 — overlap, touching, containment, unfinished order (open interval), over-running shift (clipping) |
| `pagination.test.ts` | unit, pure | Bad `page`/`size` → `INVALID_FILTER`; `totalPages` maths |
| `smoke.sh` | integration | Full lifecycle plus every documented error case, against a live server |

The smoke script is the gate for phases 11–16: **any extension that breaks a
contract response fails it.**
