import io

def edit(path, pairs):
    s = io.open(path, encoding='utf8').read()
    for old, new in pairs:
        if old not in s:
            raise SystemExit('NOT FOUND in %s:\n---\n%s\n---' % (path, old[:220]))
        s = s.replace(old, new, 1)
    io.open(path, 'w', encoding='utf8', newline='\n').write(s)
    print('  ', path)


edit('src/config.ts', [
    ("  // Optional. Each of these degrades to a working fallback — see CLAUDE.md.",
     "  // Optional. Each has a working fallback when it is missing."),
])

edit('src/lib/auth.ts', [
    ("""/**
 * scrypt from node:crypto — memory-hard, salted per user, and part of the
 * standard library. argon2id is marginally stronger but needs a compiled
 * native module, which is a poor trade for a project that must install
 * cleanly on any machine.
 *
 * Stored as `scrypt$<salt>$<hash>` so the parameters travel with the hash.
 */""",
     """/** Stored as `scrypt$<salt>$<hash>`, so the parameters travel with the hash. */"""),
    ("""/**
 * No revocation list. A token is valid for 12 hours, so deactivating someone
 * stops them logging in again but does not end a session already in progress.
 * Acceptable for an internal tool where staff sign in per shift; the upgrade
 * path is a Redis set of revoked ids checked here — see docs/hld.md §9.
 */""",
     """/**
 * There is no revocation list. Deactivating someone stops the next sign-in but
 * does not end a session already running, so a token is live for up to 12 hours
 * after that.
 */"""),
    ("""/**
 * A 60 second token scoped to the event stream only.
 *
 * EventSource cannot set headers, so the token has to travel in the URL, where
 * it lands in access logs. Scoping and expiry make that acceptable: this
 * ticket opens a stream that carries only order ids, and it is worthless a
 * minute later.
 */""",
     """/**
 * A 60 second token that works on the event stream and nowhere else.
 *
 * EventSource cannot set headers, so this has to travel in the URL where access
 * logs will keep it. Scoping and a short life are what make that survivable.
 */"""),
    ("""/**
 * Who may move an order to a given status.
 *
 * A plain requireRole cannot express this, because the answer depends on the
 * status being requested: the kitchen cooks, the floor delivers, and only a
 * manager cancels. Kept here with the other authorization rules rather than
 * as an `if` inside the route handler.
 */""",
     """/**
 * Who may move an order to a given status. requireRole cannot express this on
 * its own, because the answer depends on which status is being asked for.
 */"""),
    ("""  // One message for both cases, so the response cannot be used to discover
  // which email addresses exist.""",
     """  // Same message either way, so a caller cannot use it to find out which
  // addresses have accounts."""),
])

edit('src/lib/errors.ts', [
    ("""/**
 * Every error code the API can return, and the HTTP status it maps to.
 * The brief names the codes but not the statuses — see questions.md §3.
 *
 * The first five are the contract's. UNAUTHORIZED and FORBIDDEN belong to the
 * platform layer and never appear on a contract route for an authenticated
 * caller. INTERNAL_ERROR is the catch-all.
 */""",
     """/** Every error code the API returns, and the HTTP status each one maps to. */"""),
    ("""export class ApiError extends Error {
  // Declared and assigned explicitly rather than as a constructor parameter
  // property: Node's built-in TypeScript stripping rejects those, and keeping
  // this file runnable by plain `node` is what lets the tests need no compiler.
  readonly code: ErrorCode""",
     """export class ApiError extends Error {
  // Not a constructor parameter property: Node's type stripping rejects those,
  // and the tests run these files without a compiler.
  readonly code: ErrorCode"""),
    ("""/**
 * Messages for the database constraints we expect callers to hit. Letting
 * Postgres be the guard and mapping its error is the only race-free way to
 * check uniqueness — a SELECT before an INSERT lets two requests both pass.
 */""",
     """/**
 * Messages for the constraints callers actually hit. Catching the violation is
 * race-free; a SELECT before the INSERT lets two requests both pass.
 */"""),
    ("  // Bounded, so a self-referencing cause cannot spin forever.\n", ""),
    ("""/**
 * Translates a Postgres error into a contract error, or null if we do not
 * recognise it.
 *
 * Walks the `cause` chain because Drizzle wraps driver errors in its own
 * DrizzleQueryError, which carries no `code` of its own. Reading only the
 * outermost error turns every constraint violation into a 500.
 */""",
     """/**
 * Turns a Postgres error into an API error, or null if it is not one we know.
 *
 * Walks the cause chain: Drizzle wraps driver errors, and the wrapper carries
 * no error code, so reading only the outer error turns every constraint
 * violation into a 500.
 */"""),
])

edit('src/lib/serialize.ts', [
    ("""// ─── Contract response shapes ────────────────────────────────────────────────
// These mirror docs/api-contract.md exactly. Adding a field here changes the
// contract, so do not add one without changing that document first.""",
     """// ─── Response shapes ─────────────────────────────────────────────────────────
// What the API returns. Adding a field here changes the public API."""),
    ("""/**
 * node-postgres returns `numeric` as a string to avoid the precision loss of
 * a float. This is the one place it becomes a number.
 */
const toMoney = (value: string | null) => Number(value ?? 0)""",
     """/** node-postgres hands back `numeric` as a string. This is where it becomes a number. */
const toMoney = (value: string | null) => Number(value ?? 0)"""),
    ("""  // Summed in whole paise, then divided once. Adding 0.1 + 0.2 in floating
  // point gives 0.30000000000000004; adding 10 + 20 does not.""",
     """  // Whole paise, divided once at the end: 0.1 + 0.2 is 0.30000000000000004 in
  // floating point, 10 + 20 is not."""),
    ("    // itemCount is the total quantity, not the number of lines — questions.md §1.3.\n",
     "    // Total quantity, not the number of lines.\n"),
])

edit('src/lib/status.ts', [
    ("""/**
 * The order lifecycle. The brief names INVALID_STATUS_TRANSITION but not the
 * machine, so this is the assumed one — see questions.md §2.
 *
 *   CONFIRMED -> PREPARING -> READY -> COMPLETED
 *       |            |          |
 *       +------------+----------+---> CANCELLED
 *
 * COMPLETED and CANCELLED are terminal. No skipping forward, no going back.
 */""",
     """/**
 * The order lifecycle.
 *
 *   CONFIRMED -> PREPARING -> READY -> COMPLETED
 *       |            |          |
 *       +------------+----------+---> CANCELLED
 */"""),
    ("""/**
 * Setting the status an order already has is allowed and changes nothing.
 * A double-tap in a busy kitchen should not raise an error.
 */
export function isNoop(from: OrderStatus, to: OrderStatus): boolean {""",
     """export function isNoop(from: OrderStatus, to: OrderStatus): boolean {"""),
])

edit('src/lib/validation.ts', [
    ("""/**
 * Validation happens here, in the route definition, so handlers can assume
 * their input is already valid.
 *
 * The error code is a parameter because the contract uses different ones for
 * the same kind of failure: a bad body is VALIDATION_FAILED, a bad query
 * parameter is INVALID_FILTER, and a malformed path id means the resource
 * cannot exist, so it is RESOURCE_NOT_FOUND.
 */""",
     """/**
 * Validates at the route definition, so handlers can assume good input.
 *
 * The error code is a parameter because the same kind of failure has different
 * names depending on where it came from: a bad body is VALIDATION_FAILED, a bad
 * query parameter is INVALID_FILTER, and a malformed path id means the resource
 * cannot exist, so it is RESOURCE_NOT_FOUND.
 */"""),
    ("""/**
 * The `meta.pagination` block. A page past the end returns an empty array with
 * correct meta rather than a 404 — see questions.md §3.
 */""",
     """/** A page past the end returns an empty array with correct totals, not a 404. */"""),
])

edit('src/lib/cache.ts', [
    ("""/**
 * Caches the analytics aggregates, and nothing else.
 *
 * Order lists are deliberately not cached: they change on every status tap and
 * are already pushed live over the event stream, so a cache there would spend
 * all its effort on invalidation to make the app less current. Aggregates are
 * the opposite — nobody makes a decision on revenue that is 30 seconds stale.
 *
 * Without Redis every call simply runs the query. That is the whole fallback.
 */""",
     """/**
 * Caches the analytics aggregates. Nothing else is cached — order lists change
 * on every status tap and are already pushed live.
 *
 * Without Redis, every call just runs the query.
 */"""),
    ("""/**
 * Invalidation by version, not by deletion.
 *
 * Deleting keys by pattern is O(keyspace) and needs SCAN. Bumping a counter
 * that forms part of every key retires the whole set at once, and the old
 * entries expire on their own TTL.
 */""",
     """/**
 * Retires every cached key at once by bumping a counter that is part of each
 * key name. Deleting by pattern would need SCAN over the whole keyspace.
 */"""),
    ("""/**
 * Read every time, never remembered: a second API process bumps this key, and
 * a remembered value would keep serving what that process just invalidated.
 */""",
     """// Read every time. Remembering it would miss another process's invalidation."""),
])

edit('src/lib/notifications.ts', [
    ("""/**
 * Telling a customer their order is ready, without letting that get in the way
 * of the order itself.
 *
 * The pattern is a transactional outbox. The intent to send is written in the
 * same transaction as the status change, so a crash between committing the
 * change and dispatching the message cannot lose it. A loop drains the table
 * afterwards.
 *
 * There is no BullMQ. A queue earns its place by absorbing load and retrying
 * slow external calls — but the outbox is needed for correctness whatever else
 * we do, and draining it gives exactly those two properties. A job queue in
 * front of it would be a second queue doing the first one's work.
 */""",
     """/**
 * Customer messages, sent through a transactional outbox.
 *
 * The row goes in with the status change that caused it, so a crash between
 * committing the change and sending the message cannot lose it. This loop
 * drains the table afterwards and retries what fails.
 */"""),
    ("""// Not every step is worth a message. Nobody wants a text saying their food has
// started cooking.
""", "// Only the steps a customer cares about.\n"),
    ("""  /**
   * Posts to any URL — a Slack incoming webhook, an automation tool, or a real
   * SMS gateway's HTTP endpoint. A second implementation that can actually be
   * tested, unlike a Twilio driver nobody here has credentials for.
   */""",
     """  /** Posts to any URL: a Slack webhook, an automation tool, an SMS gateway. */"""),
    ("  /** The default. Demonstrable with no account, no key and no network. */",
     "  /** The default. Works with no account and no network. */"),
    ("""/**
 * Takes a batch of messages in one statement.
 *
 * SKIP LOCKED lets a second worker step over rows this one is already holding,
 * so two workers never send the same message and neither waits on the other.
 */""",
     """/**
 * Takes a batch in one statement. SKIP LOCKED lets a second worker step over
 * rows this one holds, so neither waits and no message is sent twice.
 */"""),
    ("      // Back to PENDING for another go, or FAILED with the reason recorded.\n", ""),
    ("""/**
 * Frees messages left in SENDING by a process that died mid-send.
 *
 * Compares claimed_at, not created_at: an old message being sent right now has
 * an old created_at, and resetting it would send the customer a second copy.
 */""",
     """/**
 * Frees messages stuck in SENDING by a process that died mid-send.
 *
 * Compares claimed_at, not created_at. An old message being sent right now has
 * an old created_at, and resetting it would send a second copy.
 */"""),
    ("""    // A slow provider can make one cycle outlast the interval. Without this
    // the cycles pile up and race each other over the same rows.""",
     """    // A slow provider can make a cycle outlast the interval, and overlapping
    // cycles race over the same rows."""),
    ("  // The drain alone must not hold the process open at shutdown.",
     "  // Must not hold the process open at shutdown."),
    ("/** Queues a message inside the caller's transaction. Never sends anything itself. */",
     "/** Queues a message in the caller's transaction. Sends nothing itself. */"),
])

edit('src/lib/idempotency.ts', [
    ("""/**
 * Makes a retried request safe.
 *
 * Restaurant wifi drops mid-request. The client cannot tell a lost response
 * from a lost request, so it retries — and without this that retry becomes a
 * second order for the same food.
 *
 * The mechanism is the unique primary key, not a lock or a Redis entry:
 *
 *   1. The key row is inserted inside the same transaction as the order, so
 *      the two commit together or not at all.
 *   2. A second request with the same key BLOCKS on that primary key until the
 *      first transaction finishes — Postgres does that for us, for exactly the
 *      right duration.
 *   3. It then fails with 23505, reads the stored response, and replays it.
 *
 * No polling, no state column, no distributed lock.
 */""",
     """/**
 * Makes a retried POST /orders safe, so a dropped connection does not become a
 * second order for the same food.
 *
 * The unique primary key does the work. The key row is written in the same
 * transaction as the order, so a concurrent retry blocks on it until that
 * transaction ends, then fails with 23505 and replays the stored response.
 */"""),
    ("""/**
  * True only for the unique violation on the key itself.
  *
  * Checks the constraint name, not just the SQLSTATE: a duplicate phone raises
  * the same 23505 from inside the same transaction, and treating that as a
  * replay would return someone else's order.
  */""",
     """/**
 * True only for a violation of the key itself. A duplicate phone raises the
 * same 23505, and treating that as a replay would return someone else's order.
 */"""),
    ("""/**
 * Postgres has no row expiry, so "TTL" is a delete. Run alongside the
 * notification drain rather than as its own schedule.
 */""",
     """/** Postgres has no row expiry, so old keys are deleted by the drain loop. */"""),
    ("""/**
 * Takes the key before any of the work happens.
 *
 * A concurrent request with the same key blocks here, on the primary key,
 * rather than after inserting a duplicate order and rolling it back.
 * statusCode 0 marks it as in progress until `recordResponse` fills it in.
 */""",
     """/**
 * Takes the key before the work starts, so a concurrent retry blocks here
 * instead of building a duplicate order first. statusCode 0 means in progress.
 */"""),
    ("""  // Same key, different request: the client has a bug, and replaying the old
  // response would hide it while quietly dropping the new order.""",
     """  // Same key, different request. Replaying would hide the caller's bug and
  // silently drop this order."""),
])

edit('src/db/client.ts', [
    ("""// Required, not optional: pg emits 'error' when an *idle* client drops — a
// database restart, a network blip — and an unhandled 'error' event on an
// EventEmitter terminates the process. Logging it lets the pool reconnect
// on the next query instead of taking the API down with it.""",
     """// pg emits 'error' when an idle client drops. Unhandled, that ends the
// process; handled, the pool just reconnects on the next query."""),
])

edit('src/db/schema.ts', [
    ("""    // Unique: this constraint is what produces RESOURCE_ALREADY_EXISTS. We catch
    // Postgres error 23505 rather than doing a check-then-insert that races.""",
     """    // Unique. The violation is what produces RESOURCE_ALREADY_EXISTS."""),
    ("""/**
 * Every status change an order has been through.
 *
 * Written in the SAME transaction as the change itself, so the log can never
 * disagree with the order it describes. This is the source for every
 * time-based metric — prep time, throughput, the funnel — which is why prep
 * timestamps are not duplicated onto `orders`.
 */""",
     """/**
 * Every status change an order has been through, written in the transaction
 * that made it. Prep time and throughput are read from here rather than kept
 * as extra columns on `orders`.
 */"""),
    ("""/**
 * The transactional outbox: what we intend to tell a customer.
 *
 * The row is written in the SAME transaction as the status change, so a
 * notification cannot be lost by a crash between committing the change and
 * telling anyone about it. A worker drains it afterwards.
 */""",
     """/** Messages waiting to be sent. Written with the change that caused them. */"""),
    ("""/**
 * Makes a retried request safe.
 *
 * In Postgres rather than Redis: the guarantee wanted is "exactly one order",
 * and the order lives here. Writing the key in the same transaction as the
 * order is what makes the two atomic — and the unique primary key is the lock,
 * so a second concurrent request with the same key blocks until the first
 * commits, then reads its stored response.
 */""",
     """/**
 * Replayed responses for retried requests. In Postgres, not Redis, so the key
 * and the order it protects commit together.
 */"""),
    ("""    // Null when the change was not made by a signed-in person — seeded history,
    // or a request made while AUTH_DISABLED is set. Set null rather than
    // deleted if the staff member is removed: the history stays true.""",
     """    // Null when nobody was signed in. Set null rather than deleted when a staff
    // member leaves, so the history stays intact."""),
    ("""    // Partial: the drain only ever looks for work, so the index only covers
    // rows that are work.""",
     """    // Partial: the drain only looks for pending rows."""),
    ("""    // scrypt from node:crypto, salted per user. Never a plaintext password.""",
     """    // scrypt, salted per user."""),
])

edit('src/lib/orders.tx.ts', [
    ("""/**
 * Records a status change in the log.
 *
 * Always called with the transaction that made the change, never on its own —
 * that is what makes it impossible for the log and the order to disagree.
 */""",
     """/** Records a status change. Always called with the transaction that made it. */"""),
    ("""/**
 * The only way an order's status changes.
 *
 * Routes call this rather than issuing their own UPDATE, so every transition
 * is checked, logged, and — from phase 13 — announced from one place.
 */""",
     """/**
 * The only way an order's status changes. Every transition is checked, logged,
 * queued for notification and announced from here.
 */"""),
    ("  // Setting the status it already has changes nothing and is not an error.\n",
     "  // A double-tap in a busy kitchen should not be an error.\n"),
    ("""    // The expected status sits in the WHERE clause, so this is atomic without
    // a lock: if another request moved the order first, zero rows match and we
    // report the conflict rather than overwriting their change.""",
     """    // The expected status is in the WHERE clause, so no lock is needed: if
    // someone moved it first, no rows match and we report the conflict."""),
    ("""    // Written with the change it describes, so a crash between committing and
    // dispatching cannot lose the message.""",
     """    // Queued in this transaction, so a crash cannot lose the message."""),
    ("""  // After the commit, never inside it: announcing a change that then rolled
  // back would tell every screen something untrue.""",
     """  // After the commit. Announcing a change that then rolled back would tell
  // every screen something untrue."""),
])

edit('src/lib/events.ts', [
    ("""/**
 * With one API process the in-memory bus is enough. With several behind a load
 * balancer, a client connected to instance A must still see a change made on
 * instance B — that is the only thing Redis is doing here.
 *
 * Absent, the bus still serves every client connected to this process.
 */""",
     """/**
 * With one API process the in-memory bus is enough. With several, a client
 * connected to one must still see a change made on another — that is all Redis
 * does here.
 */"""),
    ("""      // Redis delivers our own publish back to us; emitting it again would
      // send every client two copies of every change.""",
     """      // Redis echoes our own publish back; re-emitting would double every change."""),
    ("""/**
 * Announces that an order changed.
 *
 * Called from lib/orders.tx.ts *after* the transaction commits — never inside
 * it. Announcing a change that later rolls back would tell every screen
 * something untrue.
 */""",
     """/** Announces that an order changed. Only ever called after a commit. */"""),
    ("""// One listener per open SSE connection. The default cap of 10 would start
// printing leak warnings on the eleventh kitchen screen.""",
     """// One listener per open connection; the default cap of 10 is far too low."""),
    ("/** Long-lived streams keep the server open, so shutdown has to end them. */",
     "/** Streams stay open by design, so shutdown has to end them explicitly. */"),
])

edit('src/routes/events.ts', [
    ("""  /**
   * A short-lived ticket for the event stream.
   *
   * EventSource cannot send an Authorization header, and putting a 12 hour
   * session token in a URL would leave it in access logs and Referer headers.
   * This ticket lasts 60 seconds and is accepted on no other route.
   */""",
     """  /**
   * A 60 second ticket for the stream. EventSource cannot send an
   * Authorization header, and a 12 hour token in a URL would outlive the logs
   * it lands in.
   */"""),
    ("""        // The frame carries an id, not the order. The client refetches, which
        // keeps authorization on the fetch path and the response shape in one
        // place.""",
     """        // An id, not the order: the client refetches, which keeps authorization
        // on the fetch path."""),
    ("""      // Stay open until the client goes away. Returning from this callback
      // closes the stream, so it cannot be a long sleep: Node's setTimeout
      // overflows above 2^31-1 milliseconds and fires immediately, which would
      // hang up on every screen the moment it connected.""",
     """      // Returning from this callback closes the stream, so wait for the client
      // to go away instead."""),
    ("""        // Also the only cleanup point — without it every reconnect leaves its
        // listener and timer behind, a leak that grows for as long as the
        // process runs.""",
     """        // The only cleanup point: without it every reconnect leaks a listener."""),
    ("""// Proxies and load balancers close a connection that has been idle too long,
// often at 60 seconds. A comment every 25s keeps it open without meaning anything.""",
     """// Proxies drop idle connections, often at 60s."""),
])

edit('src/routes/notifications.ts', [
    ("""/**
 * What the system tried to tell customers, and whether it worked.
 *
 * An outbox nobody can inspect is an outbox nobody trusts: when a customer says
 * they were never told their food was ready, this is the answer.
 */""",
     """/** What was sent to customers, and whether it worked. */"""),
])

edit('src/services/analytics.service.ts', [
    ("""/**
 * Every number on the dashboard, as SQL over the tables we already have.
 *
 * There is no reporting store and no denormalised rollup: at this data size
 * (see docs/hld.md §2) aggregating live is both simpler and always correct.
 * The upgrade path, if it is ever needed, is an hourly rollup table fed by the
 * same event log — not a second copy of the truth.
 */""",
     """/**
 * Every number on the dashboard, read live from the same tables the app writes.
 * At this size there is no reason for a separate reporting store; an hourly
 * rollup off the event log is the next step if there ever is.
 */"""),
    ("""      -- Prep time comes from the event log, which is why those timestamps are
      -- not duplicated onto orders. Orders still cooking have no READY event
      -- and are excluded rather than counted as zero.""",
     """      -- Orders still cooking have no READY event, so they are excluded rather
      -- than counted as zero."""),
    ("""/**
 * Orders and revenue per day.
 *
 * generate_series supplies the days, so a day with no trade appears as a zero
 * rather than a gap the chart would draw straight through.
 */""",
     """/**
 * Orders and revenue per day. generate_series supplies the calendar, so a
 * closed day charts as zero instead of a gap drawn straight through.
 */"""),
    ("/** When the kitchen is busy. Every hour is present, so the shape is honest. */",
     "/** Orders by hour. All 24 are returned, so quiet hours show as zero. */"),
    ("""/**
 * Per-cook throughput and speed.
 *
 * Deliberately not a utilization percentage. That needs a scheduled-shift
 * denominator, and a metric about a person built on data nobody keeps accurate
 * is worse than no metric — see questions.md §3.7. These two numbers come
 * from what the system actually recorded.
 */""",
     """/**
 * What each person started and finished, and how long they took.
 *
 * Not a utilization percentage: that needs a shift schedule this system does
 * not keep, and a number about a person is worse than none if its denominator
 * is stale.
 */"""),
])

edit('src/services/ai.service.ts', [
    ("""/**
 * A plain-English read of the day's numbers.
 *
 * Two rules govern what goes in the prompt:
 *
 *  1. Aggregates only. No customer rows — no names, phones or emails ever
 *     leave the building.
 *  2. No per-person data. The per-cook table is on screen for the manager who
 *     is entitled to see it; sending an individual's performance to a
 *     third-party API is a different act, and not one the feature needs.
 *
 * And one rule governs the failure path: this never throws. Without a key, or
 * with the provider down, the endpoint returns the same real figures with
 * `narrative: null` and the dashboard hides one panel. A reviewer with no key
 * sees a working dashboard, not an error.
 */""",
     """/**
 * A plain-English read of the day's numbers.
 *
 * The prompt carries aggregates only — no customer rows, and no per-person
 * figures either. This never throws: with no key or a provider outage it
 * returns `narrative: null` and the dashboard hides one panel.
 */"""),
    ("""// Long enough for a slow response, short enough that a dashboard never hangs.""",
     """// A dashboard should never wait longer than this for commentary."""),
    ("/** Reduces the dashboard to the handful of facts worth reasoning about. */",
     "/** The handful of figures worth reasoning about. */"),
    ("""      // Most often finish_reason 'length': the model ran out of budget while
      // reasoning. Worth naming, because it is a configuration problem rather
      // than an outage.""",
     """      // Usually finish_reason 'length' — the model spent its budget reasoning.
      // Log it, because that is a setting to change, not an outage."""),
    ("""    // A timeout, a DNS failure, a provider outage — all the same to the caller.""",
     """    // Timeout, DNS, outage: all the same to the caller."""),
    ("""        // gpt-oss is a reasoning model: it spends tokens thinking before it
        // writes anything. At 300 the reasoning consumed the whole budget and
        // `content` came back empty. Low effort plus room for both.""",
     """        // A reasoning model spends tokens before writing anything, so the
        // budget has to cover both."""),
])

edit('src/routes/orders.ts', [
    ("""/**
 * Attaches the order to an existing customer, or creates one.
 *
 * When an id is given the other fields are ignored rather than applied as an
 * update — a typo at the counter must not overwrite a good record.
 *
 * When only details are given and the phone is already on file, we reuse that
 * customer. Taking an order should not fail because someone came back a second
 * time, and the contract lists no RESOURCE_ALREADY_EXISTS for order creation.
 * See questions.md §1.4.
 */""",
     """/**
 * Attaches the order to an existing customer, or creates one.
 *
 * With an id, the other fields are ignored: a typo at the counter must not
 * overwrite a good record. Without one, a phone already on file reuses that
 * customer, because taking an order should not fail for a returning diner.
 */"""),
    ("""// Reading is open to any signed-in role; the guards below cover the actions
// that change something.
""", "// Any signed-in role can read. The guards cover what changes something.\n"),
    ("""      // Who may make this move depends on the status being requested, so the
      // check lives with the other authorization rules, not in this handler.
""", ""),
    ("    // Optional. Absent, nothing about this endpoint changes.\n", ""),
    ("""  // Not validated as a uuid here: the contract's only listed error for this
  // parameter is RESOURCE_NOT_FOUND, and an id that cannot name a customer is
  // a customer that does not exist. Checked in the handler.""",
     """  // Checked in the handler, not here: an unusable id and an unknown customer
  // are the same answer, and a bare eq() on a malformed uuid raises 22P02."""),
    ("""  /** DELETE /orders/{order_id}/items/{item_id} — 200 with the order, not 204. */""",
     """  /** DELETE /orders/{order_id}/items/{item_id} — returns the order, not 204. */"""),
    ("""    // Scoped to the order as well as the item, so an item id from another
    // order cannot be deleted through this one.""",
     """    // Scoped to the order too, so an item id from another order is not deletable
    // through this one."""),
    ("""      // Loaded first so an unknown order is a 404 rather than a foreign key error.""",
     """      // Loaded first, so an unknown order is a 404 and not a foreign key error."""),
    ("""        // orderNumber breaks ties: without a unique tiebreaker, two orders
        // sharing a timestamp can repeat or vanish across page boundaries.""",
     """        // orderNumber breaks ties: two orders sharing a timestamp can otherwise
        // repeat or vanish across a page boundary."""),
    ("""      // numeric is passed as a string: sending a float would reintroduce
          // the precision loss the column type exists to avoid.""",
     """      // Passed as a string: a float here reintroduces exactly the
          // precision loss numeric exists to avoid."""),
])

edit('src/routes/customers.ts', [
    ("""  /**
   * DELETE /customers/{id} — 204, no body.
   *
   * The foreign key cascades, so this also removes the customer's orders. The
   * contract lists no conflict error for a customer who still has orders, which
   * forces that behaviour — it is the top open question in questions.md §1.1.
   */""",
     """  /**
   * DELETE /customers/{id} — 204, no body.
   *
   * Cascades to their orders. There is no error code for "still has orders",
   * so deleting a customer necessarily deletes their history.
   */"""),
    ("/** Drops keys the caller omitted, so PATCH updates only what was sent. */\n", ""),
    ("    // Two queries, both filtered the same way: the page, and how many there are.\n", ""),
    ("""/**
 * Escapes the LIKE wildcards so a customer searching for "50%" gets what they
 * asked for. Backslash is Postgres's default LIKE escape character.
 */""",
     """/** Escapes LIKE wildcards, so searching for "50%" finds "50%". */"""),
])

edit('src/index.ts', [
    ("// /health and /auth/login are the only routes reachable without a token.\n",
     "// /health, /auth/login and the event stream are reachable without a session\n// token; the stream carries its own short-lived ticket instead.\n"),
    ("""// The stream authenticates with a short-lived ticket in the query string,
// because EventSource cannot send an Authorization header.
""", ""),
    ("""/**
 * Every hosting platform stops a container by sending SIGTERM and killing it
 * shortly after. Without this, a deploy cuts requests that were mid-flight and
 * leaves database connections for the server to time out.
 *
 * Stop accepting new connections, let the open ones finish, close the pool.
 */""",
     """/**
 * Stop taking new connections, let the open ones finish, close the pool.
 * Without this a deploy cuts requests that were mid-flight.
 */"""),
    ("""  // If a request hangs, do not block the deploy for ever. unref() so this
  // timer alone never keeps the process alive.""",
     """  // A hung request must not block the deploy for ever."""),
    ("// Nothing this API accepts is large. Reject the rest before parsing it.",
     "// Nothing here is large. Reject the rest before parsing it."),
])

edit('scripts/smoke.ts', [
    ("""/**
 * Contract smoke test.
 *
 * Walks the full order lifecycle and every error case docs/api-contract.md
 * documents, against a running server and a real database.
 *
 * This is the gate for phases 11-16: any platform feature that changes a
 * contract response fails here. Run it before and after adding one.
 *
 *   npm run smoke                       (expects the API on :3000)
 *   SMOKE_URL=https://... npm run smoke
 *
 * Uses fetch and no dependencies, so it runs anywhere Node does — no curl,
 * no shell differences between Windows and Linux.
 */""",
     """/**
 * End-to-end check of the whole API against a running server and a real
 * database: every endpoint, every documented error, the role rules, the live
 * stream, and the retry behaviour.
 *
 *   npm run smoke                        (expects the API on :3000)
 *   SMOKE_URL=https://... npm run smoke
 *
 * Plain fetch and no dependencies, so it runs anywhere Node does.
 */"""),
])

edit('scripts/build-schema.ts', [
    ("""/**
 * Builds `database/schema.sql` — the consolidated DDL deliverable — by
 * concatenating the drizzle-kit migrations in order.
 *
 * Why not `pg_dump`: it needs a running database, emits psql-only directives,
 * and its output changes with the client version. The migrations are already
 * the exact statements we ship, so joining them has no dependencies at all.
 *
 * Generated file. Never edit it by hand — change `src/db/schema.ts` and run
 * `npm run db:generate && npm run db:schema`.
 */""",
     """/**
 * Builds database/schema.sql by joining the migrations in order.
 *
 * Not pg_dump: that needs a live database and emits psql-only directives.
 *
 * The output is generated. Change src/db/schema.ts and regenerate.
 */"""),
])

edit('test/status.test.ts', [
    ("""/**
 * The transition table from docs/lld.md §5, written out by hand rather than
 * derived from the implementation — otherwise the test would agree with a bug.
 * Rows are `from`, columns are `to`.
 */""",
     """/**
 * The transition table written out by hand rather than derived from the
 * implementation, so the test cannot agree with a bug. Rows are `from`.
 */"""),
])

edit('test/serialize.test.ts', [
    ("    // questions.md §1.3 — an order of 2 naan and 1 biryani is 3 items.\n",
     "    // 2 naan and 1 biryani is 3 items, not 2 lines.\n"),
    ("""    // 0.1 + 0.2 === 0.30000000000000004 in floating point. Summing in whole
    // paise and dividing once avoids it.""",
     """    // The case that breaks naive float addition."""),
    ("""    // A platform-layer column leaking into an order response would break the
    // contract silently. This test fails if that ever happens.""",
     """    // Fails if an internal column ever leaks into a response."""),
])

edit('Dockerfile', [
    ("""# node is PID 1 and receives SIGTERM directly. Going through `npm start` would
# put npm at PID 1, which does not reliably forward signals to its child, so
# the graceful shutdown in src/index.ts would never run.""",
     """# node as PID 1, so it receives SIGTERM directly. npm does not reliably
# forward signals, which would leave the shutdown handler unreachable."""),
    ("""# node:24-alpine ships an unprivileged `node` user. Running as root in a
# container is a needless escalation if the process is ever compromised.""",
     """# Unprivileged user; nothing here needs root."""),
    ("""# Single stage: the app runs TypeScript directly through tsx, so there is no
# build output to copy between stages.""",
     """# Single stage: tsx runs the TypeScript directly, so there is nothing to copy
# between stages."""),
])

print('backend comments rewritten')
