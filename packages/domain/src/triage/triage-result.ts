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

/** Output of the AI triage step. `targetRepo` is a free string here; use `triageResultSchemaFor` to bind it to an allowlist. */
export const TriageResult = z.object({
  category: TicketCategory,
  riskTier: RiskTier,
  targetRepo: z.string().min(1),
  summary: z.string().min(1).max(SUMMARY_MAX_LENGTH),
  duplicateCandidates: z.array(DuplicateCandidate),
  alreadyImplementedHint: AlreadyImplementedHint.optional(),
  riskSignals: z.array(z.string()),
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
