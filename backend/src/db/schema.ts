import { sql, type SQL } from 'drizzle-orm'
import {
  boolean,
  check,
  jsonb,
  index,
  integer,
  numeric,
  pgEnum,
  pgSequence,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'

/** The five statuses are fixed by the API contract, so the database rejects a sixth. */
export const orderStatus = pgEnum('order_status', [
  'CONFIRMED',
  'PREPARING',
  'READY',
  'COMPLETED',
  'CANCELLED',
])

/** Who can do what. Enforced by the API, and constrained by the database. */
export const staffRole = pgEnum('staff_role', ['ADMIN', 'MANAGER', 'SERVICE', 'KITCHEN'])

/** Feeds `orderNumber`. A sequence cannot hand the same value to two concurrent inserts. */
export const orderNumberSeq = pgSequence('order_number_seq', { startWith: 1 })

const timestamps = {
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
}

export const customers = pgTable(
  'customers',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    email: text('email'),
    // Unique: this constraint is what produces RESOURCE_ALREADY_EXISTS. We catch
    // Postgres error 23505 rather than checking first, which would race.
    phone: text('phone').notNull(),
    ...timestamps,
  },
  (table) => [uniqueIndex('customers_phone_idx').on(table.phone)],
)

export const orders = pgTable(
  'orders',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orderNumber: text('order_number')
      .notNull()
      .default(sql`'ORD-' || lpad(nextval('order_number_seq')::text, 6, '0')`),
    customerId: uuid('customer_id')
      .notNull()
      .references(() => customers.id, { onDelete: 'cascade' }),
    status: orderStatus('status').notNull().default('CONFIRMED'),
    ...timestamps,
  },
  (table) => [
    uniqueIndex('orders_order_number_idx').on(table.orderNumber),
    index('orders_customer_id_idx').on(table.customerId),
    // Filter and sort in one index — this is the kitchen board's query.
    index('orders_status_created_at_idx').on(table.status, table.createdAt.desc()),
    index('orders_created_at_idx').on(table.createdAt.desc()),
  ],
)

export const orderItems = pgTable(
  'order_items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orderId: uuid('order_id')
      .notNull()
      .references(() => orders.id, { onDelete: 'cascade' }),
    itemName: text('item_name').notNull(),
    quantity: integer('quantity').notNull(),
    // Stored on the line, so a later menu price change cannot rewrite past orders.
    unitPrice: numeric('unit_price', { precision: 10, scale: 2 }).notNull(),
    // Generated: nothing is allowed to write a total that disagrees with its inputs.
    totalPrice: numeric('total_price', { precision: 10, scale: 2 }).generatedAlwaysAs(
      (): SQL => sql`${orderItems.quantity} * ${orderItems.unitPrice}`,
    ),
    createdAt: timestamps.createdAt,
  },
  (table) => [
    index('order_items_order_id_idx').on(table.orderId),
    check('order_items_quantity_positive', sql`${table.quantity} > 0`),
    check('order_items_unit_price_non_negative', sql`${table.unitPrice} >= 0`),
  ],
)

/** Restaurant staff. Not customers — these are the people who use the system. */
export const staff = pgTable(
  'staff',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    email: text('email').notNull(),
    // scrypt from node:crypto, salted per user. Never a plaintext password.
    passwordHash: text('password_hash').notNull(),
    role: staffRole('role').notNull(),
    isActive: boolean('is_active').notNull().default(true),
    ...timestamps,
  },
  (table) => [uniqueIndex('staff_email_idx').on(table.email)],
)

/**
 * Every status change an order has been through.
 *
 * Written in the SAME transaction as the change itself, so the log can never
 * disagree with the order it describes. This is the source for every
 * time-based metric — prep time, throughput, the funnel — which is why prep
 * timestamps are not duplicated onto `orders`.
 */
export const orderStatusEvents = pgTable(
  'order_status_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orderId: uuid('order_id')
      .notNull()
      .references(() => orders.id, { onDelete: 'cascade' }),
    // Null for the event that created the order: it came from nowhere.
    fromStatus: orderStatus('from_status'),
    toStatus: orderStatus('to_status').notNull(),
    // Null when the change was not made by a signed-in person — seeded history,
    // or a request made while AUTH_DISABLED is set. Set null rather than
    // deleted if the staff member is removed: the history stays true.
    staffId: uuid('staff_id').references(() => staff.id, { onDelete: 'set null' }),
    createdAt: timestamps.createdAt,
  },
  (table) => [
    index('order_status_events_order_id_created_at_idx').on(table.orderId, table.createdAt),
    index('order_status_events_to_status_created_at_idx').on(table.toStatus, table.createdAt),
  ],
)


/**
 * The transactional outbox: what we intend to tell a customer.
 *
 * The row is written in the SAME transaction as the status change, so a
 * notification cannot be lost by a crash between committing the change and
 * telling anyone about it. A worker drains it afterwards.
 */
export const notifications = pgTable(
  'notifications',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orderId: uuid('order_id')
      .notNull()
      .references(() => orders.id, { onDelete: 'cascade' }),
    channel: text('channel').notNull(),
    recipient: text('recipient').notNull(),
    body: text('body').notNull(),
    status: text('status').notNull().default('PENDING'),
    attempts: integer('attempts').notNull().default(0),
    lastError: text('last_error'),
    createdAt: timestamps.createdAt,
    claimedAt: timestamp('claimed_at', { withTimezone: true }),
    sentAt: timestamp('sent_at', { withTimezone: true }),
  },
  (table) => [
    // Partial: the drain only ever looks for work, so the index only covers
    // rows that are work.
    index('notifications_pending_idx')
      .on(table.createdAt)
      .where(sql`${table.status} = 'PENDING'`),
    index('notifications_order_id_idx').on(table.orderId),
  ],
)

/**
 * Makes a retried request safe.
 *
 * In Postgres rather than Redis: the guarantee wanted is "exactly one order",
 * and the order lives here. Writing the key in the same transaction as the
 * order is what makes the two atomic — and the unique primary key is the lock,
 * so a second concurrent request with the same key blocks until the first
 * commits, then reads its stored response.
 */
export const idempotencyKeys = pgTable('idempotency_keys', {
  key: text('key').primaryKey(),
  endpoint: text('endpoint').notNull(),
  requestHash: text('request_hash').notNull(),
  statusCode: integer('status_code').notNull(),
  responseBody: jsonb('response_body').notNull(),
  createdAt: timestamps.createdAt,
})
