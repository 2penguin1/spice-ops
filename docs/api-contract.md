# API reference

Every endpoint, its inputs and its failures. A summary table is in the
[readme](../readme.md#api); this is the detail.

**Contents**

- [Conventions](#conventions)
- [Objects](#objects)
- [Auth](#auth)
- [Customers](#customers)
- [Orders](#orders)
- [Order items](#order-items)
- [Staff](#staff)
- [Analytics](#analytics)
- [Live updates](#live-updates)
- [Notifications](#notifications)
- [Health](#health)

---

## Conventions

- Base URL `http://localhost:3000`. No version prefix.
- Every request except `POST /auth/login` and `GET /health` needs
  `Authorization: Bearer <token>`. The event stream uses a ticket instead.
- Every success is `{ "data": … }`. List endpoints add
  `"meta": { "pagination": … }`.
- Every failure is `{ "error": { "code": …, "message": … } }`.
- `204` responses have no body at all.

### Pagination

| Parameter | Default | Rules |
|---|---|---|
| `page` | `1` | Whole number, 1 or more |
| `size` | `20` | Whole number, 1 to 100 |

- Anything else returns `INVALID_FILTER`.
- `totalPages` is `ceil(total / size)`.
- A page past the end returns an empty array with correct totals, not a 404.

### Error codes

| Code | HTTP | Means |
|---|---|---|
| `VALIDATION_FAILED` | 400 | The body is wrong |
| `INVALID_FILTER` | 400 | A query parameter is wrong |
| `UNAUTHORIZED` | 401 | No token, or an expired one |
| `FORBIDDEN` | 403 | Signed in, but not allowed to do this |
| `RESOURCE_NOT_FOUND` | 404 | No such thing |
| `RESOURCE_ALREADY_EXISTS` | 409 | Something unique already has that value |
| `INVALID_STATUS_TRANSITION` | 409 | That status move is not allowed |
| `INTERNAL_ERROR` | 500 | Our fault |

---

## Objects

### Customer

| Field | Type | Notes |
|---|---|---|
| `id` | string | UUID |
| `name` | string | |
| `email` | string \| null | Nullable, not optional — the key is always present |
| `phone` | string | Unique across customers |
| `createdAt` `updatedAt` | string | ISO-8601 |

### OrderItem

| Field | Type | Notes |
|---|---|---|
| `id` | string | Needed to delete the item |
| `itemName` | string | |
| `quantity` | number | Whole number above zero |
| `unitPrice` | number | Zero or more, at most two decimals |
| `totalPrice` | number | `quantity × unitPrice`, computed by the database |

### OrderDetail

| Field | Type | Notes |
|---|---|---|
| `id` | string | |
| `orderNumber` | string | `ORD-000042` |
| `customerId` | string | |
| `status` | string | One of the five statuses |
| `totalAmount` | number | Summed from the items |
| `itemCount` | number | Total quantity, not the number of lines |
| `createdAt` `updatedAt` | string | ISO-8601 |
| `customer` | Customer | Always included |
| `items` | OrderItem[] | Always included |

---

## Auth

### `POST /auth/login`

No token needed.

```json
{ "email": "manager@spice.test", "password": "spice123" }
```

→ `200` `{ "data": { "token": "…", "staff": { "id", "name", "role" } } }`

- The token lasts 12 hours.
- **Errors:** `VALIDATION_FAILED`, `UNAUTHORIZED`.
- A wrong password and an unknown email return the same message, and take the
  same time, so responses cannot be used to find out which accounts exist.

### `GET /auth/me`

→ `200` with the current token's owner.

---

## Customers

### `GET /customers`

| Query | Type | Notes |
|---|---|---|
| `search` | string | Matches name, email or phone, anywhere, ignoring case |
| `page` `size` | number | See [pagination](#pagination) |

→ `200` `{ data: Customer[], meta }`, newest first.

**Errors:** `INVALID_FILTER`.

### `POST /customers`

```json
{ "name": "Aarav Sharma", "email": "aarav@example.com", "phone": "+91 98200 11223" }
```

- `name` and `phone` are required. `email` may be `null`.
- → `201` `{ data: Customer }`
- **Errors:** `VALIDATION_FAILED`, `RESOURCE_ALREADY_EXISTS` (phone taken),
  `FORBIDDEN` (kitchen).

### `PATCH /customers/{id}`

- Same fields, all optional. An empty body returns the record unchanged.
- → `200` `{ data: Customer }`
- **Errors:** `VALIDATION_FAILED`, `RESOURCE_ALREADY_EXISTS`,
  `RESOURCE_NOT_FOUND`, `FORBIDDEN`.

### `DELETE /customers/{id}`

- → `204`, no body.
- **Deletes their orders too.** There is no error for "still has orders", so
  this is what deleting a customer means. See [questions.md §1.1](../questions.md).
- **Errors:** `RESOURCE_NOT_FOUND`, `FORBIDDEN` (service and kitchen).

---

## Orders

### `GET /orders`

| Query | Type | Notes |
|---|---|---|
| `search` | string | Matches order number, customer name or phone |
| `status` | string | One of the five statuses |
| `customerId` | string | |
| `page` `size` | number | See [pagination](#pagination) |

→ `200` `{ data: OrderDetail[], meta }`, newest first.

**Errors:**

- `INVALID_FILTER` — bad `page`, `size` or `status`.
- `RESOURCE_NOT_FOUND` — no such customer. A malformed id gives the same
  answer: an id that cannot name a customer is a customer that does not exist.

### `GET /orders/{id}`

→ `200` `{ data: OrderDetail }`. **Errors:** `RESOURCE_NOT_FOUND`.

### `POST /orders`

```json
{
  "customer": { "id": null, "name": "Walk In", "email": null, "phone": "+91 98200 11223" },
  "items": [{ "itemName": "Chicken Biryani", "quantity": 1, "unitPrice": 380 }]
}
```

**How the customer is resolved:**

| Input | What happens |
|---|---|
| `customer.id` given | Attach to them. The other fields are ignored, not applied as an update |
| No id, phone already on file | Attach to that customer. Their details are not overwritten |
| No id, phone is new | Create the customer |

**Rules:**

- At least one item, at most 60.
- New orders start `CONFIRMED`.
- The whole thing is one transaction.

**Optional header:** `Idempotency-Key: <string>`

- Send the same key twice and the same order comes back, not a second one.
- The same key with a different body returns `VALIDATION_FAILED` — that is a
  caller bug and replaying would hide it.
- Without the header, nothing about this endpoint changes.

→ `201` `{ data: OrderDetail }`

**Errors:** `VALIDATION_FAILED`, `RESOURCE_NOT_FOUND` (unknown `customer.id`),
`FORBIDDEN` (kitchen).

### `PATCH /orders/{id}/status`

```json
{ "status": "PREPARING" }
```

Allowed moves:

```
CONFIRMED ──▶ PREPARING ──▶ READY ──▶ COMPLETED
    │             │           │
    └─────────────┴───────────┴──▶ CANCELLED
```

- `COMPLETED` and `CANCELLED` are final.
- Setting the status it already has returns `200` and changes nothing.

→ `200` `{ data: OrderDetail }`

**Errors:**

- `VALIDATION_FAILED` — not one of the five statuses.
- `RESOURCE_NOT_FOUND` — no such order.
- `INVALID_STATUS_TRANSITION` — a real status, an illegal move, **or** someone
  else moved the order first.
- `FORBIDDEN` — the role may not make this particular move. See the
  [role table](../readme.md#who-can-do-what).

### `GET /orders/{id}/timeline`

→ `200` with every status the order has been through:

```json
{ "data": [{ "id": "…", "fromStatus": null, "toStatus": "CONFIRMED", "createdAt": "…" }] }
```

- `fromStatus` is `null` for the event that created the order.
- Ordered oldest first.
- **Errors:** `RESOURCE_NOT_FOUND`.

---

## Order items

### `POST /orders/{id}/items`

```json
{ "itemName": "Garlic Naan", "quantity": 2, "unitPrice": 70 }
```

→ `201` `{ data: OrderDetail }` — the **whole order**, not the item.

**Errors:** `VALIDATION_FAILED`, `RESOURCE_NOT_FOUND`, `FORBIDDEN`.

### `DELETE /orders/{id}/items/{itemId}`

→ `200` `{ data: OrderDetail }` — the whole order. Note `200`, not `204`.

- The item must belong to that order, so an item id from another order cannot
  be deleted through this one.
- Removing the last item is allowed; the order sits at zero.
- **Errors:** `RESOURCE_NOT_FOUND` (order or item), `FORBIDDEN`.

---

## Staff

Admins and managers only. Managers cannot delete anyone, set a role, or change
another person's password.

| Method | Path | Notes |
|---|---|---|
| `GET` | `/staff` | Paginated. Never returns a password hash |
| `POST` | `/staff` | `name`, `email`, `password` (8+), `role` |
| `PATCH` | `/staff/{id}` | All fields optional, plus `isActive` |
| `DELETE` | `/staff/{id}` | `204`. Admins only |

**Guards:**

- You cannot delete your own account.
- The last active admin cannot be deleted, demoted or deactivated.

---

## Analytics

Admins and managers only. Cached for 30 seconds; the written summary for 15
minutes.

| Endpoint | Returns |
|---|---|
| `GET /analytics/summary` | Revenue taken and still cooking, order counts, status mix, cancellation rate, average prep time |
| `GET /analytics/daily?days=` | Orders and revenue per day. `days` is 1–90, default 14 |
| `GET /analytics/hours` | Orders per hour. All 24 hours, so quiet ones show as zero |
| `GET /analytics/staff` | Orders started and finished per person, and average prep time |
| `GET /analytics/items` | Best selling dishes by quantity |
| `GET /analytics/insights` | `{ narrative, model, unavailable }` |

**Notes:**

- Days and hours are bucketed in the restaurant's timezone, not the server's.
- `averagePrepSeconds` is `null` when nothing has finished yet — never zero.
- `/analytics/insights` **always returns 200**. With no AI key, a provider
  outage or a timeout, `narrative` is `null` and `unavailable` says why.
- **Errors:** `INVALID_FILTER` (bad `days`), `FORBIDDEN`.

---

## Live updates

### `POST /events/ticket`

→ `200` `{ "data": { "ticket": "…" } }`

- Lasts 60 seconds and works on no other route.
- Needed because a browser's `EventSource` cannot send an `Authorization`
  header.

### `GET /events?ticket=…`

A `text/event-stream` connection.

```
event: ready
data: {"ok":true}

event: order:updated
data: {"orderId":"…","orderNumber":"ORD-000042","status":"PREPARING"}

event: ping
data:
```

- Frames carry an **id, not the order** — the client refetches, which keeps
  permission checks on the fetch path.
- `ping` every 25 seconds, so proxies do not drop an idle connection.
- **Errors:** `UNAUTHORIZED` — missing ticket, expired ticket, or a session
  token used in its place.

---

## Notifications

### `GET /notifications?orderId=`

Admins and managers only. What was sent to customers and whether it worked.

```json
{
  "data": [{
    "id": "…", "orderId": "…", "channel": "console",
    "recipient": "+91 98200 11223", "body": "Spice Garden: order ORD-000042 is ready.",
    "status": "SENT", "attempts": 1, "lastError": null,
    "createdAt": "…", "sentAt": "…"
  }]
}
```

`status` is `PENDING`, `SENDING`, `SENT` or `FAILED`. Three attempts, then
`FAILED` with the reason in `lastError`.

---

## Health

### `GET /health`

No token needed.

→ `200` `{ "data": { "status": "ok", "db": "up" } }`

→ `503` `{ "data": { "status": "degraded", "db": "down" } }` when Postgres is
unreachable. The API stays up and recovers by itself.
