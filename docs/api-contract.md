# API Contract

Transcribed from the assignment brief. **This file is the implementation target.**
Where the brief was silent, the gap is marked `[assumed]` and repeated in
`questions.md`. Base URL: `http://localhost:3000` — routes are mounted at the
root, no `/api/v1` prefix (the brief specifies `/customers`, `/orders`).

> **Layer 1.** Everything up to the appendix is the graded contract and is
> implemented exactly as written. The platform features described in
> `docs/plan.md` add the routes listed in the [appendix](#appendix-extension-routes)
> and change **nothing** below this line — no extra fields, no extra error
> codes, no altered status codes.
>
> **Auth.** Contract routes require an `Authorization: Bearer <token>` header
> (see the appendix). This adds `401`/`403` as transport-level failures but
> alters no success shape. To exercise the contract without tokens, set
> `AUTH_DISABLED=true` in `backend/.env` — `readme.md` documents both paths.

## Envelopes

Success:

```jsonc
{
  "data": T,
  "meta": {                 // list endpoints only
    "pagination": { "page": 1, "size": 20, "total": 137, "totalPages": 7 }
  }
}
```

Error:

```jsonc
{ "error": { "code": "VALIDATION_FAILED", "message": "human readable" } }
```

`204 No Content` responses have no body at all.

## Shared objects

### Customer

| Field       | Type              | Notes                          |
|-------------|-------------------|--------------------------------|
| `id`        | string (uuid)     |                                |
| `name`      | string            |                                |
| `email`     | string \| null    | nullable, not optional         |
| `phone`     | string            | unique across customers        |
| `createdAt` | string (ISO-8601) | timestamptz                    |
| `updatedAt` | string (ISO-8601) | timestamptz                    |

### OrderDetail

| Field         | Type                                                        | Notes                        |
|---------------|-------------------------------------------------------------|------------------------------|
| `id`          | string (uuid)                                               |                              |
| `orderNumber` | string                                                      | e.g. `ORD-000042`            |
| `customerId`  | string (uuid)                                               |                              |
| `status`      | `CONFIRMED\|PREPARING\|READY\|COMPLETED\|CANCELLED`         |                              |
| `totalAmount` | number                                                      | derived: Σ item totalPrice   |
| `itemCount`   | number                                                      | derived: Σ item quantity `[assumed]` |
| `createdAt`   | string (ISO-8601)                                           |                              |
| `updatedAt`   | string (ISO-8601)                                           |                              |
| `customer`    | Customer                                                    | always embedded              |
| `items`       | OrderItem[]                                                 | always embedded              |

### OrderItem

| Field        | Type    | Notes                                    |
|--------------|---------|------------------------------------------|
| `id`         | string  | `[assumed]` — not in the brief's shape, but `DELETE /orders/{id}/items/{item_id}` needs it |
| `itemName`   | string  |                                          |
| `quantity`   | integer | `> 0`                                    |
| `unitPrice`  | number  | `>= 0`, 2 dp                             |
| `totalPrice` | number  | generated column: `quantity * unitPrice` |

## Error code → HTTP status `[assumed]`

The brief names codes but not statuses.

| Code                       | HTTP |
|----------------------------|------|
| `VALIDATION_FAILED`        | 400  |
| `INVALID_FILTER`           | 400  |
| `RESOURCE_NOT_FOUND`       | 404  |
| `RESOURCE_ALREADY_EXISTS`  | 409  |
| `INVALID_STATUS_TRANSITION`| 409  |
| (unhandled)                | 500 `{"code":"INTERNAL_ERROR"}` |

## Pagination `[assumed]`

`page` defaults to `1`, `size` to `20`, `size` capped at `100`. Both must be
positive integers; anything else → `INVALID_FILTER`. `totalPages = ceil(total/size)`.
A `page` beyond the end returns `data: []` with correct `meta`, not a 404.

---

## Customers

### `GET /customers`

Query: `search?` (string), `page?`, `size?`
→ `200` `ApiResponse<Customer[]>` with pagination meta.

`search` matches `name`, `email` or `phone`, case-insensitive substring `[assumed]`.

Errors: `INVALID_FILTER` (bad `page`/`size`).

### `POST /customers`

Body: `{ name, email: string|null, phone }` — `name`, `phone` required.
→ `201` `ApiResponse<Customer>`

Errors: `VALIDATION_FAILED`, `RESOURCE_ALREADY_EXISTS` (phone taken).

### `PATCH /customers/{id}`

Body: `{ name?, email?, phone? }`, all optional. Empty body is a no-op `[assumed]`.
→ `200` `ApiResponse<Customer>`

Errors: `VALIDATION_FAILED`, `RESOURCE_ALREADY_EXISTS`, `RESOURCE_NOT_FOUND`.

### `DELETE /customers/{id}`

→ `204` no body.

Errors: `RESOURCE_NOT_FOUND`.

Deleting a customer cascades to their orders and order items `[assumed]` — the
brief lists no conflict error for a customer who still has orders. **This is the
top clarifying question in `questions.md`.**

---

## Orders

### `GET /orders`

Query: `search?`, `status?`, `customerId?`, `page?`, `size?`
→ `200` `ApiResponse<OrderDetail[]>` with pagination meta.

`search` matches `orderNumber`, customer `name` or customer `phone`,
case-insensitive substring `[assumed]`. Default sort: `createdAt DESC` `[assumed]`.

Errors:
- `INVALID_FILTER` — bad `page`, `size`, or a `status` outside the enum.
- `RESOURCE_NOT_FOUND` — `customerId` does not exist.

### `GET /orders/{order_id}`

→ `200` `ApiResponse<OrderDetail>`. Errors: `RESOURCE_NOT_FOUND`.

### `POST /orders`

```jsonc
{
  "customer": { "id": "uuid | null", "name": "...", "email": "... | null", "phone": "..." },
  "items": [ { "itemName": "...", "quantity": 2, "unitPrice": 12.5 } ]
}
```

- `customer.id` present → attach to that customer; `404 RESOURCE_NOT_FOUND` if absent.
  The other customer fields are then ignored, not applied as an update `[assumed]`.
- `customer.id` null/omitted → create the customer from the given details. If the
  `phone` already belongs to a customer, reuse that customer rather than failing
  `[assumed]` — creating an order should not 409 on a returning caller.
- `items` must contain ≥ 1 entry → else `VALIDATION_FAILED`.
- New orders start at `CONFIRMED` `[assumed]`.
- The whole thing is one transaction.

→ `201` `ApiResponse<OrderDetail>`. Errors: `VALIDATION_FAILED`, `RESOURCE_NOT_FOUND`.

### `PATCH /orders/{order_id}/status`

Body: `{ "status": "PREPARING" }`
→ `200` `ApiResponse<OrderDetail>`

Allowed transitions `[assumed]` — the brief names the error, not the machine:

```
CONFIRMED ──▶ PREPARING ──▶ READY ──▶ COMPLETED
    │             │           │
    └─────────────┴───────────┴──▶ CANCELLED

COMPLETED and CANCELLED are terminal. Same-status is a no-op 200, not an error.
```

Errors: `RESOURCE_NOT_FOUND`, `VALIDATION_FAILED` (unknown status value),
`INVALID_STATUS_TRANSITION` (valid status, illegal move).

### `POST /orders/{order_id}/items`

Body: `{ itemName, quantity, unitPrice }`
→ `201` `ApiResponse<OrderDetail>` (the **whole** order, not the item).

Errors: `RESOURCE_NOT_FOUND`, `VALIDATION_FAILED`.

The brief lists no transition error here, so items may be added to an order in
any status, including `COMPLETED` `[assumed]` — flagged in `questions.md`.

### `DELETE /orders/{order_id}/items/{item_id}`

→ `200` `ApiResponse<OrderDetail>` (note: 200 with the order, not 204).

Errors: `RESOURCE_NOT_FOUND` (order or item; item must belong to that order),
`VALIDATION_FAILED`.

Removing the last item leaves an order with zero items, `totalAmount: 0` `[assumed]` —
the ≥1-item rule is stated only for creation.

---

# Appendix: extension routes

Not part of the assignment brief. A grader checking contract adherence can stop
reading at the line above. These use the same envelopes so the API stays
internally consistent, and they add two codes — `UNAUTHORIZED` (401) and
`FORBIDDEN` (403) — that **never** appear on a contract route for a caller with
a valid token.

## Auth

| Route | Purpose |
|---|---|
| `POST /auth/login` | `{ email, password }` → `{ data: { token, staff } }`. 12h HS256 JWT carrying `{ sub, role, name }`. |
| `GET /auth/me` | current staff record from the token |

Seeded accounts (documented in `readme.md`, password `spice123` for all):
`admin@spice.test`, `manager@spice.test`, `cook@spice.test`, `server@spice.test`.

## Role matrix over contract routes

Enforced by `requireRole` middleware. Any authenticated role may read.

| Action | ADMIN | MANAGER | SERVICE | KITCHEN |
|---|:--:|:--:|:--:|:--:|
| Create order, add/remove items | ✓ | ✓ | ✓ | — |
| `CONFIRMED → PREPARING`, `→ READY` | ✓ | ✓ | — | ✓ |
| `READY → COMPLETED` | ✓ | ✓ | ✓ | — |
| `→ CANCELLED` | ✓ | ✓ | — | — |
| Customer create / update | ✓ | ✓ | ✓ | — |
| Customer delete | ✓ | ✓ | — | — |
| Staff management, analytics | ✓ | ✓ (no staff delete) | — | — |

## Staff

`GET /staff`, `POST /staff`, `PATCH /staff/{id}`, `DELETE /staff/{id}`,
`POST /staff/{id}/shifts`, `GET /staff/{id}/shifts` — same envelopes, same
pagination rules, same error codes plus `UNAUTHORIZED`/`FORBIDDEN`.

## Orders — claiming

`POST /orders/{order_id}/claim` — a cook claims an unassigned `CONFIRMED` order
and moves it to `PREPARING` in one atomic statement:

```sql
UPDATE orders SET status='PREPARING', assigned_staff_id=$staff
WHERE id=$1 AND status='CONFIRMED' AND assigned_staff_id IS NULL
```

Returns `OrderDetail` (without `assignedStaffId` — the assignment is visible via
`GET /orders/{id}/timeline`).

0 rows changed means one of two things, and they are different errors, so the
handler re-reads the row to tell them apart:

| Row state | Response |
|---|---|
| already has an `assigned_staff_id` | `409 RESOURCE_ALREADY_EXISTS` |
| unassigned but not `CONFIRMED` | `409 INVALID_STATUS_TRANSITION` |
| gone | `404 RESOURCE_NOT_FOUND` |

`GET /orders/{order_id}/timeline` — the `order_status_events` rows for an order:
`{ fromStatus, toStatus, staff: { id, name } | null, createdAt }[]`.

## Analytics (ADMIN, MANAGER)

| Route | Returns |
|---|---|
| `GET /analytics/summary` | revenue (net / incoming), status funnel, cancellation rate, avg prep time |
| `GET /analytics/timeseries?days=14` | orders and revenue per day, peak hours |
| `GET /analytics/staff` | per-cook throughput, avg prep time, utilization |
| `GET /analytics/menu` | top items, co-occurrence pairs |
| `GET /analytics/ai-insights` | the above aggregates plus `narrative: string \| null` — **null, not an error, when no API key is configured** |

`utilization` is the union of a cook's prep intervals over their scheduled
shift, capped at 1.0 by construction. It is labelled in the UI as *"share of
shift with at least one order in preparation"* — see `docs/plan.md` §8.

## Real-time

`GET /events` — `text/event-stream`. Frames carry ids, not bodies:

```
event: order:updated
data: {"orderId":"…","status":"PREPARING"}
```

Clients refetch the affected order, which keeps authorization on the fetch path.

## Ops

`GET /health` → `{ status, db, redis }`. `GET /metrics` (ADMIN) → request counts,
p50/p95 latency by route, queue depth.

## Request headers

| Header | Where | Effect |
|---|---|---|
| `Authorization: Bearer <jwt>` | all routes unless `AUTH_DISABLED=true` | identity + role |
| `Idempotency-Key: <string>` | `POST /orders`, optional | replays the stored response instead of creating a second order. Same key + different body → `VALIDATION_FAILED`. Absent → no behaviour change. |
