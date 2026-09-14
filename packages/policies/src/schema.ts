import { RiskTier, Role, TicketState } from '@ai-delivery-hub/domain';
import { z } from 'zod';

export const RepoStack = z.enum(['rails', 'fastapi', 'flutter', 'next']);
export type RepoStack = z.infer<typeof RepoStack>;

export const RepoPolicy = z.object({
  remote: z.string().min(1),
  defaultBranch: z.string().min(1),
  testCommand: z.string().min(1),
  stack: RepoStack,
  /** Supports `{wpId}` and `{slug}` placeholders. */
  branchPattern: z.string().min(1),
});
export type RepoPolicy = z.infer<typeof RepoPolicy>;

const ModelName = z.string().min(1);

/** Claude `output_config.effort` levels; controls thinking depth and token spend per run kind. */
export const EffortLevel = z.enum(['low', 'medium', 'high', 'xhigh', 'max']);
export type EffortLevel = z.infer<typeof EffortLevel>;

export const EffortPolicy = z.object({
  triage: EffortLevel.default('low'),
  planning: EffortLevel.default('high'),
});
export type EffortPolicy = z.infer<typeof EffortPolicy>;

export const ModelPolicy = z.object({
  triage: ModelName.default('claude-opus-5'),
  planning: z.object({ low: ModelName, medium: ModelName, high: ModelName }),
  effort: EffortPolicy.prefault({}),
});
export type ModelPolicy = z.infer<typeof ModelPolicy>;

export const RunBudgetPolicy = z.object({
  maxTokens: z.number().int().positive(),
  maxDurationMs: z.number().int().positive(),
  /** Agentic (planning) runs only: hard stop on user/assistant turns. */
  maxTurns: z.number().int().positive().optional(),
});
export type RunBudgetPolicy = z.infer<typeof RunBudgetPolicy>;

export const BudgetPolicy = z.object({ triage: RunBudgetPolicy, planning: RunBudgetPolicy });
export type BudgetPolicy = z.infer<typeof BudgetPolicy>;

/**
 * How a work package opts into the hub:
 * - `status`: its OpenProject status equals `statusName` (needs an OP admin to create the status);
 * - `prefix`: its subject starts with `subjectPrefix` (no admin needed);
 * - `status_or_prefix`: either.
 */
export const TriggerRule = z
  .object({
    kind: z.enum(['status', 'prefix', 'status_or_prefix']),
    statusName: z.string().min(1).optional(),
    subjectPrefix: z.string().min(1).optional(),
  })
  .superRefine((rule, ctx) => {
    if (rule.kind !== 'prefix' && rule.statusName === undefined) {
      ctx.addIssue({ code: 'custom', path: ['statusName'], message: `statusName is required for kind ${rule.kind}` });
    }
    if (rule.kind !== 'status' && rule.subjectPrefix === undefined) {
      ctx.addIssue({ code: 'custom', path: ['subjectPrefix'], message: `subjectPrefix is required for kind ${rule.kind}` });
    }
  });
export type TriggerRule = z.infer<typeof TriggerRule>;

export const OpenProjectPolicy = z.object({
  projectIds: z.array(z.number().int().positive()).min(1),
  trigger: TriggerRule,
  /** Ticket state -> OpenProject status name. States absent here are not mirrored. */
  statusSync: z.partialRecord(TicketState, z.string().min(1)),
});
export type OpenProjectPolicy = z.infer<typeof OpenProjectPolicy>;

export const ReposFile = z.object({
  repos: z.record(z.string().min(1), RepoPolicy).refine((r) => Object.keys(r).length > 0, 'at least one repo is required'),
  models: ModelPolicy,
  budgets: BudgetPolicy,
  openproject: OpenProjectPolicy,
  /** GitHub login -> role. */
  roles: z.record(z.string().min(1), Role),
});
export type ReposFile = z.infer<typeof ReposFile>;

export const RiskPathRule = z.object({ glob: z.string().min(1), tier: RiskTier });
export type RiskPathRule = z.infer<typeof RiskPathRule>;

export const RiskPathsFile = z.object({ rules: z.array(RiskPathRule) });
export type RiskPathsFile = z.infer<typeof RiskPathsFile>;
