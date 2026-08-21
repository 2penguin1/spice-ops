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

/** Five fixed statuses, so the database rejects a sixth. */
export const orderStatus = pgEnum('order_status', [
  'CONFIRMED',
  'PREPARING',
  'READY',
  'COMPLETED',
  'CANCELLED',
])

/** Who can do what. Enforced by the API, constrained by the database. */
export const staffRole = pgEnum('staff_role', ['ADMIN', 'MANAGER', 'SERVICE', 'KITCHEN'])

/** Feeds `orderNumber`. A sequence cannot give two inserts the same value. */
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
    // Filter and sort in one index: the kitchen board's query.
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
    // On the line, so a later menu price change cannot rewrite past orders.
    unitPrice: numeric('unit_price', { precision: 10, scale: 2 }).notNull(),
    // Generated, so nothing can write a total that disagrees with its inputs.
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
    // scrypt, salted per user.
    passwordHash: text('password_hash').notNull(),
    role: staffRole('role').notNull(),
    isActive: boolean('is_active').notNull().default(true),
    ...timestamps,
  },
  (table) => [uniqueIndex('staff_email_idx').on(table.email)],
)

/**
 * Every status change an order has been through, written in the transaction
 * that made it. Prep time and throughput are read from here rather than kept
 * as extra columns on `orders`.
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
    // Null when nobody was signed in. Set null rather than deleted when someone
    // leaves, so the history stays intact.
    staffId: uuid('staff_id').references(() => staff.id, { onDelete: 'set null' }),
    createdAt: timestamps.createdAt,
  },
  (table) => [
    index('order_status_events_order_id_created_at_idx').on(table.orderId, table.createdAt),
    index('order_status_events_to_status_created_at_idx').on(table.toStatus, table.createdAt),
  ],
)


/** Messages waiting to be sent, written with the change that caused them. */
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
    // Partial: the drain only ever looks for pending rows.
    index('notifications_pending_idx')
      .on(table.createdAt)
      .where(sql`${table.status} = 'PENDING'`),
    index('notifications_order_id_idx').on(table.orderId),
  ],
)

/**
 * Stored responses for retried requests. In Postgres, not Redis, so the key and
 * the order it protects commit together.
 */
export const idempotencyKeys = pgTable('idempotency_keys', {
  key: text('key').primaryKey(),
  endpoint: text('endpoint').notNull(),
  requestHash: text('request_hash').notNull(),
  statusCode: integer('status_code').notNull(),
  responseBody: jsonb('response_body').notNull(),
  createdAt: timestamps.createdAt,
})
