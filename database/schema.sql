-- Spice Garden OMS — consolidated schema.
--
-- GENERATED FILE. Do not edit.
-- Source of truth: backend/src/db/schema.ts
-- Rebuild:        cd backend && npm run db:generate && npm run db:schema
--
-- Apply to an empty database with:
--   psql "$DATABASE_URL" -f database/schema.sql

-- ─── 0000_amused_molten_man.sql ──────────────────────────────────

CREATE TYPE "public"."order_status" AS ENUM('CONFIRMED', 'PREPARING', 'READY', 'COMPLETED', 'CANCELLED');

CREATE SEQUENCE "public"."order_number_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1;

CREATE TABLE "customers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"email" text,
	"phone" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "order_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"item_name" text NOT NULL,
	"quantity" integer NOT NULL,
	"unit_price" numeric(10, 2) NOT NULL,
	"total_price" numeric(10, 2) GENERATED ALWAYS AS ("order_items"."quantity" * "order_items"."unit_price") STORED,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "order_items_quantity_positive" CHECK ("order_items"."quantity" > 0),
	CONSTRAINT "order_items_unit_price_non_negative" CHECK ("order_items"."unit_price" >= 0)
);

CREATE TABLE "orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_number" text DEFAULT 'ORD-' || lpad(nextval('order_number_seq')::text, 6, '0') NOT NULL,
	"customer_id" uuid NOT NULL,
	"status" "order_status" DEFAULT 'CONFIRMED' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE "order_items" ADD CONSTRAINT "order_items_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;

ALTER TABLE "orders" ADD CONSTRAINT "orders_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE cascade ON UPDATE no action;

CREATE UNIQUE INDEX "customers_phone_idx" ON "customers" USING btree ("phone");

CREATE INDEX "order_items_order_id_idx" ON "order_items" USING btree ("order_id");

CREATE UNIQUE INDEX "orders_order_number_idx" ON "orders" USING btree ("order_number");

CREATE INDEX "orders_customer_id_idx" ON "orders" USING btree ("customer_id");

CREATE INDEX "orders_status_created_at_idx" ON "orders" USING btree ("status","created_at" DESC NULLS LAST);

CREATE INDEX "orders_created_at_idx" ON "orders" USING btree ("created_at" DESC NULLS LAST);

-- ─── 0001_neat_gambit.sql ────────────────────────────────────────

CREATE TABLE "order_status_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"from_status" "order_status",
	"to_status" "order_status" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE "order_status_events" ADD CONSTRAINT "order_status_events_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;

CREATE INDEX "order_status_events_order_id_created_at_idx" ON "order_status_events" USING btree ("order_id","created_at");

CREATE INDEX "order_status_events_to_status_created_at_idx" ON "order_status_events" USING btree ("to_status","created_at");

-- ─── 0002_majestic_vulture.sql ───────────────────────────────────

CREATE TYPE "public"."staff_role" AS ENUM('ADMIN', 'MANAGER', 'SERVICE', 'KITCHEN');

CREATE TABLE "staff" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"password_hash" text NOT NULL,
	"role" "staff_role" NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE "order_status_events" ADD COLUMN "staff_id" uuid;

CREATE UNIQUE INDEX "staff_email_idx" ON "staff" USING btree ("email");

ALTER TABLE "order_status_events" ADD CONSTRAINT "order_status_events_staff_id_staff_id_fk" FOREIGN KEY ("staff_id") REFERENCES "public"."staff"("id") ON DELETE set null ON UPDATE no action;

-- ─── 0003_serious_venom.sql ──────────────────────────────────────

CREATE TABLE "idempotency_keys" (
	"key" text PRIMARY KEY NOT NULL,
	"endpoint" text NOT NULL,
	"request_hash" text NOT NULL,
	"status_code" integer NOT NULL,
	"response_body" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"channel" text NOT NULL,
	"recipient" text NOT NULL,
	"body" text NOT NULL,
	"status" text DEFAULT 'PENDING' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sent_at" timestamp with time zone
);

ALTER TABLE "notifications" ADD CONSTRAINT "notifications_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;

CREATE INDEX "notifications_pending_idx" ON "notifications" USING btree ("created_at") WHERE "notifications"."status" = 'PENDING';

CREATE INDEX "notifications_order_id_idx" ON "notifications" USING btree ("order_id");
