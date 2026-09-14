import type { TicketEvent, TicketSnapshot } from '@ai-delivery-hub/domain';
import { describe, expect, it } from 'vitest';
import { outboxKey, outboxRowsForEvent } from '../../src/modules/sync/outbox.js';

const statusSync = { planning: 'In specification', plan_review: 'Specified', plan_approved: 'Confirmed', rejected: 'Rejected' };
const sync = { statusSync, hubPublicUrl: 'https://hub.example.com/' };

function snapshot(overrides: Partial<TicketSnapshot> = {}): TicketSnapshot {
  return {
    id: 't-1',
    opWorkPackageId: 4711,
    opProjectId: 15,
    opLockVersion: 3,
    subject: 'x',
    state: 'received',
    flags: [],
    priority: 'normal',
    planVersionCount: 0,
    unresolvedCommentCount: 0,
    createdAt: '2026-09-14T12:00:00.000Z',
    updatedAt: '2026-09-14T12:00:00.000Z',
    ...overrides,
  };
}

function event(type: TicketEvent['type'], seq: number): TicketEvent {
  return {
    id: `00000000-0000-4000-8000-${String(seq).padStart(12, '0')}`,
    ticketId: 't-1',
    seq,
    type,
    actor: { kind: 'system', id: 'ingest' },
    artifacts: [],
    payload: {},
    createdAt: '2026-09-14T12:00:00.000Z',
  } as TicketEvent;
}

describe('outboxKey', () => {
  it('is ${ticketId}:${eventSeq}:${kind}', () => {
    expect(outboxKey('t-1', 7, 'op_comment')).toBe('t-1:7:op_comment');
    expect(outboxKey('t-1', 7, 'op_status')).toBe('t-1:7:op_status');
    expect(outboxKey('t-1', 7, 'op_status')).not.toBe(outboxKey('t-1', 8, 'op_status'));
  });
});

describe('outboxRowsForEvent', () => {
  it('posts an acknowledgement comment when a ticket is received', () => {
    const rows = outboxRowsForEvent(event('ticket_received', 1), snapshot(), sync);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ key: 't-1:1:op_comment', kind: 'op_comment', ticketId: 't-1', eventSeq: 1, opWorkPackageId: 4711 });
    expect((rows[0]?.payload as { body: string }).body).toMatch(/AI Delivery Hub/);
  });

  it('mirrors the state when the new state is in statusSync', () => {
    const rows = outboxRowsForEvent(event('planning_started', 4), snapshot({ state: 'planning' }), sync);
    expect(rows).toEqual([
      expect.objectContaining({ key: 't-1:4:op_status', kind: 'op_status', payload: { statusName: 'In specification' } }),
    ]);
  });

  it('produces nothing for states outside statusSync or informational events', () => {
    expect(outboxRowsForEvent(event('triage_started', 2), snapshot({ state: 'triaging' }), sync)).toEqual([]);
    expect(outboxRowsForEvent(event('op_sync_posted', 3), snapshot(), sync)).toEqual([]);
    expect(outboxRowsForEvent(event('ticket_updated_from_op', 3), snapshot(), sync)).toEqual([]);
  });

  it('posts a plan-ready comment with the hub link and goal, plus the mapped status, on plan_version_created', () => {
    const created = { ...event('plan_version_created', 6), actor: { kind: 'ai', id: 'planner' }, payload: { version: 2, baseCommitSha: 'a'.repeat(40), goal: 'Fix login without cookie' } } as TicketEvent;
    const rows = outboxRowsForEvent(created, snapshot({ state: 'plan_review', planVersionCount: 2 }), sync);
    expect(rows.map((r) => r.kind)).toEqual(['op_comment', 'op_status']);
    const body = (rows[0]?.payload as { body: string }).body;
    expect(body).toBe('AI plan v2 ready for review: https://hub.example.com/tickets/t-1/plan — Fix login without cookie');
    expect(rows[0]?.key).toBe('t-1:6:op_comment');
    expect(rows[1]?.payload).toEqual({ statusName: 'Specified' });
  });

  it('still posts the plan comment without a goal and mirrors plan_approved / rejected statuses', () => {
    const created = { ...event('plan_version_created', 6), actor: { kind: 'ai', id: 'planner' }, payload: { version: 1, baseCommitSha: 'a'.repeat(40) } } as TicketEvent;
    const [comment] = outboxRowsForEvent(created, snapshot({ state: 'plan_review' }), { statusSync: {}, hubPublicUrl: 'http://localhost:5173' });
    expect((comment?.payload as { body: string }).body).toBe('AI plan v1 ready for review: http://localhost:5173/tickets/t-1/plan');
    expect(outboxRowsForEvent(event('plan_approved', 9), snapshot({ state: 'plan_approved' }), sync)).toEqual([
      expect.objectContaining({ kind: 'op_status', payload: { statusName: 'Confirmed' } }),
    ]);
    expect(outboxRowsForEvent(event('ticket_rejected', 9), snapshot({ state: 'rejected' }), sync)).toEqual([
      expect.objectContaining({ kind: 'op_status', payload: { statusName: 'Rejected' } }),
    ]);
  });
});
