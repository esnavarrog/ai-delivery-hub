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
  requesterActor,
  SHA_A,
  systemActor,
  validAssessment,
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

  it('applies management scores and riceScore from an assessment on triage_completed', () => {
    const triage = validTriageResult({ assessment: validAssessment() });
    const next = reduceTicket(baseSnapshot({ state: 'triaging' }), makeEvent('triage_completed', aiActor, triage));
    expect(next.state).toBe('triaged');
    expect(next.value).toBe(4);
    expect(next.reach).toBe(3);
    expect(next.confidence).toBe(0.8);
    expect(next.effort).toBe('M');
    expect(next.riceScore).toBe(4.8);
  });

  it('keeps scores undefined when triage_completed carries no assessment (backward compatible)', () => {
    const next = reduceTicket(baseSnapshot({ state: 'triaging' }), makeEvent('triage_completed', aiActor, validTriageResult()));
    expect(next.riceScore).toBeUndefined();
    expect(next.value).toBeUndefined();
  });

  it('overrides scores and recomputes riceScore on triage_confirmed', () => {
    const s0 = baseSnapshot({ state: 'awaiting_owner', value: 4, reach: 3, confidence: 0.8, effort: 'M', riceScore: 4.8 });
    const s1 = reduceTicket(
      s0,
      makeEvent('triage_confirmed', ownerDev, { scores: { value: 5, reach: 4, confidence: 1, effort: 'L' } }),
    );
    expect(s1.state).toBe('awaiting_owner');
    expect(s1.value).toBe(5);
    expect(s1.reach).toBe(4);
    expect(s1.confidence).toBe(1);
    expect(s1.effort).toBe('L');
    expect(s1.riceScore).toBe(5);
  });

  it('leaves scores untouched when triage_confirmed carries no scores override', () => {
    const s0 = baseSnapshot({ state: 'awaiting_owner', value: 4, reach: 3, confidence: 0.8, effort: 'M', riceScore: 4.8 });
    const s1 = reduceTicket(s0, makeEvent('triage_confirmed', ownerDev, {}));
    expect(s1).toMatchObject({ value: 4, reach: 3, confidence: 0.8, effort: 'M', riceScore: 4.8 });
  });

  it('records the round and pending question count on requester_questions_asked', () => {
    const ev = makeEvent('requester_questions_asked', aiActor, {
      round: 1,
      questions: [{ id: 'q1', text: 'How many users?' }],
    });
    const next = reduceTicket(baseSnapshot({ state: 'triaging' }), ev);
    expect(next.state).toBe('awaiting_requester');
    expect(next.clarificationRound).toBe(1);
    expect(next.pendingQuestionCount).toBe(1);
  });

  it('clears pending questions and re-enters triaging on requester_answers_submitted', () => {
    const s0 = baseSnapshot({ state: 'awaiting_requester', clarificationRound: 1, pendingQuestionCount: 1 });
    const ev = makeEvent('requester_answers_submitted', requesterActor, {
      round: 1,
      answers: [{ questionId: 'q1', text: '12 people' }],
    });
    const next = reduceTicket(s0, ev);
    expect(next.state).toBe('triaging');
    expect(next.pendingQuestionCount).toBe(0);
    expect(next.clarificationRound).toBe(1);
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
                : t.event === 'requester_questions_asked'
                  ? { round: 1, questions: [{ id: 'q1', text: 'x' }] }
                  : t.event === 'requester_answers_submitted'
                    ? { round: 1, answers: [{ questionId: 'q1', text: 'x' }] }
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
