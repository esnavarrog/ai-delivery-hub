import type {
  AddCommentBody,
  ApproveBody,
  ConfirmTriageBody,
  DecisionBody,
  DuplicateBody,
  FlagBody,
  PlanCommentDto,
  RequestChangesBody,
  RunKind,
  SubmitAnswersBody,
} from '@ai-delivery-hub/contracts';
import type { Actor, Clock, EventStore, IdGenerator, Role, TicketEventType, TicketSnapshot } from '@ai-delivery-hub/domain';
import type { TriageScheduler } from '../ingest/ingest-work-package.js';
import type { PlanningScheduler } from '../planning/run-planning.js';
import type { PlanCommentsRepository, PlanVersionsRepository } from '../shared/repositories.js';
import { ForbiddenError, InvalidCommandError, TicketNotFoundError, TransitionDeniedError, appendCommand, type CommandResult } from '../shared/ticket-command.js';

export interface HubUser {
  login: string;
  role: Role;
}

/** Humans are `dev` actors unless they are QA; the finer role travels as `actorRole` for the guards. */
export function actorFor(user: HubUser): Actor {
  return { kind: user.role === 'qa' ? 'qa' : 'dev', id: user.login };
}

/** Whether `user` has a primary action on the ticket right now (the inbox "Waiting on you" rule). */
export function isWaitingOn(snapshot: TicketSnapshot, user: HubUser): boolean {
  const reviewer = user.role === 'dev' || user.role === 'lead' || user.role === 'admin';
  switch (snapshot.state) {
    case 'plan_review':
    case 'plan_changes_requested':
      return snapshot.ownerUserId === user.login;
    case 'awaiting_owner':
      return reviewer;
    case 'triaged':
      return user.role === 'lead' || user.role === 'admin';
    default:
      return false;
  }
}

/** Events a role may even attempt; anything else is a 403 before the domain guards run. */
const LIMITED_ROLE_EVENTS: readonly TicketEventType[] = ['plan_comment_added', 'flag_set', 'flag_cleared', 'requester_answers_submitted'];

function assertRoleMayAttempt(user: HubUser, eventType: TicketEventType): void {
  if (user.role === 'requester' || user.role === 'qa') {
    if (!LIMITED_ROLE_EVENTS.includes(eventType)) throw new ForbiddenError(`role ${user.role} may not perform ${eventType}`);
    if (user.role === 'requester' && eventType !== 'plan_comment_added') return; // flag restriction is checked by the domain guard
  }
}

export interface TicketCommandsDeps {
  eventStore: EventStore;
  ids: IdGenerator;
  clock: Clock;
  planVersions: PlanVersionsRepository;
  planComments: PlanCommentsRepository;
  triage: TriageScheduler;
  planning: PlanningScheduler;
  allowedRepos: readonly string[];
}

export interface CommentCommandResult extends CommandResult {
  comment: PlanCommentDto;
}

export interface EnqueuedCommandResult extends CommandResult {
  enqueued: RunKind;
}

/**
 * Human commands on a ticket. Every method resolves the actor, checks the role, lets the domain
 * guards decide (`canTransition`) and appends the event with optimistic concurrency (one retry).
 */
export class TicketCommands {
  constructor(private readonly deps: TicketCommandsDeps) {}

  async claimTicket(ticketId: string, user: HubUser): Promise<CommandResult> {
    const result = await this.simple(ticketId, user, 'ticket_claimed', { payload: { ownerUserId: user.login } });
    if (result.snapshot.state === 'planning') await this.deps.planning.enqueuePlanning(ticketId);
    return result;
  }

  async confirmTriage(ticketId: string, user: HubUser, body: ConfirmTriageBody): Promise<CommandResult> {
    if (body.targetRepo !== undefined && !this.deps.allowedRepos.includes(body.targetRepo)) {
      throw new InvalidCommandError(`targetRepo must be one of: ${this.deps.allowedRepos.join(', ')}`);
    }
    const payload: Record<string, unknown> = {};
    if (body.category !== undefined) payload['category'] = body.category;
    if (body.riskTier !== undefined) payload['riskTier'] = body.riskTier;
    if (body.targetRepo !== undefined) payload['targetRepo'] = body.targetRepo;
    if (body.scores !== undefined) payload['scores'] = body.scores;
    return this.simple(ticketId, user, 'triage_confirmed', { payload });
  }

  async requestPlanChanges(ticketId: string, user: HubUser, body: RequestChangesBody): Promise<CommandResult> {
    assertRoleMayAttempt(user, 'plan_changes_requested');
    return appendCommand(this.deps, ticketId, ({ snapshot, guard, event }) => {
      if (body.reason === undefined && snapshot.unresolvedCommentCount === 0) {
        throw new InvalidCommandError('requesting changes needs a reason or at least one unresolved plan comment');
      }
      guard(actorFor(user), 'plan_changes_requested', { actorRole: user.role });
      return [event('plan_changes_requested', actorFor(user), body.reason !== undefined ? { reason: body.reason } : {})];
    });
  }

  async approvePlan(ticketId: string, user: HubUser, body: ApproveBody): Promise<CommandResult> {
    const payload: Record<string, unknown> = {};
    if (body.secondApproverId !== undefined) payload['secondApproverId'] = body.secondApproverId;
    const result = await this.simple(ticketId, user, 'plan_approved', { payload, ...(body.note !== undefined ? { reason: body.note } : {}) });
    const latest = await this.deps.planVersions.latest(ticketId);
    if (latest) await this.deps.planVersions.setStatus(latest.id, 'approved');
    return result;
  }

  reopenPlan(ticketId: string, user: HubUser, body: DecisionBody): Promise<CommandResult> {
    return this.simple(ticketId, user, 'plan_reopened', body.reason !== undefined ? { reason: body.reason } : {});
  }

  rejectTicket(ticketId: string, user: HubUser, body: DecisionBody): Promise<CommandResult> {
    return this.simple(ticketId, user, 'ticket_rejected', body.reason !== undefined ? { reason: body.reason } : {});
  }

  markDuplicate(ticketId: string, user: HubUser, body: DuplicateBody): Promise<CommandResult> {
    const payload: Record<string, unknown> = {};
    if (body.duplicateOfTicketId !== undefined) payload['duplicateOfTicketId'] = body.duplicateOfTicketId;
    return this.simple(ticketId, user, 'ticket_marked_duplicate', { payload, ...(body.reason !== undefined ? { reason: body.reason } : {}) });
  }

  markAlreadyImplemented(ticketId: string, user: HubUser, body: DecisionBody): Promise<CommandResult> {
    return this.simple(ticketId, user, 'ticket_marked_already_implemented', body.reason !== undefined ? { reason: body.reason } : {});
  }

  async setFlag(ticketId: string, user: HubUser, body: FlagBody): Promise<CommandResult> {
    const type: TicketEventType = body.set ? 'flag_set' : 'flag_cleared';
    if (user.role === 'requester' && body.flag !== 'needs_info') throw new ForbiddenError('requesters may only set or clear needs_info');
    return this.simple(ticketId, user, type, { payload: { flag: body.flag }, ...(body.reason !== undefined ? { reason: body.reason } : {}) });
  }

  async addPlanComment(ticketId: string, user: HubUser, body: AddCommentBody): Promise<CommentCommandResult> {
    assertRoleMayAttempt(user, 'plan_comment_added');
    const commentId = this.deps.ids.uuid();
    let comment: PlanCommentDto | undefined;
    const result = await appendCommand(this.deps, ticketId, async ({ guard, event }) => {
      guard(actorFor(user), 'plan_comment_added', { actorRole: user.role });
      const version = body.planVersionId !== undefined ? await this.deps.planVersions.get(body.planVersionId) : await this.deps.planVersions.latest(ticketId);
      if (!version || version.ticketId !== ticketId) throw new InvalidCommandError('planVersionId does not belong to this ticket');
      comment = { id: commentId, planVersionId: version.id, sectionPath: body.sectionPath, authorId: user.login, body: body.body, resolvedByVersion: null, createdAt: this.deps.clock.nowIso() };
      return [event('plan_comment_added', actorFor(user), { payload: { commentId, planVersionId: version.id, sectionPath: body.sectionPath } })];
    });
    if (!comment) throw new Error('comment was not built');
    await this.deps.planComments.insert(comment);
    return { ...result, comment };
  }

  async resolvePlanComment(ticketId: string, user: HubUser, commentId: string): Promise<CommandResult> {
    assertRoleMayAttempt(user, 'plan_comment_resolved');
    const comment = await this.deps.planComments.get(commentId);
    const version = comment ? await this.deps.planVersions.get(comment.planVersionId) : undefined;
    if (!comment || !version || version.ticketId !== ticketId) throw new TicketNotFoundError(`${ticketId}/comments/${commentId}`);
    if (comment.resolvedByVersion !== null) throw new TransitionDeniedError(ticketId, 'plan_comment_resolved', 'comment is already resolved');
    const result = await appendCommand(this.deps, ticketId, ({ guard, event }) => {
      guard(actorFor(user), 'plan_comment_resolved', { actorRole: user.role });
      return [event('plan_comment_resolved', actorFor(user), { payload: { commentId } })];
    });
    await this.deps.planComments.resolve(commentId, Math.max(1, result.snapshot.planVersionCount));
    return result;
  }

  async retriage(ticketId: string, user: HubUser): Promise<EnqueuedCommandResult> {
    assertRoleMayAttempt(user, 'triage_started');
    const result = await appendCommand(this.deps, ticketId, ({ snapshot }) => {
      if (snapshot.state !== 'received') throw new TransitionDeniedError(ticketId, 'triage_started', `ticket is in ${snapshot.state}; only received tickets can be re-triaged`);
      return [];
    });
    await this.deps.triage.enqueueTriage(ticketId);
    return { ...result, enqueued: 'triage' };
  }

  /**
   * The requester (or a lead/admin) answers the AI's clarifying questions; the domain guard checks
   * ownership and that `body.round` matches the ticket's current `clarificationRound`. On success the
   * ticket re-enters `triaging` and triage is re-enqueued so the AI re-runs with the answers as context.
   */
  async submitAnswers(ticketId: string, user: HubUser, body: SubmitAnswersBody): Promise<EnqueuedCommandResult> {
    assertRoleMayAttempt(user, 'requester_answers_submitted');
    const result = await appendCommand(this.deps, ticketId, ({ guard, event }) => {
      const payload = { round: body.round, answers: body.answers };
      guard(actorFor(user), 'requester_answers_submitted', { actorRole: user.role, payload });
      return [event('requester_answers_submitted', actorFor(user), { payload })];
    });
    await this.deps.triage.enqueueTriage(ticketId);
    return { ...result, enqueued: 'triage' };
  }

  async replan(ticketId: string, user: HubUser, body: DecisionBody): Promise<EnqueuedCommandResult> {
    const result = await this.simple(ticketId, user, 'replan_requested', body.reason !== undefined ? { reason: body.reason } : {});
    await this.deps.planning.enqueuePlanning(ticketId);
    return { ...result, enqueued: 'planning' };
  }

  private async simple(ticketId: string, user: HubUser, type: TicketEventType, options: { payload?: Record<string, unknown>; reason?: string }): Promise<CommandResult> {
    assertRoleMayAttempt(user, type);
    return appendCommand(this.deps, ticketId, ({ guard, event }) => {
      guard(actorFor(user), type, { actorRole: user.role, ...(options.payload !== undefined ? { payload: options.payload } : {}) });
      return [event(type, actorFor(user), options)];
    });
  }
}
