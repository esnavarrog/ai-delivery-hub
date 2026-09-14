CREATE TABLE "approvals" (
	"id" uuid PRIMARY KEY NOT NULL,
	"ticket_id" text NOT NULL,
	"gate" text NOT NULL,
	"decided_by" text NOT NULL,
	"decision" text NOT NULL,
	"note" text,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ingest_watermarks" (
	"project_id" integer PRIMARY KEY NOT NULL,
	"since" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "op_sync_outbox" (
	"key" text PRIMARY KEY NOT NULL,
	"ticket_id" text NOT NULL,
	"event_seq" integer NOT NULL,
	"kind" text NOT NULL,
	"op_work_package_id" integer NOT NULL,
	"payload" jsonb NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"external_ref" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"posted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "plan_comments" (
	"id" uuid PRIMARY KEY NOT NULL,
	"plan_version_id" uuid NOT NULL,
	"section_path" text NOT NULL,
	"author_id" text NOT NULL,
	"body" text NOT NULL,
	"resolved_by_version" integer,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "plan_versions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"ticket_id" text NOT NULL,
	"version" integer NOT NULL,
	"plan" jsonb NOT NULL,
	"rendered_markdown" text NOT NULL,
	"base_commit_sha" text NOT NULL,
	"status" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "repos" (
	"name" text PRIMARY KEY NOT NULL,
	"remote" text NOT NULL,
	"default_branch" text NOT NULL,
	"stack" text NOT NULL,
	"test_command" text NOT NULL,
	"branch_pattern" text NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "runs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"ticket_id" text NOT NULL,
	"kind" text NOT NULL,
	"status" text NOT NULL,
	"model" text NOT NULL,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"cost_usd" numeric(12, 6),
	"budget_tokens" integer NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"ended_at" timestamp with time zone,
	"log_pointer" text
);
--> statement-breakpoint
CREATE TABLE "ticket_events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"ticket_id" text NOT NULL,
	"seq" integer NOT NULL,
	"type" text NOT NULL,
	"actor_kind" text NOT NULL,
	"actor_id" text NOT NULL,
	"reason" text,
	"run_id" text,
	"payload" jsonb NOT NULL,
	"artifacts" jsonb NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tickets" (
	"id" text PRIMARY KEY NOT NULL,
	"op_work_package_id" integer NOT NULL,
	"op_project_id" integer NOT NULL,
	"op_lock_version" integer NOT NULL,
	"subject" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"state" text NOT NULL,
	"flags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"category" text,
	"risk_tier" text,
	"target_repo" text,
	"owner_user_id" text,
	"priority" text NOT NULL,
	"plan_version_count" integer DEFAULT 0 NOT NULL,
	"unresolved_comment_count" integer DEFAULT 0 NOT NULL,
	"last_plan_version_at" timestamp with time zone,
	"last_human_comment_at" timestamp with time zone,
	"head_seq" integer NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "tickets_op_work_package_id_unique" UNIQUE("op_work_package_id")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" text PRIMARY KEY NOT NULL,
	"display_name" text,
	"role" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE INDEX "approvals_ticket_idx" ON "approvals" USING btree ("ticket_id");--> statement-breakpoint
CREATE INDEX "op_sync_outbox_status_idx" ON "op_sync_outbox" USING btree ("status");--> statement-breakpoint
CREATE INDEX "plan_comments_version_idx" ON "plan_comments" USING btree ("plan_version_id");--> statement-breakpoint
CREATE UNIQUE INDEX "plan_versions_ticket_version_uq" ON "plan_versions" USING btree ("ticket_id","version");--> statement-breakpoint
CREATE INDEX "runs_ticket_idx" ON "runs" USING btree ("ticket_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ticket_events_ticket_seq_uq" ON "ticket_events" USING btree ("ticket_id","seq");--> statement-breakpoint
CREATE INDEX "tickets_state_idx" ON "tickets" USING btree ("state");--> statement-breakpoint
CREATE INDEX "tickets_owner_idx" ON "tickets" USING btree ("owner_user_id");--> statement-breakpoint
CREATE INDEX "tickets_repo_idx" ON "tickets" USING btree ("target_repo");