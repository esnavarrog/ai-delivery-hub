import type { RunDto } from '@ai-delivery-hub/contracts';
import {
  MAX_CLARIFICATION_ROUNDS,
  wrapUntrusted,
  type Actor,
  type Clock,
  type EventStore,
  type IdGenerator,
  type ManualIntake,
  type RunFailureReason,
  type RunResult,
  type TicketEvent,
  type TicketSnapshot,
  type TriageResult,
} from '@ai-delivery-hub/domain';
import type { RunBudgetPolicy } from '@ai-delivery-hub/policies';
import { MAX_RECENT_TICKETS, type ClarificationRound, type RecentTicket, type TriageRunnerInput } from '../../adapters/agent/triage-runner.js';
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
  | { kind: 'completed'; runId: string; next: 'awaiting_owner' | 'planning' | 'awaiting_requester' }
  | { kind: 'failed'; runId: string; reason: RunFailureReason; message: string }
  | { kind: 'skipped'; reason: string };

export const TRIAGE_SYSTEM_ACTOR: Actor = { kind: 'system', id: 'triage-scheduler' };
export const TRIAGE_AI_ACTOR: Actor = { kind: 'ai', id: 'triage-runner' };

/** After triage: a ticket that already has an owner skips `awaiting_owner`. */
export function triageFollowUp(snapshot: TicketSnapshot): 'planning_started' | 'owner_required' {
  return snapshot.ownerUserId ? 'planning_started' : 'owner_required';
}

/** Renders a manual feature request's structured intake as plain lines for the untrusted ticket block. */
function intakeLines(intake: ManualIntake): string[] {
  const lines = [
    '',
    'Structured intake:',
    `Department: ${intake.department}`,
    `Problem: ${intake.problem}`,
    `Affected: ${intake.affected}`,
    `Frequency: ${intake.frequency}`,
    `Current workaround: ${intake.currentWorkaround}`,
    `Expected outcome: ${intake.expectedOutcome}`,
  ];
  if (intake.successMetric !== undefined) lines.push(`Success metric: ${intake.successMetric}`);
  if (intake.deadline !== undefined) lines.push(`Deadline: ${intake.deadline}${intake.deadlineReason !== undefined ? ` (${intake.deadlineReason})` : ''}`);
  return lines;
}

/** The ticket facts the model may see, as one untrusted block. Never placed in the system prompt. */
export function ticketUntrustedContext(loaded: LoadedTicket): string {
  const received = loaded.events[0]?.payload as { status?: string; type?: string; intake?: ManualIntake } | undefined;
  const { source } = loaded.snapshot;
  const sourceLines =
    source.kind === 'openproject'
      ? [`OpenProject project id: ${source.projectId}`, `Work package: #${source.workPackageId}`]
      : [`Source: manual ticket ${source.key}`];
  const lines = [
    `Subject: ${loaded.snapshot.subject}`,
    `Type: ${received?.type ?? 'unknown'}`,
    `OpenProject status: ${received?.status ?? 'unknown'}`,
    `Priority: ${loaded.snapshot.priority}`,
    ...sourceLines,
    '',
    'Description:',
    loaded.description,
    ...(received?.intake !== undefined ? intakeLines(received.intake) : []),
  ];
  return wrapUntrusted('ticket', lines.join('\n'));
}

/**
 * Prior clarification rounds from the ticket's own event history: pairs each
 * `requester_questions_asked` with its matching `requester_answers_submitted` (when answered
 * already), oldest round first. Feeds a re-triage so the model refines instead of restarting.
 */
export function clarificationHistoryFrom(events: readonly TicketEvent[]): ClarificationRound[] {
  const rounds = new Map<number, ClarificationRound>();
  for (const event of events) {
    if (event.type === 'requester_questions_asked') {
      rounds.set(event.payload.round, { round: event.payload.round, questions: event.payload.questions, answers: [] });
    } else if (event.type === 'requester_answers_submitted') {
      const round = rounds.get(event.payload.round);
      if (round) round.answers = event.payload.answers;
    }
  }
  return [...rounds.values()].sort((a, b) => a.round - b.round);
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
      started = await appendCommand(deps, ticketId, ({ snapshot, guard, event }) => {
        // A ticket already in `triaging` got there via `requester_answers_submitted`: this is a
        // re-triage, no `triage_started` transition is needed (or valid) from that state.
        if (snapshot.state === 'triaging') {
          guard(TRIAGE_SYSTEM_ACTOR, 'run_started');
          return [event('run_started', TRIAGE_SYSTEM_ACTOR, { runId, payload: { kind: 'triage', model } })];
        }
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

    const questions = result.value.assessment?.functional.questions ?? [];
    const outcome = await appendCommand(deps, ticketId, ({ snapshot, guard, event }) => {
      const currentRound = snapshot.clarificationRound ?? 0;
      // After MAX_CLARIFICATION_ROUNDS the questions are still recorded on the assessment for a
      // human to see, but they no longer route the ticket back to the requester.
      if (questions.length > 0 && currentRound < MAX_CLARIFICATION_ROUNDS) {
        const round = currentRound + 1;
        const payload = { round, questions: questions.map((text, i) => ({ id: `q${round}-${i + 1}`, text })), assessment: result.value.assessment };
        guard(TRIAGE_AI_ACTOR, 'requester_questions_asked', { payload });
        return [
          event('requester_questions_asked', TRIAGE_AI_ACTOR, { runId, payload }),
          event('run_succeeded', TRIAGE_SYSTEM_ACTOR, { runId, payload: { kind: 'triage', ...result.usage } }),
        ];
      }
      guard(TRIAGE_AI_ACTOR, 'triage_completed');
      return [
        event('triage_completed', TRIAGE_AI_ACTOR, { runId, payload: result.value }),
        event('run_succeeded', TRIAGE_SYSTEM_ACTOR, { runId, payload: { kind: 'triage', ...result.usage } }),
      ];
    });
    await deps.runs.update(runId, { ...usagePatch, status: 'succeeded' });

    if (outcome.snapshot.state === 'awaiting_requester') {
      return { kind: 'completed', runId, next: 'awaiting_requester' };
    }

    const followUp = await appendCommand(deps, ticketId, ({ snapshot, guard, event }) => {
      const type = triageFollowUp(snapshot);
      guard(TRIAGE_SYSTEM_ACTOR, type);
      return [event(type, TRIAGE_SYSTEM_ACTOR, { runId })];
    });
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
      const recentTickets: RecentTicket[] = recent.map((t) => ({ id: t.id, displayKey: t.displayKey, subject: t.subject, state: t.state, targetRepo: t.targetRepo }));
      const clarificationHistory = clarificationHistoryFrom(loaded.events);
      return await deps.runner.runTriage({
        runId,
        ticket: loaded.snapshot,
        untrustedContext: ticketUntrustedContext(loaded),
        budget,
        allowedRepos: Object.keys(deps.policies.repos),
        recentTickets,
        ...(clarificationHistory.length > 0 ? { clarificationHistory } : {}),
      });
    } catch (err) {
      return { ok: false, reason: 'provider_error', message: err instanceof Error ? err.message : String(err), usage: { inputTokens: 0, outputTokens: 0, durationMs: 0 } };
    }
  }
}
