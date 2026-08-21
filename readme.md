# Spice Garden — Order Management System

An internal tool for a restaurant chain. Staff take orders, the kitchen moves
them through a lifecycle, and managers search, filter and follow them.

Built for the Full Stack Developer assignment. The API implements
[`docs/api-contract.md`](docs/api-contract.md) exactly; every assumption behind
it is written down in [`questions.md`](questions.md).

**TypeScript · Hono · Zod · Drizzle · PostgreSQL 18 · React 19 · Vite**

---

## Before you start

| You need | Why |
|---|---|
| **Node 22.9 or newer** | The API runs TypeScript directly, and uses `--env-file-if-exists` |
| **Docker** | Runs PostgreSQL. Skip it if you already have Postgres 14+ — see [Using your own Postgres](#using-your-own-postgres) |

Check with `node --version` and `docker --version`.

---

## Get it running

Four steps, about two minutes.

### 1. Start the database

```bash
docker compose up -d
```

Wait for both containers to report healthy:

```bash
docker compose ps
```

> Postgres publishes on **5432** and Redis on **6379**. If either port is
> already taken on your machine, see [Troubleshooting](#troubleshooting) — this
> is the most common snag.

Redis is optional. Nothing in the assignment scope uses it yet, and the API
runs correctly without it.

### 2. Set up the API

```bash
cd backend
npm install
cp .env.example .env      # Windows: copy .env.example .env
npm run db:migrate        # create the tables
npm run db:seed           # 8 customers, 40 orders, 100 items
npm run dev               # http://localhost:3000
```

Leave it running and open a second terminal.

### 3. Set up the web app

```bash
cd frontend
npm install
cp .env.example .env      # Windows: copy .env.example .env
npm run dev               # http://localhost:5173
```

### 4. Open it

**<http://localhost:5173>** — sign in with any of the four seeded accounts.

| Sign in as | Email | Password | Sees |
|---|---|---|---|
| **Manager** | `manager@spice.test` | `spice123` | everything — start here |
| **Kitchen** | `cook@spice.test` | `spice123` | starts prep, marks ready. No customers, no order taking |
| **Service** | `server@spice.test` | `spice123` | takes orders, completes them. Cannot cancel |
| **Admin** | `admin@spice.test` | `spice123` | everything, plus staff |

Signing in as each shows a different set of controls — that is the point of the
role model, and the quickest way to see it working.

You should see 40 seeded orders across all five statuses.

---

## Check that it works

### The whole contract, in one command

With the API running:

```bash
cd backend
npm run smoke
```

This signs in as each role, walks the full order lifecycle, and exercises every
error case the contract documents plus the role rules — 99 checks — then
deletes the data it created. It should end with:

```
99/99 checks passed
Contract intact.
```

### Unit tests and types

```bash
cd backend
npm run check             # typecheck + 26 tests, no database needed
```

### By hand

`/health` is open. Everything else needs a token:

```bash
curl http://localhost:3000/health

TOKEN=$(curl -s -X POST http://localhost:3000/auth/login -H 'content-type: application/json' -d '{"email":"manager@spice.test","password":"spice123"}' | grep -o '"token":"[^"]*"' | cut -d'"' -f4)

curl -H "Authorization: Bearer $TOKEN" "http://localhost:3000/orders?status=READY&size=2"
curl -H "Authorization: Bearer $TOKEN" http://localhost:3000/customers
```

**Checking the contract without tokens.** Set `AUTH_DISABLED=true` in
`backend/.env` and restart. Every route then accepts anonymous requests, so the
contract can be tested with plain `curl`. The server refuses to start with that
flag under `NODE_ENV=production`, and warns on every boot.

---

## What you are looking at

| Screen | Path | What it does |
|---|---|---|
| **Orders** | `/orders` | Search by order number, customer name or phone. Filter by status. Paginated. Filters live in the URL, so a filtered view can be shared. |
| **Order** | `/orders/:id` | The order as a kitchen ticket. Advance its status, add and remove items, see the customer. Only legal next moves are offered. |
| **Take an order** | `/orders/new` | Pick dishes from the menu, then either attach an existing customer or enter a new one. |
| **Customers** | `/customers` | Search, add, edit and delete. Hidden from the kitchen. |

Each order also shows its **history** — every status it has been through, when,
and which staff member moved it.

---

## Project structure

```
spice-ops/
├── backend/              Hono API
│   ├── src/
│   │   ├── db/           schema.ts is the single source of truth for tables
│   │   ├── lib/          errors, validation, status machine, auth, serializers
│   │   ├── routes/       customers.ts, orders.ts, auth.ts, staff.ts
│   │   ├── config.ts     environment, validated at boot
│   │   └── index.ts      app assembly and graceful shutdown
│   ├── scripts/          smoke.ts, build-schema.ts
│   └── test/             node:test, no framework
├── frontend/             React + Vite
│   └── src/
│       ├── api/          client and contract types
│       ├── components/   status, pagination, errors, skeletons
│       ├── hooks/        useApi, useDebounced
│       ├── lib/          menu, formatting, auth context, role hints
│       └── pages/        Login, Orders, OrderDetail, NewOrder, Customers
├── database/
│   ├── schema.sql        consolidated DDL (generated — do not hand-edit)
│   ├── seed.sql          deterministic seed data
│   └── migrations/       drizzle-kit output
├── docs/
│   ├── api-contract.md   the implementation target
│   ├── plan.md           decisions, data model, build order
│   ├── hld.md            scale, topology, failure modes, trade-offs
│   └── lld.md            module map, sequences, algorithms
├── questions.md          assumptions and open questions
└── CLAUDE.md             engineering conventions
```

---

## API

Base URL `http://localhost:3000`. Full detail in
[`docs/api-contract.md`](docs/api-contract.md).

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/customers` | List, with `search`, `page`, `size` |
| `POST` | `/customers` | Create |
| `PATCH` | `/customers/{id}` | Update; every field optional |
| `DELETE` | `/customers/{id}` | Delete (cascades to their orders) |
| `GET` | `/orders` | List, with `search`, `status`, `customerId`, `page`, `size` |
| `GET` | `/orders/{id}` | One order with its customer and items |
| `POST` | `/orders` | Create, attaching to a customer or making one |
| `PATCH` | `/orders/{id}/status` | Advance the lifecycle |
| `POST` | `/orders/{id}/items` | Add an item, returns the whole order |
| `DELETE` | `/orders/{id}/items/{itemId}` | Remove an item, returns the whole order |
| `GET` | `/health` | Liveness and database reachability |

Beyond the assignment contract:

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/auth/login` | Exchange credentials for a 12 hour token |
| `GET` | `/auth/me` | The current token's owner |
| `GET` | `/orders/{id}/timeline` | Every status the order has been through, and who moved it |
| `GET/POST/PATCH/DELETE` | `/staff` | Staff management |

Every success is wrapped in `{ "data": … }`, with
`"meta": { "pagination": … }` on list endpoints. Every failure is
`{ "error": { "code": …, "message": … } }`.

### Who can do what

Reading is open to any signed-in role. These are the actions:

| Action | Admin | Manager | Service | Kitchen |
|---|:--:|:--:|:--:|:--:|
| Take an order, add or remove items | ✓ | ✓ | ✓ | — |
| Start prep, mark ready | ✓ | ✓ | — | ✓ |
| Complete an order | ✓ | ✓ | ✓ | — |
| Cancel an order | ✓ | ✓ | — | — |
| Add or edit a customer | ✓ | ✓ | ✓ | — |
| Delete a customer | ✓ | ✓ | — | — |
| Manage staff | ✓ | ✓ (no deleting) | — | — |

A refused action returns `403 FORBIDDEN`. A missing or expired token returns
`401 UNAUTHORIZED`. Neither appears on a contract route for a caller with a
valid token and the right role.

### Order lifecycle

```
CONFIRMED ──▶ PREPARING ──▶ READY ──▶ COMPLETED
     │             │           │
     └─────────────┴───────────┴──▶ CANCELLED
```

`COMPLETED` and `CANCELLED` are final. Setting the status an order already has
succeeds and changes nothing. Anything else returns
`409 INVALID_STATUS_TRANSITION`.

---

## Commands

Run from `backend/`:

| Command | What it does |
|---|---|
| `npm run dev` | API with reload on change |
| `npm start` | API without watching |
| `npm run check` | Typecheck and unit tests |
| `npm test` | Unit tests only |
| `npm run smoke` | Contract test against a running API |
| `npm run db:migrate` | Apply migrations |
| `npm run db:seed` | Reset to the seed data |
| `npm run db:generate` | Generate a migration after editing `src/db/schema.ts` |
| `npm run db:schema` | Rebuild `database/schema.sql` |

Run from `frontend/`:

| Command | What it does |
|---|---|
| `npm run dev` | Vite dev server |
| `npm run build` | Production build into `dist/` |
| `npm run preview` | Serve the production build |
| `npm run lint` | Lint |

---

## Configuration

**`backend/.env`** — copy from `.env.example`.

| Variable | Required | Default | Notes |
|---|---|---|---|
| `DATABASE_URL` | **yes** | — | Boot fails with a clear message if missing |
| `JWT_SECRET` | **yes** | — | Signs the login tokens. Any long random string locally |
| `PORT` | no | `3000` | |
| `CORS_ORIGIN` | no | `http://localhost:5173` | The web app's origin |
| `REDIS_URL` | no | — | Absent: no cache, one warning at boot |
| `AUTH_DISABLED` | no | `false` | Refuses to boot under `NODE_ENV=production` |

**`frontend/.env`**

| Variable | Default | Notes |
|---|---|---|
| `VITE_API_URL` | `http://localhost:3000` | Read at **build** time, not runtime |

---

## Troubleshooting

**`docker compose up` fails: port is already allocated**

Something already uses 5432 or 6379 — often a locally installed Postgres or
Redis. Either stop that service, or leave it running and point Docker
elsewhere. Create `docker-compose.override.yml` (already gitignored):

```yaml
services:
  db:
    ports: !override ['5433:5432']
  redis:
    ports: !override ['6380:6379']
```

Then set `DATABASE_URL=postgres://spice:spice@localhost:5433/spice_oms` in
`backend/.env`.

**`Cannot reach the API` in the browser**

The API is not running, or `VITE_API_URL` does not match its port. Confirm with
`curl http://localhost:3000/health`, then restart the Vite server — it reads
that variable at startup.

**`DATABASE_URL is not set`**

`backend/.env` is missing. Run `cp .env.example .env` inside `backend/`.

**The API returns 503 with `"db": "down"`**

Postgres is not reachable. Check `docker compose ps`. The API stays up and
recovers by itself once the database returns.

**Migrations fail with `relation already exists`**

The database has tables from an earlier run. Start clean:

```bash
docker compose down -v && docker compose up -d
cd backend && npm run db:migrate && npm run db:seed
```

---

## Using your own Postgres

Docker is only a convenience. Any PostgreSQL 14 or newer works — the schema
uses `gen_random_uuid()`, generated columns, and enums, all built in.

```sql
CREATE DATABASE spice_oms;
CREATE USER spice WITH PASSWORD 'spice';
GRANT ALL PRIVILEGES ON DATABASE spice_oms TO spice;
```

Point `DATABASE_URL` at it and run `npm run db:migrate && npm run db:seed`.

To apply the schema without Drizzle:

```bash
psql "$DATABASE_URL" -f database/schema.sql
psql "$DATABASE_URL" -f database/seed.sql
```

---

## Deploying

The API is a stateless container. It reads all configuration from the
environment, boots without a `.env` file, handles `SIGTERM` by draining
in-flight requests, and reports readiness at `/health`.

```bash
docker build -t spice-oms-backend ./backend
docker run -p 3000:3000 \
  -e DATABASE_URL=... -e JWT_SECRET=... -e CORS_ORIGIN=... \
  spice-oms-backend
```

Managed Postgres works as-is — `?sslmode=require` in the connection string is
honoured. Run `npm run db:migrate` as a release step, never on boot, so two
instances starting together cannot race.

The frontend is a static build; serve `frontend/dist` from any host or CDN.

---

## Reading further

| Document | What it answers |
|---|---|
| [`questions.md`](questions.md) | Every assumption, and the four questions I would ask |
| [`docs/api-contract.md`](docs/api-contract.md) | The endpoint specification |
| [`docs/plan.md`](docs/plan.md) | Stack decisions, data model, build order |
| [`docs/hld.md`](docs/hld.md) | Scale figures, failure modes, trade-offs |
| [`docs/lld.md`](docs/lld.md) | Module map, sequences, algorithms |
