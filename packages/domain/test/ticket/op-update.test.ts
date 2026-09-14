import { describe, expect, it } from 'vitest';
import { TicketUpdatedFromOpPayload } from '../../src/events/ticket-event.js';
import { reduceTicket } from '../../src/ticket/reduce.js';
import { canTransition, isInformationalEvent, nextState } from '../../src/ticket/transitions.js';
import { makeEvent, ownerDev, snapshotIn, systemActor } from '../fixtures.js';

describe('ticket_updated_from_op', () => {
  it('is an informational event that keeps the state on non-terminal tickets', () => {
    expect(isInformationalEvent('ticket_updated_from_op')).toBe(true);
    expect(nextState('plan_review', 'ticket_updated_from_op')).toBe('plan_review');
    expect(nextState('rejected', 'ticket_updated_from_op')).toBeUndefined();
    expect(canTransition({ ticket: snapshotIn('planning'), actor: systemActor }, 'ticket_updated_from_op').allowed).toBe(true);
    expect(canTransition({ ticket: snapshotIn('done'), actor: systemActor }, 'ticket_updated_from_op').allowed).toBe(false);
  });

  it('requires a lockVersion and at least one changed field in its payload', () => {
    expect(TicketUpdatedFromOpPayload.safeParse({ opLockVersion: 4, changedFields: ['subject'], subject: 'New' }).success).toBe(true);
    expect(TicketUpdatedFromOpPayload.safeParse({ opLockVersion: 4, changedFields: [] }).success).toBe(false);
    expect(TicketUpdatedFromOpPayload.safeParse({ changedFields: ['subject'] }).success).toBe(false);
  });

  it('updates subject and lock version in the snapshot, leaving description-only changes to the lock version', () => {
    const start = snapshotIn('plan_review', { ownerUserId: ownerDev.id, subject: 'Old', opLockVersion: 3 });
    const withSubject = reduceTicket(
      start,
      makeEvent('ticket_updated_from_op', systemActor, { opLockVersion: 4, changedFields: ['subject'], subject: 'New' }),
    );
    expect(withSubject.subject).toBe('New');
    expect(withSubject.opLockVersion).toBe(4);
    expect(withSubject.state).toBe('plan_review');

    const descriptionOnly = reduceTicket(
      withSubject,
      makeEvent('ticket_updated_from_op', systemActor, { opLockVersion: 5, changedFields: ['description'], description: 'x' }),
    );
    expect(descriptionOnly.subject).toBe('New');
    expect(descriptionOnly.opLockVersion).toBe(5);
  });
});
