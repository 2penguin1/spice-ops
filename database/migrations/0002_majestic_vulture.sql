CREATE TYPE "public"."staff_role" AS ENUM('ADMIN', 'MANAGER', 'SERVICE', 'KITCHEN');--> statement-breakpoint
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
--> statement-breakpoint
ALTER TABLE "order_status_events" ADD COLUMN "staff_id" uuid;--> statement-breakpoint
CREATE UNIQUE INDEX "staff_email_idx" ON "staff" USING btree ("email");--> statement-breakpoint
ALTER TABLE "order_status_events" ADD CONSTRAINT "order_status_events_staff_id_staff_id_fk" FOREIGN KEY ("staff_id") REFERENCES "public"."staff"("id") ON DELETE set null ON UPDATE no action;