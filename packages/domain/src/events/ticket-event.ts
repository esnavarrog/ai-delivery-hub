import { z } from 'zod';
import { Actor } from '../ticket/actor.js';
import { TicketFlag } from '../ticket/ticket-state.js';
import { Confidence, Effort, TriageAssessment, TriageResult } from '../triage/triage-result.js';

export const TicketEventType = z.enum([
  // intake & triage
  'ticket_received',
  'triage_started',
  'triage_completed',
  'owner_required',
  // planning & review
  'planning_started',
  'ticket_claimed',
  'plan_version_created',
  'plan_changes_requested',
  'replan_requested',
  'plan_approved',
  'plan_reopened',
  // terminal decisions
  'ticket_rejected',
  'ticket_marked_duplicate',
  'ticket_marked_already_implemented',
  // phase 2+ delivery
  'implementation_started',
  'implementation_completed',
  'dev_review_approved',
  'sandbox_qa_passed',
  'sandbox_qa_failed',
  'qa_fix_submitted',
  'staging_qa_passed',
  // flags
  'flag_set',
  'flag_cleared',
  // plan comments
  'plan_comment_added',
  'plan_comment_resolved',
  // agent runs
  'run_started',
  'run_succeeded',
  'run_failed',
  'budget_exhausted',
  // external sync
  'op_sync_posted',
  /** OpenProject changed subject/description of a work package that is already a ticket. */
  'ticket_updated_from_op',
  /** A human confirmed the AI triage, optionally overriding category, risk tier, target repo or RICE scores. */
  'triage_confirmed',
  /** AI triage asked the requester clarifying questions; moves the ticket to `awaiting_requester`. */
  'requester_questions_asked',
  /** The requester (or a lead/admin) answered clarifying questions; moves the ticket back to `triaging`. */
  'requester_answers_submitted',
]);
export type TicketEventType = z.infer<typeof TicketEventType>;

export const ArtifactKind = z.enum([
  'commit',
  'branch',
  'pr',
  'plan_version',
  'op_comment',
  'run_log',
  /** HTML mockup produced during planning. */
  'design_draft',
]);
export type ArtifactKind = z.infer<typeof ArtifactKind>;

export const Artifact = z.object({
  kind: ArtifactKind,
  ref: z.string().min(1),
});
export type Artifact = z.infer<typeof Artifact>;

export const CommitSha = z.string().regex(/^[0-9a-f]{40}$/, 'expected a 40-char lowercase hex sha');

// Payload schemas for events that carry structured data.
export const PlanVersionCreatedPayload = z.object({
  version: z.number().int().min(1),
  baseCommitSha: CommitSha,
  /** Plan goal, duplicated here so notifications can be rendered without loading the plan. */
  goal: z.string().min(1).optional(),
});
export type PlanVersionCreatedPayload = z.infer<typeof PlanVersionCreatedPayload>;

export const TicketClaimedPayload = z.object({ ownerUserId: z.string().min(1) });
export type TicketClaimedPayload = z.infer<typeof TicketClaimedPayload>;

export const FlagPayload = z.object({ flag: TicketFlag });
export type FlagPayload = z.infer<typeof FlagPayload>;

export const TriageCompletedPayload = TriageResult;

/** A human override of the AI-suggested RICE inputs; see `riceScore`. */
export const ScoreOverride = z.object({
  value: z.number().int().min(1).max(5),
  reach: z.number().int().min(1).max(5),
  confidence: Confidence,
  effort: Effort,
});
export type ScoreOverride = z.infer<typeof ScoreOverride>;

/** Carried by `triage_confirmed`; every field is an optional override of the AI triage. */
export const TriageConfirmedPayload = TriageResult.pick({ category: true, riskTier: true, targetRepo: true })
  .partial()
  .extend({ scores: ScoreOverride.optional() });
export type TriageConfirmedPayload = z.infer<typeof TriageConfirmedPayload>;

export const ClarificationQuestion = z.object({ id: z.string().min(1), text: z.string().min(1) });
export type ClarificationQuestion = z.infer<typeof ClarificationQuestion>;

/** Carried by `requester_questions_asked`. */
export const RequesterQuestionsAskedPayload = z.object({
  round: z.number().int().min(1),
  questions: z.array(ClarificationQuestion).min(1),
  /**
   * The full three-lens assessment that produced these questions, so it is not lost while the
   * ticket waits in `awaiting_requester` (only `triage_completed` otherwise carries it). Optional
   * for backward compatibility with events written before this field existed.
   */
  assessment: TriageAssessment.optional(),
});
export type RequesterQuestionsAskedPayload = z.infer<typeof RequesterQuestionsAskedPayload>;

export const ClarificationAnswer = z.object({ questionId: z.string().min(1), text: z.string().min(1) });
export type ClarificationAnswer = z.infer<typeof ClarificationAnswer>;

/** Carried by `requester_answers_submitted`. */
export const RequesterAnswersSubmittedPayload = z.object({
  round: z.number().int().min(1),
  answers: z.array(ClarificationAnswer).min(1),
});
export type RequesterAnswersSubmittedPayload = z.infer<typeof RequesterAnswersSubmittedPayload>;

export const OpChangedField = z.enum(['subject', 'description']);
export type OpChangedField = z.infer<typeof OpChangedField>;

/** Carried by `ticket_updated_from_op`; only the fields listed in `changedFields` are present. */
export const TicketUpdatedFromOpPayload = z.object({
  opLockVersion: z.number().int().min(0),
  changedFields: z.array(OpChangedField).min(1),
  subject: z.string().min(1).optional(),
  description: z.string().optional(),
});
export type TicketUpdatedFromOpPayload = z.infer<typeof TicketUpdatedFromOpPayload>;

const OpenPayload = z.record(z.string(), z.unknown());

const eventBase = z.object({
  id: z.uuid(),
  ticketId: z.string().min(1),
  seq: z.number().int().min(1),
  actor: Actor,
  reason: z.string().optional(),
  runId: z.string().optional(),
  artifacts: z.array(Artifact),
  createdAt: z.iso.datetime(),
});

const typedEventTypes = [
  'ticket_updated_from_op',
  'triage_completed',
  'triage_confirmed',
  'plan_version_created',
  'ticket_claimed',
  'flag_set',
  'flag_cleared',
  'requester_questions_asked',
  'requester_answers_submitted',
] as const satisfies readonly TicketEventType[];
type TypedEventType = (typeof typedEventTypes)[number];
export type OpenEventType = Exclude<TicketEventType, TypedEventType>;

const openEventTypes = TicketEventType.options.filter(
  (t): t is OpenEventType => !(typedEventTypes as readonly string[]).includes(t),
) as [OpenEventType, ...OpenEventType[]];

/**
 * A domain event in a ticket's stream. Events carrying data use a discriminated
 * payload schema; every other event has an open `Record<string, unknown>` payload.
 */
export const TicketEvent = z.discriminatedUnion('type', [
  eventBase.extend({ type: z.literal('ticket_updated_from_op'), payload: TicketUpdatedFromOpPayload }),
  eventBase.extend({ type: z.literal('triage_completed'), payload: TriageCompletedPayload }),
  eventBase.extend({ type: z.literal('triage_confirmed'), payload: TriageConfirmedPayload }),
  eventBase.extend({ type: z.literal('plan_version_created'), payload: PlanVersionCreatedPayload }),
  eventBase.extend({ type: z.literal('ticket_claimed'), payload: TicketClaimedPayload }),
  eventBase.extend({ type: z.literal('flag_set'), payload: FlagPayload }),
  eventBase.extend({ type: z.literal('flag_cleared'), payload: FlagPayload }),
  eventBase.extend({ type: z.literal('requester_questions_asked'), payload: RequesterQuestionsAskedPayload }),
  eventBase.extend({ type: z.literal('requester_answers_submitted'), payload: RequesterAnswersSubmittedPayload }),
  eventBase.extend({ type: z.enum(openEventTypes), payload: OpenPayload }),
]);
export type TicketEvent = z.infer<typeof TicketEvent>;
