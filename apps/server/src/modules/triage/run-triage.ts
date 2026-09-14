import type { RunDto } from '@ai-delivery-hub/contracts';
import {
  wrapUntrusted,
  type Actor,
  type Clock,
  type EventStore,
  type IdGenerator,
  type RunFailureReason,
  type RunResult,
  type TicketSnapshot,
  type TriageResult,
} from '@ai-delivery-hub/domain';
import type { RunBudgetPolicy } from '@ai-delivery-hub/policies';
import { MAX_RECENT_TICKETS, type RecentTicket, type TriageRunnerInput } from '../../adapters/agent/triage-runner.js';
import type { TicketFilters } from '../../http/app.js';
import type { PlanningScheduler } from '../planning/run-planning.js';
import type { RunsRepository } from '../shared/repositories.js';
import { TransitionDeniedError, appendCommand, type LoadedTicket } from '../shared/ticket-command.js';

export interface TriageRunnerLike {
  runTriage(input: TriageRunnerInput): Promise<RunResult<TriageResult>>;
}

export interface RunTriageDeps {
  eventStore: EventStore;
  ids: IdGenerator;
  clock: Clock;
  runner: TriageRunnerLike;
  runs: RunsRepository;
  /** Recent tickets feed duplicate suggestions; the ticket under triage is excluded. */
  tickets: { list(filters: TicketFilters): Promise<TicketSnapshot[]> };
  planning: PlanningScheduler;
  policies: {
    repos: Record<string, unknown>;
    models: { triage: string };
    budgets: { triage: RunBudgetPolicy };
  };
}

export type TriageOutcome =
  | { kind: 'completed'; runId: string; next: 'awaiting_owner' | 'planning' }
  | { kind: 'failed'; runId: string; reason: RunFailureReason; message: string }
  | { kind: 'skipped'; reason: string };

export const TRIAGE_SYSTEM_ACTOR: Actor = { kind: 'system', id: 'triage-scheduler' };
export const TRIAGE_AI_ACTOR: Actor = { kind: 'ai', id: 'triage-runner' };

/** After triage: a ticket that already has an owner skips `awaiting_owner`. */
export function triageFollowUp(snapshot: TicketSnapshot): 'planning_started' | 'owner_required' {
  return snapshot.ownerUserId ? 'planning_started' : 'owner_required';
}

/** The ticket facts the model may see, as one untrusted block. Never placed in the system prompt. */
export function ticketUntrustedContext(loaded: LoadedTicket): string {
  const received = loaded.events[0]?.payload as { status?: string; type?: string } | undefined;
  const lines = [
    `Subject: ${loaded.snapshot.subject}`,
    `Type: ${received?.type ?? 'unknown'}`,
    `OpenProject status: ${received?.status ?? 'unknown'}`,
    `Priority: ${loaded.snapshot.priority}`,
    `OpenProject project id: ${loaded.snapshot.opProjectId}`,
    `Work package: #${loaded.snapshot.opWorkPackageId}`,
    '',
    'Description:',
    loaded.description,
  ];
  return wrapUntrusted('ticket', lines.join('\n'));
}

/**
 * Runs the AI triage for one ticket: `triage_started` → agent → `triage_completed` + follow-up,
 * or `run_failed` back to `received`. Every attempt leaves a `runs` row. Idempotent per state:
 * a ticket that is not in `received` (or is paused) is skipped.
 */
export class RunTriage {
  constructor(private readonly deps: RunTriageDeps) {}

  async execute(ticketId: string): Promise<TriageOutcome> {
    const { deps } = this;
    const runId = deps.ids.uuid();
    const model = deps.policies.models.triage;
    const budget = { maxTokens: deps.policies.budgets.triage.maxTokens, maxDurationMs: deps.policies.budgets.triage.maxDurationMs };

    let started;
    try {
      started = await appendCommand(deps, ticketId, ({ guard, event }) => {
        guard(TRIAGE_SYSTEM_ACTOR, 'triage_started');
        return [event('triage_started', TRIAGE_SYSTEM_ACTOR, { runId }), event('run_started', TRIAGE_SYSTEM_ACTOR, { runId, payload: { kind: 'triage', model } })];
      });
    } catch (err) {
      if (err instanceof TransitionDeniedError) return { kind: 'skipped', reason: err.reason };
      throw err;
    }

    const startedAt = deps.clock.nowIso();
    const run: RunDto = {
      id: runId,
      ticketId,
      kind: 'triage',
      status: 'running',
      model,
      inputTokens: 0,
      outputTokens: 0,
      costUsd: null,
      budgetTokens: budget.maxTokens,
      startedAt,
      endedAt: null,
      failureReason: null,
      errorMessage: null,
    };
    await deps.runs.insert(run);

    const result = await this.runAgent(runId, started, budget);
    const usagePatch = { inputTokens: result.usage.inputTokens, outputTokens: result.usage.outputTokens, costUsd: result.usage.costUsd ?? null, endedAt: deps.clock.nowIso() };

    if (!result.ok) {
      await appendCommand(deps, ticketId, ({ guard, event }) => {
        guard(TRIAGE_SYSTEM_ACTOR, 'run_failed');
        const events = [];
        if (result.reason === 'budget_exhausted') events.push(event('budget_exhausted', TRIAGE_SYSTEM_ACTOR, { runId, reason: result.message, payload: { kind: 'triage' } }));
        events.push(event('run_failed', TRIAGE_SYSTEM_ACTOR, { runId, reason: result.message, payload: { kind: 'triage', reason: result.reason } }));
        return events;
      });
      await deps.runs.update(runId, { ...usagePatch, status: result.reason === 'budget_exhausted' ? 'budget_exhausted' : 'failed', failureReason: result.reason, errorMessage: result.message });
      return { kind: 'failed', runId, reason: result.reason, message: result.message };
    }

    await appendCommand(deps, ticketId, ({ guard, event }) => {
      guard(TRIAGE_AI_ACTOR, 'triage_completed');
      return [
        event('triage_completed', TRIAGE_AI_ACTOR, { runId, payload: result.value }),
        event('run_succeeded', TRIAGE_SYSTEM_ACTOR, { runId, payload: { kind: 'triage', ...result.usage } }),
      ];
    });
    const followUp = await appendCommand(deps, ticketId, ({ snapshot, guard, event }) => {
      const type = triageFollowUp(snapshot);
      guard(TRIAGE_SYSTEM_ACTOR, type);
      return [event(type, TRIAGE_SYSTEM_ACTOR, { runId })];
    });
    await deps.runs.update(runId, { ...usagePatch, status: 'succeeded' });
    if (followUp.snapshot.state === 'planning') {
      await deps.planning.enqueuePlanning(ticketId);
      return { kind: 'completed', runId, next: 'planning' };
    }
    return { kind: 'completed', runId, next: 'awaiting_owner' };
  }

  private async runAgent(runId: string, loaded: LoadedTicket, budget: { maxTokens: number; maxDurationMs: number }): Promise<RunResult<TriageResult>> {
    const { deps } = this;
    try {
      const recent = (await deps.tickets.list({})).filter((t) => t.id !== loaded.snapshot.id).slice(0, MAX_RECENT_TICKETS);
      const recentTickets: RecentTicket[] = recent.map((t) => ({ id: t.id, opWorkPackageId: t.opWorkPackageId, subject: t.subject, state: t.state, targetRepo: t.targetRepo }));
      return await deps.runner.runTriage({
        runId,
        ticket: loaded.snapshot,
        untrustedContext: ticketUntrustedContext(loaded),
        budget,
        allowedRepos: Object.keys(deps.policies.repos),
        recentTickets,
      });
    } catch (err) {
      return { ok: false, reason: 'provider_error', message: err instanceof Error ? err.message : String(err), usage: { inputTokens: 0, outputTokens: 0, durationMs: 0 } };
    }
  }
}
