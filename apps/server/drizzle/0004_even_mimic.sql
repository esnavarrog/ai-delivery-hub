ALTER TABLE "tickets" ADD COLUMN "department" text;--> statement-breakpoint
ALTER TABLE "tickets" ADD COLUMN "requester_user_id" text;--> statement-breakpoint
CREATE INDEX "tickets_requester_idx" ON "tickets" USING btree ("requester_user_id");