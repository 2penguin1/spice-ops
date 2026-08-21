# Architecture & Build Plan — Spice Garden OMS

Decisions, data model, subsystems, infrastructure, and build order.
The endpoint spec lives separately in [api-contract.md](api-contract.md);
assumptions and open questions in [../questions.md](../questions.md).

---

## 1. What we're building

Two layers, deliberately separated.

**Layer 1 — the contract.** Every endpoint in the assignment brief, exactly as
specified. Customers CRUD, orders list/detail/create, status transitions, order
items. This is what gets graded on correctness and contract adherence, and it
is finished and verified before anything in layer 2 starts.

**Layer 2 — the platform.** Authentication and roles, an order event log,
real-time push over SSE, an analytics dashboard for owners and managers, async
notification workers, caching, and AI-assisted operational insights. These make
the system look like something a real restaurant chain would run, and none of
them are permitted to change a single byte of a layer-1 response.

## 2. The rule that holds it together

> **No layer-2 feature may alter a layer-1 request or response shape.**

Concretely:

- `Customer`, `OrderDetail`, `OrderItem` and the error envelope have exactly the
  fields the brief lists. `assignedStaffId` exists in the database and never
  appears in an order response.
- Extensions live on routes the brief does not mention: `/auth/*`, `/staff/*`,
  `/analytics/*`, `/events`, `/metrics`. A grader reading only the brief sees a
  spec-exact API and can ignore the rest.
- The only exception is a **request** header: `Authorization` (and optional
  `Idempotency-Key` on `POST /orders`). Neither changes a response body.
- Every extension degrades. No Redis? In-memory fallback. No LLM key? Raw SQL
  numbers with the narrative omitted. No Twilio? Messages log to the console.
  The app must run correctly with nothing but Postgres.

That last point is what makes ambition safe: a reviewer with a broken Docker
install can still `npm run dev` and exercise the whole contract.

## 3. Stack

| Layer | Choice | Why |
|---|---|---|
| Backend | **Hono** + `@hono/node-server`, TypeScript, Node 24 | Bonus-scored. `streamSSE` is built in, so real-time costs no dependency. |
| Validation | **Zod** via `@hono/zod-validator` | Bonus-scored. Validation at the route edge; one handler maps every Zod failure to `VALIDATION_FAILED`. |
| Database | **PostgreSQL 18** | `timestamptz`, `numeric`, native enums, generated columns, `tstzrange` for the utilization maths. |
| Data access | **Drizzle ORM** | Thin, real SQL migrations we ship as `database/schema.sql` (a required deliverable), no hidden codegen. |
| Auth | **`jose`** (JWT) + **`@node-rs/argon2`** | `jose` is the maintained standard-compliant JWT library. Argon2id over bcrypt for password hashing. |
| Cache / pub-sub | **Redis 7** via **`ioredis`** | Caches analytics aggregates, fans SSE events across processes, backs the queue. |
| Queue | **BullMQ** | Redis-backed, retries and dead-letter built in, so notification failures never touch the HTTP path. |
| Frontend | **React + Vite + TS**, React Router | React is mandated. |
| Charts | **Recharts** | The dashboard needs real charts; hand-rolled SVG for six chart types is not laziness, it is a second project. |
| Server state | plain `fetch` + `useApi` hook, `EventSource` for live updates | SSE invalidates the few caches we have, which is most of what a query library buys us. |
| Styling | hand-written CSS + CSS variables | No Tailwind build step, no component library. |
| Tests | `node:test` + a curl smoke script | Zero framework config. Covers the status machine, serializers, the interval-merge maths, and one pass over every endpoint. |

**Still rejected:** repository/service layers over Drizzle (Drizzle *is* the
data layer), a DTO class hierarchy, a `shared/` types package, WebSockets (SSE
is unidirectional and reconnects natively), a payment gateway, a
customer-facing ordering app.

## 4. Repository layout

```
spice-ops/
├── CLAUDE.md                    conventions for anyone editing this
├── readme.md                    setup + run + demo credentials
├── questions.md                 assumptions + clarifying questions
├── docker-compose.yml           postgres + redis (+ optional app services)
├── docs/
│   ├── plan.md                  this file
│   ├── api-contract.md          the implementation target
│   └── Assignment 1_....docx    original brief
├── database/
│   ├── schema.sql               consolidated DDL (generated — never hand-edit)
│   ├── seed.sql                 staff, customers, ~40 orders, backdated events
│   └── migrations/              drizzle-kit output + journal
├── backend/
│   └── src/
│       ├── index.ts             app assembly, middleware chain, listen
│       ├── db/
│       │   ├── schema.ts        ← single source of truth for the schema
│       │   ├── client.ts        pool + drizzle instance
│       │   └── seed.ts          runs database/seed.sql
│       ├── lib/
│       │   ├── errors.ts        ApiError, code->status map, error middleware
│       │   ├── validation.ts    shared Zod schemas (pagination, uuid, status)
│       │   ├── status.ts        transition machine, one exported function
│       │   ├── serialize.ts     row -> contract shape (numeric->number, Date->ISO)
│       │   ├── auth.ts          JWT sign/verify, requireAuth, requireRole
│       │   ├── events.ts        emit(); in-memory bus + Redis pub/sub fan-out
│       │   ├── cache.ts         get/set/invalidate; no-op when Redis is absent
│       │   └── idempotency.ts   Idempotency-Key capture and replay
│       ├── routes/
│       │   ├── customers.ts     ┐
│       │   ├── orders.ts        ┘ layer 1 — contract exact
│       │   ├── auth.ts          ┐
│       │   ├── staff.ts         │
│       │   ├── analytics.ts     │ layer 2 — extensions
│       │   ├── events.ts        │
│       │   └── metrics.ts       ┘
│       ├── services/
│       │   ├── analytics.service.ts   SQL aggregates + interval merge
│       │   └── ai.service.ts          LLM narrative, degrades without a key
│       └── queues/
│           ├── queue.ts               BullMQ setup, inline fallback
│           └── notification.worker.ts drivers: console | twilio
└── frontend/
    └── src/
        ├── api/{client,types}.ts
        ├── hooks/{useApi,useAuth,useOrderStream}.ts
        ├── pages/
        │   ├── Login.tsx
        │   ├── Orders.tsx           list, search, status filter, pagination
        │   ├── OrderDetail.tsx      status controls, items, customer panel
        │   ├── NewOrder.tsx         menu picker + customer attach-or-create
        │   ├── Kitchen.tsx          claim & advance board, live via SSE
        │   ├── Customers.tsx        CRUD
        │   ├── Staff.tsx            register staff, assign shifts (manager+)
        │   └── Dashboard.tsx        analytics (manager/admin only)
        └── components/{StatusBadge,Pagination,ErrorBanner,Field,RoleGate}.tsx
```

## 5. Data model

Eight tables. `gen_random_uuid()` is built into Postgres 13+, so no extension.

```
staff ──< staff_shifts                     customers
  │                                            │
  │  assigned_staff_id (nullable)              │ customer_id
  ├──────────────────────────┐                 │
  │                        orders ─────────────┘
  │                          │
  ├──< order_status_events >─┤
                             ├──< order_items
                             └──< notifications

idempotency_keys  (standalone, TTL-pruned)
```

### 5.1 Corrections to the earlier design

Three decisions from the planning discussion are changed here. Each was a
defect, not a matter of taste:

**Totals are derived, not stored.** The earlier plan put `total_amount` and
`item_count` on `orders` with a default of `0`, then proposed database triggers
to keep them accurate. That creates a synchronisation problem and then buys a
second mechanism to solve it — and items are mutable on two endpoints, so every
add and delete has to recompute or the totals silently lie. `SUM()` at read
time has no failure mode, no trigger to explain, and at restaurant scale (tens
of items per order) costs nothing. *If* the analytics queries ever measure slow
against a large seed, the upgrade path is a materialized view refreshed on the
event stream — not triggers on the hot path.

**`total_price` is a generated column**, `GENERATED ALWAYS AS (quantity *
unit_price) STORED`. Stored as a plain column it can drift from its own inputs.
Generated, nothing is allowed to write it wrong.

**`orders.customer_id` uses `ON DELETE CASCADE`, not `RESTRICT`.** RESTRICT
looks safer but silently breaks the contract: `DELETE /customers/{id}` lists
only `RESOURCE_NOT_FOUND` as a failure, so a foreign key violation has no legal
error code to return. This is the top open question in `questions.md` — if the
answer comes back "block it", the fix is one line plus a new error code.

### 5.2 Tables

**`customers`** — `id` uuid pk · `name` text · `email` text null · `phone` text
**unique** · `created_at` · `updated_at`

The unique constraint on `phone` is what produces `RESOURCE_ALREADY_EXISTS`; we
catch the Postgres `23505` and map it, rather than doing a check-then-insert
that races.

**`orders`** — `id` uuid pk · `order_number` text unique · `customer_id` uuid fk
→ customers **cascade** · `status` `order_status` · `assigned_staff_id` uuid fk
→ staff null · `created_at` · `updated_at`

- `order_status` is a **Postgres enum**, not text with a check. The five values
  are fixed by the contract; the database rejects a sixth.
- `order_number` defaults to
  `'ORD-' || lpad(nextval('order_number_seq')::text, 6, '0')`. Readable,
  gap-tolerant, unique without an app-side retry loop, and generated by the
  database so concurrent inserts cannot collide.
- `assigned_staff_id` is set when a cook claims the order. **It is never
  serialized into `OrderDetail`.**

**`order_items`** — `id` uuid pk · `order_id` uuid fk → orders **cascade** ·
`item_name` text · `quantity` int `CHECK > 0` · `unit_price` numeric(10,2)
`CHECK >= 0` · `total_price` numeric(10,2) **generated** · `created_at`

Storing `unit_price` on the line locks the price at purchase time, so past
orders stay financially accurate when the menu changes.

**`staff`** — `id` uuid pk · `name` text · `email` text unique ·
`password_hash` text · `role` `staff_role` (`ADMIN | MANAGER | KITCHEN |
SERVICE`) · `is_active` boolean · `created_at` · `updated_at`

**`staff_shifts`** — `id` uuid pk · `staff_id` uuid fk → staff **cascade** ·
`shift_start` timestamptz · `shift_end` timestamptz · `CHECK (shift_end >
shift_start)`

Scheduled windows. Utilization compares actual prep intervals against these.

**`order_status_events`** — `id` uuid pk · `order_id` uuid fk → orders
**cascade** · `staff_id` uuid fk → staff null · `from_status` `order_status`
null · `to_status` `order_status` · `created_at`

The audit trail, and the single source for every time-based metric. Written in
the *same transaction* as the status change, so the log can never disagree with
the order. `from_status` is null for the creation event.

Prep timestamps are **derived from this table**, not duplicated onto `orders` —
`confirmed_at`, `ready_at` and friends are `MIN(created_at) FILTER (WHERE
to_status = …)`. One source of truth, and it survives a status being set twice.

**`notifications`** — `id` uuid pk · `order_id` uuid fk → orders **cascade** ·
`channel` text · `template` text · `payload` jsonb · `status` text
(`PENDING | SENT | FAILED`) · `attempts` int · `last_error` text null ·
`created_at` · `sent_at` null

A transactional outbox. The row is written in the same transaction as the
status change; the worker picks it up. Without this, a queue push that fails
after commit loses the notification silently.

**`idempotency_keys`** — `key` text pk · `endpoint` text · `request_hash` text ·
`response_body` jsonb · `status_code` int · `created_at`

Postgres, not Redis: the guarantee we want is "exactly one order", and the
order lives in Postgres. Putting the key in the same transaction as the insert
makes the two atomic. A different `request_hash` for the same key is a client
bug → `VALIDATION_FAILED`.

### 5.3 Indexes

| Index | Serves |
|---|---|
| `customers(phone)` unique | duplicate detection, attach-by-phone on order create |
| `orders(customer_id)` | `GET /orders?customerId=` |
| `orders(status, created_at DESC)` composite | kitchen board and the default paged list in one index — status filter and sort order together, no separate sort step |
| `orders(created_at DESC)` | unfiltered list pagination |
| `orders(assigned_staff_id)` where not null | per-cook queues |
| `order_items(order_id)` | item fan-out for a page of orders |
| `order_status_events(order_id, created_at)` | order timeline |
| `order_status_events(staff_id, to_status, created_at)` | every staff analytics query |
| `notifications(status, created_at)` partial on PENDING | outbox drain |

Search is `ILIKE '%…%'`, which no btree index helps. Acceptable at this scale;
`pg_trgm` with a GIN index is the upgrade path and gets a `ponytail:` marker in
the code.

### 5.4 Reading an order

`GET /orders` decides the shape of everything. Two round trips, never N+1: page
the orders joined to their customer, then fetch items for that page's ids in
one `WHERE order_id = ANY($1)` and group in JS. Totals are computed from the
items already in hand.

## 6. Authentication & roles

JWT bearer tokens. `POST /auth/login` takes email + password, returns a signed
token carrying `{ sub, role, name }`. HS256 with a secret from the environment —
asymmetric keys buy nothing with one issuer and one audience.

No refresh tokens. A 12-hour access token, and staff log in again at the start
of a shift. Refresh rotation is real work (a token table, reuse detection,
revocation) that adds nothing to a system with no third-party clients.

| Role | Can |
|---|---|
| `ADMIN` | everything, including staff management and the analytics dashboard |
| `MANAGER` | everything except staff deletion; sees analytics; may cancel orders and delete customers |
| `SERVICE` | create orders, view all, advance `READY → COMPLETED` |
| `KITCHEN` | view orders, claim them, advance `CONFIRMED → PREPARING → READY` |

Roles are enforced by a `requireRole(...)` middleware on the route, not by
`if` statements inside handlers. **Role checks reject with the contract's
existing envelope** — `403` with a `FORBIDDEN` code on non-contract routes; on
contract routes, only actions the brief doesn't describe are restricted, so a
correctly-authenticated caller never sees a code the brief doesn't list.

### The grading problem, and the fix

Auth on contract routes means a reviewer who curls `GET /orders` gets a `401`
before they can check a single response shape. Three mitigations, all cheap:

1. The seed creates one account per role with documented passwords, and
   `readme.md` opens with a ready-to-paste `curl` that logs in and exports a token.
2. `npm run token -- manager` prints a valid token for scripting.
3. `AUTH_DISABLED=true` in `.env` bypasses auth entirely for contract testing.
   The server **refuses to boot** with that flag when `NODE_ENV=production`, so
   it cannot escape a dev machine.

## 7. Real-time (SSE)

`GET /events` streams via Hono's `streamSSE`. Events are emitted from exactly
one place — the transaction helper that writes an `order_status_events` row —
so nothing can change an order without the stream knowing.

```
mutation ─▶ tx { update order + insert event + insert outbox row } ─▶ commit
                                    │
                                    └─▶ emit('order:updated', id)
                                            ├─▶ local EventEmitter ─▶ open SSE connections
                                            └─▶ Redis PUBLISH ─▶ other instances
```

Redis pub/sub is what makes this correct with more than one backend process;
with Redis absent the local emitter alone still serves a single instance. The
frontend's `useOrderStream` hook holds one `EventSource` and refetches the
affected order — the browser reconnects on its own when restaurant wifi drops.

Events carry an order id, not an order body. The client refetches, which keeps
authorization on the fetch path and avoids leaking orders to a stream that
outlived the token.

## 8. Analytics

All SQL over `order_status_events` and `order_items`. Redis caches each result
for 30 seconds, invalidated on any order event.

| Metric | Source |
|---|---|
| Net revenue | `SUM(total_price)` over items of `COMPLETED` orders |
| Incoming revenue | same for `PREPARING` and `READY` |
| Status funnel | `COUNT(*) GROUP BY status` |
| Cancellation rate | `CANCELLED / total`, windowed |
| Avg prep time | `AVG(ready_at − preparing_at) FILTER (WHERE ready_at IS NOT NULL)` from the event log — orders still cooking must be excluded, not counted as zero |
| Peak hours | `COUNT(*) GROUP BY date_trunc('hour', created_at)` |
| Per-cook throughput | orders per staff per shift |
| Menu co-occurrence | self-join on `order_items` for basket pairs |

### Utilization, done correctly

The planning discussion proposed `idle = shift_length − Σ(ready_at −
claimed_at)`. **That is wrong**, and it would put a number in front of a manager
that misrepresents a person's work. A cook with three pans going has three
overlapping intervals, so the sum exceeds the wall-clock time spent and the
gauge reads over 100%; two cooks on one order double-count it.

Three things have to be right. Only the first is about overlap:

1. **Merge, don't sum.** Take the *union* of a cook's `[preparing_at, ready_at]`
   intervals via `range_agg`, then sum the merged spans.
2. **Close open intervals.** An order still cooking has no `ready_at`;
   `tstzrange(x, NULL)` is unbounded, `upper()` is `NULL`, and the whole sum
   collapses to `NULL`. Clamp the open end to `now()`.
3. **Clip to the shift.** Prep running past clock-off still divides by an
   8-hour shift, so an unclipped result can exceed 1.0 — the exact failure this
   was meant to prevent.

The full query is in [lld.md §9.3](lld.md), with a unit test covering all five
cases (overlap, touching, containment, unfinished order, over-running shift).
With intervals clipped to the shift, utilization cannot exceed 1.0 by
construction.

Avg prep time carries the same open-interval trap and needs
`FILTER (WHERE ready_at IS NOT NULL)`.

Even correct, the metric is *presented* as "time with at least one order in
prep" — not "time working". A cook prepping nothing while restocking is not
idle, and the dashboard says so in plain text next to the gauge. We are not
shipping a number that gets someone disciplined for a definition they never
agreed to.

## 9. Async work

BullMQ over Redis, fed by the `notifications` outbox.

- **Producer:** the status transaction inserts a `PENDING` outbox row. After
  commit, the job is enqueued. If the enqueue fails, a periodic drain picks up
  stale `PENDING` rows — the outbox is the safety net.
- **Consumer:** `notification.worker.ts` resolves a driver from
  `NOTIFY_DRIVER`: `console` (default) logs the message; `twilio` sends
  WhatsApp. The default driver means the feature is fully demonstrable with no
  account, no key, and no network.
- Retries with exponential backoff, 3 attempts, then `FAILED` with `last_error`
  recorded. Failures never reach the HTTP response.
- With Redis absent, the queue falls back to running the job inline after the
  response is sent. Slower, still correct, no crash.

## 10. AI insights

`GET /analytics/ai-insights` (ADMIN/MANAGER). Feeds the aggregate numbers from
§8 — never raw customer rows — to Claude, and returns a short plain-English
operational summary alongside the raw figures.

Degradation is the whole design: with no `ANTHROPIC_API_KEY`, the endpoint
returns the aggregates with `"narrative": null`, and the dashboard renders every
chart with the commentary panel hidden. A reviewer without a key sees a working
dashboard, not an error.

Responses cached 15 minutes — the numbers do not move fast enough to justify a
model call per page load.

## 11. Concurrency, caching, idempotency

**Status transitions are atomic without a lock.** No `SELECT … FOR UPDATE`, no
version column:

```sql
UPDATE orders SET status = $new, updated_at = now()
WHERE id = $id AND status = $expected
```

Zero rows affected means someone else moved it first — that *is* the
lost-update detection, and it maps straight onto `INVALID_STATUS_TRANSITION`.
One statement, no lock held across a round trip, no deadlock ordering to reason
about. Claiming an order is the same shape with `AND assigned_staff_id IS NULL`,
which makes "two cooks claim simultaneously" resolve correctly by construction.

**Caching** covers analytics aggregates and nothing else. Order lists are
deliberately *not* cached: they change on every status click and are already
pushed live over SSE, so a cache there would spend all its effort on
invalidation to make the app less current.

**Idempotency** is opt-in on `POST /orders` via an `Idempotency-Key` header.
Key, request hash and response are written in the same transaction as the
order; a replay returns the stored response. Absent header, no behaviour change
— the contract is untouched.

## 12. Infrastructure

`docker-compose.yml` runs Postgres and Redis by default. A `full` profile adds
the backend and frontend images so a reviewer can choose one command or the
familiar `npm run dev`.

```yaml
services:
  db:        postgres:18-alpine   :5432   healthcheck: pg_isready
  redis:     redis:7-alpine       :6379   healthcheck: redis-cli ping
  backend:   profile "full"       :3000   depends_on healthy db + redis
  frontend:  profile "full"       :5173
```

| Service | Port | Key env |
|---|---|---|
| Postgres | 5432 | — |
| Redis | 6379 | — |
| Backend | 3000 | `DATABASE_URL`, `REDIS_URL`, `JWT_SECRET`, `CORS_ORIGIN`, `NOTIFY_DRIVER`, `ANTHROPIC_API_KEY?`, `AUTH_DISABLED?` |
| Frontend | 5173 | `VITE_API_URL` |

Both packages ship a committed `.env.example` with working local defaults.
The backend refuses to boot without `DATABASE_URL` or `JWT_SECRET`, naming the
missing one — a fast failure beats a connection timeout. `REDIS_URL` is
optional by design; its absence logs one warning and degrades per §2.

Migrations run explicitly (`npm run db:migrate`), never on boot. Seeding is
idempotent (truncate, then insert) and backdates orders and events across the
past two weeks so the analytics dashboard has a real shape on first load.

**No CI.** One reviewer runs this once from the readme. `npm run check`
(typecheck + test) is what a CI file would have called anyway.

## 13. Build order

Layer 1 is phases 0–10 and ends with a complete, verified, contract-exact
system. **If everything after phase 10 were deleted, the submission would still
satisfy the brief in full.** That is the point of the ordering.

| # | Phase | Done when |
|---|---|---|
| 0 | Scaffold + infra | `docker compose up -d`, both packages install, `GET /health` returns 200 |
| 1 | Schema + seed | `database/schema.sql` generated, migration applied, seed loads staff + customers + ~40 backdated orders across every status |
| 2 | API plumbing | Error envelope middleware, code→status map, Zod pagination/uuid/status schemas, serializers — all unit tested |
| 3 | Customers API | 4 endpoints, duplicate-phone → `RESOURCE_ALREADY_EXISTS` via the `23505` map, cascade delete |
| 4 | Orders read API | `GET /orders` with search + status + customerId + pagination; `GET /orders/{id}`; two-query fan-out, no N+1 |
| 5 | Orders write API | `POST /orders` transactional with attach-or-create customer; conditional-UPDATE status machine; item add/delete |
| 6 | Smoke script | One script walks the full lifecycle and every documented error case |
| 7 | Frontend shell | Vite app, router, API client, layout, Orders list live against the real API |
| 8 | Order detail | Status controls, item add/remove, customer panel |
| 9 | New order + customers | Create-order flow with menu picker, customers CRUD screen |
| 10 | **Layer 1 complete** | readme verified from a clean clone; contract re-checked endpoint by endpoint against `api-contract.md` |
| 11 | Event log | `order_status_events` written in the status transaction; order timeline on the detail page |
| 12 | Auth + roles | `/auth/login`, JWT middleware, `requireRole`, login page, `RoleGate`, seeded accounts, `AUTH_DISABLED` escape hatch — **re-run the phase 6 smoke script to prove the contract still passes** |
| 13 | SSE | `/events`, emitter, Redis pub/sub fan-out, `useOrderStream`, Kitchen board with claim + one-click advance |
| 14 | Analytics | Aggregate queries, `range_agg` utilization with its unit test, Recharts dashboard, Redis caching |
| 15 | Async + notifications | Outbox table, BullMQ, console driver, optional Twilio driver, inline fallback |
| 16 | Idempotency + AI + polish | `Idempotency-Key` on order create, `/analytics/ai-insights` with degradation, `/metrics`, final `questions.md` |

Phases 11–16 are each independently droppable. Any one can be cut on time
without touching the ones before it.

## 14. Out of scope

Payment gateways and a customer-facing ordering app (the brief defines an
internal staff tool; payments are outside the contract entirely). Refresh token
rotation. Multi-location tenancy — the background mentions multiple locations
but no endpoint or field carries one; adding it later means a `location_id` on
`orders` and a filter parameter. Soft deletes. A normalized menu catalogue —
the contract's item shape carries a name and price but no menu item id, so the
frontend menu is a seeded constant that pre-fills `unitPrice`, and the API stays
free-text as specified. Rate limiting (internal tool, authenticated, no
adversary). Structured log shipping.

Each is a deliberate omission recorded in `questions.md`, not an oversight.
