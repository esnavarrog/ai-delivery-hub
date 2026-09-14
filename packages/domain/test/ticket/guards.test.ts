import { describe, expect, it } from 'vitest';
import { canTransition } from '../../src/ticket/transitions.js';
import { adminUser, aiActor, otherDev, ownerDev, snapshotIn, systemActor } from '../fixtures.js';

const owned = { ownerUserId: ownerDev.id };

describe('plan_approved guards', () => {
  it('allows the owner when there are no unresolved comments (medium risk)', () => {
    const r = canTransition(
      { ticket: snapshotIn('plan_review', { ...owned, riskTier: 'medium' }), actor: ownerDev },
      'plan_approved',
    );
    expect(r).toEqual({ allowed: true });
  });

  it('is denied with unresolved comments', () => {
    const r = canTransition(
      { ticket: snapshotIn('plan_review', { ...owned, unresolvedCommentCount: 2 }), actor: ownerDev },
      'plan_approved',
    );
    expect(r.allowed).toBe(false);
    if (!r.allowed) expect(r.reason).toMatch(/unresolved/i);
  });

  it('is denied for a dev who is not the owner', () => {
    const r = canTransition({ ticket: snapshotIn('plan_review', owned), actor: otherDev }, 'plan_approved');
    expect(r.allowed).toBe(false);
    if (!r.allowed) expect(r.reason).toMatch(/owner/i);
  });

  it('is allowed for an admin who is not the owner', () => {
    const r = canTransition(
      { ticket: snapshotIn('plan_review', owned), actor: adminUser, actorRole: 'admin' },
      'plan_approved',
    );
    expect(r).toEqual({ allowed: true });
  });

  it('requires a second approver for high risk', () => {
    const ticket = snapshotIn('plan_review', { ...owned, riskTier: 'high' });
    const denied = canTransition({ ticket, actor: ownerDev }, 'plan_approved');
    expect(denied.allowed).toBe(false);
    if (!denied.allowed) expect(denied.reason).toMatch(/second approver/i);

    const allowed = canTransition(
      { ticket, actor: ownerDev, payload: { secondApproverId: 'dev-two' } },
      'plan_approved',
    );
    expect(allowed).toEqual({ allowed: true });
  });

  it('rejects the approving actor as their own second approver', () => {
    const ticket = snapshotIn('plan_review', { ...owned, riskTier: 'high' });
    const r = canTransition(
      { ticket, actor: ownerDev, payload: { secondApproverId: ownerDev.id } },
      'plan_approved',
    );
    expect(r.allowed).toBe(false);
  });
});

describe('ownership guards on review decisions', () => {
  it('plan_changes_requested denied for non-owner dev, allowed for owner and admin', () => {
    const ticket = snapshotIn('plan_review', owned);
    expect(canTransition({ ticket, actor: otherDev }, 'plan_changes_requested').allowed).toBe(false);
    expect(canTransition({ ticket, actor: ownerDev }, 'plan_changes_requested').allowed).toBe(true);
    expect(
      canTransition({ ticket, actor: adminUser, actorRole: 'admin' }, 'plan_changes_requested').allowed,
    ).toBe(true);
  });

  it('ticket_rejected from triaged requires owner or admin', () => {
    const ticket = snapshotIn('triaged');
    expect(canTransition({ ticket, actor: otherDev }, 'ticket_rejected').allowed).toBe(false);
    expect(canTransition({ ticket, actor: adminUser, actorRole: 'admin' }, 'ticket_rejected').allowed).toBe(true);
  });
});

describe('planning_started guard', () => {
  it('requires an owner to skip awaiting_owner', () => {
    expect(canTransition({ ticket: snapshotIn('triaged'), actor: systemActor }, 'planning_started').allowed).toBe(false);
    expect(canTransition({ ticket: snapshotIn('triaged', owned), actor: systemActor }, 'planning_started').allowed).toBe(true);
  });
});

describe('ticket_claimed guard', () => {
  it('only a dev can claim', () => {
    expect(canTransition({ ticket: snapshotIn('awaiting_owner'), actor: ownerDev }, 'ticket_claimed').allowed).toBe(true);
    expect(canTransition({ ticket: snapshotIn('awaiting_owner'), actor: aiActor }, 'ticket_claimed').allowed).toBe(false);
    expect(canTransition({ ticket: snapshotIn('awaiting_owner'), actor: { kind: 'qa', id: 'q' } }, 'ticket_claimed').allowed).toBe(false);
  });
});

describe('paused flag (global guard)', () => {
  it('blocks ai/system state transitions', () => {
    const paused = snapshotIn('planning', { ...owned, flags: ['paused'] });
    const r = canTransition({ ticket: paused, actor: aiActor }, 'plan_version_created');
    expect(r.allowed).toBe(false);
    if (!r.allowed) expect(r.reason).toMatch(/paused/i);
    expect(canTransition({ ticket: snapshotIn('received', { flags: ['paused'] }), actor: systemActor }, 'triage_started').allowed).toBe(false);
  });

  it('does not block dev transitions', () => {
    const paused = snapshotIn('plan_review', { ...owned, flags: ['paused'] });
    expect(canTransition({ ticket: paused, actor: ownerDev }, 'plan_approved').allowed).toBe(true);
  });

  it('does not block flag events, so the pause can be lifted', () => {
    const paused = snapshotIn('planning', { flags: ['paused'] });
    expect(canTransition({ ticket: paused, actor: systemActor }, 'flag_cleared').allowed).toBe(true);
    expect(canTransition({ ticket: paused, actor: ownerDev }, 'flag_cleared').allowed).toBe(true);
  });

  it('flag events are denied on terminal states', () => {
    expect(canTransition({ ticket: snapshotIn('done'), actor: ownerDev }, 'flag_set').allowed).toBe(false);
  });
});

describe('replan_requested guard', () => {
  it('allows replanning below 3 plan versions', () => {
    const t = snapshotIn('plan_changes_requested', { ...owned, planVersionCount: 2 });
    expect(canTransition({ ticket: t, actor: ownerDev }, 'replan_requested').allowed).toBe(true);
    expect(canTransition({ ticket: t, actor: systemActor }, 'replan_requested').allowed).toBe(true);
  });

  it('denies at 3 versions without a new human comment', () => {
    const t = snapshotIn('plan_changes_requested', {
      ...owned,
      planVersionCount: 3,
      lastPlanVersionAt: '2026-09-14T12:00:00.000Z',
      lastHumanCommentAt: '2026-09-14T11:00:00.000Z',
    });
    const r = canTransition({ ticket: t, actor: ownerDev }, 'replan_requested');
    expect(r.allowed).toBe(false);
    if (!r.allowed) expect(r.reason).toMatch(/comment/i);
  });

  it('allows at 3 versions when a human commented after the last version', () => {
    const t = snapshotIn('plan_changes_requested', {
      ...owned,
      planVersionCount: 3,
      lastPlanVersionAt: '2026-09-14T12:00:00.000Z',
      lastHumanCommentAt: '2026-09-14T12:30:00.000Z',
    });
    expect(canTransition({ ticket: t, actor: ownerDev }, 'replan_requested').allowed).toBe(true);
  });
});

describe('lead role', () => {
  const lead = { kind: 'dev', id: 'lead-1' } as const;
  const owned = { ownerUserId: ownerDev.id };

  it('may approve and reject like an owner without owning the ticket', () => {
    const ticket = snapshotIn('plan_review', owned);
    expect(canTransition({ ticket, actor: lead, actorRole: 'lead' }, 'plan_approved').allowed).toBe(true);
    expect(canTransition({ ticket, actor: lead, actorRole: 'lead' }, 'plan_changes_requested').allowed).toBe(true);
    expect(canTransition({ ticket, actor: lead, actorRole: 'lead' }, 'ticket_rejected').allowed).toBe(true);
    // same actor without the role is still denied
    expect(canTransition({ ticket, actor: lead, actorRole: 'dev' }, 'plan_approved').allowed).toBe(false);
  });

  it('counts as a valid second approver for high-risk plans', () => {
    const ticket = snapshotIn('plan_review', { ...owned, riskTier: 'high' });
    const r = canTransition(
      { ticket, actor: ownerDev, payload: { secondApproverId: lead.id, secondApproverRole: 'lead' } },
      'plan_approved',
    );
    expect(r).toEqual({ allowed: true });
  });

  it('a requester or qa cannot act as second approver', () => {
    const ticket = snapshotIn('plan_review', { ...owned, riskTier: 'high' });
    for (const role of ['requester', 'qa'] as const) {
      const r = canTransition(
        { ticket, actor: ownerDev, payload: { secondApproverId: 'someone', secondApproverRole: role } },
        'plan_approved',
      );
      expect(r.allowed, role).toBe(false);
    }
  });
});

describe('requester role', () => {
  const requester = { kind: 'dev', id: 'req-1' } as const;
  const reviewing = snapshotIn('plan_review', { ownerUserId: ownerDev.id, planVersionCount: 1 });

  it('may add plan comments', () => {
    expect(canTransition({ ticket: reviewing, actor: requester, actorRole: 'requester' }, 'plan_comment_added')).toEqual({ allowed: true });
  });

  it('may set and clear needs_info only', () => {
    const ctx = { ticket: reviewing, actor: requester, actorRole: 'requester' as const };
    expect(canTransition({ ...ctx, payload: { flag: 'needs_info' } }, 'flag_set').allowed).toBe(true);
    expect(canTransition({ ...ctx, payload: { flag: 'needs_info' } }, 'flag_cleared').allowed).toBe(true);
    expect(canTransition({ ...ctx, payload: { flag: 'paused' } }, 'flag_set').allowed).toBe(false);
    expect(canTransition(ctx, 'flag_set').allowed).toBe(false);
  });

  it('is denied every other event, even ones a dev kind could trigger', () => {
    const ctx = { ticket: reviewing, actor: requester, actorRole: 'requester' as const };
    for (const ev of ['plan_approved', 'plan_changes_requested', 'ticket_rejected', 'plan_reopened', 'plan_comment_resolved'] as const) {
      const r = canTransition(ctx, ev);
      expect(r.allowed, ev).toBe(false);
      if (!r.allowed) expect(r.reason).toMatch(/requester/i);
    }
    const claimable = snapshotIn('awaiting_owner');
    expect(canTransition({ ticket: claimable, actor: requester, actorRole: 'requester' }, 'ticket_claimed').allowed).toBe(false);
  });
});

describe('plan comment events', () => {
  it('require at least one plan version', () => {
    expect(canTransition({ ticket: snapshotIn('planning', { planVersionCount: 0 }), actor: ownerDev }, 'plan_comment_added').allowed).toBe(false);
    expect(canTransition({ ticket: snapshotIn('plan_review', { planVersionCount: 1 }), actor: ownerDev }, 'plan_comment_added').allowed).toBe(true);
    expect(canTransition({ ticket: snapshotIn('plan_review', { planVersionCount: 1 }), actor: aiActor }, 'plan_comment_resolved').allowed).toBe(true);
  });
});

describe('plan_reopened guard', () => {
  const owned = { ownerUserId: ownerDev.id };
  const approved = snapshotIn('plan_approved', owned);

  it('allows the owner, a lead and an admin', () => {
    expect(canTransition({ ticket: approved, actor: ownerDev }, 'plan_reopened')).toEqual({ allowed: true });
    expect(canTransition({ ticket: approved, actor: { kind: 'dev', id: 'lead-1' }, actorRole: 'lead' }, 'plan_reopened').allowed).toBe(true);
    expect(canTransition({ ticket: approved, actor: adminUser, actorRole: 'admin' }, 'plan_reopened').allowed).toBe(true);
  });

  it('denies a dev who is not the owner', () => {
    const r = canTransition({ ticket: approved, actor: otherDev, actorRole: 'dev' }, 'plan_reopened');
    expect(r.allowed).toBe(false);
    if (!r.allowed) expect(r.reason).toMatch(/owner/i);
  });
});
