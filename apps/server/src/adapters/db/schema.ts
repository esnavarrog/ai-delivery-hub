import { index, integer, jsonb, numeric, pgTable, real, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });

/**
 * Read model of a ticket (see domain `TicketSnapshot`) plus `description` and the projected head seq.
 * `sourceKind` discriminates an OpenProject work package (`opWorkPackageId`/`opProjectId`/
 * `opLockVersion` set, `manualKey` null) from a manual ticket (`manualKey` set, OP columns null).
 * Both id columns are individually `unique()`; Postgres treats NULLs as distinct for uniqueness, so
 * any number of manual rows (all-null OP columns) and OP rows (all-null `manualKey`) coexist.
 * `displayKey` is denormalized (`OP-<id>` or the manual key) so list/detail reads never recompute it.
 */
export const tickets = pgTable(
  'tickets',
  {
    id: text('id').primaryKey(),
    sourceKind: text('source_kind').notNull(),
    opWorkPackageId: integer('op_work_package_id').unique(),
    opProjectId: integer('op_project_id'),
    opLockVersion: integer('op_lock_version'),
    manualKey: text('manual_key').unique(),
    displayKey: text('display_key').notNull(),
    subject: text('subject').notNull(),
    description: text('description').notNull().default(''),
    state: text('state').notNull(),
    flags: jsonb('flags').$type<string[]>().notNull().default([]),
    category: text('category'),
    riskTier: text('risk_tier'),
    targetRepo: text('target_repo'),
    ownerUserId: text('owner_user_id'),
    /** Manual (feature request) tickets only; null on OpenProject-sourced tickets. */
    department: text('department'),
    /** The ticket's creator/requester login; drives requester-scoped reads and the answer guard. */
    requesterUserId: text('requester_user_id'),
    /** How many clarification rounds have been asked so far; set by `requester_questions_asked`. */
    clarificationRound: integer('clarification_round'),
    /** Outstanding clarification questions; reset to 0 by `requester_answers_submitted`. */
    pendingQuestionCount: integer('pending_question_count'),
    /** Effective RICE inputs, set by `triage_completed`'s assessment and overridable by `triage_confirmed`. */
    scoreValue: integer('score_value'),
    scoreReach: integer('score_reach'),
    scoreConfidence: real('score_confidence'),
    scoreEffort: text('score_effort'),
    riceScore: real('rice_score'),
    priority: text('priority').notNull(),
    planVersionCount: integer('plan_version_count').notNull().default(0),
    unresolvedCommentCount: integer('unresolved_comment_count').notNull().default(0),
    lastPlanVersionAt: ts('last_plan_version_at'),
    lastHumanCommentAt: ts('last_human_comment_at'),
    headSeq: integer('head_seq').notNull(),
    createdAt: ts('created_at').notNull(),
    updatedAt: ts('updated_at').notNull(),
  },
  (t) => [
    index('tickets_state_idx').on(t.state),
    index('tickets_owner_idx').on(t.ownerUserId),
    index('tickets_repo_idx').on(t.targetRepo),
    index('tickets_requester_idx').on(t.requesterUserId),
  ],
);

/** Append-only event stream; `(ticket_id, seq)` uniqueness is what enforces optimistic concurrency. */
export const ticketEvents = pgTable(
  'ticket_events',
  {
    id: uuid('id').primaryKey(),
    ticketId: text('ticket_id').notNull(),
    seq: integer('seq').notNull(),
    type: text('type').notNull(),
    actorKind: text('actor_kind').notNull(),
    actorId: text('actor_id').notNull(),
    reason: text('reason'),
    runId: text('run_id'),
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull(),
    artifacts: jsonb('artifacts').$type<Array<{ kind: string; ref: string }>>().notNull(),
    createdAt: ts('created_at').notNull(),
  },
  (t) => [uniqueIndex('ticket_events_ticket_seq_uq').on(t.ticketId, t.seq)],
);

export const planVersions = pgTable(
  'plan_versions',
  {
    id: uuid('id').primaryKey(),
    ticketId: text('ticket_id').notNull(),
    version: integer('version').notNull(),
    plan: jsonb('plan').$type<Record<string, unknown>>().notNull(),
    renderedMarkdown: text('rendered_markdown').notNull(),
    baseCommitSha: text('base_commit_sha').notNull(),
    status: text('status').notNull(),
    createdAt: ts('created_at').notNull(),
  },
  (t) => [uniqueIndex('plan_versions_ticket_version_uq').on(t.ticketId, t.version)],
);

export const planComments = pgTable(
  'plan_comments',
  {
    id: uuid('id').primaryKey(),
    planVersionId: uuid('plan_version_id').notNull(),
    sectionPath: text('section_path').notNull(),
    authorId: text('author_id').notNull(),
    body: text('body').notNull(),
    resolvedByVersion: integer('resolved_by_version'),
    createdAt: ts('created_at').notNull(),
  },
  (t) => [index('plan_comments_version_idx').on(t.planVersionId)],
);

export const runs = pgTable(
  'runs',
  {
    id: uuid('id').primaryKey(),
    ticketId: text('ticket_id').notNull(),
    kind: text('kind').notNull(),
    status: text('status').notNull(),
    model: text('model').notNull(),
    inputTokens: integer('input_tokens').notNull().default(0),
    outputTokens: integer('output_tokens').notNull().default(0),
    costUsd: numeric('cost_usd', { precision: 12, scale: 6 }),
    budgetTokens: integer('budget_tokens').notNull(),
    startedAt: ts('started_at').notNull(),
    endedAt: ts('ended_at'),
    logPointer: text('log_pointer'),
    failureReason: text('failure_reason'),
    errorMessage: text('error_message'),
  },
  (t) => [index('runs_ticket_idx').on(t.ticketId)],
);

/** Humans known to the hub; `id` is the GitHub login. */
export const users = pgTable('users', {
  id: text('id').primaryKey(),
  displayName: text('display_name'),
  role: text('role').notNull(),
  createdAt: ts('created_at').notNull(),
});

export const repos = pgTable('repos', {
  name: text('name').primaryKey(),
  remote: text('remote').notNull(),
  defaultBranch: text('default_branch').notNull(),
  stack: text('stack').notNull(),
  testCommand: text('test_command').notNull(),
  branchPattern: text('branch_pattern').notNull(),
  updatedAt: ts('updated_at').notNull(),
});

export const approvals = pgTable(
  'approvals',
  {
    id: uuid('id').primaryKey(),
    ticketId: text('ticket_id').notNull(),
    gate: text('gate').notNull(),
    decidedBy: text('decided_by').notNull(),
    decision: text('decision').notNull(),
    note: text('note'),
    createdAt: ts('created_at').notNull(),
  },
  (t) => [index('approvals_ticket_idx').on(t.ticketId)],
);

/** Last `updated_at` lower bound used by the polling fallback, per OpenProject project. */
export const ingestWatermarks = pgTable('ingest_watermarks', {
  projectId: integer('project_id').primaryKey(),
  since: ts('since').notNull(),
  updatedAt: ts('updated_at').notNull().defaultNow(),
});

/** Single-row atomic counter backing manual ticket keys (`M-0001`, `M-0002`, ...); the row is created on first use. */
export const manualTicketCounter = pgTable('manual_ticket_counter', {
  id: text('id').primaryKey(),
  nextValue: integer('next_value').notNull().default(1),
});
