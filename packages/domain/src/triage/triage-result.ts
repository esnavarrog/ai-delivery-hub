import { z } from 'zod';
import { RiskTier, TicketCategory } from '../ticket/ticket-state.js';

export const SUMMARY_MAX_LENGTH = 600;

export const DuplicateCandidate = z.object({
  ticketId: z.string().min(1),
  /** The candidate's `OP-<id>` or `M-000N` display key (see `ticketDisplayKey`). */
  displayKey: z.string().min(1),
  similarity: z.number().min(0).max(1),
  reason: z.string().min(1),
});
export type DuplicateCandidate = z.infer<typeof DuplicateCandidate>;

export const AlreadyImplementedHint = z.object({
  evidencePaths: z.array(z.string().min(1)),
  explanation: z.string().min(1),
});
export type AlreadyImplementedHint = z.infer<typeof AlreadyImplementedHint>;

/** Relative development cost bucket used to weight a RICE score; see `EFFORT_WEIGHTS`. */
export const Effort = z.enum(['S', 'M', 'L', 'XL']);
export type Effort = z.infer<typeof Effort>;

/** How confident the assessment is in its value/reach estimate. */
export const Confidence = z.union([z.literal(0.5), z.literal(0.8), z.literal(1)]);
export type Confidence = z.infer<typeof Confidence>;

/** Cap on `functional.questions`; a wire reply over this is truncated before validation (see `triage-parse.ts`). */
export const MAX_CLARIFICATION_QUESTIONS = 5;

const FunctionalAssessment = z.object({
  /** 1 = unclear request, 5 = fully specified. */
  clarity: z.number().int().min(1).max(5),
  acceptanceCriteria: z.array(z.string().min(1)),
  /** Open questions for the requester; a non-empty list is what drives `awaiting_requester`. At most `MAX_CLARIFICATION_QUESTIONS`. */
  questions: z.array(z.string().min(1)).max(MAX_CLARIFICATION_QUESTIONS),
});

const TechnicalAssessment = z.object({
  feasibility: z.enum(['feasible', 'uncertain', 'infeasible']),
  risks: z.array(z.string().min(1)),
  dependencies: z.array(z.string().min(1)),
});

const ManagementAssessment = z.object({
  /** 1..5 business value. */
  value: z.number().int().min(1).max(5),
  /** 1..5 how many users/how often. */
  reach: z.number().int().min(1).max(5),
  confidence: Confidence,
  effort: Effort,
  recommendation: z.enum(['approve', 'reject', 'needs_info']),
  rationale: z.string().min(1),
});

/** Three-lens AI assessment of a feature request: functional analyst, senior dev, dev manager. */
export const TriageAssessment = z.object({
  functional: FunctionalAssessment,
  technical: TechnicalAssessment,
  management: ManagementAssessment,
});
export type TriageAssessment = z.infer<typeof TriageAssessment>;

/** Output of the AI triage step. `targetRepo` is a free string here; use `triageResultSchemaFor` to bind it to an allowlist. */
export const TriageResult = z.object({
  category: TicketCategory,
  riskTier: RiskTier,
  targetRepo: z.string().min(1),
  summary: z.string().min(1).max(SUMMARY_MAX_LENGTH),
  duplicateCandidates: z.array(DuplicateCandidate),
  alreadyImplementedHint: AlreadyImplementedHint.optional(),
  riskSignals: z.array(z.string()),
  /** Optional, backward compatible: older triage results have no three-lens assessment. */
  assessment: TriageAssessment.optional(),
});
export type TriageResult = z.infer<typeof TriageResult>;

/** Builds a TriageResult schema whose `targetRepo` must be one of the provided repositories (case-sensitive). */
export function triageResultSchemaFor(repos: readonly string[]) {
  const allowed = new Set(repos);
  return TriageResult.extend({
    targetRepo: z
      .string()
      .min(1)
      .refine((repo) => allowed.has(repo), {
        message: `targetRepo must be one of: ${[...allowed].join(', ')}`,
      }),
  });
}
