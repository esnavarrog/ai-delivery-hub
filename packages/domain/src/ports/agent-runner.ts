import { z } from 'zod';
import type { Plan } from '../plan/plan.js';
import type { TicketSnapshot } from '../ticket/ticket.js';
import type { TriageResult } from '../triage/triage-result.js';

export const RunBudget = z.object({
  maxTokens: z.number().int().positive(),
  maxDurationMs: z.number().int().positive(),
  /** Agentic runs only: maximum user/assistant turns before the run stops. */
  maxTurns: z.number().int().positive().optional(),
});
export type RunBudget = z.infer<typeof RunBudget>;

export const RunUsage = z.object({
  inputTokens: z.number().int().min(0),
  outputTokens: z.number().int().min(0),
  durationMs: z.number().int().min(0),
  /** Provider-reported cost when available (the Agent SDK reports `total_cost_usd`). */
  costUsd: z.number().min(0).optional(),
});
export type RunUsage = z.infer<typeof RunUsage>;

export const RunFailureReason = z.enum(['budget_exhausted', 'invalid_output', 'provider_error', 'cancelled']);
export type RunFailureReason = z.infer<typeof RunFailureReason>;

export type RunResult<T> =
  | { ok: true; value: T; usage: RunUsage }
  | { ok: false; reason: RunFailureReason; usage: RunUsage; message: string };

export interface RunInputBase {
  runId: string;
  ticket: TicketSnapshot;
  /** Already wrapped with `wrapUntrusted`; the adapter must not unwrap it. */
  untrustedContext: string;
  budget: RunBudget;
}

export interface TriageRunInput extends RunInputBase {
  allowedRepos: readonly string[];
}

export interface PlanningRunInput extends RunInputBase {
  targetRepo: string;
  baseCommitSha: string;
  previousPlan?: Plan;
  reviewerFeedback?: readonly string[];
}

/** Boundary to whatever executes the AI agents. Implementations live outside the domain. */
export interface AgentRunnerPort {
  runTriage(input: TriageRunInput): Promise<RunResult<TriageResult>>;
  runPlanning(input: PlanningRunInput): Promise<RunResult<Plan>>;
}
