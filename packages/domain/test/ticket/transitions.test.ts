import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { TicketEventType } from '../../src/events/ticket-event.js';
import { ActorKind } from '../../src/ticket/actor.js';
import { TicketState } from '../../src/ticket/ticket-state.js';
import {
  FLAG_EVENTS,
  MAX_CLARIFICATION_ROUNDS,
  TERMINAL_STATES,
  TRANSITIONS,
  canTransition,
  isTerminal,
  nextState,
} from '../../src/ticket/transitions.js';
import { adminUser, aiActor, requesterActor, snapshotIn, systemActor } from '../fixtures.js';

describe('TRANSITIONS table', () => {
  it('every TicketState appears as from or to', () => {
    const seen = new Set<string>();
    for (const t of TRANSITIONS) {
      seen.add(t.from);
      seen.add(t.to);
    }
    for (const s of TicketState.options) {
      expect(seen.has(s), `state ${s} is unreachable/unused`).toBe(true);
    }
  });

  it('has no duplicate (from, event) pairs', () => {
    const keys = TRANSITIONS.map((t) => `${t.from}::${t.event}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('every non-terminal state has at least one outgoing transition', () => {
    for (const s of TicketState.options) {
      if (TERMINAL_STATES.includes(s)) continue;
      expect(
        TRANSITIONS.some((t) => t.from === s),
        `non-terminal state ${s} has no outgoing transition`,
      ).toBe(true);
    }
  });

  it('terminal states have no outgoing transitions', () => {
    for (const s of TERMINAL_STATES) {
      expect(TRANSITIONS.some((t) => t.from === s)).toBe(false);
      expect(isTerminal(s)).toBe(true);
    }
    expect(TERMINAL_STATES).toEqual(['rejected', 'duplicate', 'already_implemented', 'done']);
  });

  it('only uses declared event types and actor kinds', () => {
    for (const t of TRANSITIONS) {
      expect(TicketEventType.options).toContain(t.event);
      expect(t.allowedActors.length).toBeGreaterThan(0);
      for (const a of t.allowedActors) expect(ActorKind.options).toContain(a);
    }
  });

  it('flag events are not state transitions', () => {
    for (const t of TRANSITIONS) expect(FLAG_EVENTS).not.toContain(t.event);
  });

  it('encodes the Phase 1 paths exactly', () => {
    const pairs = TRANSITIONS.filter((t) => t.phase === 1).map((t) => [t.from, t.event, t.to]);
    expect(pairs).toEqual(
      expect.arrayContaining([
        ['received', 'triage_started', 'triaging'],
        ['triaging', 'triage_completed', 'triaged'],
        ['triaging', 'run_failed', 'received'],
        ['triaged', 'owner_required', 'awaiting_owner'],
        ['triaged', 'planning_started', 'planning'],
        ['awaiting_owner', 'ticket_claimed', 'planning'],
        ['planning', 'plan_version_created', 'plan_review'],
        ['planning', 'run_failed', 'plan_changes_requested'],
        ['plan_review', 'plan_changes_requested', 'plan_changes_requested'],
        ['plan_changes_requested', 'replan_requested', 'planning'],
        ['plan_review', 'plan_approved', 'plan_approved'],
        ['plan_approved', 'plan_reopened', 'plan_review'],
        ['triaged', 'ticket_rejected', 'rejected'],
        ['plan_review', 'ticket_marked_duplicate', 'duplicate'],
        ['plan_changes_requested', 'ticket_marked_already_implemented', 'already_implemented'],
      ]),
    );
    // planning must have exactly one success path and one failure path
    expect(TRANSITIONS.filter((t) => t.from === 'planning').map((t) => t.event).sort()).toEqual([
      'plan_version_created',
      'run_failed',
    ]);
  });
});

describe('nextState', () => {
  it('matches the table for every row', () => {
    for (const t of TRANSITIONS) expect(nextState(t.from, t.event)).toBe(t.to);
  });

  it('returns the same state for flag events on non-terminal states', () => {
    expect(nextState('planning', 'flag_set')).toBe('planning');
    expect(nextState('done', 'flag_set')).toBeUndefined();
  });

  it('is undefined for pairs not in the table', () => {
    expect(nextState('received', 'plan_approved')).toBeUndefined();
    expect(nextState('done', 'triage_started')).toBeUndefined();
  });
});

describe('canTransition (structure)', () => {
  it('allows a tabled transition for an allowed actor', () => {
    const r = canTransition({ ticket: snapshotIn('received'), actor: systemActor }, 'triage_started');
    expect(r).toEqual({ allowed: true });
  });

  it('denies an actor kind not in allowedActors', () => {
    const r = canTransition({ ticket: snapshotIn('received'), actor: { kind: 'qa', id: 'q' } }, 'triage_started');
    expect(r.allowed).toBe(false);
  });

  it('denies events with no row for the current state', () => {
    const r = canTransition({ ticket: snapshotIn('received'), actor: aiActor }, 'plan_approved');
    expect(r.allowed).toBe(false);
    if (!r.allowed) expect(r.reason).toMatch(/no transition/i);
  });

  it('property: canTransition denies or nextState is defined', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...TicketState.options),
        fc.constantFrom(...TicketEventType.options),
        fc.record({ kind: fc.constantFrom(...ActorKind.options), id: fc.string({ minLength: 1 }) }),
        (state, event, actor) => {
          const r = canTransition({ ticket: snapshotIn(state), actor }, event);
          return r.allowed === false || nextState(state, event) !== undefined;
        },
      ),
    );
  });
});

describe('informational events', () => {
  it('nextState keeps the state for informational events on non-terminal states', () => {
    expect(nextState('planning', 'run_started')).toBe('planning');
    expect(nextState('plan_review', 'plan_comment_added')).toBe('plan_review');
    expect(nextState('done', 'op_sync_posted')).toBeUndefined();
  });

  it('canTransition allows run/sync events for system actors on non-terminal states', () => {
    expect(canTransition({ ticket: snapshotIn('planning'), actor: systemActor }, 'run_started')).toEqual({ allowed: true });
    expect(canTransition({ ticket: snapshotIn('done'), actor: systemActor }, 'op_sync_posted').allowed).toBe(false);
  });
});

describe('triage_confirmed (state-keeping human confirmation)', () => {
  const dev = { kind: 'dev', id: 'ana' } as const;

  it('keeps the state and is only allowed while a human can still steer triage', () => {
    for (const state of ['triaged', 'awaiting_owner', 'plan_changes_requested'] as const) {
      expect(nextState(state, 'triage_confirmed')).toBe(state);
      expect(canTransition({ ticket: snapshotIn(state), actor: dev, actorRole: 'dev' }, 'triage_confirmed')).toEqual({ allowed: true });
    }
    for (const state of ['received', 'triaging', 'planning', 'plan_review', 'plan_approved', 'rejected'] as const) {
      expect(canTransition({ ticket: snapshotIn(state), actor: dev, actorRole: 'dev' }, 'triage_confirmed').allowed).toBe(false);
    }
  });

  it('requires a human dev actor; once owned, only the owner, a lead or an admin', () => {
    expect(canTransition({ ticket: snapshotIn('awaiting_owner'), actor: aiActor }, 'triage_confirmed').allowed).toBe(false);
    expect(canTransition({ ticket: snapshotIn('awaiting_owner'), actor: systemActor }, 'triage_confirmed').allowed).toBe(false);
    expect(canTransition({ ticket: snapshotIn('awaiting_owner'), actor: dev, actorRole: 'requester' }, 'triage_confirmed').allowed).toBe(false);
    const owned = snapshotIn('plan_changes_requested', { ownerUserId: 'owner' });
    expect(canTransition({ ticket: owned, actor: dev, actorRole: 'dev' }, 'triage_confirmed').allowed).toBe(false);
    expect(canTransition({ ticket: owned, actor: { kind: 'dev', id: 'owner' }, actorRole: 'dev' }, 'triage_confirmed').allowed).toBe(true);
    expect(canTransition({ ticket: owned, actor: dev, actorRole: 'lead' }, 'triage_confirmed').allowed).toBe(true);
  });
});

describe('clarification loop (awaiting_requester)', () => {
  it('requester_questions_asked moves triaging -> awaiting_requester for the ai actor', () => {
    expect(nextState('triaging', 'requester_questions_asked')).toBe('awaiting_requester');
    expect(canTransition({ ticket: snapshotIn('triaging'), actor: aiActor }, 'requester_questions_asked')).toEqual({
      allowed: true,
    });
  });

  it('denies asking another round once MAX_CLARIFICATION_ROUNDS is reached', () => {
    expect(MAX_CLARIFICATION_ROUNDS).toBe(2);
    const capped = snapshotIn('triaging', { clarificationRound: MAX_CLARIFICATION_ROUNDS });
    const r = canTransition({ ticket: capped, actor: aiActor }, 'requester_questions_asked');
    expect(r.allowed).toBe(false);
    if (!r.allowed) expect(r.reason).toMatch(/clarification/i);
  });

  it('allows asking below the cap', () => {
    const belowCap = snapshotIn('triaging', { clarificationRound: MAX_CLARIFICATION_ROUNDS - 1 });
    expect(canTransition({ ticket: belowCap, actor: aiActor }, 'requester_questions_asked')).toEqual({ allowed: true });
  });

  it('requester_answers_submitted moves awaiting_requester back to triaging (re-triage)', () => {
    expect(nextState('awaiting_requester', 'requester_answers_submitted')).toBe('triaging');
  });

  it('allows the ticket requester to answer on their own ticket', () => {
    const ticket = snapshotIn('awaiting_requester', { requesterUserId: requesterActor.id });
    expect(
      canTransition({ ticket, actor: requesterActor, actorRole: 'requester' }, 'requester_answers_submitted'),
    ).toEqual({ allowed: true });
  });

  it('denies a different requester answering someone else\'s ticket', () => {
    const ticket = snapshotIn('awaiting_requester', { requesterUserId: 'req-owner' });
    const r = canTransition({ ticket, actor: requesterActor, actorRole: 'requester' }, 'requester_answers_submitted');
    expect(r.allowed).toBe(false);
    if (!r.allowed) expect(r.reason).toMatch(/own ticket/i);
  });

  it('allows lead/admin regardless of ownership', () => {
    const ticket = snapshotIn('awaiting_requester', { requesterUserId: 'req-owner' });
    expect(
      canTransition({ ticket, actor: adminUser, actorRole: 'lead' }, 'requester_answers_submitted'),
    ).toEqual({ allowed: true });
    expect(
      canTransition({ ticket, actor: adminUser, actorRole: 'admin' }, 'requester_answers_submitted'),
    ).toEqual({ allowed: true });
  });

  it('denies a regular dev who is neither the requester nor lead/admin', () => {
    const ticket = snapshotIn('awaiting_requester', { requesterUserId: 'req-owner' });
    const r = canTransition({ ticket, actor: { kind: 'dev', id: 'someone-else' }, actorRole: 'dev' }, 'requester_answers_submitted');
    expect(r.allowed).toBe(false);
  });

  describe('round invariants (payload.round must match the current clarificationRound)', () => {
    it('is silent (allowed) when the caller does not pass payload.round, preserving old callers', () => {
      const ticket = snapshotIn('triaging', { clarificationRound: 1 });
      expect(canTransition({ ticket, actor: aiActor }, 'requester_questions_asked')).toEqual({ allowed: true });
    });

    it('allows requester_questions_asked when payload.round increments cleanly from the current round', () => {
      const ticket = snapshotIn('triaging', { clarificationRound: 1 });
      expect(
        canTransition({ ticket, actor: aiActor, payload: { round: 2, questions: [{ id: 'q1', text: 'x' }] } }, 'requester_questions_asked'),
      ).toEqual({ allowed: true });
    });

    it('denies a repeated round 1 from bypassing the cap (round must be clarificationRound + 1, not a replay)', () => {
      const ticket = snapshotIn('triaging', { clarificationRound: 1 });
      const r = canTransition({ ticket, actor: aiActor, payload: { round: 1, questions: [{ id: 'q1', text: 'x' }] } }, 'requester_questions_asked');
      expect(r.allowed).toBe(false);
      if (!r.allowed) expect(r.reason).toMatch(/round/i);
    });

    it('denies asking round 3 outright (skipping ahead) even though the cap check alone would not catch it', () => {
      const ticket = snapshotIn('triaging', { clarificationRound: 0 });
      const r = canTransition({ ticket, actor: aiActor, payload: { round: 3, questions: [{ id: 'q1', text: 'x' }] } }, 'requester_questions_asked');
      expect(r.allowed).toBe(false);
    });

    it('allows requester_answers_submitted when payload.round matches the current clarificationRound', () => {
      const ticket = snapshotIn('awaiting_requester', { requesterUserId: requesterActor.id, clarificationRound: 2 });
      expect(
        canTransition(
          { ticket, actor: requesterActor, actorRole: 'requester', payload: { round: 2, answers: [{ questionId: 'q1', text: 'a' }] } },
          'requester_answers_submitted',
        ),
      ).toEqual({ allowed: true });
    });

    it('denies answering a stale round', () => {
      const ticket = snapshotIn('awaiting_requester', { requesterUserId: requesterActor.id, clarificationRound: 2 });
      const r = canTransition(
        { ticket, actor: requesterActor, actorRole: 'requester', payload: { round: 1, answers: [{ questionId: 'q1', text: 'a' }] } },
        'requester_answers_submitted',
      );
      expect(r.allowed).toBe(false);
      if (!r.allowed) expect(r.reason).toMatch(/round/i);
    });
  });
});
