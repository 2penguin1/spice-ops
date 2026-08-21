# CLAUDE.md — Spice Garden Order Management System

Internal order management system for a casual-dining chain. Built as an
assignment deliverable; the brief is `docs/Assignment 1_Full Stack Developer Intern.docx`.

| Doc | What it answers |
|---|---|
| `docs/plan.md` | decisions, data model, subsystems, build order |
| `docs/api-contract.md` | the graded endpoint spec — **the implementation target** |
| `docs/hld.md` | scale numbers, topology, failure modes, scaling path, trade-offs |
| `docs/lld.md` | module map, sequences, transaction boundaries, algorithms, tests |
| `questions.md` | every assumption and open question |

## Skills — use these, do not improvise

Route the work through the right skill before starting. These are installed and
available; not using them is how this codebase drifts.

| When you are… | Use | Why |
|---|---|---|
| Writing, changing, or refactoring **any** code | **`ponytail`** (persistent, already active) | The ladder: does it need to exist → is it already here → stdlib → native → existing dep → one line. Smallest thing that works. |
| Touching Hono routing, middleware, validators, testing, streaming | **`hono`** skill | Written by Hono's author. Do not guess the middleware or `zValidator` API from memory. Ships `npx hono request` for hitting endpoints without a server. |
| Unsure of any library API — Drizzle, Zod, `jose`, BullMQ, `ioredis`, Recharts | **`context7` MCP** (`query-docs`) | Fetches current docs. Guessing a Drizzle or Zod signature from memory is the most likely way to waste an hour. |
| Finishing a phase | **`ponytail-review`**, then **`code-review`** | Two different jobs. The first hunts complexity, the second hunts bugs. Run both — neither covers the other. |
| Building or reshaping UI | **`frontend-design`** | Keeps the app from looking like a bootstrapped template. |
| Writing **any** chart on the dashboard | **`dataviz`** — *before* the first line of chart code | Colour, axes, and stat tiles as one system. Retrofitting this is painful. |
| Explaining anything back to the user | **`plain-answer`** | Short sentences, plain words, tables over prose. |
| Writing `readme.md` or docs | **`documentation-writer`** | Diátaxis: tutorial / how-to / reference / explanation are different documents. |
| Writing browser tests | **`playwright-tester`** | |

## The system has two layers. Know which one you are editing.

**Layer 1 — the contract.** `/customers` and `/orders`, exactly as the brief
specifies. This is what gets graded.

**Layer 2 — the platform.** `/auth`, `/staff`, `/analytics`, `/events`,
`/metrics`, plus the event log, queue, and cache behind them.

> **No layer-2 feature may alter a layer-1 request or response shape.**

If a change to auth, analytics, SSE, or the queue would add a field to
`OrderDetail`, change a status code, or introduce a new error code on a
contract route — it is the wrong change. Find another way.

## Non-negotiable: the API contract wins

`docs/api-contract.md` is the source of truth for every contract endpoint,
payload, field name, and error code. It is transcribed from the brief.

- Never rename, add, or drop a field in a layer-1 response. `camelCase` everywhere.
- Every success response is wrapped: `{ "data": T }`, plus
  `"meta": { "pagination": {...} }` only on list endpoints.
- Every error response is exactly `{ "error": { "code": "...", "message": "..." } }`.
- Layer-1 error codes are only: `VALIDATION_FAILED`, `INVALID_FILTER`,
  `RESOURCE_NOT_FOUND`, `RESOURCE_ALREADY_EXISTS`, `INVALID_STATUS_TRANSITION`.
  Do not invent new ones there. `UNAUTHORIZED` and `FORBIDDEN` exist for layer 2.
- `assignedStaffId` is a database column. It **never** appears in an order
  response.
- If the brief is silent, pick the sane default, implement it, and write the
  assumption into `questions.md`. Do not stall.

## Every extension degrades

The app must run correctly with nothing but Postgres. No exceptions.

| Missing | Behaviour |
|---|---|
| Redis | in-memory event bus, no cache, queue jobs run inline after the response |
| `ANTHROPIC_API_KEY` | analytics returns real numbers with `narrative: null`; the UI hides the commentary panel |
| Twilio credentials | `NOTIFY_DRIVER=console` logs the message |

A missing optional dependency logs one warning at boot and nothing else. It
never throws, and it never degrades a layer-1 response.

## Stack

| Layer | Choice |
|---|---|
| Backend | Hono + Zod (`@hono/zod-validator`), TypeScript, Node 24 |
| DB | PostgreSQL 18, Drizzle ORM |
| Auth | `jose` (JWT, HS256), `@node-rs/argon2` |
| Cache / pub-sub / queue | Redis 7 via `ioredis`, BullMQ |
| Frontend | React + Vite + TypeScript, React Router, Recharts |
| Tests | `node:test` + a curl smoke script. No Jest, no Vitest. |

## Layout

```
backend/    Hono API      — src/routes (layer 1 and 2 split by file), src/lib, src/services, src/queues
frontend/   React SPA     — src/pages, src/api, src/hooks
database/   schema.sql, seed.sql, migrations/  (generated — see below)
docs/       plan.md, api-contract.md, the brief
```

## Rules that bite

- **`backend/src/db/schema.ts` is the only schema source of truth.**
  `database/schema.sql` and `database/migrations/` are generated by
  `drizzle-kit`. Never hand-edit them; change the TS and regenerate.
- **Money is `numeric(10,2)`.** `pg` returns numeric as a *string*. Convert to
  `number` exactly once, in the serializer. Never float maths, never JS
  accumulation across rows, never `float`/`double` for money.
- **`totalAmount` and `itemCount` are derived, never stored.** No denormalised
  totals, no triggers keeping them in sync. `total_price` is a generated column.
- **Status changes go through one transaction helper** that updates the order,
  inserts the `order_status_events` row, and writes the notification outbox row
  together. Nothing changes a status any other way — the event log and the
  order can then never disagree, and it is the only place that emits SSE.
- **Transitions use a conditional UPDATE**, not a lock:
  `UPDATE orders SET status=$new WHERE id=$id AND status=$expected`.
  Zero rows affected is the conflict signal. No `SELECT … FOR UPDATE`, no
  version column.
- **Prep timestamps are derived from `order_status_events`**, not columns on
  `orders`.
- Validation happens at the edge with Zod, in the route definition. Handlers
  may assume their input is valid.
- Role checks are `requireRole(...)` middleware on the route, never `if` blocks
  inside handlers.
- The status machine lives only in `backend/src/lib/status.ts`.
- Timestamps are `timestamptz`, serialized as ISO-8601 UTC.

## Code standards — it has to be explainable out loud

**The bar: every file can be explained to another person in 60 seconds.** This
code gets walked through in an interview. Clever code that needs a paragraph of
defence has already failed, no matter how correct it is.

### Size and shape

- **Files ≤ 150 lines. Functions ≤ 30 lines, one job each.** Over the limit is a
  signal to split, not a rule to argue with.
- **Every route file has the same shape**, in this order: imports → Zod schemas →
  routes in the order `api-contract.md` lists them → export. Read one file, you
  can navigate all of them.
- Directory layout mirrors the request flow: `routes/` → `lib/` → `db/`.
  Dependencies point one way. `lib/` never imports from `routes/`.

### One concept, one home

If logic exists in two places, one of them is a bug waiting to happen.

| Concept | Its only home |
|---|---|
| Status transition rules | `lib/status.ts` |
| Every status write (order + event + outbox + SSE) | `lib/orders.tx.ts` |
| Error → code → HTTP mapping | `lib/errors.ts` |
| DB row → API shape | `lib/serialize.ts` |
| Shared Zod schemas (pagination, uuid, status) | `lib/validation.ts` |
| Table definitions | `db/schema.ts` |

**Before writing a helper, grep for it.** Re-implementing something that lives
two files over is the most common way this codebase would rot.

### Naming

- Name after the domain, not the mechanism: `transitionOrder`, not
  `handleUpdate`. `orderNumber`, not `num`.
- `camelCase` in TypeScript and JSON, `snake_case` in SQL. Drizzle maps between
  them in one place — `db/schema.ts`.
- Booleans read as assertions: `isActive`, `canTransition`.

### Boring over clever

Banned because they cost a reader time: nested ternaries, chained
optional-chaining puzzles, regex where `split` works, barrel `index.ts`
re-exports that hide where a thing lives, `any`, default exports.

- No abstraction with one implementation. No repository or service layer over
  Drizzle for plain CRUD — Drizzle *is* the data layer, routes call it
  directly. `services/` exists only for analytics SQL and the AI call.
- No dependency for what a few lines of stdlib or Postgres does.
- Prefer a DB constraint over app-level checking (unique phone, `quantity > 0`,
  FK integrity, the status enum). Let Postgres be the guard and map its error
  codes — catch `23505`, do not check-then-insert, which races.
- Comments explain **why**. The *what* is the code's job. Deliberate shortcuts
  get a `ponytail:` comment naming the ceiling and the upgrade path.

### Patterns in use — know their names

Every pattern here is standard and has a name. Being able to say the name is
half of explaining the code.

| Pattern | Where | In one sentence |
|---|---|---|
| Middleware pipeline | `index.ts` | Each layer either rejects or enriches, then passes on |
| State machine | `lib/status.ts` | A fixed set of states and the legal moves between them |
| Optimistic concurrency (compare-and-set) | every status write | Put the expected state in the `WHERE`; 0 rows means someone beat you |
| Transactional outbox | `notifications` | Write the intent to send in the same transaction as the change |
| Strategy | `NotificationDriver` | Same interface, swappable implementation (`console` / `twilio`) |
| Publish–subscribe | SSE + Redis | One publisher, many listeners, no direct coupling |
| Idempotency key | `POST /orders` | A client-supplied key makes a retry safe |
| Data mapper | `lib/serialize.ts` | Database rows and API shapes are separate types, mapped explicitly |
| Response envelope | `ApiResponse<T>` | Every response has the same outer shape |

### Before you call a file done

1. Could a teammate explain this file after reading it once?
2. Does anything here already exist elsewhere in the repo?
3. Is there a shorter version that is equally clear? (Shorter, not denser.)
4. Would you be comfortable being asked "why did you write it this way?"

## Don't ship a number you can't defend

Analytics go in front of a manager making decisions about people. Utilization
is the **union** of a cook's prep intervals (`range_agg`), never the sum —
overlapping orders would otherwise read above 100%. Any metric about a person
is labelled with what it literally measures, not what it implies. If a metric
cannot be computed honestly, leave it out.

## Commands

*Available from phase 0 onward — nothing is scaffolded yet.*

```bash
docker compose up -d                    # postgres + redis
docker compose --profile full up        # everything, one command
cd backend  && npm run dev              # API on :3000
cd frontend && npm run dev              # SPA on :5173
cd backend  && npm run db:generate && npm run db:migrate && npm run db:seed
cd backend  && npm run token -- manager # print a JWT for curl
cd backend  && npm run check            # typecheck + test
```

## Definition of done for any change

1. `npm run check` passes in the package you touched.
2. The layer-1 contract shape is unchanged — and if you touched anything in
   phases 11–16, **re-run the smoke script** to prove it.
3. New non-trivial logic left one runnable assertion behind.
4. Anything optional you depended on still degrades per the table above.
5. Any new assumption is in `questions.md`.
6. **You could explain every line you wrote, out loud, without notes.** If a
   line needs a paragraph to justify, rewrite the line.
