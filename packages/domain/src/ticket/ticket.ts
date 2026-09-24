import { z } from 'zod';
import { Confidence, Effort } from '../triage/triage-result.js';
import { Department } from './manual-intake.js';
import { TicketSource } from './ticket-source.js';
import { RiskTier, TicketCategory, TicketFlag, TicketState } from './ticket-state.js';

/** Mirrors OpenProject's default priority set. */
export const TicketPriority = z.enum(['low', 'normal', 'high', 'immediate']);
export type TicketPriority = z.infer<typeof TicketPriority>;

/**
 * Read model of a ticket, derived by folding its event stream.
 * `lastPlanVersionAt` / `lastHumanCommentAt` exist so the replan guard can be
 * evaluated from the snapshot alone, without reloading events.
 */
export const TicketSnapshot = z.object({
  id: z.string().min(1),
  source: TicketSource,
  /** `OP-<workPackageId>` or the manual `M-0001` key; see `ticketDisplayKey`. */
  displayKey: z.string().min(1),
  subject: z.string().min(1),
  state: TicketState,
  flags: z.array(TicketFlag),
  category: TicketCategory.optional(),
  riskTier: RiskTier.optional(),
  targetRepo: z.string().min(1).optional(),
  ownerUserId: z.string().min(1).optional(),
  priority: TicketPriority,
  planVersionCount: z.number().int().min(0),
  unresolvedCommentCount: z.number().int().min(0),
  lastPlanVersionAt: z.iso.datetime().optional(),
  lastHumanCommentAt: z.iso.datetime().optional(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  /** Manual (feature request) tickets only; absent on OpenProject-sourced tickets. */
  department: Department.optional(),
  /** The ticket's creator/requester login; drives the clarification-answer guard. */
  requesterUserId: z.string().min(1).optional(),
  /** How many clarification rounds have been asked so far; capped at `MAX_CLARIFICATION_ROUNDS`. */
  clarificationRound: z.number().int().min(0).optional(),
  pendingQuestionCount: z.number().int().min(0).optional(),
  /** Effective RICE inputs, set by `triage_completed`'s assessment and overridable by `triage_confirmed`. */
  value: z.number().int().min(1).max(5).optional(),
  reach: z.number().int().min(1).max(5).optional(),
  confidence: Confidence.optional(),
  effort: Effort.optional(),
  riceScore: z.number().optional(),
});
export type TicketSnapshot = z.infer<typeof TicketSnapshot>;
