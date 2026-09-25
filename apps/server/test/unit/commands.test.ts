import type { TicketEvent } from '@ai-delivery-hub/domain';
import { beforeEach, describe, expect, it } from 'vitest';
import { TicketCommands, actorFor, isWaitingOn, type HubUser } from '../../src/modules/approval/commands.js';
import { projectTicket } from '../../src/modules/ingest/ticket-received.js';
import { ForbiddenError, InvalidCommandError, TicketNotFoundError, TransitionDeniedError } from '../../src/modules/shared/ticket-command.js';
import { SHA_HEAD, plan, triageResult } from '../helpers/fake-agent-runner.js';
import { FixedClock, MemoryEventStore, MemoryPlanCommentsRepository, MemoryPlanVersionsRepository, SequentialIds, receivedEvent } from '../helpers/memory.js';

const ana: HubUser = { login: 'ana', role: 'dev' };
const bob: HubUser = { login: 'bob', role: 'dev' };
const lead: HubUser = { login: 'lea', role: 'lead' };
const admin: HubUser = { login: 'Macstban', role: 'admin' };
const requester: HubUser = { login: 'req', role: 'requester' };
const qa: HubUser = { login: 'quinn', role: 'qa' };

let seq = 1;
function ev(ticketId: string, type: TicketEvent['type'], actor: TicketEvent['actor'], payload: Record<string, unknown> = {}, extra: Record<string, unknown> = {}): TicketEvent {
  seq += 1;
  return { ...receivedEvent(ticketId), id: `50000000-0000-4000-8000-${String(seq).padStart(12, '0')}`, seq, type, actor, payload, createdAt: `2026-09-14T11:${String(seq).padStart(2, '0')}:00.000Z`, ...extra } as TicketEvent;
}

const sys = { kind: 'system', id: 'x' } as const;
const ai = { kind: 'ai', id: 'x' } as const;

function awaitingOwnerStream(ticketId: string): TicketEvent[] {
  seq = 1;
  return [receivedEvent(ticketId), ev(ticketId, 'triage_started', sys), ev(ticketId, 'triage_completed', ai, triageResult()), ev(ticketId, 'owner_required', sys)];
}

function planReviewStream(ticketId: string, owner = 'ana', riskTier: 'low' | 'medium' | 'high' = 'medium'): TicketEvent[] {
  seq = 1;
  return [
    receivedEvent(ticketId),
    ev(ticketId, 'triage_started', sys),
    ev(ticketId, 'triage_completed', ai, triageResult({ riskTier })),
    ev(ticketId, 'owner_required', sys),
    ev(ticketId, 'ticket_claimed', { kind: 'dev', id: owner }, { ownerUserId: owner }),
    ev(ticketId, 'plan_version_created', ai, { version: 1, baseCommitSha: SHA_HEAD }, { artifacts: [{ kind: 'plan_version', ref: 'v-1' }] }),
  ];
}

describe('actorFor', () => {
  it('maps hub roles to domain actor kinds', () => {
    expect(actorFor(ana)).toEqual({ kind: 'dev', id: 'ana' });
    expect(actorFor(lead)).toEqual({ kind: 'dev', id: 'lea' });
    expect(actorFor(admin)).toEqual({ kind: 'dev', id: 'Macstban' });
    expect(actorFor(requester)).toEqual({ kind: 'dev', id: 'req' });
    expect(actorFor(qa)).toEqual({ kind: 'qa', id: 'quinn' });
  });
});

describe('isWaitingOn', () => {
  const base = projectTicket(awaitingOwnerStream('t-1')).snapshot;
  it('awaiting_owner waits on every dev, lead and admin; not on requesters or qa', () => {
    expect(isWaitingOn(base, ana)).toBe(true);
    expect(isWaitingOn(base, lead)).toBe(true);
    expect(isWaitingOn(base, admin)).toBe(true);
    expect(isWaitingOn(base, requester)).toBe(false);
    expect(isWaitingOn(base, qa)).toBe(false);
  });
  it('plan_review / plan_changes_requested wait on the owner only', () => {
    const review = { ...base, state: 'plan_review' as const, ownerUserId: 'ana' };
    expect(isWaitingOn(review, ana)).toBe(true);
    expect(isWaitingOn(review, bob)).toBe(false);
    expect(isWaitingOn(review, lead)).toBe(false);
    expect(isWaitingOn({ ...review, state: 'plan_changes_requested' }, ana)).toBe(true);
  });
  it('triaged waits on leads and admins (rejection decisions)', () => {
    const triaged = { ...base, state: 'triaged' as const };
    expect(isWaitingOn(triaged, lead)).toBe(true);
    expect(isWaitingOn(triaged, admin)).toBe(true);
    expect(isWaitingOn(triaged, ana)).toBe(false);
    expect(isWaitingOn({ ...base, state: 'planning' }, ana)).toBe(false);
  });
});

describe('TicketCommands', () => {
  let store: MemoryEventStore;
  let versions: MemoryPlanVersionsRepository;
  let comments: MemoryPlanCommentsRepository;
  let triageQueue: string[];
  let planningQueue: string[];
  let clock: FixedClock;
  let commands: TicketCommands;

  beforeEach(() => {
    store = new MemoryEventStore();
    versions = new MemoryPlanVersionsRepository();
    comments = new MemoryPlanCommentsRepository(versions);
    triageQueue = [];
    planningQueue = [];
    clock = new FixedClock('2026-09-14T12:00:00.000Z');
    commands = new TicketCommands({
      eventStore: store,
      ids: new SequentialIds(),
      clock,
      planVersions: versions,
      planComments: comments,
      triage: { enqueueTriage: async (id) => void triageQueue.push(id) },
      planning: { enqueuePlanning: async (id) => void planningQueue.push(id) },
      allowedRepos: ['backend-parkingapp', 'libredte-api'],
    });
  });

  const seedReview = async (owner = 'ana', riskTier: 'low' | 'medium' | 'high' = 'medium') => {
    await store.append('t-1', 0, planReviewStream('t-1', owner, riskTier));
    await versions.insert({ id: 'v-1', ticketId: 't-1', version: 1, plan: plan(), renderedMarkdown: '# Plan', baseCommitSha: SHA_HEAD, status: 'review', createdAt: '2026-09-14T11:06:00.000Z' });
  };
  const state = async (id = 't-1') => projectTicket(await store.load(id)).snapshot;

  describe('claimTicket', () => {
    it('lets a dev claim an awaiting_owner ticket and moves it to planning, enqueuing the planning job', async () => {
      await store.append('t-1', 0, awaitingOwnerStream('t-1'));
      const result = await commands.claimTicket('t-1', ana);
      expect(result.snapshot).toMatchObject({ state: 'planning', ownerUserId: 'ana' });
      expect(store.types('t-1').at(-1)).toBe('ticket_claimed');
      expect(planningQueue).toEqual(['t-1']);
    });
    it('rejects a requester (403) and an unknown ticket (404)', async () => {
      await store.append('t-1', 0, awaitingOwnerStream('t-1'));
      await expect(commands.claimTicket('t-1', requester)).rejects.toBeInstanceOf(ForbiddenError);
      await expect(commands.claimTicket('nope', ana)).rejects.toBeInstanceOf(TicketNotFoundError);
    });
    it('refuses to claim a ticket that is not awaiting an owner (409)', async () => {
      await seedReview();
      await expect(commands.claimTicket('t-1', bob)).rejects.toBeInstanceOf(TransitionDeniedError);
    });
  });

  describe('confirmTriage', () => {
    it('records a state-keeping triage_confirmed with the overrides applied to the snapshot', async () => {
      await store.append('t-1', 0, awaitingOwnerStream('t-1'));
      const result = await commands.confirmTriage('t-1', ana, { riskTier: 'high', targetRepo: 'libredte-api' });
      expect(result.snapshot).toMatchObject({ state: 'awaiting_owner', riskTier: 'high', targetRepo: 'libredte-api', category: 'bug' });
      const last = (await store.load('t-1')).at(-1)!;
      expect(last.type).toBe('triage_confirmed');
      expect(last.payload).toEqual({ riskTier: 'high', targetRepo: 'libredte-api' });
    });
    it('rejects a target repo that is not in the policies (400) and a non-owner once owned (409)', async () => {
      await store.append('t-1', 0, awaitingOwnerStream('t-1'));
      await expect(commands.confirmTriage('t-1', ana, { targetRepo: 'unknown-repo' })).rejects.toBeInstanceOf(InvalidCommandError);
      const owned = new MemoryEventStore();
      await owned.append('t-2', 0, [...planReviewStream('t-2'), ev('t-2', 'plan_changes_requested', { kind: 'dev', id: 'ana' }, {}, { reason: 'x' })]);
      const ownedCommands = new TicketCommands({ eventStore: owned, ids: new SequentialIds(), clock, planVersions: versions, planComments: comments, triage: { enqueueTriage: async () => {} }, planning: { enqueuePlanning: async () => {} }, allowedRepos: ['libredte-api'] });
      await expect(ownedCommands.confirmTriage('t-2', bob, { riskTier: 'low' })).rejects.toBeInstanceOf(TransitionDeniedError);
      expect((await ownedCommands.confirmTriage('t-2', ana, { riskTier: 'low' })).snapshot.riskTier).toBe('low');
    });
    it('passes a score override through to the triage_confirmed payload and recomputes RICE on the snapshot', async () => {
      await store.append('t-1', 0, awaitingOwnerStream('t-1'));
      const scores = { value: 5, reach: 4, confidence: 1 as const, effort: 'S' as const };
      const result = await commands.confirmTriage('t-1', ana, { scores });
      expect(result.snapshot).toMatchObject({ value: 5, reach: 4, confidence: 1, effort: 'S', riceScore: 20 });
      const last = (await store.load('t-1')).at(-1)!;
      expect(last.type).toBe('triage_confirmed');
      expect(last.payload).toEqual({ scores });
    });
  });

  describe('plan comments', () => {
    it('adds a comment on the latest version by default, stores the row and bumps the unresolved counter', async () => {
      await seedReview();
      const result = await commands.addPlanComment('t-1', ana, { sectionPath: 'steps[0]', body: 'Add a request spec' });
      expect(result.comment).toMatchObject({ planVersionId: 'v-1', sectionPath: 'steps[0]', authorId: 'ana', body: 'Add a request spec', resolvedByVersion: null });
      expect(result.snapshot.unresolvedCommentCount).toBe(1);
      expect(await comments.get(result.comment.id)).toEqual(result.comment);
      const last = (await store.load('t-1')).at(-1)!;
      expect(last.type).toBe('plan_comment_added');
      expect(last.payload).toEqual({ commentId: result.comment.id, planVersionId: 'v-1', sectionPath: 'steps[0]' });
    });
    it('lets a requester comment but not resolve; rejects a foreign plan version', async () => {
      await seedReview();
      const added = await commands.addPlanComment('t-1', requester, { sectionPath: 'goal', body: 'Please also cover mobile' });
      await expect(commands.resolvePlanComment('t-1', requester, added.comment.id)).rejects.toBeInstanceOf(ForbiddenError);
      await expect(commands.addPlanComment('t-1', ana, { sectionPath: 'goal', body: 'x', planVersionId: 'v-other' })).rejects.toBeInstanceOf(InvalidCommandError);
    });
    it('resolves a comment once, recording the current plan version', async () => {
      await seedReview();
      const added = await commands.addPlanComment('t-1', ana, { sectionPath: 'goal', body: 'Too broad' });
      const resolved = await commands.resolvePlanComment('t-1', ana, added.comment.id);
      expect(resolved.snapshot.unresolvedCommentCount).toBe(0);
      expect(await comments.get(added.comment.id)).toMatchObject({ resolvedByVersion: 1 });
      await expect(commands.resolvePlanComment('t-1', ana, added.comment.id)).rejects.toBeInstanceOf(TransitionDeniedError);
      await expect(commands.resolvePlanComment('t-1', ana, 'missing')).rejects.toBeInstanceOf(TicketNotFoundError);
    });
    it('refuses comments before any plan version exists', async () => {
      await store.append('t-1', 0, awaitingOwnerStream('t-1'));
      await expect(commands.addPlanComment('t-1', ana, { sectionPath: 'goal', body: 'x' })).rejects.toBeInstanceOf(TransitionDeniedError);
    });
  });

  describe('requestPlanChanges / replan', () => {
    it('needs a reason or an unresolved comment', async () => {
      await seedReview();
      await expect(commands.requestPlanChanges('t-1', ana, {})).rejects.toBeInstanceOf(InvalidCommandError);
      const result = await commands.requestPlanChanges('t-1', ana, { reason: 'Scope is too wide' });
      expect(result.snapshot.state).toBe('plan_changes_requested');
      expect((await store.load('t-1')).at(-1)?.reason).toBe('Scope is too wide');
    });
    it('accepts without a reason when comments are pending, and only from the owner, a lead or an admin', async () => {
      await seedReview();
      await commands.addPlanComment('t-1', bob, { sectionPath: 'goal', body: 'Hmm' });
      await expect(commands.requestPlanChanges('t-1', bob, {})).rejects.toBeInstanceOf(TransitionDeniedError);
      expect((await commands.requestPlanChanges('t-1', lead, {})).snapshot.state).toBe('plan_changes_requested');
    });
    it('replan moves back to planning and enqueues the job; the 3-version guard needs a fresh human comment', async () => {
      await seedReview();
      await commands.requestPlanChanges('t-1', ana, { reason: 'x' });
      const result = await commands.replan('t-1', ana, {});
      expect(result.snapshot.state).toBe('planning');
      expect(result.enqueued).toBe('planning');
      expect(planningQueue).toEqual(['t-1']);

      // three versions without a newer human comment → denied
      const events = await store.load('t-1');
      const n = events.length;
      await store.append('t-1', n, [
        ev('t-1', 'plan_version_created', ai, { version: 2, baseCommitSha: SHA_HEAD }, { seq: n + 1, createdAt: '2026-09-14T12:30:00.000Z' }),
        ev('t-1', 'plan_changes_requested', { kind: 'dev', id: 'ana' }, {}, { seq: n + 2, reason: 'y' }),
        ev('t-1', 'replan_requested', { kind: 'dev', id: 'ana' }, {}, { seq: n + 3 }),
        ev('t-1', 'plan_version_created', ai, { version: 3, baseCommitSha: SHA_HEAD }, { seq: n + 4, createdAt: '2026-09-14T12:40:00.000Z' }),
        ev('t-1', 'plan_changes_requested', { kind: 'dev', id: 'ana' }, {}, { seq: n + 5, reason: 'z' }),
      ]);
      await expect(commands.replan('t-1', ana, {})).rejects.toBeInstanceOf(TransitionDeniedError);
      clock.set('2026-09-14T12:50:00.000Z');
      await commands.addPlanComment('t-1', ana, { sectionPath: 'goal', body: 'Now try this' });
      expect((await commands.replan('t-1', ana, {})).snapshot.state).toBe('planning');
    });
  });

  describe('approvePlan', () => {
    it('approves a medium-risk plan with no unresolved comments and marks the version approved', async () => {
      await seedReview();
      const result = await commands.approvePlan('t-1', ana, {});
      expect(result.snapshot.state).toBe('plan_approved');
      expect((await versions.get('v-1'))?.status).toBe('approved');
    });
    it('is denied with unresolved comments (409), for a non-owner dev (409) and for a requester (403)', async () => {
      await seedReview();
      await commands.addPlanComment('t-1', ana, { sectionPath: 'goal', body: 'wait' });
      await expect(commands.approvePlan('t-1', ana, {})).rejects.toThrow(/unresolved/);
      await expect(commands.approvePlan('t-1', bob, {})).rejects.toBeInstanceOf(TransitionDeniedError);
      await expect(commands.approvePlan('t-1', requester, {})).rejects.toBeInstanceOf(ForbiddenError);
    });
    it('high risk needs a distinct second approver', async () => {
      await seedReview('ana', 'high');
      await expect(commands.approvePlan('t-1', ana, {})).rejects.toThrow(/second approver/);
      await expect(commands.approvePlan('t-1', ana, { secondApproverId: 'ana' })).rejects.toBeInstanceOf(TransitionDeniedError);
      const result = await commands.approvePlan('t-1', ana, { secondApproverId: 'lea' });
      expect(result.snapshot.state).toBe('plan_approved');
      expect((await store.load('t-1')).at(-1)?.payload).toEqual({ secondApproverId: 'lea' });
    });
    it('reopenPlan returns an approved plan to review', async () => {
      await seedReview();
      await commands.approvePlan('t-1', ana, {});
      const result = await commands.reopenPlan('t-1', ana, { reason: 'requirements changed' });
      expect(result.snapshot.state).toBe('plan_review');
    });
  });

  describe('terminal decisions', () => {
    it('reject / duplicate / already-implemented require owner or lead/admin and record the reason', async () => {
      await seedReview();
      await expect(commands.rejectTicket('t-1', bob, { reason: 'no' })).rejects.toBeInstanceOf(TransitionDeniedError);
      const rejected = await commands.rejectTicket('t-1', lead, { reason: 'Out of scope' });
      expect(rejected.snapshot.state).toBe('rejected');
      expect((await store.load('t-1')).at(-1)?.reason).toBe('Out of scope');

      await store.append('t-2', 0, planReviewStream('t-2'));
      const dup = await commands.markDuplicate('t-2', ana, { duplicateOfTicketId: 't-1' });
      expect(dup.snapshot.state).toBe('duplicate');
      expect((await store.load('t-2')).at(-1)?.payload).toEqual({ duplicateOfTicketId: 't-1' });

      await store.append('t-3', 0, awaitingOwnerStream('t-3').slice(0, 3)); // triaged
      expect((await commands.markAlreadyImplemented('t-3', admin, {})).snapshot.state).toBe('already_implemented');
    });
  });

  describe('flags', () => {
    it('sets and clears flags; requesters may only toggle needs_info; terminal tickets refuse flags', async () => {
      await seedReview();
      expect((await commands.setFlag('t-1', ana, { flag: 'paused', set: true })).snapshot.flags).toEqual(['paused']);
      expect((await commands.setFlag('t-1', ana, { flag: 'paused', set: false })).snapshot.flags).toEqual([]);
      expect((await commands.setFlag('t-1', requester, { flag: 'needs_info', set: true })).snapshot.flags).toEqual(['needs_info']);
      await expect(commands.setFlag('t-1', requester, { flag: 'paused', set: true })).rejects.toBeInstanceOf(ForbiddenError);
      await commands.rejectTicket('t-1', ana, { reason: 'done' });
      await expect(commands.setFlag('t-1', ana, { flag: 'blocked', set: true })).rejects.toBeInstanceOf(TransitionDeniedError);
    });
  });

  describe('retriage', () => {
    it('re-enqueues triage for a ticket back in received after a failure; refuses other states and requesters', async () => {
      await store.append('t-1', 0, [receivedEvent('t-1'), ev('t-1', 'triage_started', sys), ev('t-1', 'run_failed', sys, { reason: 'provider_error' })]);
      expect((await state()).state).toBe('received');
      const result = await commands.retriage('t-1', ana);
      expect(result.enqueued).toBe('triage');
      expect(triageQueue).toEqual(['t-1']);
      await expect(commands.retriage('t-1', requester)).rejects.toBeInstanceOf(ForbiddenError);
      await store.append('t-2', 0, planReviewStream('t-2'));
      await expect(commands.retriage('t-2', ana)).rejects.toBeInstanceOf(TransitionDeniedError);
    });
  });

  it('qa users cannot drive phase-1 review transitions', async () => {
    await seedReview();
    await expect(commands.approvePlan('t-1', qa, {})).rejects.toBeInstanceOf(ForbiddenError);
  });

  describe('submitAnswers', () => {
    const awaitingRequesterStream = (ticketId: string, requesterUserId = 'req'): TicketEvent[] => {
      seq = 1;
      return [
        receivedEvent(ticketId, { requesterUserId }),
        ev(ticketId, 'triage_started', sys),
        ev(ticketId, 'requester_questions_asked', ai, { round: 1, questions: [{ id: 'q1', text: 'Which team?' }] }),
      ];
    };

    it("lets the ticket's own requester answer, re-triages and re-enters triaging", async () => {
      await store.append('t-1', 0, awaitingRequesterStream('t-1', 'req'));
      const result = await commands.submitAnswers('t-1', requester, { round: 1, answers: [{ questionId: 'q1', text: 'Finance' }] });
      expect(result.snapshot.state).toBe('triaging');
      expect(result.enqueued).toBe('triage');
      expect(triageQueue).toEqual(['t-1']);
      expect((await store.load('t-1')).at(-1)).toMatchObject({ type: 'requester_answers_submitted', payload: { round: 1, answers: [{ questionId: 'q1', text: 'Finance' }] } });
    });

    it('lets a lead/admin answer on behalf of the requester', async () => {
      await store.append('t-1', 0, awaitingRequesterStream('t-1', 'req'));
      const result = await commands.submitAnswers('t-1', lead, { round: 1, answers: [{ questionId: 'q1', text: 'Finance' }] });
      expect(result.snapshot.state).toBe('triaging');
    });

    it("denies a different requester answering someone else's ticket (409)", async () => {
      await store.append('t-1', 0, awaitingRequesterStream('t-1', 'req'));
      const other: HubUser = { login: 'other-req', role: 'requester' };
      await expect(commands.submitAnswers('t-1', other, { round: 1, answers: [{ questionId: 'q1', text: 'x' }] })).rejects.toBeInstanceOf(TransitionDeniedError);
    });

    it('denies answering a stale round (409)', async () => {
      await store.append('t-1', 0, awaitingRequesterStream('t-1', 'req'));
      await expect(commands.submitAnswers('t-1', requester, { round: 2, answers: [{ questionId: 'q1', text: 'x' }] })).rejects.toBeInstanceOf(TransitionDeniedError);
    });

    it('denies a plain dev who is neither the requester nor lead/admin (409)', async () => {
      await store.append('t-1', 0, awaitingRequesterStream('t-1', 'req'));
      await expect(commands.submitAnswers('t-1', bob, { round: 1, answers: [{ questionId: 'q1', text: 'x' }] })).rejects.toBeInstanceOf(TransitionDeniedError);
    });
  });
});
