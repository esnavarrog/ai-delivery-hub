import { randomUUID } from 'node:crypto';
import { OptimisticConcurrencyError, type TicketEvent } from '@ai-delivery-hub/domain';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createDb, type DbHandle } from '../../src/adapters/db/client.js';
import { PgEventStore } from '../../src/adapters/db/event-store.js';
import { PgManualKeySequence } from '../../src/adapters/db/manual-key-sequence.js';
import { runMigrations } from '../../src/adapters/db/migrations.js';
import { PgPlanCommentsRepository, PgPlanVersionsRepository, PgRunsRepository } from '../../src/adapters/db/plan-repositories.js';
import { PgTicketProjection, ProjectingEventStore } from '../../src/adapters/db/ticket-projection.js';
import { PgWatermarkStore } from '../../src/adapters/db/watermarks.js';
import { IngestWorkPackage } from '../../src/modules/ingest/ingest-work-package.js';
import { FixedClock, SequentialIds } from '../helpers/memory.js';

const url = process.env['DATABASE_URL_TEST'];
if (!url) {
  console.log('[integration] DATABASE_URL_TEST is not set; skipping Postgres tests. Start infra/docker-compose.yml and export DATABASE_URL_TEST=postgres://hub:hub@localhost:5433/hub_test');
}

function event(ticketId: string, seq: number, type: TicketEvent['type'], payload: Record<string, unknown> = {}, extra: Partial<TicketEvent> = {}): TicketEvent {
  return {
    id: randomUUID(),
    ticketId,
    seq,
    type,
    actor: { kind: 'system', id: 'ingest' },
    artifacts: [],
    payload,
    createdAt: `2026-09-14T12:00:${String(seq).padStart(2, '0')}.000Z`,
    ...extra,
  } as TicketEvent;
}

const receivedPayload = (opWorkPackageId: number, subject = 'Subject') => ({
  source: { kind: 'openproject' as const, workPackageId: opWorkPackageId, projectId: 15, lockVersion: 1 },
  subject,
  description: 'desc',
  status: 'New',
  type: 'Bug',
  priority: 'normal',
  opUpdatedAt: '2026-09-14T09:00:00Z',
});

describe.skipIf(!url)('Postgres adapters', () => {
  let handle: DbHandle;
  let store: PgEventStore;

  beforeAll(async () => {
    await runMigrations(url!);
    handle = createDb(url!, 5);
    store = new PgEventStore(handle.db);
  });

  afterAll(async () => {
    await handle?.close();
  });

  beforeEach(async () => {
    await handle.db.execute(sql`TRUNCATE tickets, ticket_events, ingest_watermarks, plan_versions, plan_comments, runs, manual_ticket_counter`);
  });

  describe('PgEventStore', () => {
    it('appends and loads events in seq order with every field intact', async () => {
      const a = event('t-1', 1, 'ticket_received', receivedPayload(1), { reason: 'why', runId: 'run-1' });
      const b = event('t-1', 2, 'op_sync_posted', { externalRef: '9' }, { artifacts: [{ kind: 'op_comment', ref: '9' }] });
      await store.append('t-1', 0, [a]);
      await store.append('t-1', 1, [b]);
      await store.append('t-2', 0, [event('t-2', 1, 'ticket_received', receivedPayload(2))]);
      expect(await store.load('t-1')).toEqual([a, b]);
      expect(await store.load('missing')).toEqual([]);
    });

    it('rejects a stale expectedSeq with OptimisticConcurrencyError', async () => {
      await store.append('t-1', 0, [event('t-1', 1, 'ticket_received', receivedPayload(1))]);
      const err = await store.append('t-1', 0, [event('t-1', 1, 'triage_started')]).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(OptimisticConcurrencyError);
      expect((err as OptimisticConcurrencyError).actualSeq).toBe(1);
      expect(await store.load('t-1')).toHaveLength(1);
    });

    it('lets exactly one of two concurrent appends at the same seq win', async () => {
      await store.append('t-1', 0, [event('t-1', 1, 'ticket_received', receivedPayload(1))]);
      const results = await Promise.allSettled([
        store.append('t-1', 1, [event('t-1', 2, 'triage_started')]),
        store.append('t-1', 1, [event('t-1', 2, 'triage_started')]),
      ]);
      const rejected = results.filter((r) => r.status === 'rejected');
      expect(rejected).toHaveLength(1);
      expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(OptimisticConcurrencyError);
      expect(await store.load('t-1')).toHaveLength(2);
    });

    it('refuses events whose seq does not continue the stream', async () => {
      await expect(store.append('t-1', 0, [event('t-1', 5, 'ticket_received', receivedPayload(1))])).rejects.toThrow(/seq 5/);
    });
  });

  describe('PgTicketProjection', () => {
    it('upserts the snapshot after each append and serves the API queries', async () => {
      const projection = new PgTicketProjection(handle.db);
      const hookCalls: string[] = [];
      const projecting = new ProjectingEventStore(store, projection, [async (appended, snap) => void hookCalls.push(`${appended[0]?.type}:${snap.state}`)]);
      const ingest = new IngestWorkPackage({
        eventStore: projecting,
        ticketIndex: projection,
        triage: { enqueueTriage: async () => {} },
        ids: new SequentialIds(),
        clock: new FixedClock(),
        trigger: { kind: 'prefix', subjectPrefix: '[AI]' },
      });
      const wp = {
        id: 4711,
        subject: '[AI] Subject',
        description: { raw: 'desc' },
        status: 'New',
        type: 'Bug',
        priority: 'High',
        project: { id: 15, name: 'P' },
        lockVersion: 1,
        updatedAt: '2026-09-14T09:00:00Z',
      };
      const created = await ingest.execute(wp);
      expect(created.kind).toBe('created');
      const ticketId = (created as { ticketId: string }).ticketId;

      expect(await projection.findTicketIdByWorkPackage(4711)).toBe(ticketId);
      expect(await projection.findTicketIdByWorkPackage(1)).toBeUndefined();
      const listed = await projection.list({ state: 'received' });
      expect(listed.map((t) => t.id)).toEqual([ticketId]);
      expect(listed[0]).toMatchObject({ subject: '[AI] Subject', priority: 'high', displayKey: 'OP-4711', source: { lockVersion: 1 }, flags: [] });
      expect(await projection.list({ state: 'planning' })).toEqual([]);

      const updated = await ingest.execute({ ...wp, lockVersion: 2, subject: '[AI] Renamed' });
      expect(updated.kind).toBe('updated');
      const found = await projection.get(ticketId);
      expect(found?.snapshot).toMatchObject({ subject: '[AI] Renamed', source: { lockVersion: 2 }, state: 'received' });
      expect(found?.events.map((e) => e.type)).toEqual(['ticket_received', 'ticket_updated_from_op']);
      expect((await projection.eventsAfter(ticketId, 1)).map((e) => e.seq)).toEqual([2]);
      expect(hookCalls).toEqual(['ticket_received:received', 'ticket_updated_from_op:received']);
      expect(await projection.get('nope')).toBeUndefined();
    });
  });

  describe('PgWatermarkStore', () => {
    it('stores and overwrites the per-project watermark', async () => {
      const watermarks = new PgWatermarkStore(handle.db);
      expect(await watermarks.get(15)).toBeUndefined();
      await watermarks.set(15, '2026-09-14T11:00:00.000Z');
      expect(await watermarks.get(15)).toBe('2026-09-14T11:00:00.000Z');
      await watermarks.set(15, '2026-09-14T12:00:00.000Z');
      expect(await watermarks.get(15)).toBe('2026-09-14T12:00:00.000Z');
      expect(await watermarks.get(6)).toBeUndefined();
    });
  });

  describe('PgManualKeySequence', () => {
    it('hands out incrementing M-000N keys, including across concurrent callers', async () => {
      const keys = new PgManualKeySequence(handle.db);
      expect(await keys.next()).toBe('M-0001');
      expect(await keys.next()).toBe('M-0002');
      const concurrent = await Promise.all([keys.next(), keys.next(), keys.next()]);
      expect(new Set(concurrent).size).toBe(3);
      expect([...concurrent].sort()).toEqual(['M-0003', 'M-0004', 'M-0005']);
    });
  });

  describe('PgPlanVersionsRepository / PgPlanCommentsRepository', () => {
    const SHA = 'c'.repeat(40);
    const plan = {
      goal: 'Fix login', scopeIn: ['auth'], scopeOut: [], filesTouched: [{ path: 'a.rb', action: 'modify' as const, why: 'fix' }],
      steps: [{ order: 1, title: 'Test', detail: 'cover', tests: ['spec'] }], tests: ['rspec'], risks: [], rollback: 'revert',
      acceptanceCriteria: [{ id: 'AC-1', given: 'x', when: 'y', then: 'z' }], baseCommitSha: SHA, openQuestions: [],
    };
    const version = (id: string, ticketId: string, n: number) => ({
      id, ticketId, version: n, plan, renderedMarkdown: `# Plan v${n}`, baseCommitSha: SHA, status: 'review' as const, createdAt: `2026-09-14T12:0${n}:00.000Z`,
    });

    it('stores versions per ticket, lists them ascending, serves the latest and updates status', async () => {
      const repo = new PgPlanVersionsRepository(handle.db);
      const v1 = version(randomUUID(), 't-1', 1);
      const v2 = version(randomUUID(), 't-1', 2);
      const other = version(randomUUID(), 't-2', 1);
      await repo.insert(v2);
      await repo.insert(v1);
      await repo.insert(other);
      expect(await repo.listByTicket('t-1')).toEqual([v1, v2]);
      expect(await repo.latest('t-1')).toEqual(v2);
      expect(await repo.latest('t-9')).toBeUndefined();
      expect(await repo.get(other.id)).toEqual(other);
      await repo.setStatus(v1.id, 'superseded');
      expect((await repo.get(v1.id))?.status).toBe('superseded');
      await expect(repo.insert(version(randomUUID(), 't-1', 2))).rejects.toThrow();
    });

    it('lists comments across every version of a ticket and resolves them', async () => {
      const versions = new PgPlanVersionsRepository(handle.db);
      const comments = new PgPlanCommentsRepository(handle.db);
      const v1 = version(randomUUID(), 't-1', 1);
      const v2 = version(randomUUID(), 't-1', 2);
      const foreign = version(randomUUID(), 't-2', 1);
      for (const v of [v1, v2, foreign]) await versions.insert(v);
      const c1 = { id: randomUUID(), planVersionId: v1.id, sectionPath: 'goal', authorId: 'ana', body: 'Too broad', resolvedByVersion: null, createdAt: '2026-09-14T12:10:00.000Z' };
      const c2 = { id: randomUUID(), planVersionId: v2.id, sectionPath: 'steps[0]', authorId: 'ana', body: 'Add a test', resolvedByVersion: null, createdAt: '2026-09-14T12:11:00.000Z' };
      const c3 = { id: randomUUID(), planVersionId: foreign.id, sectionPath: 'goal', authorId: 'bob', body: 'other ticket', resolvedByVersion: null, createdAt: '2026-09-14T12:12:00.000Z' };
      for (const c of [c2, c1, c3]) await comments.insert(c);
      expect(await comments.listByTicket('t-1')).toEqual([c1, c2]);
      await comments.resolve(c1.id, 2);
      expect(await comments.get(c1.id)).toEqual({ ...c1, resolvedByVersion: 2 });
      expect(await comments.get('00000000-0000-4000-8000-000000000999')).toBeUndefined();
    });
  });

  describe('PgRunsRepository', () => {
    it('inserts, patches and lists runs newest first with numeric cost round-trip', async () => {
      const repo = new PgRunsRepository(handle.db);
      const base = {
        ticketId: 't-1', kind: 'triage' as const, status: 'running' as const, model: 'claude-opus-5', inputTokens: 0, outputTokens: 0,
        costUsd: null, budgetTokens: 40_000, endedAt: null, failureReason: null, errorMessage: null,
      };
      const r1 = { ...base, id: randomUUID(), startedAt: '2026-09-14T12:00:00.000Z' };
      const r2 = { ...base, id: randomUUID(), kind: 'planning' as const, startedAt: '2026-09-14T12:05:00.000Z' };
      const r3 = { ...base, id: randomUUID(), ticketId: 't-2', startedAt: '2026-09-14T12:06:00.000Z' };
      for (const r of [r1, r2, r3]) await repo.insert(r);
      await repo.update(r1.id, { status: 'succeeded', inputTokens: 1200, outputTokens: 340, costUsd: 0.012345, endedAt: '2026-09-14T12:01:00.000Z' });
      await repo.update(r2.id, { status: 'failed', failureReason: 'invalid_output', errorMessage: 'not json', endedAt: '2026-09-14T12:06:00.000Z' });
      expect(await repo.get(r1.id)).toEqual({ ...r1, status: 'succeeded', inputTokens: 1200, outputTokens: 340, costUsd: 0.012345, endedAt: '2026-09-14T12:01:00.000Z' });
      expect(await repo.get(r2.id)).toMatchObject({ status: 'failed', failureReason: 'invalid_output', errorMessage: 'not json' });
      expect((await repo.list({ ticketId: 't-1' })).map((r) => r.id)).toEqual([r2.id, r1.id]);
      expect((await repo.list({})).map((r) => r.id)).toEqual([r3.id, r2.id, r1.id]);
      expect((await repo.list({ limit: 1 })).map((r) => r.id)).toEqual([r3.id]);
      expect(await repo.get(randomUUID())).toBeUndefined();
    });
  });
});

