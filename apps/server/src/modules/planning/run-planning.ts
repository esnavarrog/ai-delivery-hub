import type { PlanVersionDto, RunDto } from '@ai-delivery-hub/contracts';
import {
  renderPlanMarkdown,
  TriageResult,
  type Actor,
  type Clock,
  type EventStore,
  type IdGenerator,
  type Plan,
  type RiskTier,
  type RunBudget,
  type RunFailureReason,
  type RunResult,
} from '@ai-delivery-hub/domain';
import type { RunBudgetPolicy } from '@ai-delivery-hub/policies';
import type { PlanningRunnerInput } from '../../adapters/agent/planning-runner.js';
import type { AcquiredWorktree, RepoWorktreePort } from '../../adapters/repo/git-worktree.js';
import type { PlanCommentsRepository, PlanVersionsRepository, RunsRepository } from '../shared/repositories.js';
import { TransitionDeniedError, appendCommand, type LoadedTicket } from '../shared/ticket-command.js';
import { ticketUntrustedContext } from '../triage/run-triage.js';

export interface PlanningScheduler {
  enqueuePlanning(ticketId: string): Promise<void>;
}

export interface PlanningRunnerLike {
  runPlanning(input: PlanningRunnerInput): Promise<RunResult<Plan>>;
}

export interface RunPlanningDeps {
  eventStore: EventStore;
  ids: IdGenerator;
  clock: Clock;
  runner: PlanningRunnerLike;
  runs: RunsRepository;
  planVersions: PlanVersionsRepository;
  planComments: PlanCommentsRepository;
  worktrees: RepoWorktreePort;
  policies: {
    models: { planning: Record<RiskTier, string> };
    budgets: { planning: RunBudgetPolicy };
  };
}

export type PlanningOutcome =
  | { kind: 'completed'; runId: string; version: number; planVersionId: string }
  | { kind: 'failed'; runId: string; reason: RunFailureReason; message: string }
  | { kind: 'skipped'; reason: string };

export const PLANNING_SYSTEM_ACTOR: Actor = { kind: 'system', id: 'planning-scheduler' };
export const PLANNING_AI_ACTOR: Actor = { kind: 'ai', id: 'planning-runner' };

/**
 * Runs the planning agent for a ticket in `planning`: read-only worktree → agent → `plan_versions`
 * row + `plan_version_created` (→ `plan_review`), or `run_failed` (→ `plan_changes_requested`).
 */
export class RunPlanning {
  constructor(private readonly deps: RunPlanningDeps) {}

  async execute(ticketId: string): Promise<PlanningOutcome> {
    const { deps } = this;
    const runId = deps.ids.uuid();
    const policy = deps.policies.budgets.planning;
    const budget: RunBudget = { maxTokens: policy.maxTokens, maxDurationMs: policy.maxDurationMs };
    if (policy.maxTurns !== undefined) budget.maxTurns = policy.maxTurns;

    let started;
    try {
      started = await appendCommand(deps, ticketId, ({ snapshot, guard, event }) => {
        if (snapshot.state !== 'planning') throw new TransitionDeniedError(ticketId, 'run_started', `ticket is in ${snapshot.state}, not planning`);
        if (snapshot.flags.includes('paused')) throw new TransitionDeniedError(ticketId, 'run_started', 'ticket is paused');
        guard(PLANNING_SYSTEM_ACTOR, 'run_started');
        return [event('run_started', PLANNING_SYSTEM_ACTOR, { runId, payload: { kind: 'planning' } })];
      });
    } catch (err) {
      if (err instanceof TransitionDeniedError) return { kind: 'skipped', reason: err.reason };
      throw err;
    }

    const tier: RiskTier = started.snapshot.riskTier ?? 'medium';
    const model = deps.policies.models.planning[tier];
    const run: RunDto = {
      id: runId,
      ticketId,
      kind: 'planning',
      status: 'running',
      model,
      inputTokens: 0,
      outputTokens: 0,
      costUsd: null,
      budgetTokens: budget.maxTokens,
      startedAt: deps.clock.nowIso(),
      endedAt: null,
      failureReason: null,
      errorMessage: null,
    };
    await deps.runs.insert(run);

    const result = await this.runAgent(runId, started, budget);
    const usagePatch = { inputTokens: result.usage.inputTokens, outputTokens: result.usage.outputTokens, costUsd: result.usage.costUsd ?? null, endedAt: deps.clock.nowIso() };

    if (!result.ok) {
      await appendCommand(deps, ticketId, ({ guard, event }) => {
        guard(PLANNING_SYSTEM_ACTOR, 'run_failed');
        const events = [];
        if (result.reason === 'budget_exhausted') events.push(event('budget_exhausted', PLANNING_SYSTEM_ACTOR, { runId, reason: result.message, payload: { kind: 'planning' } }));
        events.push(event('run_failed', PLANNING_SYSTEM_ACTOR, { runId, reason: result.message, payload: { kind: 'planning', reason: result.reason } }));
        return events;
      });
      await deps.runs.update(runId, { ...usagePatch, status: result.reason === 'budget_exhausted' ? 'budget_exhausted' : 'failed', failureReason: result.reason, errorMessage: result.message });
      return { kind: 'failed', runId, reason: result.reason, message: result.message };
    }

    const plan = result.value;
    const previous = await deps.planVersions.latest(ticketId);
    const version = started.snapshot.planVersionCount + 1;
    const planVersion: PlanVersionDto = {
      id: deps.ids.uuid(),
      ticketId,
      version,
      plan,
      renderedMarkdown: renderPlanMarkdown(plan),
      baseCommitSha: plan.baseCommitSha,
      status: 'review',
      createdAt: deps.clock.nowIso(),
    };
    await deps.planVersions.insert(planVersion);
    if (previous) await deps.planVersions.setStatus(previous.id, 'superseded');
    await appendCommand(deps, ticketId, ({ guard, event }) => {
      guard(PLANNING_AI_ACTOR, 'plan_version_created');
      return [
        event('plan_version_created', PLANNING_AI_ACTOR, {
          runId,
          payload: { version, baseCommitSha: plan.baseCommitSha, goal: plan.goal },
          artifacts: [{ kind: 'plan_version', ref: planVersion.id }],
        }),
        event('run_succeeded', PLANNING_SYSTEM_ACTOR, { runId, payload: { kind: 'planning', ...result.usage } }),
      ];
    });
    await deps.runs.update(runId, { ...usagePatch, status: 'succeeded' });
    return { kind: 'completed', runId, version, planVersionId: planVersion.id };
  }

  private async runAgent(runId: string, loaded: LoadedTicket, budget: RunBudget): Promise<RunResult<Plan>> {
    const { deps } = this;
    const zeroUsage = { inputTokens: 0, outputTokens: 0, durationMs: 0 };
    const fail = (message: string): RunResult<Plan> => ({ ok: false, reason: 'provider_error', message, usage: zeroUsage });
    const targetRepo = loaded.snapshot.targetRepo;
    if (!targetRepo) return fail('ticket has no target repository; confirm triage first');

    let worktree: AcquiredWorktree;
    try {
      worktree = await deps.worktrees.acquireReadOnly(targetRepo);
    } catch (err) {
      return fail(`could not prepare a read-only checkout of ${targetRepo}: ${err instanceof Error ? err.message : String(err)}`);
    }
    try {
      const previous = await deps.planVersions.latest(loaded.snapshot.id);
      const unresolved = (await deps.planComments.listByTicket(loaded.snapshot.id)).filter((c) => c.resolvedByVersion === null);
      const triageEvent = [...loaded.events].reverse().find((e) => e.type === 'triage_completed');
      const triage = triageEvent ? TriageResult.safeParse(triageEvent.payload) : undefined;
      const input: PlanningRunnerInput = {
        runId,
        ticket: loaded.snapshot,
        untrustedContext: ticketUntrustedContext(loaded),
        budget,
        targetRepo,
        baseCommitSha: worktree.headSha,
        worktreePath: worktree.path,
      };
      if (triage?.success) input.triage = triage.data;
      if (previous) input.previousPlan = previous.plan;
      if (unresolved.length > 0) input.reviewerFeedback = unresolved.map((c) => `[${c.sectionPath}] ${c.authorId}: ${c.body}`);
      return await deps.runner.runPlanning(input);
    } catch (err) {
      return fail(err instanceof Error ? err.message : String(err));
    } finally {
      await worktree.release().catch(() => undefined);
    }
  }
}
