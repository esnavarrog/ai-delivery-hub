import { createHmac } from 'node:crypto';
import type { TicketEvent, WorkPackage } from '@ai-delivery-hub/domain';
import { describe, expect, it } from 'vitest';
import { HUB_USER_HEADER, createApp } from '../../src/http/app.js';
import { TicketCommands } from '../../src/modules/approval/commands.js';
import { IngestWorkPackage } from '../../src/modules/ingest/ingest-work-package.js';
import { SHA_HEAD, plan, triageResult } from '../helpers/fake-agent-runner.js';
import {
  FixedClock,
  MemoryEventStore,
  MemoryPlanCommentsRepository,
  MemoryPlanVersionsRepository,
  MemoryRunsRepository,
  MemoryTicketIndex,
  MemoryTicketQueries,
  SequentialIds,
  receivedEvent,
} from '../helpers/memory.js';

const secret = 'whsec';
const roles = { ana: 'dev', bob: 'dev', lea: 'lead', Macstban: 'admin', req: 'requester' } as const;

const json = async <T = Record<string, any>>(res: Response): Promise<T> => (await res.json()) as T;
const as = (login: string, init: RequestInit = {}): RequestInit => ({ ...init, headers: { ...(init.headers ?? {}), [HUB_USER_HEADER]: login } });
const post = (login: string, body?: unknown): RequestInit =>
  as(login, { method: 'POST', headers: { 'content-type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });

let seq = 1;
function ev(ticketId: string, type: TicketEvent['type'], actor: TicketEvent['actor'], payload: Record<string, unknown> = {}, extra: Record<string, unknown> = {}): TicketEvent {
  seq += 1;
  return { ...receivedEvent(ticketId), id: `60000000-0000-4000-8000-${String(seq).padStart(12, '0')}`, seq, type, actor, payload, createdAt: `2026-09-14T11:${String(seq).padStart(2, '0')}:00.000Z`, ...extra } as TicketEvent;
}
const sys = { kind: 'system', id: 'x' } as const;
const ai = { kind: 'ai', id: 'x' } as const;

function awaitingOwner(ticketId: string, wp = 4711): TicketEvent[] {
  seq = 1;
  return [receivedEvent(ticketId, { opWorkPackageId: wp }), ev(ticketId, 'triage_started', sys), ev(ticketId, 'triage_completed', ai, triageResult()), ev(ticketId, 'owner_required', sys)];
}
function planReview(ticketId: string, owner = 'ana', wp = 4712): TicketEvent[] {
  seq = 1;
  return [
    receivedEvent(ticketId, { opWorkPackageId: wp }),
    ev(ticketId, 'triage_started', sys),
    ev(ticketId, 'triage_completed', ai, triageResult()),
    ev(ticketId, 'owner_required', sys),
    ev(ticketId, 'ticket_claimed', { kind: 'dev', id: owner }, { ownerUserId: owner }),
    ev(ticketId, 'plan_version_created', ai, { version: 1, baseCommitSha: SHA_HEAD, goal: plan().goal }, { artifacts: [{ kind: 'plan_version', ref: 'v-1' }] }),
  ];
}

const wp: WorkPackage = { id: 4711, subject: '[AI] thing', description: { raw: 'd' }, status: 'New', type: 'Bug', project: { id: 15, name: 'P' }, lockVersion: 1, updatedAt: '2026-09-14T09:00:00Z' };

async function harness() {
  const store = new MemoryEventStore();
  const versions = new MemoryPlanVersionsRepository();
  const comments = new MemoryPlanCommentsRepository(versions);
  const runs = new MemoryRunsRepository();
  const triageQueue: string[] = [];
  const planningQueue: string[] = [];
  const ids = new SequentialIds();
  const clock = new FixedClock();
  const ingest = new IngestWorkPackage({
    eventStore: store,
    ticketIndex: new MemoryTicketIndex(store),
    triage: { enqueueTriage: async (id) => void triageQueue.push(id) },
    ids,
    clock,
    trigger: { kind: 'prefix', subjectPrefix: '[AI]' },
  });
  const commands = new TicketCommands({
    eventStore: store,
    ids,
    clock,
    planVersions: versions,
    planComments: comments,
    triage: { enqueueTriage: async (id) => void triageQueue.push(id) },
    planning: { enqueuePlanning: async (id) => void planningQueue.push(id) },
    allowedRepos: ['backend-parkingapp', 'libredte-api'],
  });
  const fetched: number[] = [];
  const app = createApp({
    queries: new MemoryTicketQueries(store),
    webhook: { secret, ingest, op: { getWorkPackage: async (id) => (fetched.push(id), wp) } },
    sse: { pollIntervalMs: 5 },
    auth: { roles },
    commands,
    planVersions: versions,
    planComments: comments,
    runs,
  });

  await store.append('a', 0, awaitingOwner('a', 4711));
  await store.append('r', 0, planReview('r', 'ana', 4712));
  await versions.insert({ id: 'v-1', ticketId: 'r', version: 1, plan: plan(), renderedMarkdown: '# Plan', baseCommitSha: SHA_HEAD, status: 'review', createdAt: '2026-09-14T11:06:00.000Z' });
  await runs.insert({ id: 'run-1', ticketId: 'r', kind: 'planning', status: 'succeeded', model: 'claude-opus-5', inputTokens: 10, outputTokens: 5, costUsd: 0.1, budgetTokens: 150_000, startedAt: '2026-09-14T11:05:00.000Z', endedAt: '2026-09-14T11:06:00.000Z', failureReason: null, errorMessage: null });
  return { app, store, versions, comments, runs, triageQueue, planningQueue, fetched };
}

describe('HTTP app', () => {
  it('GET /health needs no auth', async () => {
    const { app } = await harness();
    expect((await app.request('/health')).status).toBe(200);
  });

  describe('auth', () => {
    it('rejects missing and unknown X-Hub-User with 401 in the error envelope', async () => {
      const { app } = await harness();
      const missing = await app.request('/api/me');
      expect(missing.status).toBe(401);
      expect(await json(missing)).toEqual({ error: { code: 'unauthorized', message: expect.stringContaining(HUB_USER_HEADER) } });
      expect((await app.request('/api/me', as('stranger'))).status).toBe(401);
      expect((await app.request('/api/tickets', as('stranger'))).status).toBe(401);
    });

    it('GET /api/me resolves the role from policies (admin for Macstban) and accepts the query fallback for EventSource', async () => {
      const { app } = await harness();
      expect(await json(await app.request('/api/me', as('Macstban')))).toEqual({ login: 'Macstban', role: 'admin' });
      expect(await json(await app.request('/api/me', as('req')))).toEqual({ login: 'req', role: 'requester' });
      expect(await json(await app.request('/api/me?hub_user=lea'))).toEqual({ login: 'lea', role: 'lead' });
    });
  });

  describe('GET /api/tickets', () => {
    it('lists, filters and rejects bad filters', async () => {
      const { app } = await harness();
      expect((await json(await app.request('/api/tickets', as('ana')))).tickets).toHaveLength(2);
      expect((await json(await app.request('/api/tickets?state=plan_review', as('ana')))).tickets.map((t: { id: string }) => t.id)).toEqual(['r']);
      expect((await json(await app.request('/api/tickets?repo=backend-parkingapp&owner=ana', as('ana')))).tickets).toHaveLength(1);
      const bad = await app.request('/api/tickets?state=bogus', as('ana'));
      expect(bad.status).toBe(400);
      expect((await json(bad)).error.code).toBe('bad_request');
    });

    it('waitingOn=me applies the role rule', async () => {
      const { app } = await harness();
      const ids = async (login: string) => (await json(await app.request('/api/tickets?waitingOn=me', as(login)))).tickets.map((t: { id: string }) => t.id).sort();
      expect(await ids('ana')).toEqual(['a', 'r']); // awaiting_owner + owner of r
      expect(await ids('bob')).toEqual(['a']);
      expect(await ids('req')).toEqual([]);
    });
  });

  it('GET /api/tickets/:id returns snapshot, events, latest plan summary, unresolved count and latest run; 404 otherwise', async () => {
    const { app } = await harness();
    const body = await json(await app.request('/api/tickets/r', as('ana')));
    expect(body.ticket).toMatchObject({ id: 'r', state: 'plan_review', ownerUserId: 'ana' });
    expect(body.events).toHaveLength(6);
    expect(body.latestPlan).toEqual({ id: 'v-1', version: 1, goal: plan().goal, baseCommitSha: SHA_HEAD, createdAt: '2026-09-14T11:06:00.000Z' });
    expect(body.unresolvedCommentCount).toBe(0);
    expect(body.latestRun).toMatchObject({ id: 'run-1', kind: 'planning', status: 'succeeded' });
    const missing = await app.request('/api/tickets/zzz', as('ana'));
    expect(missing.status).toBe(404);
    expect(await json(missing)).toEqual({ error: { code: 'not_found', message: expect.any(String) } });
    expect((await json(await app.request('/api/tickets/a', as('ana')))).latestPlan).toBeNull();
  });

  it('GET /api/tickets/:id/plan returns every version with markdown and the comments', async () => {
    const { app } = await harness();
    await app.request('/api/tickets/r/comments', post('ana', { sectionPath: 'goal', body: 'Too broad' }));
    const body = await json(await app.request('/api/tickets/r/plan', as('ana')));
    expect(body.versions).toHaveLength(1);
    expect(body.versions[0]).toMatchObject({ version: 1, renderedMarkdown: '# Plan', plan: plan() });
    expect(body.comments).toHaveLength(1);
    expect(body.comments[0]).toMatchObject({ sectionPath: 'goal', body: 'Too broad', authorId: 'ana', resolvedByVersion: null });
  });

  describe('commands', () => {
    it('claim: 200 with the new snapshot and planning enqueued; 403 for a requester; 409 in the wrong state', async () => {
      const { app, planningQueue } = await harness();
      const res = await app.request('/api/tickets/a/claim', post('bob'));
      expect(res.status).toBe(200);
      expect((await json(res)).ticket).toMatchObject({ state: 'planning', ownerUserId: 'bob' });
      expect(planningQueue).toEqual(['a']);
      const forbidden = await app.request('/api/tickets/r/claim', post('req'));
      expect(forbidden.status).toBe(403);
      expect((await json(forbidden)).error.code).toBe('forbidden');
      const conflict = await app.request('/api/tickets/r/claim', post('bob'));
      expect(conflict.status).toBe(409);
      expect(await json(conflict)).toEqual({ error: { code: 'conflict', message: expect.stringMatching(/no transition/) } });
    });

    it('confirm-triage: applies overrides; 400 for an unknown repo or a malformed body', async () => {
      const { app } = await harness();
      const res = await app.request('/api/tickets/a/confirm-triage', post('ana', { riskTier: 'high' }));
      expect(res.status).toBe(200);
      expect((await json(res)).ticket).toMatchObject({ state: 'awaiting_owner', riskTier: 'high' });
      const unknownRepo = await app.request('/api/tickets/a/confirm-triage', post('ana', { targetRepo: 'nope' }));
      expect(unknownRepo.status).toBe(400);
      expect((await json(unknownRepo)).error.code).toBe('bad_request');
      expect((await app.request('/api/tickets/a/confirm-triage', post('ana', { riskTier: 'extreme' }))).status).toBe(400);
    });

    it('comments: add returns the comment and the snapshot; resolve clears it; approve is blocked while unresolved', async () => {
      const { app } = await harness();
      const added = await app.request('/api/tickets/r/comments', post('ana', { sectionPath: 'steps[0]', body: 'Add a spec' }));
      expect(added.status).toBe(201);
      const addedBody = await json(added);
      expect(addedBody.comment).toMatchObject({ planVersionId: 'v-1', sectionPath: 'steps[0]', authorId: 'ana' });
      expect(addedBody.ticket.unresolvedCommentCount).toBe(1);

      const blocked = await app.request('/api/tickets/r/approve', post('ana', {}));
      expect(blocked.status).toBe(409);
      expect((await json(blocked)).error.message).toMatch(/unresolved/);

      const resolved = await app.request(`/api/tickets/r/comments/${addedBody.comment.id}/resolve`, post('ana'));
      expect(resolved.status).toBe(200);
      expect((await json(resolved)).ticket.unresolvedCommentCount).toBe(0);
      expect((await app.request('/api/tickets/r/comments/nope/resolve', post('ana'))).status).toBe(404);

      const approved = await app.request('/api/tickets/r/approve', post('ana'));
      expect(approved.status).toBe(200);
      expect((await json(approved)).ticket.state).toBe('plan_approved');
    });

    it('request-changes needs a reason or a comment (400), then replan re-enqueues planning', async () => {
      const { app, planningQueue } = await harness();
      expect((await app.request('/api/tickets/r/request-changes', post('ana', {}))).status).toBe(400);
      const changed = await app.request('/api/tickets/r/request-changes', post('ana', { reason: 'Too wide' }));
      expect(changed.status).toBe(200);
      expect((await json(changed)).ticket.state).toBe('plan_changes_requested');
      const replan = await app.request('/api/tickets/r/replan', post('ana'));
      expect(replan.status).toBe(200);
      expect(await json(replan)).toMatchObject({ ticket: { state: 'planning' }, enqueued: 'planning' });
      expect(planningQueue).toEqual(['r']);
    });

    it('reopen, reject, duplicate and already-implemented', async () => {
      const { app, store } = await harness();
      await app.request('/api/tickets/r/approve', post('ana'));
      expect((await json(await app.request('/api/tickets/r/reopen', post('ana', { reason: 'changed' })))).ticket.state).toBe('plan_review');
      expect((await json(await app.request('/api/tickets/r/reject', post('lea', { reason: 'Out of scope' })))).ticket.state).toBe('rejected');
      expect((await store.load('r')).at(-1)?.reason).toBe('Out of scope');

      await store.append('d', 0, planReview('d', 'ana', 4713));
      const dup = await json(await app.request('/api/tickets/d/duplicate', post('ana', { duplicateOfTicketId: 'r' })));
      expect(dup.ticket.state).toBe('duplicate');
      await store.append('i', 0, planReview('i', 'ana', 4714));
      expect((await json(await app.request('/api/tickets/i/already-implemented', post('Macstban')))).ticket.state).toBe('already_implemented');
    });

    it('flags: set/clear via {flag, set}; 400 on a bad flag; requester limited to needs_info (403)', async () => {
      const { app } = await harness();
      expect((await json(await app.request('/api/tickets/r/flags', post('ana', { flag: 'paused', set: true })))).ticket.flags).toEqual(['paused']);
      expect((await json(await app.request('/api/tickets/r/flags', post('ana', { flag: 'paused', set: false })))).ticket.flags).toEqual([]);
      expect((await app.request('/api/tickets/r/flags', post('ana', { flag: 'urgent', set: true }))).status).toBe(400);
      expect((await app.request('/api/tickets/r/flags', post('req', { flag: 'paused', set: true }))).status).toBe(403);
      expect((await json(await app.request('/api/tickets/r/flags', post('req', { flag: 'needs_info', set: true })))).ticket.flags).toEqual(['needs_info']);
    });

    it('retriage re-enqueues a received ticket after a failed run; 409 otherwise', async () => {
      const { app, store, triageQueue } = await harness();
      seq = 1;
      await store.append('f', 0, [receivedEvent('f', { opWorkPackageId: 4715 }), ev('f', 'triage_started', sys), ev('f', 'run_failed', sys, { reason: 'provider_error' })]);
      const res = await app.request('/api/tickets/f/retriage', post('ana'));
      expect(res.status).toBe(200);
      expect(await json(res)).toMatchObject({ enqueued: 'triage', ticket: { state: 'received' } });
      expect(triageQueue).toEqual(['f']);
      expect((await app.request('/api/tickets/r/retriage', post('ana'))).status).toBe(409);
    });

    it('returns 400 with the zod message on an unparseable body and 404 for an unknown ticket', async () => {
      const { app } = await harness();
      const bad = await app.request('/api/tickets/r/comments', as('ana', { method: 'POST', body: 'not json', headers: { 'content-type': 'application/json' } }));
      expect(bad.status).toBe(400);
      expect((await json(bad)).error.code).toBe('bad_request');
      expect((await app.request('/api/tickets/zzz/claim', post('ana'))).status).toBe(404);
    });
  });

  describe('GET /api/runs', () => {
    it('lists runs (optionally by ticket) and fetches one by id', async () => {
      const { app, runs } = await harness();
      await runs.insert({ id: 'run-2', ticketId: 'a', kind: 'triage', status: 'failed', model: 'claude-opus-5', inputTokens: 1, outputTokens: 1, costUsd: null, budgetTokens: 40_000, startedAt: '2026-09-14T11:10:00.000Z', endedAt: '2026-09-14T11:10:30.000Z', failureReason: 'invalid_output', errorMessage: 'bad json' });
      expect((await json(await app.request('/api/runs', as('ana')))).runs.map((r: { id: string }) => r.id)).toEqual(['run-2', 'run-1']);
      expect((await json(await app.request('/api/runs?ticketId=r', as('ana')))).runs.map((r: { id: string }) => r.id)).toEqual(['run-1']);
      expect((await json(await app.request('/api/runs/run-2', as('ana')))).run).toMatchObject({ failureReason: 'invalid_output', errorMessage: 'bad json' });
      expect((await app.request('/api/runs/nope', as('ana'))).status).toBe(404);
    });
  });

  it('streams new events over SSE (auth via query for EventSource)', async () => {
    const { app, store } = await harness();
    const res = await app.request('/api/tickets/a/events/stream?after=3&hub_user=ana');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/event-stream');
    const reader = res.body!.getReader();
    const { value } = await reader.read();
    const text = new TextDecoder().decode(value);
    expect(text).toContain('event: ticket_event');
    expect(text).toContain('"seq":4');
    await reader.cancel();
    expect((await app.request('/api/tickets/a/events/stream')).status).toBe(401);
    expect(store.types('a')).toHaveLength(4);
  });

  describe('POST /webhooks/openproject', () => {
    const body = JSON.stringify({ action: 'work_package:updated', work_package: { id: 4711, subject: 'attacker-controlled' } });
    const sign = (b: string, s = secret) => `sha1=${createHmac('sha1', s).update(b).digest('hex')}`;

    it('rejects a missing or invalid signature without touching OpenProject', async () => {
      const { app, fetched } = await harness();
      expect((await app.request('/webhooks/openproject', { method: 'POST', body })).status).toBe(401);
      expect((await app.request('/webhooks/openproject', { method: 'POST', body, headers: { 'X-OP-Signature': sign(body, 'wrong') } })).status).toBe(401);
      expect(fetched).toEqual([]);
    });

    it('fetches the work package fresh and ingests it', async () => {
      const { app, fetched } = await harness();
      const res = await app.request('/webhooks/openproject', { method: 'POST', body, headers: { 'X-OP-Signature': sign(body), 'content-type': 'application/json' } });
      expect(res.status).toBe(202);
      expect(fetched).toEqual([4711]);
    });

    it('returns 400 on a body without a work package id', async () => {
      const { app } = await harness();
      const bad = JSON.stringify({ action: 'nope' });
      expect((await app.request('/webhooks/openproject', { method: 'POST', body: bad, headers: { 'X-OP-Signature': sign(bad) } })).status).toBe(400);
    });
  });
});
