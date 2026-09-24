CREATE TABLE "manual_ticket_counter" (
	"id" text PRIMARY KEY NOT NULL,
	"next_value" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "tickets" ALTER COLUMN "op_work_package_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "tickets" ALTER COLUMN "op_project_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "tickets" ALTER COLUMN "op_lock_version" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "tickets" ADD COLUMN "source_kind" text NOT NULL;--> statement-breakpoint
ALTER TABLE "tickets" ADD COLUMN "manual_key" text;--> statement-breakpoint
ALTER TABLE "tickets" ADD COLUMN "display_key" text NOT NULL;--> statement-breakpoint
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_manual_key_unique" UNIQUE("manual_key");