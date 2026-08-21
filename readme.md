# Spice Garden — Order Management System

An internal tool for a restaurant chain. Waiters take orders, the kitchen cooks
them, managers watch the numbers.

**TypeScript · Hono · Zod · Drizzle · PostgreSQL 18 · React 19 · Vite**

---

## Contents

- [What it does](#what-it-does)
- [How it fits together](#how-it-fits-together)
- [Run it](#run-it)
- [Sign in](#sign-in)
- [Check that it works](#check-that-it-works)
- [The data model](#the-data-model)
- [The order lifecycle](#the-order-lifecycle)
- [Placing an order](#placing-an-order)
- [API](#api)
- [Who can do what](#who-can-do-what)
- [Decisions worth explaining](#decisions-worth-explaining)
- [Configuration](#configuration)
- [Commands](#commands)
- [Project layout](#project-layout)
- [Troubleshooting](#troubleshooting)
- [Deploying](#deploying)

---

## What it does

| Screen | Path | What happens there |
|---|---|---|
| **Orders** | `/orders` | Search by order number, customer name or phone. Filter by status. Filters live in the URL, so a view can be shared. |
| **Order** | `/orders/:id` | One order as a kitchen ticket. Move it on, add or remove items, see its full history. |
| **Take an order** | `/orders/new` | Pick dishes, then attach an existing customer or add a new one. |
| **Kitchen** | `/kitchen` | Live board: waiting, cooking, ready. One tap to advance. Updates on its own when anyone changes an order. |
| **Dashboard** | `/dashboard` | Revenue, order volume, service pattern, status mix, per-cook speed, top dishes. Managers and admins only. |
| **Customers** | `/customers` | Search, add, edit, delete. |

Three things run underneath the screens:

- **A live event stream.** Any change is pushed to every open screen, so a cook
  marking food ready updates the waiter's list without a refresh.
- **A status history.** Every move is recorded with who made it. All the
  time-based numbers are read from it.
- **Customer messages.** Queued in the same transaction as the change that
  caused them, then sent by a worker.

---

## How it fits together

```mermaid
flowchart LR
    subgraph Browser
        UI["React SPA<br/>Orders · Kitchen · Dashboard"]
    end

    subgraph Server["API — stateless, runs as N copies"]
        API["Hono<br/>auth → validate → route"]
        WORKER["Worker<br/>drains the outbox"]
    end

    subgraph Data
        PG[("PostgreSQL<br/>the source of truth")]
        REDIS[("Redis<br/>optional")]
    end

    UI -- "HTTPS + JWT" --> API
    API -. "server-sent events" .-> UI
    API --> PG
    WORKER --> PG
    API <-- "cache + fan-out" --> REDIS
    WORKER -- "console or webhook" --> OUT["Customer"]

    style REDIS stroke-dasharray: 5 5
```

- **Postgres holds everything that matters.** Nothing else is trusted.
- **The API keeps no state**, so it can run as several copies behind a load
  balancer.
- **Redis is optional.** It caches dashboard figures and carries events between
  API copies. Without it the app still works — one warning at startup, and live
  updates reach only the screens connected to the same copy.

---

## Run it

You need **Node 22.9+** and **Docker**. Check with `node --version` and
`docker --version`.

### 1. Start Postgres and Redis

```bash
docker compose up -d
docker compose ps        # wait for both to report healthy
```

> Postgres uses port **5432** and Redis **6379**. If either is already taken,
> see [Troubleshooting](#troubleshooting) — this is the most common snag.

### 2. Start the API

```bash
cd backend
npm install
cp .env.example .env       # Windows: copy .env.example .env
npm run db:migrate         # create the tables
npm run db:seed            # 5 staff, 8 customers, 40 orders
npm run dev                # http://localhost:3000
```

Leave it running. Open a second terminal.

### 3. Start the web app

```bash
cd frontend
npm install
cp .env.example .env       # Windows: copy .env.example .env
npm run dev                # http://localhost:5173
```

### 4. Open <http://localhost:5173>

Allow about five minutes the first time, mostly pulling the Postgres image.

---

## Sign in

Five seeded accounts. The password is `spice123` for all of them.

| Role | Email | What they see |
|---|---|---|
| **Manager** | `manager@spice.test` | Everything. Start here. |
| **Admin** | `admin@spice.test` | Everything, plus staff management. |
| **Kitchen** | `cook@spice.test` | Kitchen board and orders. No customers, no order taking, cannot cancel. |
| **Kitchen** | `cook2@spice.test` | A second cook, so the dashboard has two to compare. |
| **Service** | `server@spice.test` | Takes orders and completes them. Cannot cancel. |

Each role sees a different set of controls.

---

## Check that it works

### The whole API, one command

With the API running:

```bash
cd backend
npm run smoke
```

It signs in as each role, walks an order through its whole life, and tries every
documented error case. It ends with a pass count and `Contract intact.`

It also works with authentication switched off — it detects that and skips the
role checks rather than reporting false failures.

### Types and unit tests

```bash
cd backend
npm run check      # typecheck + unit tests, no database needed
```

### By hand

`/health` is open. Everything else needs a token:

```bash
curl http://localhost:3000/health

TOKEN=$(curl -s -X POST http://localhost:3000/auth/login \
  -H 'content-type: application/json' \
  -d '{"email":"manager@spice.test","password":"spice123"}' \
  | grep -o '"token":"[^"]*"' | cut -d'"' -f4)

curl -H "Authorization: Bearer $TOKEN" "http://localhost:3000/orders?status=READY&size=2"
```

**To test without tokens**, set `AUTH_DISABLED=true` in `backend/.env` and
restart. Every route then accepts anonymous requests. The server refuses to
start with that flag when `NODE_ENV=production`, and warns on every boot.

---

## The data model

```mermaid
erDiagram
    CUSTOMERS ||--o{ ORDERS : places
    ORDERS ||--o{ ORDER_ITEMS : contains
    ORDERS ||--o{ ORDER_STATUS_EVENTS : logs
    ORDERS ||--o{ NOTIFICATIONS : triggers
    STAFF ||--o{ ORDER_STATUS_EVENTS : "made by"

    CUSTOMERS {
        uuid id PK
        text name
        text email "nullable"
        text phone UK
    }
    ORDERS {
        uuid id PK
        text order_number UK "ORD-000042"
        uuid customer_id FK
        enum status
    }
    ORDER_ITEMS {
        uuid id PK
        uuid order_id FK
        text item_name
        int quantity "CHECK > 0"
        numeric unit_price
        numeric total_price "GENERATED"
    }
    ORDER_STATUS_EVENTS {
        uuid id PK
        uuid order_id FK
        uuid staff_id FK "nullable"
        enum from_status "null when placed"
        enum to_status
    }
    STAFF {
        uuid id PK
        text email UK
        text password_hash
        enum role
    }
    NOTIFICATIONS {
        uuid id PK
        uuid order_id FK
        text status "PENDING/SENDING/SENT/FAILED"
        int attempts
    }
```

A seventh table, `idempotency_keys`, stores the response to a request so a retry
can replay it instead of creating a second order.

**Two things are deliberately not columns:**

- **An order's total.** It is summed from the items when the order is read.
  Items change on two endpoints, so a stored total would have two chances to
  drift. A sum has none.
- **Prep timestamps.** They come from the status history. Five status columns
  would be five things to keep in step.

---

## The order lifecycle

```mermaid
stateDiagram-v2
    [*] --> CONFIRMED : order placed
    CONFIRMED --> PREPARING : kitchen starts
    PREPARING --> READY : kitchen finishes
    READY --> COMPLETED : handed over
    CONFIRMED --> CANCELLED
    PREPARING --> CANCELLED
    READY --> CANCELLED
    COMPLETED --> [*]
    CANCELLED --> [*]
```

- No skipping a step, no going back.
- `COMPLETED` and `CANCELLED` are final.
- Setting the status an order already has succeeds and changes nothing — a
  double-tap in a busy kitchen should not be an error.
- Anything else returns `409 INVALID_STATUS_TRANSITION`.

---

## Placing an order

```mermaid
sequenceDiagram
    autonumber
    participant S as Staff
    participant API
    participant DB as PostgreSQL
    participant W as Worker

    S->>API: POST /orders (Idempotency-Key)
    API->>DB: has this key been used?
    alt already used
        DB-->>API: the stored response
        API-->>S: 201 — same order, no duplicate
    else new request
        API->>DB: BEGIN
        API->>DB: take the key
        API->>DB: find or create the customer
        API->>DB: insert the order and its items
        API->>DB: insert the status event
        API->>DB: queue the customer message
        API->>DB: store the response
        API->>DB: COMMIT
        API-->>S: 201 order
        API->>API: announce on the event stream
        W->>DB: claim the queued message
        W->>W: send it, then mark it sent
    end
```

Everything that must be all-or-nothing sits inside the transaction. Everything
that can be retried sits outside it.

---

## API

Base URL `http://localhost:3000`. Full detail in
[`docs/api-contract.md`](docs/api-contract.md).

### Orders and customers

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/customers` | List, with `search`, `page`, `size` |
| `POST` | `/customers` | Create |
| `PATCH` | `/customers/{id}` | Update; every field optional |
| `DELETE` | `/customers/{id}` | Delete, and their orders with them |
| `GET` | `/orders` | List, with `search`, `status`, `customerId`, `page`, `size` |
| `GET` | `/orders/{id}` | One order with its customer and items |
| `POST` | `/orders` | Create; accepts an optional `Idempotency-Key` header |
| `PATCH` | `/orders/{id}/status` | Move the order on |
| `POST` | `/orders/{id}/items` | Add an item, returns the whole order |
| `DELETE` | `/orders/{id}/items/{itemId}` | Remove an item, returns the whole order |

### Everything else

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/auth/login` | Email and password for a 12 hour token |
| `GET` | `/auth/me` | Who the current token belongs to |
| `GET` | `/orders/{id}/timeline` | Every status the order has been through |
| `GET` `POST` `PATCH` `DELETE` | `/staff`, `/staff/{id}` | Staff management |
| `GET` | `/analytics/summary` | Revenue, counts, status mix, cancellation rate, average prep |
| `GET` | `/analytics/daily?days=` | Orders and revenue per day |
| `GET` | `/analytics/hours` | Orders by hour of day |
| `GET` | `/analytics/staff` | Orders started and finished per person, and how long they took |
| `GET` | `/analytics/items` | Best selling dishes |
| `GET` | `/analytics/insights` | A written read of the figures, if an AI key is set |
| `POST` | `/events/ticket` | A 60 second ticket for the event stream |
| `GET` | `/events?ticket=` | Server-sent events; announces order changes |
| `GET` | `/notifications?orderId=` | What was sent to customers, and whether it worked |
| `GET` | `/health` | Liveness, and whether the database is reachable |

### Shape of every response

Success:

```json
{
  "data": {},
  "meta": { "pagination": { "page": 1, "size": 20, "total": 40, "totalPages": 2 } }
}
```

`meta` appears on list endpoints only. Failure is always:

```json
{ "error": { "code": "RESOURCE_NOT_FOUND", "message": "Order not found" } }
```

| Code | HTTP |
|---|---|
| `VALIDATION_FAILED`, `INVALID_FILTER` | 400 |
| `UNAUTHORIZED` | 401 |
| `FORBIDDEN` | 403 |
| `RESOURCE_NOT_FOUND` | 404 |
| `RESOURCE_ALREADY_EXISTS`, `INVALID_STATUS_TRANSITION` | 409 |
| `INTERNAL_ERROR` | 500 |

---

## Who can do what

Anyone signed in can read. These are the actions:

| Action | Admin | Manager | Service | Kitchen |
|---|:--:|:--:|:--:|:--:|
| Take an order, add or remove items | ✓ | ✓ | ✓ | — |
| Start prep, mark ready | ✓ | ✓ | — | ✓ |
| Complete an order | ✓ | ✓ | ✓ | — |
| Cancel an order | ✓ | ✓ | — | — |
| Add or edit a customer | ✓ | ✓ | ✓ | — |
| Delete a customer | ✓ | ✓ | — | — |
| See the dashboard | ✓ | ✓ | — | — |
| Manage staff | ✓ | ✓ (not delete) | — | — |
| Set anyone's role | ✓ | — | — | — |

The last active admin cannot be deleted, demoted or deactivated.

---

## Decisions worth explaining

Where the obvious approach and the one I picked differ.

**Status changes need no lock.** The expected status goes in the `WHERE` clause:

```sql
UPDATE orders SET status='PREPARING' WHERE id=$1 AND status='CONFIRMED'
```

Zero rows changed means somebody moved it first. That *is* the conflict
detection — no `SELECT … FOR UPDATE`, no version column, nothing held across a
round trip. Twelve simultaneous requests with two conflicting targets produce
one winner and eleven definite answers.

**Totals are summed, never stored.** The tempting version keeps `total_amount`
on the order and a trigger to maintain it. Items change on two endpoints, so
every path has to remember. A `SUM()` cannot forget.

**Never check-then-insert for uniqueness.** A `SELECT` to see whether a phone is
free, then an `INSERT`, is a race both requests win. The unique index is the
only honest check, so the code catches Postgres error `23505` instead.

**The status history is a table, not a column.** Each change writes a row in the
same transaction as the change itself, so the log cannot disagree with the
order. Prep time, throughput and the status mix all read from it.

**Customer messages go through an outbox.** The row is written with the change
that caused it. Sending inside the request would put an external service's
latency on the customer's response; queueing after the commit without a row
would lose the message if the process died in between.

**Idempotency uses the primary key as its lock.** The key and the order commit
together. A second request with the same key blocks on that key until the first
finishes, then reads and replays its response. Postgres does the waiting.

**Live updates send an id, not the order.** The browser refetches. That costs one
request and buys two things: permission checks stay on the fetch path, and the
response shape lives in one place.

**Analytics are cached; order lists are not.** Order lists change on every tap
and are already pushed live, so caching them would be all invalidation and no
benefit. Aggregates are the opposite — nobody decides anything on revenue that
is thirty seconds stale.

**One number I deleted.** I built a per-cook utilization percentage, found the
formula wrong, fixed it, then removed it. Its denominator is a scheduled shift,
and there is no shift schedule anyone would keep accurate. A number about a
person is worse than no number if you cannot trust what it is divided by. The
dashboard shows orders started, orders finished and average prep time instead.

**Everything optional degrades.** No Redis: in-memory events, no cache. No AI
key: real figures, no written summary. No webhook: messages go to the log. The
app runs correctly on Postgres alone.

---

## Configuration

**`backend/.env`** — copy from `.env.example`.

| Variable | Required | Default | Notes |
|---|---|---|---|
| `DATABASE_URL` | **yes** | — | Boot fails with a clear message if missing |
| `JWT_SECRET` | **yes** | — | Signs login tokens. Any long random string locally |
| `PORT` | no | `3000` | |
| `RESTAURANT_TZ` | no | `Asia/Kolkata` | Which day and hour a figure belongs to |
| `CORS_ORIGIN` | no | `http://localhost:5173` | The web app's origin |
| `REDIS_URL` | no | — | Absent: no cache, events stay within one API copy |
| `NOTIFY_DRIVER` | no | `console` | `console` logs customer messages, `webhook` posts them |
| `NOTIFY_WEBHOOK_URL` | no | — | Where the `webhook` driver posts |
| `GROQ_API_KEY` | no | — | Turns on the written read of the dashboard |
| `GROQ_MODEL` | no | `openai/gpt-oss-120b` | Any Groq chat model |
| `AUTH_DISABLED` | no | `false` | Refuses to boot under `NODE_ENV=production` |

**`frontend/.env`**

| Variable | Default | Notes |
|---|---|---|
| `VITE_API_URL` | `http://localhost:3000` | Read at **build** time, not runtime |

---

## Commands

From `backend/`:

| Command | What it does |
|---|---|
| `npm run dev` | API, reloading on change |
| `npm start` | API without watching |
| `npm run check` | Typecheck and unit tests |
| `npm test` | Unit tests only |
| `npm run smoke` | Full API check against a running server |
| `npm run db:migrate` | Apply migrations |
| `npm run db:seed` | Reset to the seed data |
| `npm run db:generate` | New migration after editing `src/db/schema.ts` |
| `npm run db:schema` | Rebuild `database/schema.sql` |

From `frontend/`:

| Command | What it does |
|---|---|
| `npm run dev` | Vite dev server |
| `npm run build` | Production build into `dist/` |
| `npm run preview` | Serve the production build |
| `npm run lint` | Lint |

---

## Project layout

```
spice-ops/
├── backend/
│   ├── src/
│   │   ├── db/           schema.ts is the only source of truth for tables
│   │   ├── lib/          errors, validation, status machine, auth, events,
│   │   │                 cache, notifications, idempotency, serializers
│   │   ├── routes/       customers, orders, auth, staff, analytics,
│   │   │                 events, notifications
│   │   ├── services/     analytics SQL and the AI call
│   │   ├── config.ts     environment, checked at boot
│   │   └── index.ts      app assembly and graceful shutdown
│   ├── scripts/          smoke.ts, build-schema.ts
│   ├── test/             node:test — status machine, serializers, validation
│   └── Dockerfile
├── frontend/src/
│   ├── api/              client and response types
│   ├── components/       status badge, pagination, errors, skeletons, timeline
│   ├── hooks/            useApi, useDebounced, useFilterParams, useOrderStream
│   ├── lib/              menu, formatting, auth context, permissions, status
│   └── pages/            Login, Orders, OrderDetail, NewOrder, Kitchen,
│                         Dashboard, Customers
├── database/
│   ├── schema.sql        full DDL (generated — do not edit by hand)
│   ├── seed.sql          deterministic seed data
│   └── migrations/       drizzle-kit output
├── docs/
│   ├── api-contract.md   the endpoint specification
│   └── architecture.md   design, scale, failure modes, trade-offs
├── questions.md          assumptions and open questions
└── docker-compose.yml
```

---

## Troubleshooting

**`docker compose up` fails: port is already allocated**

Something already uses 5432 or 6379, usually a locally installed Postgres or
Redis. Either stop it, or leave it running and move Docker. Create
`docker-compose.override.yml` (already gitignored):

```yaml
services:
  db:
    ports: !override ['5433:5432']
  redis:
    ports: !override ['6380:6379']
```

Then set `DATABASE_URL=postgres://spice:spice@localhost:5433/spice_oms` and
`REDIS_URL=redis://localhost:6380` in `backend/.env`.

**`Cannot reach the API` in the browser**

The API is not running, or `VITE_API_URL` points at the wrong port. Check with
`curl http://localhost:3000/health`, then restart the Vite server — it reads
that variable at startup.

**`DATABASE_URL is not set`**

`backend/.env` is missing. Run `cp .env.example .env` inside `backend/`.

**The API returns 503 with `"db": "down"`**

Postgres is unreachable. Check `docker compose ps`. The API stays up and
recovers by itself when the database comes back.

**Migrations fail with `relation already exists`**

Start clean:

```bash
docker compose down -v && docker compose up -d
cd backend && npm run db:migrate && npm run db:seed
```

**Using your own Postgres instead of Docker**

Any PostgreSQL 14+ works.

```sql
CREATE DATABASE spice_oms;
CREATE USER spice WITH PASSWORD 'spice';
GRANT ALL PRIVILEGES ON DATABASE spice_oms TO spice;
```

Point `DATABASE_URL` at it and run the migrate and seed commands. To skip
Drizzle entirely:

```bash
psql "$DATABASE_URL" -f database/schema.sql
psql "$DATABASE_URL" -f database/seed.sql
```

---

## Deploying

The API is a stateless container. It reads all configuration from the
environment, starts without a `.env` file, drains in-flight requests on
`SIGTERM`, and reports readiness at `/health`.

```bash
docker build -t spice-oms-backend ./backend
docker run -p 3000:3000 \
  -e DATABASE_URL=... -e JWT_SECRET=... -e CORS_ORIGIN=... \
  spice-oms-backend
```

- Managed Postgres works as-is; `?sslmode=require` in the connection string is
  honoured.
- Run `npm run db:migrate` as a release step, never on boot, so two copies
  starting together cannot race.
- The event stream holds a connection open, so the API needs a **container, not
  a serverless function**, and a load balancer idle timeout above 60 seconds.
- The frontend is a static build. Serve `frontend/dist` from any host or CDN.

---

## Read next

| Document | What it covers |
|---|---|
| [`questions.md`](questions.md) | Where the requirements were open to interpretation, what I chose, and the four questions I would put to the product owner |
| [`docs/architecture.md`](docs/architecture.md) | Scale figures, transaction boundaries, concurrency, failure modes, what breaks first, and the trade-offs behind each choice |
| [`docs/api-contract.md`](docs/api-contract.md) | Every endpoint in detail: inputs, outputs and failures |
