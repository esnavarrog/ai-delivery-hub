import { renderPlanMarkdown, type TicketEvent } from '@ai-delivery-hub/domain';
import { beforeEach, describe, expect, it } from 'vitest';
import type { PlanningRunnerInput } from '../../src/adapters/agent/planning-runner.js';
import { projectTicket } from '../../src/modules/ingest/ticket-received.js';
import { RunPlanning } from '../../src/modules/planning/run-planning.js';
import { FakeAgentRunner, FakeWorktrees, SHA_HEAD, okUsage, plan, triageResult } from '../helpers/fake-agent-runner.js';
import {
  FixedClock,
  MemoryEventStore,
  MemoryPlanCommentsRepository,
  MemoryPlanVersionsRepository,
  MemoryRunsRepository,
  SequentialIds,
  receivedEvent,
} from '../helpers/memory.js';

const policies = {
  models: { planning: { low: 'claude-sonnet-5', medium: 'claude-opus-5', high: 'claude-opus-5' } },
  budgets: { planning: { maxTokens: 150_000, maxDurationMs: 600_000, maxTurns: 40 } },
};

let seq = 1;
function ev(ticketId: string, type: TicketEvent['type'], actor: TicketEvent['actor'], payload: Record<string, unknown> = {}, createdAt = '2026-09-14T11:30:00.000Z'): TicketEvent {
  seq += 1;
  return { ...receivedEvent(ticketId), id: `30000000-0000-4000-8000-${String(seq).padStart(12, '0')}`, seq, type, actor, payload, createdAt } as TicketEvent;
}

/** received → triaging → triaged → awaiting_owner → planning (claimed by ana). */
function planningStream(ticketId: string): TicketEvent[] {
  seq = 1;
  return [
    receivedEvent(ticketId),
    ev(ticketId, 'triage_started', { kind: 'system', id: 'x' }),
    ev(ticketId, 'triage_completed', { kind: 'ai', id: 'x' }, triageResult({ riskTier: 'high' })),
    ev(ticketId, 'owner_required', { kind: 'system', id: 'x' }),
    ev(ticketId, 'ticket_claimed', { kind: 'dev', id: 'ana' }, { ownerUserId: 'ana' }),
  ];
}

describe('RunPlanning', () => {
  let store: MemoryEventStore;
  let runs: MemoryRunsRepository;
  let versions: MemoryPlanVersionsRepository;
  let comments: MemoryPlanCommentsRepository;
  let runner: FakeAgentRunner;
  let worktrees: FakeWorktrees;
  let useCase: RunPlanning;

  beforeEach(async () => {
    store = new MemoryEventStore();
    runs = new MemoryRunsRepository();
    versions = new MemoryPlanVersionsRepository();
    comments = new MemoryPlanCommentsRepository(versions);
    runner = new FakeAgentRunner();
    worktrees = new FakeWorktrees();
    useCase = new RunPlanning({
      eventStore: store,
      ids: new SequentialIds(),
      clock: new FixedClock(),
      runner,
      runs,
      planVersions: versions,
      planComments: comments,
      worktrees,
      policies,
    });
    const stream = planningStream('t-1');
    await store.append('t-1', 0, stream);
  });

  const snapshot = async () => projectTicket(await store.load('t-1')).snapshot;

  it('happy path: acquires a worktree, stores plan v1 with markdown and moves the ticket to plan_review', async () => {
    runner.scriptPlanning({ ok: true, value: plan(), usage: { ...okUsage, costUsd: 0.42 } });
    const outcome = await useCase.execute('t-1');
    expect(outcome).toMatchObject({ kind: 'completed', version: 1 });
    expect(store.types('t-1').slice(-3)).toEqual(['run_started', 'plan_version_created', 'run_succeeded']);
    expect((await snapshot())).toMatchObject({ state: 'plan_review', planVersionCount: 1 });

    const [stored] = await versions.listByTicket('t-1');
    expect(stored).toMatchObject({ ticketId: 't-1', version: 1, plan: plan(), baseCommitSha: SHA_HEAD, status: 'review' });
    expect(stored?.renderedMarkdown).toBe(renderPlanMarkdown(plan()));

    const created = (await store.load('t-1')).find((e) => e.type === 'plan_version_created')!;
    expect(created.actor).toEqual({ kind: 'ai', id: 'planning-runner' });
    expect(created.payload).toEqual({ version: 1, baseCommitSha: SHA_HEAD, goal: plan().goal });
    expect(created.artifacts).toEqual([{ kind: 'plan_version', ref: stored?.id }]);

    expect(worktrees.acquired).toEqual(['backend-parkingapp']);
    expect(worktrees.released).toHaveLength(1);
    const input = runner.planningInputs[0] as PlanningRunnerInput;
    expect(input.worktreePath).toBe(worktrees.released[0]);
    expect(input.baseCommitSha).toBe(SHA_HEAD);
    expect(input.targetRepo).toBe('backend-parkingapp');
    expect(input.budget).toEqual({ maxTokens: 150_000, maxDurationMs: 600_000, maxTurns: 40 });
    expect(input.triage?.riskTier).toBe('high');
    expect(input.previousPlan).toBeUndefined();
    expect(input.reviewerFeedback).toBeUndefined();

    const [run] = await runs.list({ ticketId: 't-1' });
    expect(run).toMatchObject({ kind: 'planning', status: 'succeeded', model: 'claude-opus-5', costUsd: 0.42, budgetTokens: 150_000 });
  });

  it('re-plan: passes the previous plan and unresolved comments, supersedes v1 and creates v2', async () => {
    runner.scriptPlanning({ ok: true, value: plan(), usage: okUsage }, { ok: true, value: plan({ goal: 'Revised goal' }), usage: okUsage });
    await useCase.execute('t-1');
    const [v1] = await versions.listByTicket('t-1');
    await comments.insert({ id: 'c-1', planVersionId: v1!.id, sectionPath: 'steps[0]', authorId: 'ana', body: 'Add a request spec too', resolvedByVersion: null, createdAt: '2026-09-14T12:10:00.000Z' });
    await comments.insert({ id: 'c-2', planVersionId: v1!.id, sectionPath: 'goal', authorId: 'ana', body: 'already handled', resolvedByVersion: 1, createdAt: '2026-09-14T12:11:00.000Z' });
    const events = await store.load('t-1');
    const n = events.length;
    await store.append('t-1', n, [
      { ...receivedEvent('t-1'), id: '40000000-0000-4000-8000-000000000001', seq: n + 1, type: 'plan_comment_added', actor: { kind: 'dev', id: 'ana' }, payload: { commentId: 'c-1' } },
      { ...receivedEvent('t-1'), id: '40000000-0000-4000-8000-000000000002', seq: n + 2, type: 'plan_changes_requested', actor: { kind: 'dev', id: 'ana' }, payload: {} },
      { ...receivedEvent('t-1'), id: '40000000-0000-4000-8000-000000000003', seq: n + 3, type: 'replan_requested', actor: { kind: 'dev', id: 'ana' }, payload: {} },
    ] as never);

    const outcome = await useCase.execute('t-1');
    expect(outcome).toMatchObject({ kind: 'completed', version: 2 });
    const input = runner.planningInputs[1]!;
    expect(input.previousPlan).toEqual(plan());
    expect(input.reviewerFeedback).toEqual(['[steps[0]] ana: Add a request spec too']);
    const all = await versions.listByTicket('t-1');
    expect(all.map((v) => [v.version, v.status])).toEqual([
      [1, 'superseded'],
      [2, 'review'],
    ]);
    expect((await snapshot())).toMatchObject({ state: 'plan_review', planVersionCount: 2 });
  });

  it('skips when the ticket is not in planning, or is paused', async () => {
    const idle = new MemoryEventStore();
    await idle.append('t-9', 0, [receivedEvent('t-9')]);
    const idleCase = new RunPlanning({ eventStore: idle, ids: new SequentialIds(), clock: new FixedClock(), runner, runs, planVersions: versions, planComments: comments, worktrees, policies });
    expect(await idleCase.execute('t-9')).toMatchObject({ kind: 'skipped' });

    const events = await store.load('t-1');
    await store.append('t-1', events.length, [{ ...receivedEvent('t-1'), id: '40000000-0000-4000-8000-000000000009', seq: events.length + 1, type: 'flag_set', actor: { kind: 'dev', id: 'ana' }, payload: { flag: 'paused' } } as never]);
    expect(await useCase.execute('t-1')).toMatchObject({ kind: 'skipped', reason: expect.stringMatching(/paused/) });
    expect(runner.planningInputs).toHaveLength(0);
    expect(worktrees.acquired).toHaveLength(0);
  });

  it('on failure: run_failed moves the ticket to plan_changes_requested, the worktree is released and nothing is stored', async () => {
    runner.scriptPlanning({ ok: false, reason: 'invalid_output', message: 'steps must contain at least 1 item', usage: okUsage });
    const outcome = await useCase.execute('t-1');
    expect(outcome).toMatchObject({ kind: 'failed', reason: 'invalid_output' });
    expect(store.types('t-1').slice(-2)).toEqual(['run_started', 'run_failed']);
    expect((await snapshot()).state).toBe('plan_changes_requested');
    expect(await versions.listByTicket('t-1')).toEqual([]);
    expect(worktrees.released).toHaveLength(1);
    expect((await runs.list({ ticketId: 't-1' }))[0]).toMatchObject({ status: 'failed', failureReason: 'invalid_output', errorMessage: 'steps must contain at least 1 item' });
  });

  it('on budget_exhausted: records the budget event and marks the run budget_exhausted', async () => {
    runner.scriptPlanning({ ok: false, reason: 'budget_exhausted', message: 'time budget of 600000ms exhausted', usage: okUsage });
    await useCase.execute('t-1');
    expect(store.types('t-1').slice(-3)).toEqual(['run_started', 'budget_exhausted', 'run_failed']);
    expect((await runs.list({ ticketId: 't-1' }))[0]).toMatchObject({ status: 'budget_exhausted' });
  });

  it('fails as provider_error when the worktree cannot be acquired', async () => {
    worktrees.failWith = new Error('git clone failed: authentication required');
    const outcome = await useCase.execute('t-1');
    expect(outcome).toMatchObject({ kind: 'failed', reason: 'provider_error', message: expect.stringMatching(/git clone failed/) });
    expect((await snapshot()).state).toBe('plan_changes_requested');
    expect(runner.planningInputs).toHaveLength(0);
  });

  it('releases the worktree even when the runner throws', async () => {
    runner.runPlanning = async () => {
      throw new Error('sdk crashed');
    };
    const outcome = await useCase.execute('t-1');
    expect(outcome).toMatchObject({ kind: 'failed', reason: 'provider_error', message: 'sdk crashed' });
    expect(worktrees.released).toHaveLength(1);
  });

  it('upcasts a legacy triage_completed payload (opWorkPackageId duplicate candidates) before handing it to the planner', async () => {
    const legacyDuplicate = { ticketId: 't-0', opWorkPackageId: 4700, similarity: 0.9, reason: 'same subject' };
    const legacyStream: TicketEvent[] = [
      receivedEvent('t-2'),
      { ...receivedEvent('t-2'), id: '50000000-0000-4000-8000-000000000002', seq: 2, type: 'triage_started', actor: { kind: 'system', id: 'x' }, payload: {} } as never,
      {
        ...receivedEvent('t-2'),
        id: '50000000-0000-4000-8000-000000000003',
        seq: 3,
        type: 'triage_completed',
        actor: { kind: 'ai', id: 'x' },
        payload: { ...triageResult(), duplicateCandidates: [legacyDuplicate] },
      } as never,
      { ...receivedEvent('t-2'), id: '50000000-0000-4000-8000-000000000004', seq: 4, type: 'owner_required', actor: { kind: 'system', id: 'x' }, payload: {} } as never,
      { ...receivedEvent('t-2'), id: '50000000-0000-4000-8000-000000000005', seq: 5, type: 'ticket_claimed', actor: { kind: 'dev', id: 'ana' }, payload: { ownerUserId: 'ana' } } as never,
    ];
    await store.append('t-2', 0, legacyStream);
    runner.scriptPlanning({ ok: true, value: plan(), usage: okUsage });
    await useCase.execute('t-2');
    const input = runner.planningInputs[0] as PlanningRunnerInput;
    expect(input.triage?.duplicateCandidates).toEqual([{ ticketId: 't-0', displayKey: 'OP-4700', similarity: 0.9, reason: 'same subject' }]);
  });
});
