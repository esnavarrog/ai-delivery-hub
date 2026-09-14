import type { RunDto } from '@ai-delivery-hub/contracts';
import { isTerminal, MAX_PLAN_VERSIONS_WITHOUT_FEEDBACK, type Role, type TicketSnapshot } from '@ai-delivery-hub/domain';
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
  | 'add_comment';

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
  action('duplicate', 'Mark as duplicate', { destructive: true }),
  action('already_implemented', 'Already implemented', { destructive: true }),
];

function runFailed(run: RunDto | null): run is RunDto {
  return run !== null && (run.status === 'failed' || run.status === 'budget_exhausted');
}

function failureMessage(run: RunDto): string {
  const reason = run.failureReason ? humanize(run.failureReason) : 'unknown reason';
  return run.errorMessage ? `${humanize(run.kind, true)} failed (${reason}): ${run.errorMessage}` : `${humanize(run.kind, true)} failed: ${reason}`;
}

function replanDisabledReason(t: TicketSnapshot): string | undefined {
  if (t.planVersionCount < MAX_PLAN_VERSIONS_WITHOUT_FEEDBACK) return undefined;
  const fed = t.lastHumanCommentAt !== undefined && (t.lastPlanVersionAt === undefined || t.lastHumanCommentAt > t.lastPlanVersionAt);
  return fed ? undefined : `Already ${t.planVersionCount} plan versions; add a plan comment before asking for another one`;
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
  const owner = t.ownerUserId ?? 'the owner';

  const plan = (info: ActionInfo, parts: Partial<Omit<ActionPlan, 'info'>> = {}): ActionPlan => ({
    more: [],
    tertiary: [],
    requiresSecondApprover: false,
    ...parts,
    info,
  });

  if (isTerminal(t.state)) {
    return plan({ kind: 'closed', title: `Closed: ${humanize(t.state)}`, message: 'This ticket is closed. No further actions are possible.' });
  }

  // Requester and QA never drive the Phase 1 flow.
  if (!reviewer) {
    const message =
      role === 'requester'
        ? 'You can follow the timeline, read the plan and add comments. A developer owns the decisions.'
        : 'QA gates open in a later phase. You can follow the timeline and read the plan.';
    return plan(
      { kind: 'read_only', title: 'Read only', message },
      { secondary: t.planVersionCount > 0 ? action('add_comment', 'Add comment') : undefined },
    );
  }

  const tertiary = [paused ? action('resume', 'Resume AI') : action('pause', 'Pause AI')];

  switch (t.state) {
    case 'received':
      if (runFailed(latestRun)) {
        return plan(
          { kind: 'failed', title: 'Triage failed', message: failureMessage(latestRun) },
          { primary: action('retriage', 'Retry triage'), tertiary },
        );
      }
      return plan({ kind: 'waiting', title: 'Waiting for AI triage', message: 'The scheduler will start triage shortly.' }, { tertiary });

    case 'triaging':
    case 'planning': {
      const what = t.state === 'triaging' ? 'triage' : 'planning';
      if (paused) {
        return plan(
          { kind: 'paused', title: 'Paused', message: `Automated ${what} is blocked until someone resumes the ticket.` },
          { primary: action('resume', 'Resume AI') },
        );
      }
      const elapsed = latestRun ? formatElapsed(latestRun.startedAt, now) : formatElapsed(t.updatedAt, now);
      const status = latestRun ? humanize(latestRun.status) : 'queued';
      return plan(
        { kind: 'ai_working', title: `AI is working on ${what}`, message: `AI is working · ${elapsed} · ${status}` },
        { primary: action('stop', 'Stop AI', { destructive: true }) },
      );
    }

    case 'triaged': {
      const mayConfirm = ownerEquivalent || isOwner;
      if (!mayConfirm) {
        return plan({ kind: 'waiting', title: 'Waiting for a lead', message: 'A lead or admin confirms the AI triage before planning starts.' }, { tertiary });
      }
      return plan(
        { kind: 'triage_suggestion', title: 'Confirm the AI triage', message: 'Review the suggested category, risk and repository. Confirm to continue or close the ticket.' },
        { primary: action('confirm_triage', 'Confirm triage'), secondary: action('reject', 'Reject', { destructive: true }), more: CLOSE_DECISIONS, tertiary },
      );
    }

    case 'awaiting_owner':
      return plan(
        { kind: 'waiting', title: 'Needs an owner', message: 'Claim the ticket to own the plan review. Planning starts right after.' },
        { primary: action('claim', 'Claim ticket'), tertiary },
      );

    case 'plan_review': {
      if (!canReview) {
        return plan({ kind: 'waiting', title: 'In review', message: `Waiting for ${owner} to review the plan.` }, { tertiary });
      }
      const unresolved = t.unresolvedCommentCount;
      const approve = action('approve', 'Approve plan', {
        ...(unresolved > 0 ? { disabledReason: `${unresolved} unresolved ${unresolved === 1 ? 'comment' : 'comments'} must be resolved first` } : {}),
      });
      return plan(
        { kind: 'plan_review', title: 'Review the plan', message: unresolved > 0 ? `${unresolved} unresolved comment(s). Resolve them or request changes.` : 'Approve to close Phase 1, or request changes for a new version.' },
        {
          primary: approve,
          secondary: action('request_changes', 'Request changes'),
          more: [action('reject', 'Reject', { destructive: true }), ...CLOSE_DECISIONS],
          tertiary,
          requiresSecondApprover: t.riskTier === 'high',
        },
      );
    }

    case 'plan_changes_requested': {
      if (!canReview) {
        return plan({ kind: 'waiting', title: 'Changes requested', message: `Waiting for ${owner} to ask for a new plan.` }, { tertiary });
      }
      const disabledReason = replanDisabledReason(t);
      const info: ActionInfo = runFailed(latestRun)
        ? { kind: 'failed', title: 'Planning failed', message: failureMessage(latestRun) }
        : { kind: 'plan_review', title: 'Changes requested', message: 'Ask the AI for a new plan version or close the ticket.' };
      return plan(info, {
        primary: action('replan', 'Re-plan', disabledReason ? { disabledReason } : {}),
        secondary: action('reject', 'Reject', { destructive: true }),
        more: CLOSE_DECISIONS,
        tertiary,
      });
    }

    case 'plan_approved':
      return plan(
        { kind: 'approved', title: 'What happens next', message: 'The plan is approved. Implementation by the AI arrives in Phase 2; until then the ticket stays here.' },
        { secondary: canReview ? action('reopen', 'Reopen plan') : undefined, tertiary },
      );

    default:
      return plan({ kind: 'later_phase', title: humanize(t.state, true), message: 'This stage is handled in a later phase of the hub.' }, { tertiary });
  }
}
