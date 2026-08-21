# Architecture

How the system is built and why. Setup and API reference are in the
[readme](../readme.md); assumptions are in [questions.md](../questions.md).

**Contents**

- [1. Scale](#1-scale)
- [2. Components](#2-components)
- [3. Where the code lives](#3-where-the-code-lives)
- [4. Transaction boundaries](#4-transaction-boundaries)
- [5. Concurrency](#5-concurrency)
- [6. Errors](#6-errors)
- [7. Consistency](#7-consistency)
- [8. Failure modes](#8-failure-modes)
- [9. Indexes](#9-indexes)
- [10. Security](#10-security)
- [11. What breaks first](#11-what-breaks-first)
- [12. Trade-offs](#12-trade-offs)
- [13. Tests](#13-tests)

---

## 1. Scale

Most design choices here follow from one number, so it comes first.

**Assumed business:** 20 locations, 150 orders each per day.

| Measure | Value | Working |
|---|---|---|
| Orders per day | 3,000 | 20 × 150 |
| Orders per year | ~1.1 M | 3,000 × 365 |
| **Peak order rate** | **~0.3 / second** | 60% of orders in 5 service hours, ×3 burst |
| Status changes per day | 12,000 | ~4 per order |
| Staff signed in at once | ~300 | 15 per location |
| Open event streams | ~100 | kitchen and manager screens |
| **Peak read rate** | **~50 / second** | 300 staff × 10 requests a minute |
| Data per year | ~3 GB | orders, items and events, with indexes |

**What follows from that:**

- Peak write load is **under one write per second**. A single Postgres instance
  handles thousands.
- We are roughly **100× under capacity** on writes and **20× under** on reads.
- So the interesting question is not "how do we scale this". It is **"what can
  we avoid building"**. Sharding, read replicas and eventual consistency all
  cost correctness and debugging time, and buy nothing at this size.
- **Redis is not here because Postgres is slow.** It is here so one dashboard
  load does not run eight aggregate queries, and so two API copies can see each
  other's events.

---

## 2. Components

| Component | Owns | Stateless? |
|---|---|---|
| React app | Screens, form state, one event-stream connection | yes |
| Hono API | Validation, permissions, business rules, serialization | **yes** — no session, no in-memory order state |
| PostgreSQL | **Everything that matters** | no |
| Redis | Dashboard cache, events between API copies | no, but **disposable** |
| Worker | Customer messages and retries | yes — runs inside the API process |

The API holding no state is what lets it run as several copies behind a plain
load balancer. The only thing that needs coordinating between copies is the
event stream, and Redis pub/sub does that — so no sticky sessions.

---

## 3. Where the code lives

Each module has one job. Dependencies point one way.

```
routes/          HTTP shape only. No SQL, no business rules.
  ├─▶ lib/validation.ts   shared schemas and the validate() wrapper
  ├─▶ lib/auth.ts         tokens, passwords, role checks
  ├─▶ lib/status.ts       the transition machine (pure)
  ├─▶ lib/orders.tx.ts    the ONLY path that changes an order's status
  ├─▶ lib/orders.query.ts loading an order in its response shape
  ├─▶ lib/serialize.ts    database row → response (pure)
  ├─▶ lib/errors.ts       ApiError and the one error handler
  ├─▶ lib/events.ts       the event bus and Redis fan-out
  ├─▶ lib/cache.ts        analytics cache, a no-op without Redis
  ├─▶ lib/notifications.ts the outbox and the drain loop
  ├─▶ lib/idempotency.ts  retry safety for placing an order
  ├─▶ services/           analytics SQL, the AI call
  └─▶ db/schema.ts        the only definition of the tables
```

**There is no repository or service layer over plain CRUD.** Drizzle is the data
layer and routes call it directly. `services/` exists only where there is real
logic beyond a query.

**One concept, one home:**

| Concept | Lives in |
|---|---|
| Which status moves are legal | `lib/status.ts` |
| Every status write | `lib/orders.tx.ts` |
| Error → code → HTTP status | `lib/errors.ts` |
| Row → response shape | `lib/serialize.ts` |
| Who may do what | `lib/auth.ts` |
| Table definitions | `db/schema.ts` |

---

## 4. Transaction boundaries

The most important table in this document.

| Operation | Inside the transaction | After it commits |
|---|---|---|
| Place an order | idempotency key, customer, order, items, first status event, queued message, stored response | announce on the stream, invalidate the cache |
| Change status | guarded update, status event, queued message | announce, invalidate |
| Add or remove an item | the item write | announce, invalidate |
| Delete a customer | cascade, handled by Postgres | — |

**The rule:** anything that must be all-or-nothing goes inside. Anything that
can be retried goes outside. **Nothing that talks to a network other than
Postgres is ever inside a transaction** — an external call holding a row lock is
how a database stalls.

---

## 5. Concurrency

Every case has a named mechanism.

| Situation | Mechanism | Outcome |
|---|---|---|
| Two cooks advance the same order | `UPDATE … WHERE status = $expected` | One wins, the other gets 409 |
| A client sends the same order twice | Unique primary key on the idempotency key | The second blocks, then replays the first's response |
| Two customers created with one phone | `INSERT … ON CONFLICT DO UPDATE` | One row, both requests succeed |
| Two workers drain the outbox | `FOR UPDATE SKIP LOCKED` | Each takes different rows, neither waits |
| An item is added while status changes | Row locks on different rows | Both succeed; the total is summed at read time, so nothing is lost |
| Order numbers | `nextval()` is atomic | Cannot collide. A rolled-back insert leaves a gap, which is fine |

### The status update, in full

```sql
UPDATE orders SET status = $new, updated_at = now()
WHERE id = $id AND status = $expected
```

- Postgres serializes the two updates on the row.
- The first changes one row. The second changes **zero** — its `WHERE` no
  longer matches.
- Zero rows *is* the conflict signal, and it maps straight to
  `INVALID_STATUS_TRANSITION`.
- No `SELECT … FOR UPDATE`, no version column, no lock held across a round
  trip, no deadlock ordering to reason about.

### Retry safety, in full

1. The request writes the idempotency key **first**, inside its transaction.
2. A second request with the same key **blocks on that key** until the first
   transaction ends. Postgres does the waiting, for exactly the right length of
   time.
3. It then fails with `23505`, reads the stored response, and replays it.

Claiming the key first is what makes step 2 useful. Claiming it last would let
the second request build an entire duplicate order before discovering the
conflict.

---

## 6. Errors

One table, one place, no error built by hand in a route.

| Source | How it is detected | Code | HTTP |
|---|---|---|---|
| Failed validation | the validator | `VALIDATION_FAILED` | 400 |
| Bad `page`, `size` or `status` | the validator | `INVALID_FILTER` | 400 |
| Missing row | zero rows returned | `RESOURCE_NOT_FOUND` | 404 |
| Duplicate phone or email | Postgres **`23505`** | `RESOURCE_ALREADY_EXISTS` | 409 |
| Reference to a missing row | Postgres **`23503`** | `RESOURCE_NOT_FOUND` | 404 |
| `quantity <= 0` | Postgres **`23514`** | `VALIDATION_FAILED` | 400 |
| A guarded update matched nothing | zero rows updated | `INVALID_STATUS_TRANSITION` | 409 |
| Missing or bad token | token verification | `UNAUTHORIZED` | 401 |
| Wrong role | the role guard | `FORBIDDEN` | 403 |
| Anything else | the catch-all | `INTERNAL_ERROR` | 500 |

**Catch the Postgres error, never check first.** A `SELECT` before an `INSERT`
to test uniqueness is a race: two requests both see "free", both insert, one
crashes. The unique index is the only honest check.

**One trap worth knowing:** Drizzle wraps driver errors, and the wrapper carries
no error code. Reading only the outer error turns every constraint violation
into a 500, so the mapper walks the cause chain.

---

## 7. Consistency

Different data needs different guarantees. Saying so explicitly is the point.

| Data | Guarantee | Why |
|---|---|---|
| Orders, items, status | **Strong** | One Postgres, one transaction. This is money and food |
| Status history | **Strong, same transaction** | The log cannot disagree with the order it describes |
| What is on screen | **Within about a second** | Pushed on the stream, with a refetch on navigation as the backstop |
| Customer messages | **At least once** | The outbox retries. A crash between sending and recording can repeat one message — better than losing it |
| Dashboard figures | **Up to 30 seconds old** | Nobody decides anything on revenue that fresh |

Nothing here is eventually consistent that could have been strongly consistent.
The single database is the simplifying assumption, and §1 is the justification.

---

## 8. Failure modes

| What fails | Effect | Recovery |
|---|---|---|
| **Redis** | None. Cache misses go to Postgres, events reach only the screens on this API copy, one warning logged | Reconnects itself |
| **The AI provider** | One dashboard panel disappears. Every real figure still renders | Next request |
| **The notification target** | Three retries with the error recorded, then marked failed. Orders unaffected | Manual replay |
| **One API copy** | Its open streams drop; browsers reconnect to another copy | Load balancer health check |
| **Postgres** | **Total outage.** The API returns 503 and stays up | Recovers by itself when the database returns |

### The honest weak point

**Postgres is a single point of failure.** At this size that is the right call —
a hot standby doubles the operational surface to protect a five-hour daily
service window. In order of cost, the fixes are:

1. Automated backups and point-in-time recovery. Lose ~5 minutes, recover in ~30.
2. A synchronous replica with automatic failover. Lose nothing, recover in under
   a minute.
3. Managed Postgres with high availability — buys #2 without running it.

For a chain where 30 minutes down means writing orders on paper, #1 is
proportionate. #3 is what I would move to when a second region opens.

---

## 9. Indexes

Every index exists for a query that exists. None is speculative.

| Index | Serves |
|---|---|
| `customers_phone_idx` (unique) | duplicate detection, attaching an order by phone |
| `orders_status_created_at_idx` | the kitchen board — filter and sort in one index |
| `orders_created_at_idx` | the unfiltered order list |
| `orders_customer_id_idx` | `GET /orders?customerId=` |
| `orders_order_number_idx` (unique) | order number lookup and the sort tiebreak |
| `order_items_order_id_idx` | loading items for a page of orders |
| `order_status_events_order_id_created_at_idx` | one order's history |
| `order_status_events_to_status_created_at_idx` | prep time and throughput |
| `notifications_pending_idx` (partial) | the outbox drain — covers only rows that are work |
| `notifications_order_id_idx` | what was sent for one order |
| `staff_email_idx` (unique) | sign-in |

**Search is a full scan.** `ILIKE '%term%'` cannot use a btree index. At this
data size that is fine; `pg_trgm` with a GIN index is the fix when it is not.

### Reading a page of orders

Two round trips, never one per order:

1. The page of orders joined to their customers.
2. Every item for those orders, in one `WHERE order_id = ANY($1)`.

Then group in memory. **Twenty orders cost three queries — the count, the page,
the items — not twenty-one.** Measured against Postgres statement logs, not
assumed.

---

## 10. Security

| Concern | What is done |
|---|---|
| Identity | Signed tokens, 12 hour life, carrying id, role and name |
| Passwords | scrypt from Node's standard library, salted per user, compared in constant time |
| Permissions | Route-level guards, plus a status-aware check where the answer depends on the target status |
| Privilege escalation | Only an admin can set a role or change another person's password |
| Lockout | The last active admin cannot be deleted, demoted or deactivated |
| Account enumeration | Sign-in hashes even when the email is unknown, so a missing account takes the same time as a wrong password |
| Event stream | A separate 60 second ticket. A session token will not open a stream and a ticket will not open the API |
| SQL injection | Everything parameterised. No string-built SQL anywhere |
| Input | Validated at the edge, bounded in length, and constrained again in the database |
| Request size | Capped before parsing |
| Data sent to the AI provider | Aggregate figures only. No customer rows, and no per-person figures |
| Secrets | Environment only. The process refuses to start without `JWT_SECRET` |

**Revocation is the known gap.** There is no revocation list, so deactivating
someone stops their next sign-in but not a session already running — up to 12
hours. The fix is a set of revoked ids in Redis, checked per request.

**About `AUTH_DISABLED`.** It exists so the API can be exercised without tokens.
It is fenced: the server **refuses to start** with it under
`NODE_ENV=production`, and it warns on every boot.

---

## 11. What breaks first

Ordered by when it actually bites.

| Scale | What breaks | Fix |
|---|---|---|
| **10×** | `ILIKE '%…%'` search does a full scan | `pg_trgm` and a GIN index |
| **10×** | Aggregates scan millions of event rows | An hourly rollup table, written by the same worker |
| **25×** | Summed totals on list pages get expensive | A materialized view refreshed off the event log — still not a stored column with a trigger |
| **50×** | Many API copies each holding a Redis subscription | A dedicated stream process; the API only publishes |
| **100×** | Read load on the primary | Read replicas for lists, search and analytics |
| **100×** | Tables around 300 GB | Partition orders and events by month, archive cold partitions |
| **500×** | Write load near one primary's limit | Shard by location — a natural boundary that is never joined across |

**Microservices are not on this list.** Nothing here needs its own deployment or
its own scaling. Splitting it would add network calls and distributed
transactions to solve a problem this system does not have.

---

## 12. Trade-offs

| Decision | Chose | Over | Why | Revisit when |
|---|---|---|---|---|
| Order totals | Summed at read | Stored column with a trigger | A stored total has two write paths to keep in step and can drift silently | List queries measure slow |
| Concurrency | Guarded `UPDATE` | `SELECT … FOR UPDATE` | One statement, no lock held, conflict detection for free | Multi-row atomic updates appear |
| Prep times | Read from the event log | Columns on the order | One source of truth, and it survives a status being set twice | Rollups need them denormalised |
| Live updates | Server-sent events | WebSockets, polling | Updates are one-way and the browser reconnects on its own | The client needs to push |
| What the stream carries | An order id | The whole order | Permission checks stay on the fetch path, and one place builds the response | Bandwidth matters |
| Messages | Outbox plus a drain loop | Sending inside the request | External latency and failure never touch the response, and nothing is lost after commit | — |
| Job queue | The outbox itself | A queue library | A queue absorbs load and retries; the outbox is needed anyway and does both | Jobs appear that are not notifications |
| Cache | Aggregates only | Caching order lists too | Order lists change constantly and are already pushed live | Read replicas exist |
| Password hashing | scrypt, standard library | argon2id | Marginally weaker, no native module to compile | A native build step is acceptable |
| Sessions | Stateless tokens | Server sessions | Keeps API copies stateless, no session store | Immediate revocation is needed |
| Database | One Postgres | Postgres plus a search or document store | The data is relational and small; a second store means dual writes | Search or analytics outgrows §11 |
| Deployment | One service | Microservices | 0.3 writes a second | Teams, not load, force a split |

---

## 13. Tests

Small and targeted. No framework, no fixtures.

| File | Type | What it proves |
|---|---|---|
| `test/status.test.ts` | pure unit | All 25 transition pairs, written out by hand so the test cannot agree with a bug |
| `test/serialize.test.ts` | pure unit | Money survives without float drift; responses carry exactly the expected fields and nothing else |
| `test/validation.test.ts` | pure unit | Pagination limits, and Postgres errors mapping to the right codes — including one wrapped by Drizzle |
| `scripts/smoke.ts` | end to end | Every endpoint, every documented error, the role rules, the live stream, retry safety, and the outbox draining |

The smoke test is the gate. It runs against a live server and a real database,
detects whether authentication is on, and skips the role checks when it is off
rather than reporting false failures.
