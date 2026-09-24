import { MAX_CLARIFICATION_QUESTIONS, type triageResultSchemaFor, type TriageResult } from '@ai-delivery-hub/domain';
import { z } from 'zod';
import type { triageWireSchema } from './structured-output.js';

/** Both triage runners retry exactly once on invalid output: the first attempt plus one corrective retry. */
export const MAX_TRIAGE_ATTEMPTS = 2;

export type TriageParseOutcome = { ok: true; value: TriageResult } | { ok: false; message: string };

/**
 * A model that ignores the "at most 5 questions" prompt instruction should not burn the one
 * corrective retry over a cosmetic overage: truncate `assessment.functional.questions` to
 * `MAX_CLARIFICATION_QUESTIONS` before schema validation sees it. Any other shape (missing
 * assessment, non-array questions, etc.) is left untouched for the schema to reject normally.
 */
function truncateAssessmentQuestions(candidate: unknown): unknown {
  if (candidate === null || typeof candidate !== 'object') return candidate;
  const c = candidate as Record<string, unknown>;
  const assessment = c['assessment'];
  if (assessment === null || typeof assessment !== 'object') return candidate;
  const a = assessment as Record<string, unknown>;
  const functional = a['functional'];
  if (functional === null || typeof functional !== 'object') return candidate;
  const f = functional as Record<string, unknown>;
  const questions = f['questions'];
  if (!Array.isArray(questions) || questions.length <= MAX_CLARIFICATION_QUESTIONS) return candidate;
  return { ...c, assessment: { ...a, functional: { ...f, questions: questions.slice(0, MAX_CLARIFICATION_QUESTIONS) } } };
}

/**
 * Validates an already-parsed candidate against the wire schema, then the repo-bound domain
 * schema, converting the wire's nullable `alreadyImplementedHint` and `assessment` into the
 * domain's optional fields (a `null` value is dropped entirely rather than kept as `null`).
 * Shared by `AnthropicTriageRunner` (which parses the reply text into JSON first) and
 * `ClaudeCodeTriageRunner` (which receives the Agent SDK's already-decoded `structured_output`).
 */
export function parseTriageCandidate(
  candidate: unknown,
  wire: ReturnType<typeof triageWireSchema>,
  domainSchema: ReturnType<typeof triageResultSchemaFor>,
): TriageParseOutcome {
  const wireParsed = wire.safeParse(truncateAssessmentQuestions(candidate));
  if (!wireParsed.success) return { ok: false, message: z.prettifyError(wireParsed.error) };
  const { alreadyImplementedHint, assessment, ...rest } = wireParsed.data;
  const domainCandidate: Record<string, unknown> = { ...rest };
  if (alreadyImplementedHint !== null) domainCandidate['alreadyImplementedHint'] = alreadyImplementedHint;
  if (assessment !== null) domainCandidate['assessment'] = assessment;
  const domainParsed = domainSchema.safeParse(domainCandidate);
  if (!domainParsed.success) return { ok: false, message: z.prettifyError(domainParsed.error) };
  return { ok: true, value: domainParsed.data };
}

/** The corrective instruction fed back to the model on the one retry, sharing the exact wording across both runners. */
export function triageCorrectiveMessage(validationError: string): string {
  return `Your previous answer was not a valid JSON object for the required schema: ${validationError}\nRespond again with ONLY the corrected JSON object.`;
}
