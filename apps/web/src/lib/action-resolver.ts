import type { RunDto } from '@ai-delivery-hub/contracts';
import { isTerminal, MAX_PLAN_VERSIONS_WITHOUT_FEEDBACK, type Role, type TicketSnapshot } from '@ai-delivery-hub/domain';
import { es } from '@/i18n/es';
import { runFailureReasonLabels, runStatusLabels, ticketStateLabels } from '@/i18n/labels';
import { formatElapsed, humanize } from './format';

export type ActionId =
  | 'claim'
  | 'confirm_triage'
  | 'reject'
  | 'duplicate'
  | 'already_implemented'
  | 'approve'
  | 'request_changes'
  | 'replan'
  | 'reopen'
  | 'retriage'
  | 'stop'
  | 'pause'
  | 'resume'
  | 'add_comment'
  | 'answer_questions';

export interface ResolvedAction {
  id: ActionId;
  label: string;
  /** Present when the button must render disabled; shown as a tooltip. */
  disabledReason?: string;
  destructive?: boolean;
}

export type InfoKind =
  | 'waiting'
  | 'ai_working'
  | 'paused'
  | 'failed'
  | 'triage_suggestion'
  | 'plan_review'
  | 'approved'
  | 'closed'
  | 'read_only'
  | 'needs_answer'
  | 'later_phase';

export interface ActionInfo {
  kind: InfoKind;
  title: string;
  message: string;
}

export interface ActionPlan {
  primary?: ResolvedAction | undefined;
  secondary?: ResolvedAction | undefined;
  /** Additional decisions, rendered as small buttons under the secondary one. */
  more: ResolvedAction[];
  /** Pause/Resume and other always-available low-emphasis actions. */
  tertiary: ResolvedAction[];
  info: ActionInfo;
  /** Approve must collect a second approver login before posting. */
  requiresSecondApprover: boolean;
}

export interface ResolveInput {
  ticket: TicketSnapshot;
  role: Role;
  login: string;
  latestRun: RunDto | null;
  now: Date;
}

const REVIEWER_ROLES: readonly Role[] = ['dev', 'lead', 'admin'];
const OWNER_EQUIVALENT_ROLES: readonly Role[] = ['lead', 'admin'];

const action = (id: ActionId, label: string, extra: Partial<ResolvedAction> = {}): ResolvedAction => ({ id, label, ...extra });

const CLOSE_DECISIONS: ResolvedAction[] = [
  action('duplicate', es.actions.markDuplicate, { destructive: true }),
  action('already_implemented', es.actions.alreadyImplemented, { destructive: true }),
];

function runFailed(run: RunDto | null): run is RunDto {
  return run !== null && (run.status === 'failed' || run.status === 'budget_exhausted');
}

function failureMessage(run: RunDto): string {
  const reason = run.failureReason ? runFailureReasonLabels[run.failureReason] : es.actionInfo.unknownReason;
  const kindLabel = humanize(run.kind, true);
  return run.errorMessage ? `${kindLabel} falló (${reason}): ${run.errorMessage}` : `${kindLabel} falló: ${reason}`;
}

function replanDisabledReason(t: TicketSnapshot): string | undefined {
  if (t.planVersionCount < MAX_PLAN_VERSIONS_WITHOUT_FEEDBACK) return undefined;
  const fed = t.lastHumanCommentAt !== undefined && (t.lastPlanVersionAt === undefined || t.lastHumanCommentAt > t.lastPlanVersionAt);
  return fed ? undefined : es.actionInfo.replanDisabled(t.planVersionCount);
}

/**
 * Pure mapping (snapshot, role, login, run) -> what the ActionPanel shows.
 * Mirrors `packages/domain` transitions and the server role checks; the server still has the last word.
 */
export function resolveActions({ ticket: t, role, login, latestRun, now }: ResolveInput): ActionPlan {
  const isOwner = t.ownerUserId !== undefined && t.ownerUserId === login;
  const ownerEquivalent = OWNER_EQUIVALENT_ROLES.includes(role);
  const canReview = isOwner || ownerEquivalent;
  const reviewer = REVIEWER_ROLES.includes(role);
  const paused = t.flags.includes('paused');
  const owner = t.ownerUserId ?? 'la persona responsable';

  const plan = (info: ActionInfo, parts: Partial<Omit<ActionPlan, 'info'>> = {}): ActionPlan => ({
    more: [],
    tertiary: [],
    requiresSecondApprover: false,
    ...parts,
    info,
  });

  if (isTerminal(t.state)) {
    return plan({ kind: 'closed', title: es.actionInfo.closedTitle(ticketStateLabels[t.state]), message: es.actionInfo.closedMessage });
  }

  // Requester and QA never drive the Phase 1 flow, except a requester answering their own
  // clarifying questions in `awaiting_requester`.
  if (!reviewer) {
    const isRequesterOwner = role === 'requester' && t.requesterUserId !== undefined && t.requesterUserId === login;
    if (t.state === 'awaiting_requester' && isRequesterOwner) {
      return plan({
        kind: 'needs_answer',
        title: es.actionInfo.needsAnswerTitle,
        message: es.actionInfo.needsAnswerMessage(t.pendingQuestionCount ?? 0),
      }, { primary: action('answer_questions', es.actions.answerQuestions) });
    }
    const message = role === 'requester' ? es.actionInfo.readOnlyRequester : es.actionInfo.readOnlyQa;
    return plan(
      { kind: 'read_only', title: es.actionInfo.readOnlyTitle, message },
      { secondary: t.planVersionCount > 0 ? action('add_comment', es.actions.addComment) : undefined },
    );
  }

  const tertiary = [paused ? action('resume', es.actions.resumeAi) : action('pause', es.actions.pauseAi)];

  switch (t.state) {
    case 'received':
      if (runFailed(latestRun)) {
        return plan(
          { kind: 'failed', title: es.actionInfo.triageFailedTitle, message: failureMessage(latestRun) },
          { primary: action('retriage', es.actions.retryTriage), tertiary },
        );
      }
      return plan({ kind: 'waiting', title: es.actionInfo.waitingTriageTitle, message: es.actionInfo.waitingTriageMessage }, { tertiary });

    case 'triaging':
    case 'planning': {
      const what = t.state === 'triaging' ? 'triaje' : 'planificación';
      if (paused) {
        return plan(
          { kind: 'paused', title: es.actionInfo.pausedTitle, message: es.actionInfo.pausedMessage(what) },
          { primary: action('resume', es.actions.resumeAi) },
        );
      }
      const elapsed = latestRun ? formatElapsed(latestRun.startedAt, now) : formatElapsed(t.updatedAt, now);
      const status = latestRun ? runStatusLabels[latestRun.status] : es.actionInfo.queued;
      return plan(
        { kind: 'ai_working', title: es.actionInfo.aiWorkingTitle(what), message: es.actionInfo.aiWorkingMessage(elapsed, status) },
        { primary: action('stop', es.actions.stopAi, { destructive: true }) },
      );
    }

    case 'triaged': {
      const mayConfirm = ownerEquivalent || isOwner;
      if (!mayConfirm) {
        return plan({ kind: 'waiting', title: es.actionInfo.waitingLeadTitle, message: es.actionInfo.waitingLeadMessage }, { tertiary });
      }
      return plan(
        { kind: 'triage_suggestion', title: es.actionInfo.triageSuggestionTitle, message: es.actionInfo.triageSuggestionMessage },
        { primary: action('confirm_triage', es.actions.confirmTriage), secondary: action('reject', es.actions.reject, { destructive: true }), more: CLOSE_DECISIONS, tertiary },
      );
    }

    case 'awaiting_requester': {
      if (!ownerEquivalent) {
        return plan({ kind: 'waiting', title: es.actionInfo.waitingAnswerTitle, message: es.actionInfo.waitingAnswerMessage }, { tertiary });
      }
      return plan(
        { kind: 'needs_answer', title: es.actionInfo.needsAnswerTitle, message: es.actionInfo.needsAnswerMessage(t.pendingQuestionCount ?? 0) },
        { primary: action('answer_questions', es.actions.answerQuestions), tertiary },
      );
    }

    case 'awaiting_owner':
      return plan(
        { kind: 'waiting', title: es.actionInfo.needsOwnerTitle, message: es.actionInfo.needsOwnerMessage },
        { primary: action('claim', es.actions.claimTicket), tertiary },
      );

    case 'plan_review': {
      if (!canReview) {
        return plan({ kind: 'waiting', title: es.actionInfo.inReviewTitle, message: es.actionInfo.inReviewMessage(owner) }, { tertiary });
      }
      const unresolved = t.unresolvedCommentCount;
      const approve = action('approve', es.actions.approvePlan, {
        ...(unresolved > 0 ? { disabledReason: es.actionInfo.unresolvedCommentsDisabled(unresolved) } : {}),
      });
      return plan(
        { kind: 'plan_review', title: es.actionInfo.reviewPlanTitle, message: unresolved > 0 ? es.actionInfo.reviewPlanUnresolved(unresolved) : es.actionInfo.reviewPlanReady },
        {
          primary: approve,
          secondary: action('request_changes', es.actions.requestChanges),
          more: [action('reject', es.actions.reject, { destructive: true }), ...CLOSE_DECISIONS],
          tertiary,
          requiresSecondApprover: t.riskTier === 'high',
        },
      );
    }

    case 'plan_changes_requested': {
      if (!canReview) {
        return plan({ kind: 'waiting', title: es.actionInfo.changesRequestedTitle, message: es.actionInfo.changesRequestedWaiting(owner) }, { tertiary });
      }
      const disabledReason = replanDisabledReason(t);
      const info: ActionInfo = runFailed(latestRun)
        ? { kind: 'failed', title: es.actionInfo.planningFailedTitle, message: failureMessage(latestRun) }
        : { kind: 'plan_review', title: es.actionInfo.changesRequestedTitle, message: es.actionInfo.changesRequestedMessage };
      return plan(info, {
        primary: action('replan', es.actions.replan, disabledReason ? { disabledReason } : {}),
        secondary: action('reject', es.actions.reject, { destructive: true }),
        more: CLOSE_DECISIONS,
        tertiary,
      });
    }

    case 'plan_approved':
      return plan(
        { kind: 'approved', title: es.actionInfo.approvedTitle, message: es.actionInfo.approvedMessage },
        { secondary: canReview ? action('reopen', es.actions.reopenPlan) : undefined, tertiary },
      );

    default:
      return plan({ kind: 'later_phase', title: ticketStateLabels[t.state], message: es.actionInfo.laterPhaseMessage }, { tertiary });
  }
}
