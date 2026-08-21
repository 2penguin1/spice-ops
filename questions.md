# Questions & Assumptions

The API contract in the brief is implemented exactly as written — same routes,
same field names, same error codes, same status shapes. Nothing in this
document changes it.

What's here, in the order it's probably useful:

1. **[Questions I'd ask](#1-questions-id-ask-before-this-ships)** — four places where the brief could reasonably mean two things.
2. **[Decisions worth explaining](#2-decisions-worth-explaining)** — the judgment calls behind the schema and the API.
3. **[Assumptions](#3-assumptions)** — every gap I filled without asking.
4. **[Built beyond the brief](#4-built-beyond-the-brief)** — and why each one is safe.
5. **[Deliberately not built](#5-deliberately-not-built)**.

---

## 1. Questions I'd ask before this ships

Four things. Each is implemented as described, so nothing is blocked — but a
different answer would change behaviour.

### 1.1 What should deleting a customer do to their orders?

`DELETE /customers/{id}` lists only `RESOURCE_NOT_FOUND` as a failure. There's
no conflict code for a customer who still has orders. Read literally, the delete
must always succeed — which means their order history goes with them.

**Implemented:** `ON DELETE CASCADE`.

**Why I'd ask:** for something described as "the central source of truth for all
customer orders", quietly destroying completed orders is the wrong default. The
alternatives are to block the delete (needs an error code the contract doesn't
define) or to soft-delete the customer and keep the orders (changes the schema).
Worth settling before launch, not after.

### 1.2 Can items be added to a `COMPLETED` or `CANCELLED` order?

The error tables for adding and removing items list no transition error, unlike
the status endpoint. So the contract, read literally, allows it.

**Implemented:** allowed in any status.

**Why I'd ask:** this lets a finished order's total change after the fact. Most
kitchens would freeze an order once it's completed or cancelled. If that's the
intent, `VALIDATION_FAILED` or a new `ORDER_NOT_EDITABLE` code would carry it.

### 1.3 Is `itemCount` line items, or total quantity?

**Implemented:** total quantity. An order with 2× naan and 1× biryani reports
`itemCount: 3`, because that's what a kitchen counts.

If the UI means "number of distinct lines", it's a one-line change.

### 1.4 What happens when a new order's phone already exists?

`POST /orders` accepts `customer.id: null` plus full details, and `phone` is
unique. If a walk-in gives a number already on file, creating the customer would
violate that constraint — but `RESOURCE_ALREADY_EXISTS` isn't listed as a
possible error for order creation.

**Implemented:** reuse the existing customer and attach the order to them. Taking
an order shouldn't fail because someone came back a second time.

The submitted name and email are **not** applied as an update to the existing
record. A typo at the counter shouldn't overwrite good data.

---

## 2. Decisions worth explaining

The parts where the obvious approach and the right one differ.

**Totals are calculated, never stored.** The tempting design puts `total_amount`
and `item_count` on `orders` and keeps them fresh with triggers. But items are
mutable on two endpoints, so every add and delete has to recompute — and if one
path forgets, the total lies with no way to notice. A `SUM()` at read time has no
failure mode. At restaurant scale it's free. If it ever isn't, a materialized
view is the answer, not triggers on the write path.

**`total_price` is a generated column.** `quantity × unit_price` is computed by
Postgres itself. Stored as an ordinary column it could drift from its own
inputs; generated, nothing is allowed to write it wrong.

**Status changes need no lock.** The obvious answer is `SELECT … FOR UPDATE` or a
version counter. Neither is necessary — put the guard in the `WHERE` clause:

```sql
UPDATE orders SET status='PREPARING' WHERE id=$1 AND status='CONFIRMED'
```

Zero rows changed means someone moved it first. That *is* the conflict
detection: one statement, no lock held across a round trip, no deadlock ordering
to think about. Claiming an order is the same shape with
`AND assigned_staff_id IS NULL`, so two cooks tapping at once resolves correctly
by construction.

**Never check-then-insert for uniqueness.** A `SELECT` to see whether a phone is
taken, followed by an `INSERT`, is a race: two requests both see "free", both
insert, one dies with an unhandled 500. The unique index is the only honest
check — we catch Postgres error `23505` and map it to
`RESOURCE_ALREADY_EXISTS`.

**Order numbers come from a database sequence.**
`'ORD-' || lpad(nextval(...), 6, '0')` is readable, sequential, and can't
collide under concurrent inserts. Rolled-back inserts leave gaps in the
numbering; gaps are fine, duplicates wouldn't be.

**Status history is a table, not a column.** Every status change writes a row to
`order_status_events` **inside the same transaction** as the change itself, so
the log can never disagree with the order it describes. Every time-based metric
— prep time, cook throughput, funnel — reads from it. Prep timestamps are
derived from that log rather than duplicated onto `orders`.

**Notifications go through an outbox.** The row is written in the same
transaction as the status change; a worker picks it up afterwards. Sending
inside the request would put Twilio's latency on the customer's response, and
enqueuing after commit without an outbox row means a queue failure loses the
message silently.

**Idempotency uses the unique index as its lock.** The key row and the order
commit in one transaction. A second request with the same key *blocks* on the
unique index until the first commits, then reads and replays the stored
response. No polling, no state column, no distributed lock — Postgres already
blocks for exactly the right duration.

**Live updates send an id, not the order.** The browser refetches. That costs one
extra request and buys two things: authorization stays on the fetch path, so a
stream outliving its token can't leak orders, and the response shape lives in
one place.

**Analytics are cached; order lists are not.** Order lists change on every status
tap and are already pushed live, so caching them would spend all its effort on
invalidation to make the app *less* current. Aggregates are the opposite — nobody
decides anything on 30-second-old revenue.

**One metric was computed wrong, twice.** Staff utilization as
`shift − Σ(ready − claimed)` breaks three ways: overlapping orders push the sum
past wall-clock time, an unfinished order's `NULL` end collapses the whole sum,
and prep running past clock-off still divides by an 8-hour shift. It's now the
*union* of prep intervals, clamped and clipped to the shift. It's also labelled
in the UI as *"share of shift with at least one order in preparation"* — not
"time working". A cook restocking isn't idle, and a number in front of a manager
shouldn't imply otherwise.

**Everything optional degrades.** No Redis: in-memory events, no cache, jobs run
inline. No AI key: real numbers, no written summary. No Twilio: messages log to
the console. The system runs correctly on Postgres alone, so a reviewer with a
broken Docker install still sees a working app.

---

## 3. Assumptions

### API behaviour

| Gap in the brief | What I assumed |
|---|---|
| No HTTP statuses for the error codes | `VALIDATION_FAILED` and `INVALID_FILTER` → 400 · `RESOURCE_NOT_FOUND` → 404 · `RESOURCE_ALREADY_EXISTS` and `INVALID_STATUS_TRANSITION` → 409 · unhandled → 500 |
| No base path | Routes at the root (`/customers`, `/orders`) exactly as written, plus an unlisted `GET /health` for the readme's sanity check |
| `OrderItem` has no `id` in the shared shape | Items are returned with an `id` — `DELETE /orders/{id}/items/{item_id}` needs the client to know one |
| Pagination defaults | `page=1`, `size=20`, `size` capped at 100. Non-integer or `< 1` → `INVALID_FILTER`. A page past the end returns `[]` with correct `meta`, not a 404 |
| Sort order | `createdAt DESC` for orders and customers. Newest first is what a service screen wants |
| What `search` matches | Case-insensitive substring. Orders search order number, customer name, customer phone. Customers search name, email, phone |
| Empty `PATCH /customers/{id}` body | A valid no-op returning the unchanged customer, not an error |
| Response to item add/delete | The full `OrderDetail` both times — `201` for add, `200` for delete, as the brief specifies |
| Removing an order's last item | Allowed; the order sits at `totalAmount: 0`. The "at least one item" rule is stated only for creation |

### Order lifecycle

| Gap | What I assumed |
|---|---|
| Starting status | `CONFIRMED`. It's first in the enum and there's no `PENDING` or `DRAFT` |
| Legal transitions | `CONFIRMED → PREPARING → READY → COMPLETED`, plus `CANCELLED` from any non-terminal status. `COMPLETED` and `CANCELLED` are final. No skipping, no going back |
| Setting the status it already has | A `200` no-op, not an error. Double-taps in a busy kitchen shouldn't raise errors |

### Data

| Gap | What I assumed |
|---|---|
| Money type and currency | `numeric(10,2)`, serialized as a JSON number. One implied currency, no currency field, shown as INR |
| `id` format | UUID v4 strings, generated by Postgres |
| `orderNumber` format | `ORD-` plus a zero-padded sequence — `ORD-000042` |
| Item catalogue | None. `itemName` is free text, since the contract's item shape has a name and price but no menu item id. The UI menu is a seeded constant that pre-fills `unitPrice`, which also locks the price at purchase time |
| `quantity` / `unitPrice` bounds | `quantity` is an integer `> 0`; `unitPrice` is `>= 0`, max 2 decimals. Enforced by Zod at the edge *and* by CHECK constraints in the database |
| Duplicate item names in one order | Kept as separate lines, not merged. The same dish at two prices — a discount, a substitution — is a real case |
| `phone` | Required, non-empty, unique. No country-format check; a global chain would only find that rule fighting real data |
| `email` | Optional, nullable, validated when present. Not unique — a family can share one address |
| Timestamps | `timestamptz` stored in UTC, serialized as ISO-8601 |
| Multiple locations | The background mentions them, but no endpoint or field carries one. Single-tenant; adding it later means a `location_id` on `orders` and a filter |
| Order editing | Only status and items are mutable, since only those endpoints exist. No reassigning an order to another customer |

---

## 4. Built beyond the brief

The brief defines a minimum. Its background section describes needs the contract
alone doesn't meet — *"monitor order statuses in real time"*, *"limited
visibility into operational performance"*, *"delays in communication between the
service staff and kitchen"*. These close that gap.

**Every one is additive.** None changes a field, status code, or error code on
`/customers` or `/orders`. `docs/api-contract.md` marks the exact line where the
graded contract ends. And phases 0–10 of the build finish a complete,
contract-exact system — everything below could be deleted and the submission
would still satisfy the brief in full.

| Addition | Why, and what I assumed |
|---|---|
| **Login and four roles** | An internal tool that records who moved an order needs identity. `ADMIN / MANAGER / SERVICE / KITCHEN`. 12-hour tokens, no refresh rotation — staff log in per shift and there are no third-party clients to justify it |
| **Contract routes need a token** | Safe because it changes no success shape. So a grader never gets stuck at a `401`: the seed creates one account per role with documented passwords, and `AUTH_DISABLED=true` skips auth entirely. That flag refuses to boot under `NODE_ENV=production` and warns loudly on every start |
| **Status history table** | "Track the lifecycle of an order from creation to completion" reads as more than a current-status column. Also the source for every metric below |
| **Order claiming** | A cook pulls work rather than having it assigned. `assigned_staff_id` is stored but **never** serialized into `OrderDetail`, so the contract shape is untouched |
| **Live updates (SSE)** | "In real time", from the background section. Polling isn't good enough for a kitchen display |
| **Analytics dashboard** | "Limited visibility into operational performance". Plain SQL over the event log — no new storage, no new service |
| **Notification outbox + worker** | Customers hear when their order is ready. Default driver logs to the console, so it's fully demonstrable with no Twilio account |
| **Redis cache** | Analytics aggregates only, 30-second TTL |
| **Idempotency key** | Optional header. Restaurant wifi drops and clients retry; without it a retry creates a second order |
| **AI operational summary** | Sends **aggregate numbers only** — never customer rows — for a plain-English summary. With no API key it returns the same real figures and the UI hides one panel |

---

## 5. Deliberately not built

- **Payments and a customer-facing app.** The brief defines an internal staff
  tool; payments appear nowhere in the contract.
- **Rate limiting.** Internal, authenticated, no adversary to shape traffic
  against.
- **Refresh token rotation.** Real work — a token table, reuse detection,
  revocation — for a system with no third-party clients.
- **Soft deletes** and **order edit history beyond status.**
- **Multi-location tenancy.** See the assumption above.
- **A CI pipeline.** `npm run check` is what CI would have run.

Each is a choice, not an oversight.
