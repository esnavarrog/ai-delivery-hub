ALTER TABLE "tickets" ADD COLUMN "clarification_round" integer;--> statement-breakpoint
ALTER TABLE "tickets" ADD COLUMN "pending_question_count" integer;--> statement-breakpoint
ALTER TABLE "tickets" ADD COLUMN "score_value" integer;--> statement-breakpoint
ALTER TABLE "tickets" ADD COLUMN "score_reach" integer;--> statement-breakpoint
ALTER TABLE "tickets" ADD COLUMN "score_confidence" real;--> statement-breakpoint
ALTER TABLE "tickets" ADD COLUMN "score_effort" text;--> statement-breakpoint
ALTER TABLE "tickets" ADD COLUMN "rice_score" real;