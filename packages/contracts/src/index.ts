import {
  Plan,
  Role,
  RunFailureReason,
  SectionPath,
  TicketEvent,
  TicketFlag,
  TicketSnapshot,
  TicketState,
  TriageConfirmedPayload,
} from '@ai-delivery-hub/domain';
import { z } from 'zod';

// ---- Errors ---------------------------------------------------------------

export const ErrorCode = z.enum(['bad_request', 'unauthorized', 'forbidden', 'not_found', 'conflict', 'internal']);
export type ErrorCode = z.infer<typeof ErrorCode>;

/** Every non-2xx API response has this shape. */
export const ErrorResponse = z.object({ error: z.object({ code: ErrorCode, message: z.string() }) });
export type ErrorResponse = z.infer<typeof ErrorResponse>;

// ---- Identity -------------------------------------------------------------

export const MeResponse = z.object({ login: z.string().min(1), role: Role });
export type MeResponse = z.infer<typeof MeResponse>;

// ---- Runs -----------------------------------------------------------------

export const RunKind = z.enum(['triage', 'planning']);
export type RunKind = z.infer<typeof RunKind>;

export const RunStatus = z.enum(['running', 'succeeded', 'failed', 'budget_exhausted']);
export type RunStatus = z.infer<typeof RunStatus>;

export const RunDto = z.object({
  id: z.string().min(1),
  ticketId: z.string().min(1),
  kind: RunKind,
  status: RunStatus,
  model: z.string().min(1),
  inputTokens: z.number().int().min(0),
  outputTokens: z.number().int().min(0),
  costUsd: z.number().min(0).nullable(),
  budgetTokens: z.number().int().positive(),
  startedAt: z.iso.datetime(),
  endedAt: z.iso.datetime().nullable(),
  failureReason: RunFailureReason.nullable(),
  errorMessage: z.string().nullable(),
});
export type RunDto = z.infer<typeof RunDto>;

export const RunsResponse = z.object({ runs: z.array(RunDto) });
export type RunsResponse = z.infer<typeof RunsResponse>;

export const RunResponse = z.object({ run: RunDto });
export type RunResponse = z.infer<typeof RunResponse>;

export const RunsQuery = z.object({ ticketId: z.string().min(1).optional() });
export type RunsQuery = z.infer<typeof RunsQuery>;

// ---- Plans ----------------------------------------------------------------

export const PlanVersionStatus = z.enum(['review', 'superseded', 'approved']);
export type PlanVersionStatus = z.infer<typeof PlanVersionStatus>;

export const PlanVersionDto = z.object({
  id: z.string().min(1),
  ticketId: z.string().min(1),
  version: z.number().int().min(1),
  plan: Plan,
  renderedMarkdown: z.string(),
  baseCommitSha: z.string().min(1),
  status: PlanVersionStatus,
  createdAt: z.iso.datetime(),
});
export type PlanVersionDto = z.infer<typeof PlanVersionDto>;

/** Enough to render the "latest plan" card without shipping the whole plan. */
export const PlanVersionSummary = z.object({
  id: z.string().min(1),
  version: z.number().int().min(1),
  goal: z.string(),
  baseCommitSha: z.string().min(1),
  createdAt: z.iso.datetime(),
});
export type PlanVersionSummary = z.infer<typeof PlanVersionSummary>;

export const PlanCommentDto = z.object({
  id: z.string().min(1),
  planVersionId: z.string().min(1),
  sectionPath: SectionPath,
  authorId: z.string().min(1),
  body: z.string().min(1),
  resolvedByVersion: z.number().int().min(1).nullable(),
  createdAt: z.iso.datetime(),
});
export type PlanCommentDto = z.infer<typeof PlanCommentDto>;

export const TicketPlanResponse = z.object({ versions: z.array(PlanVersionDto), comments: z.array(PlanCommentDto) });
export type TicketPlanResponse = z.infer<typeof TicketPlanResponse>;

// ---- Tickets --------------------------------------------------------------

export const TicketListQuery = z.object({
  state: TicketState.optional(),
  repo: z.string().min(1).optional(),
  owner: z.string().min(1).optional(),
  /** `me`: only tickets where the caller's role has a primary action right now. */
  waitingOn: z.literal('me').optional(),
});
export type TicketListQuery = z.infer<typeof TicketListQuery>;

export const TicketListResponse = z.object({ tickets: z.array(TicketSnapshot) });
export type TicketListResponse = z.infer<typeof TicketListResponse>;

export const TicketDetailResponse = z.object({
  ticket: TicketSnapshot,
  events: z.array(TicketEvent),
  latestPlan: PlanVersionSummary.nullable(),
  unresolvedCommentCount: z.number().int().min(0),
  latestRun: RunDto.nullable(),
});
export type TicketDetailResponse = z.infer<typeof TicketDetailResponse>;

// ---- Commands -------------------------------------------------------------

const Reason = z.string().trim().min(1).max(2000);

export const ConfirmTriageBody = TriageConfirmedPayload;
export type ConfirmTriageBody = z.infer<typeof ConfirmTriageBody>;

/** Either a reason or at least one unresolved comment is required (checked by the use case). */
export const RequestChangesBody = z.object({ reason: Reason.optional() });
export type RequestChangesBody = z.infer<typeof RequestChangesBody>;

export const ApproveBody = z.object({ secondApproverId: z.string().trim().min(1).optional(), note: Reason.optional() });
export type ApproveBody = z.infer<typeof ApproveBody>;

export const DecisionBody = z.object({ reason: Reason.optional() });
export type DecisionBody = z.infer<typeof DecisionBody>;

export const DuplicateBody = z.object({ reason: Reason.optional(), duplicateOfTicketId: z.string().trim().min(1).optional() });
export type DuplicateBody = z.infer<typeof DuplicateBody>;

export const FlagBody = z.object({ flag: TicketFlag, set: z.boolean(), reason: Reason.optional() });
export type FlagBody = z.infer<typeof FlagBody>;

export const AddCommentBody = z.object({
  sectionPath: SectionPath,
  body: z.string().trim().min(1).max(5000),
  /** Defaults to the latest plan version. */
  planVersionId: z.string().min(1).optional(),
});
export type AddCommentBody = z.infer<typeof AddCommentBody>;

/** Returned by every state-changing command. */
export const CommandResponse = z.object({ ticket: TicketSnapshot });
export type CommandResponse = z.infer<typeof CommandResponse>;

export const CommentResponse = z.object({ ticket: TicketSnapshot, comment: PlanCommentDto });
export type CommentResponse = z.infer<typeof CommentResponse>;

export const EnqueuedResponse = z.object({ ticket: TicketSnapshot, enqueued: RunKind });
export type EnqueuedResponse = z.infer<typeof EnqueuedResponse>;

// ---- Ingest -----------------------------------------------------------------

export const OpenProjectFetchSummary = z.object({
  fetched: z.number().int().min(0),
  created: z.number().int().min(0),
  updated: z.number().int().min(0),
});
export type OpenProjectFetchSummary = z.infer<typeof OpenProjectFetchSummary>;

export const ObsidianImportError = z.object({ file: z.string().min(1), message: z.string().min(1) });
export type ObsidianImportError = z.infer<typeof ObsidianImportError>;

export const ObsidianImportSummary = z.object({
  imported: z.number().int().min(0),
  skipped: z.number().int().min(0),
  errors: z.array(ObsidianImportError),
});
export type ObsidianImportSummary = z.infer<typeof ObsidianImportSummary>;

/** Response of `POST /api/ingest/fetch`. `obsidian` is `null` when `OBSIDIAN_VAULT_DIR` is unset. */
export const FetchResponse = z.object({
  openproject: OpenProjectFetchSummary,
  obsidian: ObsidianImportSummary.nullable(),
});
export type FetchResponse = z.infer<typeof FetchResponse>;
