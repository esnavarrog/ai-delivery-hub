import type { TicketEventType } from '../events/ticket-event.js';
import type { Actor, ActorKind, Role } from './actor.js';
import type { TicketSnapshot } from './ticket.js';
import type { TicketState } from './ticket-state.js';

export type GuardResult = { allowed: true } | { allowed: false; reason: string };

export interface TransitionContext {
  ticket: TicketSnapshot;
  actor: Actor;
  actorRole?: Role;
  /** Command payload the guard may inspect (e.g. `secondApproverId`). */
  payload?: Record<string, unknown>;
}

export type Phase = 1 | 2 | 3;

export interface Transition {
  from: TicketState;
  to: TicketState;
  event: TicketEventType;
  allowedActors: readonly ActorKind[];
  /** Delivery phase that introduces this edge. Phase 1 code exercises only phase-1 edges. */
  phase: Phase;
  guard?: (ctx: TransitionContext) => GuardResult;
}

export const TERMINAL_STATES: readonly TicketState[] = ['rejected', 'duplicate', 'already_implemented', 'done'];

/** Events that annotate a ticket with a flag; they never change `state`. */
export const FLAG_EVENTS: readonly TicketEventType[] = ['flag_set', 'flag_cleared'];

/** Events recorded for audit/counters that never change `state` and are not flags. */
export const INFORMATIONAL_EVENTS: readonly TicketEventType[] = [
  'ticket_received',
  'plan_comment_added',
  'plan_comment_resolved',
  'run_started',
  'run_succeeded',
  'budget_exhausted',
  'op_sync_posted',
  'ticket_updated_from_op',
  'triage_confirmed',
];

/** States in which a human may still confirm or override the AI triage. */
export const TRIAGE_CONFIRMABLE_STATES: readonly TicketState[] = ['triaged', 'awaiting_owner', 'plan_changes_requested'];

export const MAX_PLAN_VERSIONS_WITHOUT_FEEDBACK = 3;

/** A ticket may go through at most this many requester clarification rounds before a human must decide. */
export const MAX_CLARIFICATION_ROUNDS = 2;

/** Roles that may sign off as the second approver on a high-risk plan. */
export const SECOND_APPROVER_ROLES: readonly Role[] = ['dev', 'lead', 'admin'];

/** Roles with owner-equivalent review rights on every ticket. */
const OWNER_EQUIVALENT_ROLES: readonly Role[] = ['lead', 'admin'];

/** The only events a `requester` may trigger; flag events are further restricted to `needs_info`. */
const REQUESTER_EVENTS: readonly TicketEventType[] = [
  'plan_comment_added',
  'flag_set',
  'flag_cleared',
  'requester_answers_submitted',
];

const allow: GuardResult = { allowed: true };
const deny = (reason: string): GuardResult => ({ allowed: false, reason });

// ---- Reusable guards -------------------------------------------------------

const isOwnerOrAdmin = (ctx: TransitionContext): GuardResult => {
  if (ctx.actorRole !== undefined && OWNER_EQUIVALENT_ROLES.includes(ctx.actorRole)) return allow;
  if (ctx.ticket.ownerUserId !== undefined && ctx.ticket.ownerUserId === ctx.actor.id) return allow;
  return deny('actor must be the ticket owner, a lead or an admin');
};

const hasPlanVersion = (ctx: TransitionContext): GuardResult =>
  ctx.ticket.planVersionCount > 0 ? allow : deny('plan comments require at least one plan version');

const requesterGuard = (ctx: TransitionContext, eventType: TicketEventType): GuardResult => {
  if (ctx.actorRole !== 'requester') return allow;
  if (!REQUESTER_EVENTS.includes(eventType)) {
    return deny(`requester may only add plan comments or toggle needs_info (attempted ${eventType})`);
  }
  if (isFlagEvent(eventType) && ctx.payload?.['flag'] !== 'needs_info') {
    return deny('requester may only set or clear the needs_info flag');
  }
  return allow;
};

/** Human dev; once the ticket has an owner only the owner, a lead or an admin may confirm triage. */
const triageConfirmGuard = (ctx: TransitionContext): GuardResult => {
  if (ctx.actor.kind !== 'dev') return deny('only a human developer can confirm triage');
  if (!TRIAGE_CONFIRMABLE_STATES.includes(ctx.ticket.state)) {
    return deny(`triage can only be confirmed in ${TRIAGE_CONFIRMABLE_STATES.join(', ')} (current: ${ctx.ticket.state})`);
  }
  return ctx.ticket.ownerUserId === undefined ? allow : isOwnerOrAdmin(ctx);
};

const hasOwner = (ctx: TransitionContext): GuardResult =>
  ctx.ticket.ownerUserId ? allow : deny('ticket has no owner yet');

const actorIsDev = (ctx: TransitionContext): GuardResult =>
  ctx.actor.kind === 'dev' ? allow : deny('only a dev can claim a ticket');

const planApprovalGuard = (ctx: TransitionContext): GuardResult => {
  const ownership = isOwnerOrAdmin(ctx);
  if (!ownership.allowed) return ownership;
  if (ctx.ticket.unresolvedCommentCount > 0) {
    return deny(`plan has ${ctx.ticket.unresolvedCommentCount} unresolved comment(s)`);
  }
  if (ctx.ticket.riskTier === 'high') {
    const second = ctx.payload?.['secondApproverId'];
    if (typeof second !== 'string' || second.length === 0) {
      return deny('high-risk plans require a second approver');
    }
    if (second === ctx.actor.id) return deny('second approver must differ from the approving actor');
    const secondRole = ctx.payload?.['secondApproverRole'];
    if (secondRole !== undefined && !SECOND_APPROVER_ROLES.includes(secondRole as Role)) {
      return deny(`second approver role must be one of: ${SECOND_APPROVER_ROLES.join(', ')}`);
    }
  }
  return allow;
};

const clarificationRoundGuard = (ctx: TransitionContext): GuardResult => {
  const currentRound = ctx.ticket.clarificationRound ?? 0;
  return currentRound < MAX_CLARIFICATION_ROUNDS
    ? allow
    : deny(`clarification rounds are capped at ${MAX_CLARIFICATION_ROUNDS}; a human must decide`);
};

/** The ticket's own requester may answer; a lead or admin may answer any ticket; nobody else may. */
const requesterAnswerGuard = (ctx: TransitionContext): GuardResult => {
  if (ctx.actorRole === 'requester') {
    return ctx.ticket.requesterUserId === ctx.actor.id
      ? allow
      : deny('requester may only submit answers on their own ticket');
  }
  if (ctx.actorRole !== undefined && OWNER_EQUIVALENT_ROLES.includes(ctx.actorRole)) return allow;
  return deny('only the ticket requester, a lead or an admin may submit answers');
};

const replanGuard = (ctx: TransitionContext): GuardResult => {
  const { planVersionCount, lastHumanCommentAt, lastPlanVersionAt } = ctx.ticket;
  if (planVersionCount < MAX_PLAN_VERSIONS_WITHOUT_FEEDBACK) return allow;
  const humanCommentedSinceLastVersion =
    lastHumanCommentAt !== undefined && (lastPlanVersionAt === undefined || lastHumanCommentAt > lastPlanVersionAt);
  return humanCommentedSinceLastVersion
    ? allow
    : deny(`plan already has ${planVersionCount} versions; a new human comment is required before replanning`);
};

// ---- Table -----------------------------------------------------------------

const reviewDecisionSources: readonly TicketState[] = ['triaged', 'plan_review', 'plan_changes_requested'];
const reviewDecisions: ReadonlyArray<{ event: TicketEventType; to: TicketState }> = [
  { event: 'ticket_rejected', to: 'rejected' },
  { event: 'ticket_marked_duplicate', to: 'duplicate' },
  { event: 'ticket_marked_already_implemented', to: 'already_implemented' },
];

const phase1: Transition[] = [
  { from: 'received', to: 'triaging', event: 'triage_started', allowedActors: ['system', 'ai'], phase: 1 },
  { from: 'triaging', to: 'triaged', event: 'triage_completed', allowedActors: ['ai'], phase: 1 },
  // keeps position so the scheduler can retry triage
  { from: 'triaging', to: 'received', event: 'run_failed', allowedActors: ['system'], phase: 1 },
  {
    from: 'triaging',
    to: 'awaiting_requester',
    event: 'requester_questions_asked',
    allowedActors: ['ai'],
    phase: 1,
    guard: clarificationRoundGuard,
  },
  // requester answers re-enter triage so the AI can retriage with the answers as context
  {
    from: 'awaiting_requester',
    to: 'triaging',
    event: 'requester_answers_submitted',
    allowedActors: ['dev'],
    phase: 1,
    guard: requesterAnswerGuard,
  },
  { from: 'triaged', to: 'awaiting_owner', event: 'owner_required', allowedActors: ['system'], phase: 1 },
  { from: 'triaged', to: 'planning', event: 'planning_started', allowedActors: ['system', 'ai'], phase: 1, guard: hasOwner },
  { from: 'awaiting_owner', to: 'planning', event: 'ticket_claimed', allowedActors: ['dev'], phase: 1, guard: actorIsDev },
  { from: 'planning', to: 'plan_review', event: 'plan_version_created', allowedActors: ['ai'], phase: 1 },
  // a failed planning run lands where a human can retry or reject
  { from: 'planning', to: 'plan_changes_requested', event: 'run_failed', allowedActors: ['system'], phase: 1 },
  { from: 'plan_review', to: 'plan_changes_requested', event: 'plan_changes_requested', allowedActors: ['dev'], phase: 1, guard: isOwnerOrAdmin },
  { from: 'plan_changes_requested', to: 'planning', event: 'replan_requested', allowedActors: ['dev', 'system'], phase: 1, guard: replanGuard },
  { from: 'plan_review', to: 'plan_approved', event: 'plan_approved', allowedActors: ['dev'], phase: 1, guard: planApprovalGuard },
  { from: 'plan_approved', to: 'plan_review', event: 'plan_reopened', allowedActors: ['dev'], phase: 1, guard: isOwnerOrAdmin },
  ...reviewDecisionSources.flatMap((from) =>
    reviewDecisions.map(
      ({ event, to }): Transition => ({ from, to, event, allowedActors: ['dev'], phase: 1, guard: isOwnerOrAdmin }),
    ),
  ),
];

const phase2: Transition[] = [
  { from: 'plan_approved', to: 'implementing', event: 'implementation_started', allowedActors: ['system', 'ai'], phase: 2 },
  { from: 'implementing', to: 'dev_review', event: 'implementation_completed', allowedActors: ['ai'], phase: 2 },
  { from: 'dev_review', to: 'sandbox_qa', event: 'dev_review_approved', allowedActors: ['dev'], phase: 2, guard: isOwnerOrAdmin },
];

const phase3: Transition[] = [
  { from: 'sandbox_qa', to: 'qa_changes_requested', event: 'sandbox_qa_failed', allowedActors: ['qa'], phase: 3 },
  { from: 'qa_changes_requested', to: 'sandbox_qa', event: 'qa_fix_submitted', allowedActors: ['ai', 'dev'], phase: 3 },
  { from: 'sandbox_qa', to: 'staging_qa', event: 'sandbox_qa_passed', allowedActors: ['qa'], phase: 3 },
  { from: 'staging_qa', to: 'done', event: 'staging_qa_passed', allowedActors: ['qa'], phase: 3 },
];

export const TRANSITIONS: ReadonlyArray<Transition> = Object.freeze([...phase1, ...phase2, ...phase3]);

/** Event types that appear as a state-changing edge somewhere in the table. */
export const TRANSITION_EVENTS: ReadonlySet<TicketEventType> = new Set(TRANSITIONS.map((t) => t.event));

const index = new Map<string, Transition>();
for (const t of TRANSITIONS) {
  const key = `${t.from}::${t.event}`;
  if (index.has(key)) throw new Error(`duplicate transition for ${key}`);
  index.set(key, t);
}

// ---- Queries ---------------------------------------------------------------

export function isTerminal(state: TicketState): boolean {
  return TERMINAL_STATES.includes(state);
}

export function isFlagEvent(event: TicketEventType): boolean {
  return FLAG_EVENTS.includes(event);
}

export function isInformationalEvent(event: TicketEventType): boolean {
  return INFORMATIONAL_EVENTS.includes(event);
}

export function findTransition(from: TicketState, event: TicketEventType): Transition | undefined {
  return index.get(`${from}::${event}`);
}

/**
 * Resulting state, or `undefined` when the pair is not allowed by the table.
 * Flag and informational events keep the state on non-terminal tickets.
 */
export function nextState(from: TicketState, event: TicketEventType): TicketState | undefined {
  if (isFlagEvent(event) || isInformationalEvent(event)) return isTerminal(from) ? undefined : from;
  return findTransition(from, event)?.to;
}

/**
 * Evaluates, in order: role restrictions, terminal-state protection, actor kind,
 * the global `paused` guard and the row guard for `eventType` from the ticket's current state.
 */
export function canTransition(ctx: TransitionContext, eventType: TicketEventType): GuardResult {
  const { ticket, actor } = ctx;

  const roleCheck = requesterGuard(ctx, eventType);
  if (!roleCheck.allowed) return roleCheck;

  if (isFlagEvent(eventType)) {
    return isTerminal(ticket.state) ? deny(`cannot change flags on terminal state ${ticket.state}`) : allow;
  }

  if (isInformationalEvent(eventType)) {
    if (isTerminal(ticket.state)) return deny(`cannot record ${eventType} on terminal state ${ticket.state}`);
    if (eventType === 'plan_comment_added' || eventType === 'plan_comment_resolved') return hasPlanVersion(ctx);
    if (eventType === 'triage_confirmed') return triageConfirmGuard(ctx);
    return allow;
  }

  const transition = findTransition(ticket.state, eventType);
  if (!transition) return deny(`no transition from ${ticket.state} on ${eventType}`);

  if (!transition.allowedActors.includes(actor.kind)) {
    return deny(`actor kind ${actor.kind} may not trigger ${eventType} (allowed: ${transition.allowedActors.join(', ')})`);
  }

  if (ticket.flags.includes('paused') && (actor.kind === 'ai' || actor.kind === 'system')) {
    return deny('ticket is paused; automated transitions are blocked until a human clears the flag');
  }

  return transition.guard ? transition.guard(ctx) : allow;
}
