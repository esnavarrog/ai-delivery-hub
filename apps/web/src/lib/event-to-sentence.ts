import type { Artifact, TicketEvent } from '@ai-delivery-hub/domain';
import { humanize } from './format';

export interface Sentence {
  text: string;
  actorKind: TicketEvent['actor']['kind'];
  reason?: string;
  artifacts: Artifact[];
}

function actorName(actor: TicketEvent['actor']): string {
  if (actor.kind === 'ai') return 'AI';
  if (actor.kind === 'system') return 'System';
  return actor.id;
}

const str = (v: unknown): string | undefined => (typeof v === 'string' && v.length > 0 ? v : undefined);
const num = (v: unknown): number | undefined => (typeof v === 'number' ? v : undefined);

function runKind(payload: Record<string, unknown>): string {
  const kind = str(payload['kind']);
  if (kind === 'triage') return 'Triage';
  if (kind === 'planning') return 'Planning';
  return 'AI';
}

/** Turns a domain event into a one-line, human sentence. Unknown types fall back to a generic form. */
export function eventToSentence(event: TicketEvent): Sentence {
  const who = actorName(event.actor);
  const payload = (event.payload ?? {}) as Record<string, unknown>;
  const base = { actorKind: event.actor.kind, artifacts: event.artifacts, ...(event.reason !== undefined ? { reason: event.reason } : {}) };
  const type: string = event.type;

  switch (type) {
    case 'ticket_received':
      return { ...base, text: 'Ticket received from OpenProject' };
    case 'triage_started':
      return { ...base, text: 'AI started triage' };
    case 'triage_completed': {
      const parts = [str(payload['category']), str(payload['riskTier']) ? `${str(payload['riskTier'])} risk` : undefined, str(payload['targetRepo'])].filter(Boolean);
      return { ...base, text: parts.length > 0 ? `AI finished triage: ${parts.join(', ')}` : 'AI finished triage' };
    }
    case 'triage_confirmed': {
      const overrides = [
        str(payload['category']) ? `category ${str(payload['category'])}` : undefined,
        str(payload['riskTier']) ? `risk ${str(payload['riskTier'])}` : undefined,
        str(payload['targetRepo']) ? `repo ${str(payload['targetRepo'])}` : undefined,
      ].filter(Boolean);
      return { ...base, text: overrides.length > 0 ? `${who} confirmed the triage with overrides: ${overrides.join(', ')}` : `${who} confirmed the AI triage` };
    }
    case 'owner_required':
      return { ...base, text: 'Waiting for a developer to claim the ticket' };
    case 'planning_started':
      return { ...base, text: 'AI started planning' };
    case 'ticket_claimed':
      return { ...base, text: `${str(payload['ownerUserId']) ?? who} claimed the ticket` };
    case 'plan_version_created': {
      const v = num(payload['version']);
      return { ...base, text: v !== undefined ? `AI created plan v${v}` : 'AI created a new plan version' };
    }
    case 'plan_changes_requested':
      return { ...base, text: `${who} requested changes to the plan` };
    case 'replan_requested':
      return { ...base, text: `${who} asked the AI to re-plan` };
    case 'plan_approved': {
      const second = str(payload['secondApproverId']);
      return { ...base, text: second ? `${who} approved the plan with ${second} as second approver` : `${who} approved the plan` };
    }
    case 'plan_reopened':
      return { ...base, text: `${who} reopened the plan for review` };
    case 'ticket_rejected':
      return { ...base, text: `${who} rejected the ticket` };
    case 'ticket_marked_duplicate': {
      const of = str(payload['duplicateOfTicketId']);
      return { ...base, text: of ? `${who} marked the ticket as a duplicate of ${of}` : `${who} marked the ticket as a duplicate` };
    }
    case 'ticket_marked_already_implemented':
      return { ...base, text: `${who} marked the ticket as already implemented` };
    case 'implementation_started':
      return { ...base, text: 'AI started the implementation' };
    case 'implementation_completed':
      return { ...base, text: 'AI finished the implementation' };
    case 'dev_review_approved':
      return { ...base, text: `${who} approved the implementation review` };
    case 'sandbox_qa_passed':
      return { ...base, text: `${who} passed sandbox QA` };
    case 'sandbox_qa_failed':
      return { ...base, text: `${who} failed sandbox QA` };
    case 'qa_fix_submitted':
      return { ...base, text: `${who} submitted a QA fix` };
    case 'staging_qa_passed':
      return { ...base, text: `${who} passed staging QA` };
    case 'flag_set':
      return { ...base, text: `${who} set the ${humanize(str(payload['flag']) ?? 'unknown')} flag` };
    case 'flag_cleared':
      return { ...base, text: `${who} cleared the ${humanize(str(payload['flag']) ?? 'unknown')} flag` };
    case 'plan_comment_added': {
      const section = str(payload['sectionPath']);
      return { ...base, text: section ? `${who} commented on ${humanize(section)}` : `${who} commented on the plan` };
    }
    case 'plan_comment_resolved':
      return { ...base, text: `${who} resolved a plan comment` };
    case 'run_started':
      return { ...base, text: `${runKind(payload)} run started` };
    case 'run_succeeded':
      return { ...base, text: `${runKind(payload)} run succeeded` };
    case 'run_failed': {
      const reason = str(payload['failureReason']);
      return { ...base, text: reason ? `${runKind(payload)} run failed: ${humanize(reason)}` : `${runKind(payload)} run failed` };
    }
    case 'budget_exhausted':
      return { ...base, text: `${runKind(payload)} run stopped: budget exhausted` };
    case 'op_sync_posted':
      return { ...base, text: 'Update posted to OpenProject' };
    case 'ticket_updated_from_op': {
      const fields = Array.isArray(payload['changedFields']) ? (payload['changedFields'] as string[]).join(' and ') : undefined;
      return { ...base, text: fields ? `OpenProject updated the ${fields}` : 'OpenProject updated the work package' };
    }
    default:
      return { ...base, text: `${who} recorded ${humanize(type)}` };
  }
}
