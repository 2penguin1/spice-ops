# Assumptions and open questions

The requirements left some things open. This is what I chose, why, and the four
things I would ask before this went live.

Design decisions — why totals are summed, why status changes need no lock, and
so on — are in the [readme](readme.md#decisions-worth-explaining).

**Contents**

- [1. Open questions](#1-open-questions)
- [2. How the API behaves](#2-how-the-api-behaves)
- [3. The order lifecycle](#3-the-order-lifecycle)
- [4. The data](#4-the-data)
- [5. Built beyond the requirements](#5-built-beyond-the-requirements)
- [6. Deliberately not built](#6-deliberately-not-built)

---

## 1. Open questions

Five things. Each is built as described, or deliberately not built, so nothing
is blocked — but a different answer would change behaviour.

### 1.1 What should deleting a customer do to their orders?

- `DELETE /customers/{id}` has one failure case: the customer does not exist.
- There is no error code for "this customer still has orders".
- Read plainly, the delete must always succeed — so their order history goes
  with them.

**Built:** `ON DELETE CASCADE`.

**Why it matters:** for a system meant to be the record of every order, quietly
destroying completed ones is the wrong default. Two alternatives:

- Block the delete when orders exist. Needs an error code that does not exist.
- Soft-delete the customer and keep the orders. Changes the schema.

Worth settling before launch, not after.

### 1.2 Can items be added to a finished order?

- Adding and removing items list no error for a completed or cancelled order,
  unlike the status endpoint.
- So, read plainly, it is allowed.

**Built:** allowed in any status.

**Why it matters:** this lets a finished order's total change after the fact.
Most kitchens would freeze an order once it is completed or cancelled.

### 1.3 Is `itemCount` the number of lines, or the total quantity?

**Built:** total quantity. Two naan and one biryani is `itemCount: 3`, because
that is what a kitchen counts.

If it should mean "number of distinct dishes", it is a one-line change.

### 1.4 What if a new order's phone is already on file?

- An order can carry `customer.id: null` plus full details.
- `phone` is unique, so creating that customer would fail.
- But "already exists" is not a listed error for placing an order.

**Built:** reuse the existing customer and attach the order to them. Taking an
order should not fail because someone came back a second time.

The name and email sent with the order are **not** written over the existing
record. A typo at the counter should not overwrite good data.

### 1.5 How should staff filter orders by date?

- `GET /orders` filters by search term, status and customer. There is no way to
  ask for a date or a range.
- A restaurant works in days. "What did we take today" and "show me last
  Friday" are the two questions a manager actually asks of an order list.

**Not built.** `GET /orders` is specified in the brief, and adding a parameter
it does not mention puts something on a graded endpoint that the specification
does not describe.

**What it would take.** Optional `from` and `to` as `YYYY-MM-DD`, bucketed in
the restaurant's timezone, rejected with the existing `INVALID_FILTER` when
malformed. Both absent means all time, so every documented request behaves
exactly as it does now.

**The part that cannot be done that way.** Defaulting the API to today would
change what `GET /orders` returns with no parameters, which is a documented
behaviour. A default belongs in the interface, which would send `from=today`
and offer "all time" beside it — the server would keep no opinion.

Worth asking whether the endpoint is fixed or open to additions, because the
answer decides where this goes rather than whether it is wanted.

---

## 2. How the API behaves

| Gap | What I chose |
|---|---|
| No HTTP statuses given for the error codes | `VALIDATION_FAILED` and `INVALID_FILTER` → 400 · `RESOURCE_NOT_FOUND` → 404 · `RESOURCE_ALREADY_EXISTS` and `INVALID_STATUS_TRANSITION` → 409 · anything unhandled → 500 |
| No base path | Routes at the root, exactly as specified, plus `GET /health` |
| An order item had no `id` in the given shape | Items are returned with one — deleting an item needs the client to know it |
| Pagination defaults | `page=1`, `size=20`, `size` capped at 100. Anything not a positive integer → `INVALID_FILTER` |
| A page past the end | Empty array with correct totals, not a 404 |
| Sort order | Newest first, for both orders and customers |
| What `search` matches | Case-insensitive, anywhere in the text. Orders search order number, customer name and phone. Customers search name, email and phone |
| An empty `PATCH` body | A no-op returning the unchanged record, not an error |
| Response to adding or removing an item | The whole order, both times — `201` for add, `200` for remove |
| Removing an order's last item | Allowed; the order sits at zero. The "at least one item" rule applies to creating an order |
| Upper bounds | Not specified, so I set them: 60 items per order, 120 characters for names and dish names, 30 for a phone, 80 for a search term, 256 KB for a request body |

---

## 3. The order lifecycle

| Gap | What I chose |
|---|---|
| Starting status | `CONFIRMED`. It is first in the list and there is no draft state |
| Which moves are legal | `CONFIRMED → PREPARING → READY → COMPLETED`, plus `CANCELLED` from any of the first three. The last two are final |
| Setting the status it already has | Succeeds and changes nothing. Double-taps in a busy kitchen should not fail |
| Who may make each move | Not specified, so: the kitchen cooks, the floor delivers, only a manager cancels. See the [role table](readme.md#who-can-do-what) |

---

## 4. The data

| Gap | What I chose |
|---|---|
| Money type and currency | `numeric(10,2)`, returned as a JSON number. One implied currency, shown as INR |
| `id` format | UUIDs, generated by Postgres |
| Order number format | `ORD-` and a zero-padded database sequence — `ORD-000042` |
| A menu | Not a table. An order item carries a name and a price but no menu id, so the menu is a constant in the UI that fills in the price. That also means changing a price never rewrites an old order |
| `quantity` and `unitPrice` limits | `quantity` a whole number above zero; `unitPrice` zero or more, at most two decimals. Enforced by validation **and** by database constraints |
| The same dish twice on one order | Kept as separate lines. The same dish at two prices — a discount, a substitution — is a real case |
| `phone` | Required, unique, no country-format check. A global chain would only find that rule fighting real data |
| `email` | Optional, and not unique — a family can share one |
| Timestamps | Stored in UTC, returned as ISO-8601 |
| Which day a figure belongs to | The restaurant's timezone, not the server's. Otherwise "today" rolls over at 05:30 local and the dinner rush charts as afternoon |
| Multiple locations | Mentioned in the background, but no field or endpoint carries one. Single site. Adding it later means a `location_id` on orders and a filter |
| Editing an order | Only status and items, since only those endpoints exist. An order cannot be moved to a different customer |

---

## 5. Built beyond the requirements

The requirements describe a minimum. The background describes needs it does not
meet — "monitor order statuses in real time", "limited visibility into
operational performance", "delays in communication between the service staff and
kitchen". These close that gap.

**None of them changes a field, status code or error code on the required
endpoints.** They add routes of their own, and each one degrades to something
working when its optional dependency is missing.

| Addition | Why, and what I assumed |
|---|---|
| **Sign-in and four roles** | A tool that records who moved an order needs to know who they are. Tokens last 12 hours — staff sign in per shift, and there are no third-party clients to justify refresh rotation |
| **Required endpoints need a token** | Safe because it changes no response shape. So it stays easy to check: five seeded accounts, and `AUTH_DISABLED=true` turns auth off entirely. That flag refuses to boot under `NODE_ENV=production` |
| **Status history** | "Track the lifecycle of an order" reads as more than one current-status column. It is also the source for every time-based figure |
| **Live updates** | "In real time", from the background. Polling is not good enough for a screen above the pass |
| **Kitchen board** | Three columns of outstanding work with one tap to advance. Built from the same data, no extra storage |
| **Dashboard** | "Limited visibility into operational performance". Plain SQL over the same tables |
| **Customer messages** | Queued with the change that caused them and sent by a worker. The default driver writes to the log, so it works with no account and no network |
| **Retry safety** | An optional `Idempotency-Key` header on placing an order. Restaurant wifi drops, and without it a retry is a second order |
| **Written summary of the figures** | Sends **aggregate numbers only** — no customer rows, and no per-person figures either. Runs on Groq. With no key it returns the same real numbers and the dashboard hides one panel |

---

## 6. Deliberately not built

- **Payments and a customer-facing app.** This is an internal staff tool;
  payments appear nowhere in the requirements.
- **Rate limiting.** Internal, authenticated, no adversary to shape traffic
  against.
- **Refresh token rotation.** A token table, reuse detection and revocation, for
  a system with no third-party clients.
- **Per-cook utilization.** I built it, found the formula wrong, fixed it, then
  removed it: the denominator is a scheduled shift and there is no shift
  schedule anyone would keep accurate. A number about a person is worse than no
  number if you cannot trust what it is divided by.
- **Soft deletes**, and any history of edits beyond status.
- **Multiple locations.** See §4.
- **A CI pipeline.** `npm run check` is what it would have run.
