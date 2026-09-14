import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { TicketEvent } from '../../src/events/ticket-event.js';
import { InvalidTransitionError, reduceTicket, replay } from '../../src/ticket/reduce.js';
import { nextState, TRANSITIONS } from '../../src/ticket/transitions.js';
import type { TicketState } from '../../src/ticket/ticket-state.js';
import {
  aiActor,
  baseSnapshot,
  makeEvent,
  ownerDev,
  SHA_A,
  systemActor,
  validTriageResult,
} from '../fixtures.js';

describe('reduceTicket', () => {
  it('applies a state change through the transition table and bumps updatedAt', () => {
    const ev = makeEvent('triage_started', systemActor);
    const next = reduceTicket(baseSnapshot(), ev);
    expect(next.state).toBe('triaging');
    expect(next.updatedAt).toBe(ev.createdAt);
  });

  it('does not mutate the input snapshot', () => {
    const before = baseSnapshot();
    const frozen = JSON.parse(JSON.stringify(before)) as typeof before;
    reduceTicket(before, makeEvent('triage_started', systemActor));
    expect(before).toEqual(frozen);
  });

  it('applies triage fields on triage_completed', () => {
    const triage = validTriageResult({ category: 'feature', riskTier: 'high', targetRepo: 'web' });
    const next = reduceTicket(baseSnapshot({ state: 'triaging' }), makeEvent('triage_completed', aiActor, triage));
    expect(next.state).toBe('triaged');
    expect(next.category).toBe('feature');
    expect(next.riskTier).toBe('high');
    expect(next.targetRepo).toBe('web');
  });

  it('applies only the overridden triage fields on triage_confirmed and keeps the state', () => {
    const s0 = baseSnapshot({ state: 'awaiting_owner', category: 'bug', riskTier: 'low', targetRepo: 'backend' });
    const s1 = reduceTicket(s0, makeEvent('triage_confirmed', ownerDev, { riskTier: 'high' }));
    expect(s1.state).toBe('awaiting_owner');
    expect(s1).toMatchObject({ category: 'bug', riskTier: 'high', targetRepo: 'backend' });
    const s2 = reduceTicket(s1, makeEvent('triage_confirmed', ownerDev, {}));
    expect(s2).toMatchObject({ category: 'bug', riskTier: 'high', targetRepo: 'backend' });
  });

  it('sets the owner on ticket_claimed', () => {
    const next = reduceTicket(
      baseSnapshot({ state: 'awaiting_owner' }),
      makeEvent('ticket_claimed', ownerDev, { ownerUserId: ownerDev.id }),
    );
    expect(next.state).toBe('planning');
    expect(next.ownerUserId).toBe(ownerDev.id);
  });

  it('increments planVersionCount and records lastPlanVersionAt on plan_version_created', () => {
    const ev = makeEvent('plan_version_created', aiActor, { version: 1, baseCommitSha: SHA_A });
    const next = reduceTicket(baseSnapshot({ state: 'planning', planVersionCount: 0 }), ev);
    expect(next.planVersionCount).toBe(1);
    expect(next.lastPlanVersionAt).toBe(ev.createdAt);
    expect(next.state).toBe('plan_review');
  });

  it('tracks comment counters and human comment time', () => {
    const s0 = baseSnapshot({ state: 'plan_review' });
    const added = makeEvent('plan_comment_added', ownerDev, { commentId: 'c-1' });
    const s1 = reduceTicket(s0, added);
    expect(s1.unresolvedCommentCount).toBe(1);
    expect(s1.lastHumanCommentAt).toBe(added.createdAt);
    expect(s1.state).toBe('plan_review');

    const s2 = reduceTicket(s1, makeEvent('plan_comment_resolved', aiActor, { commentId: 'c-1' }));
    expect(s2.unresolvedCommentCount).toBe(0);

    // never goes negative
    const s3 = reduceTicket(s2, makeEvent('plan_comment_resolved', aiActor, { commentId: 'c-x' }));
    expect(s3.unresolvedCommentCount).toBe(0);
  });

  it('an ai comment does not count as a human comment', () => {
    const s1 = reduceTicket(baseSnapshot({ state: 'plan_review' }), makeEvent('plan_comment_added', aiActor));
    expect(s1.unresolvedCommentCount).toBe(1);
    expect(s1.lastHumanCommentAt).toBeUndefined();
  });

  it('sets and clears flags idempotently without changing state', () => {
    const s0 = baseSnapshot({ state: 'planning' });
    const s1 = reduceTicket(s0, makeEvent('flag_set', ownerDev, { flag: 'paused' }));
    const s2 = reduceTicket(s1, makeEvent('flag_set', ownerDev, { flag: 'paused' }));
    expect(s2.flags).toEqual(['paused']);
    expect(s2.state).toBe('planning');
    const s3 = reduceTicket(s2, makeEvent('flag_cleared', ownerDev, { flag: 'paused' }));
    expect(s3.flags).toEqual([]);
  });

  it('informational events (run_started, op_sync_posted) only touch updatedAt', () => {
    const s0 = baseSnapshot({ state: 'planning' });
    const ev = makeEvent('run_started', systemActor, { runId: 'r-1' });
    const s1 = reduceTicket(s0, ev);
    expect(s1).toEqual({ ...s0, updatedAt: ev.createdAt });
  });

  it('throws InvalidTransitionError for a transition event with no row from the current state', () => {
    expect(() => reduceTicket(baseSnapshot({ state: 'received' }), makeEvent('plan_approved', ownerDev))).toThrow(
      InvalidTransitionError,
    );
  });
});

describe('replay', () => {
  it('folds a Phase 1 happy path', () => {
    const events: TicketEvent[] = [
      makeEvent('ticket_received', systemActor),
      makeEvent('triage_started', systemActor),
      makeEvent('triage_completed', aiActor, validTriageResult()),
      makeEvent('owner_required', systemActor),
      makeEvent('ticket_claimed', ownerDev, { ownerUserId: ownerDev.id }),
      makeEvent('plan_version_created', aiActor, { version: 1, baseCommitSha: SHA_A }),
      makeEvent('plan_comment_added', ownerDev),
      makeEvent('plan_changes_requested', ownerDev),
      makeEvent('replan_requested', ownerDev),
      makeEvent('plan_version_created', aiActor, { version: 2, baseCommitSha: SHA_A }),
      makeEvent('plan_comment_resolved', aiActor),
      makeEvent('plan_approved', ownerDev),
    ];
    const final = replay(baseSnapshot(), events);
    expect(final.state).toBe('plan_approved');
    expect(final.planVersionCount).toBe(2);
    expect(final.unresolvedCommentCount).toBe(0);
    expect(final.ownerUserId).toBe(ownerDev.id);
    expect(final.category).toBe('bug');
  });

  it('property: replay equals a manual fold and is deterministic', () => {
    // Walk random valid paths through the table, then compare replay vs fold.
    const walk = fc.array(fc.nat({ max: 20 }), { minLength: 0, maxLength: 12 }).map((choices) => {
      const events: TicketEvent[] = [];
      let state: TicketState = 'received';
      for (const c of choices) {
        const options = TRANSITIONS.filter((t) => t.from === state);
        if (options.length === 0) break;
        const t = options[c % options.length]!;
        const payload =
          t.event === 'triage_completed'
            ? validTriageResult()
            : t.event === 'plan_version_created'
              ? { version: 1, baseCommitSha: SHA_A }
              : t.event === 'ticket_claimed'
                ? { ownerUserId: 'dev-owner' }
                : {};
        events.push(makeEvent(t.event, { kind: t.allowedActors[0]!, id: 'x' }, payload));
        state = nextState(state, t.event)!;
      }
      return events;
    });

    fc.assert(
      fc.property(walk, (events) => {
        const initial = baseSnapshot();
        const a = replay(initial, events);
        const b = events.reduce(reduceTicket, initial);
        const c = replay(initial, events);
        expect(a).toEqual(b);
        expect(a).toEqual(c);
      }),
    );
  });
});
