import type { triageResultSchemaFor, TriageResult } from '@ai-delivery-hub/domain';
import { z } from 'zod';
import type { triageWireSchema } from './structured-output.js';

/** Both triage runners retry exactly once on invalid output: the first attempt plus one corrective retry. */
export const MAX_TRIAGE_ATTEMPTS = 2;

export type TriageParseOutcome = { ok: true; value: TriageResult } | { ok: false; message: string };

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
  const wireParsed = wire.safeParse(candidate);
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
