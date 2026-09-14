import { describe, expect, it } from 'vitest';
import { Artifact, TicketEvent, TicketEventType } from '../../src/events/ticket-event.js';
import { validTriageResult } from '../fixtures.js';

const base = {
  id: '6f1a2b3c-4d5e-4f60-8a9b-0c1d2e3f4a5b',
  ticketId: 't-1',
  seq: 1,
  actor: { kind: 'system', id: 'scheduler' },
  artifacts: [],
  payload: {},
  createdAt: '2026-09-14T10:00:00.000Z',
};

describe('TicketEventType', () => {
  it('lists every lifecycle, flag, comment, run and sync event', () => {
    const expected = [
      'ticket_received',
      'triage_started',
      'triage_completed',
      'owner_required',
      'planning_started',
      'ticket_claimed',
      'plan_version_created',
      'plan_changes_requested',
      'replan_requested',
      'plan_approved',
      'plan_reopened',
      'ticket_rejected',
      'ticket_marked_duplicate',
      'ticket_marked_already_implemented',
      'implementation_started',
      'implementation_completed',
      'dev_review_approved',
      'sandbox_qa_passed',
      'sandbox_qa_failed',
      'qa_fix_submitted',
      'staging_qa_passed',
      'flag_set',
      'flag_cleared',
      'plan_comment_added',
      'plan_comment_resolved',
      'run_started',
      'run_succeeded',
      'run_failed',
      'budget_exhausted',
      'op_sync_posted',
      'ticket_updated_from_op',
      'triage_confirmed',
    ];
    expect([...TicketEventType.options].sort()).toEqual([...expected].sort());
  });
});

describe('triage_confirmed payload', () => {
  it('accepts an empty confirmation and partial overrides, rejects unknown values', () => {
    const actor = { kind: 'dev', id: 'ana' };
    expect(TicketEvent.safeParse({ ...base, type: 'triage_confirmed', actor, payload: {} }).success).toBe(true);
    expect(
      TicketEvent.safeParse({ ...base, type: 'triage_confirmed', actor, payload: { riskTier: 'high', targetRepo: 'web' } }).success,
    ).toBe(true);
    expect(TicketEvent.safeParse({ ...base, type: 'triage_confirmed', actor, payload: { category: 'epic' } }).success).toBe(false);
  });
});

describe('plan_version_created payload', () => {
  it('carries an optional human-readable goal', () => {
    const sha = 'a'.repeat(40);
    const parsed = TicketEvent.parse({ ...base, type: 'plan_version_created', payload: { version: 1, baseCommitSha: sha, goal: 'Fix login' } });
    expect((parsed.payload as { goal?: string }).goal).toBe('Fix login');
  });
});

describe('Artifact', () => {
  it('accepts known kinds and rejects unknown ones', () => {
    expect(Artifact.safeParse({ kind: 'commit', ref: 'abc' }).success).toBe(true);
    expect(Artifact.safeParse({ kind: 'design_draft', ref: 'drafts/login-v1.html' }).success).toBe(true);
    expect(Artifact.safeParse({ kind: 'docker_image', ref: 'abc' }).success).toBe(false);
  });
});

describe('TicketEvent', () => {
  it('parses a bare event with an empty payload', () => {
    const parsed = TicketEvent.parse({ ...base, type: 'ticket_received' });
    expect(parsed.type).toBe('ticket_received');
    expect(parsed.seq).toBe(1);
  });

  it('rejects seq < 1, non-uuid ids and bad dates', () => {
    expect(TicketEvent.safeParse({ ...base, type: 'ticket_received', seq: 0 }).success).toBe(false);
    expect(TicketEvent.safeParse({ ...base, type: 'ticket_received', id: 'nope' }).success).toBe(false);
    expect(
      TicketEvent.safeParse({ ...base, type: 'ticket_received', createdAt: 'yesterday' }).success,
    ).toBe(false);
  });

  it('requires a TriageResult payload for triage_completed', () => {
    const ok = TicketEvent.safeParse({
      ...base,
      type: 'triage_completed',
      actor: { kind: 'ai', id: 'triager' },
      payload: validTriageResult(),
    });
    expect(ok.success).toBe(true);
    const bad = TicketEvent.safeParse({ ...base, type: 'triage_completed', payload: {} });
    expect(bad.success).toBe(false);
  });

  it('requires { version, baseCommitSha } for plan_version_created', () => {
    const sha = 'a'.repeat(40);
    expect(
      TicketEvent.safeParse({
        ...base,
        type: 'plan_version_created',
        payload: { version: 1, baseCommitSha: sha },
      }).success,
    ).toBe(true);
    expect(
      TicketEvent.safeParse({
        ...base,
        type: 'plan_version_created',
        payload: { version: 0, baseCommitSha: sha },
      }).success,
    ).toBe(false);
    expect(
      TicketEvent.safeParse({
        ...base,
        type: 'plan_version_created',
        payload: { version: 1, baseCommitSha: 'short' },
      }).success,
    ).toBe(false);
  });

  it('requires { ownerUserId } for ticket_claimed', () => {
    expect(
      TicketEvent.safeParse({ ...base, type: 'ticket_claimed', payload: { ownerUserId: 'u-9' } })
        .success,
    ).toBe(true);
    expect(TicketEvent.safeParse({ ...base, type: 'ticket_claimed', payload: {} }).success).toBe(
      false,
    );
  });

  it('requires { flag } for flag_set / flag_cleared', () => {
    expect(
      TicketEvent.safeParse({ ...base, type: 'flag_set', payload: { flag: 'paused' } }).success,
    ).toBe(true);
    expect(
      TicketEvent.safeParse({ ...base, type: 'flag_cleared', payload: { flag: 'nope' } }).success,
    ).toBe(false);
  });

  it('keeps payload as an open record for events without a dedicated schema', () => {
    const parsed = TicketEvent.parse({
      ...base,
      type: 'run_failed',
      reason: 'timeout',
      runId: 'run-1',
      payload: { anything: true },
    });
    expect(parsed.payload).toEqual({ anything: true });
    expect(parsed.reason).toBe('timeout');
  });
});
