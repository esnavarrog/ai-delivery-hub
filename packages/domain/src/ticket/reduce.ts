import type { TicketEvent } from '../events/ticket-event.js';
import type { TicketSnapshot } from './ticket.js';
import { isFlagEvent, nextState, TRANSITION_EVENTS } from './transitions.js';

export class InvalidTransitionError extends Error {
  override readonly name = 'InvalidTransitionError';
  constructor(
    readonly from: TicketSnapshot['state'],
    readonly event: TicketEvent['type'],
    readonly ticketId: string,
  ) {
    super(`ticket ${ticketId}: event ${event} has no transition from state ${from}`);
  }
}

/**
 * Applies one event to a snapshot. Pure and total for well-formed streams:
 * guards are a command-side concern (see `canTransition`); the reducer only
 * refuses events whose (state, type) pair is structurally absent from the table.
 */
export function reduceTicket(snapshot: TicketSnapshot, event: TicketEvent): TicketSnapshot {
  const next: TicketSnapshot = { ...snapshot, flags: [...snapshot.flags], updatedAt: event.createdAt };

  if (isFlagEvent(event.type)) {
    // flag payloads are validated by the event schema; narrow defensively for the reducer's own typing
    const flag = (event.payload as { flag: TicketSnapshot['flags'][number] }).flag;
    next.flags =
      event.type === 'flag_set'
        ? next.flags.includes(flag)
          ? next.flags
          : [...next.flags, flag]
        : next.flags.filter((f) => f !== flag);
    return next;
  }

  if (TRANSITION_EVENTS.has(event.type)) {
    const to = nextState(snapshot.state, event.type);
    if (to === undefined) throw new InvalidTransitionError(snapshot.state, event.type, snapshot.id);
    next.state = to;
  }

  switch (event.type) {
    case 'triage_completed':
      next.category = event.payload.category;
      next.riskTier = event.payload.riskTier;
      next.targetRepo = event.payload.targetRepo;
      break;
    case 'triage_confirmed':
      if (event.payload.category !== undefined) next.category = event.payload.category;
      if (event.payload.riskTier !== undefined) next.riskTier = event.payload.riskTier;
      if (event.payload.targetRepo !== undefined) next.targetRepo = event.payload.targetRepo;
      break;
    case 'ticket_claimed':
      next.ownerUserId = event.payload.ownerUserId;
      break;
    case 'ticket_updated_from_op':
      // Only an openproject-sourced ticket can receive this event (the ingest index only finds
      // OP tickets by work package id); guard defensively rather than assume.
      if (snapshot.source.kind === 'openproject') {
        next.source = { ...snapshot.source, lockVersion: event.payload.opLockVersion };
      }
      if (event.payload.subject !== undefined) next.subject = event.payload.subject;
      break;
    case 'plan_version_created':
      next.planVersionCount = snapshot.planVersionCount + 1;
      next.lastPlanVersionAt = event.createdAt;
      break;
    case 'plan_comment_added':
      next.unresolvedCommentCount = snapshot.unresolvedCommentCount + 1;
      if (event.actor.kind === 'dev' || event.actor.kind === 'qa') next.lastHumanCommentAt = event.createdAt;
      break;
    case 'plan_comment_resolved':
      next.unresolvedCommentCount = Math.max(0, snapshot.unresolvedCommentCount - 1);
      break;
    default:
      break;
  }

  return next;
}

/** Folds an ordered event stream over an initial snapshot. */
export function replay(initial: TicketSnapshot, events: readonly TicketEvent[]): TicketSnapshot {
  return events.reduce(reduceTicket, initial);
}
