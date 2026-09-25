import { riceScore, type RiceInput, type TicketEvent, type TicketSnapshot, type TriageAssessment } from '@ai-delivery-hub/domain';

/** The three-lens assessment relevant to a ticket right now, and whether it is still provisional. */
export interface AssessmentView {
  assessment: TriageAssessment;
  /** True when read from `requester_questions_asked` (the ticket is still `awaiting_requester`); the
   * next triage run over the requester's answers may change it. */
  provisional: boolean;
}

/**
 * The assessment to show on the ticket page: the latest `triage_completed` payload, or, while the
 * ticket is `awaiting_requester`, the latest `requester_questions_asked` payload (the only place that
 * carries the assessment while questions are still pending). Undefined when neither exists or neither
 * carries an assessment (backward compatible: tickets triaged before this feature have none).
 */
export function latestAssessment(ticket: TicketSnapshot, events: readonly TicketEvent[]): AssessmentView | undefined {
  if (ticket.state === 'awaiting_requester') {
    const found = [...events].reverse().find((e) => e.type === 'requester_questions_asked');
    if (found?.type === 'requester_questions_asked' && found.payload.assessment) {
      return { assessment: found.payload.assessment, provisional: true };
    }
    return undefined;
  }
  const found = [...events].reverse().find((e) => e.type === 'triage_completed');
  if (found?.type === 'triage_completed' && found.payload.assessment) {
    return { assessment: found.payload.assessment, provisional: false };
  }
  return undefined;
}

/**
 * The RICE inputs to score: the snapshot's own value/reach/confidence/effort once `triage_completed`
 * or a `triage_confirmed` override has set them, else the assessment's management lens (e.g. while
 * `awaiting_requester`, before any of those events have run).
 */
export function effectiveScores(ticket: TicketSnapshot, assessment: TriageAssessment | undefined): RiceInput | undefined {
  if (ticket.value !== undefined && ticket.reach !== undefined && ticket.confidence !== undefined && ticket.effort !== undefined) {
    return { value: ticket.value, reach: ticket.reach, confidence: ticket.confidence, effort: ticket.effort };
  }
  return assessment?.management;
}

/** Convenience: `riceScore` of `effectiveScores`, or undefined when there is nothing to score yet. */
export function effectiveRiceScore(ticket: TicketSnapshot, assessment: TriageAssessment | undefined): number | undefined {
  const scores = effectiveScores(ticket, assessment);
  return scores ? riceScore(scores) : undefined;
}

/**
 * Whether the AI-suggested RICE numbers have since been confirmed by a human, i.e. a `triage_confirmed`
 * event exists after the latest `triage_completed` (so a later re-triage correctly reads as AI-suggested
 * again until re-confirmed).
 */
export function isTriageConfirmed(events: readonly TicketEvent[]): boolean {
  const lastCompleted = [...events].reverse().find((e) => e.type === 'triage_completed');
  const lastConfirmed = [...events].reverse().find((e) => e.type === 'triage_confirmed');
  if (!lastConfirmed) return false;
  if (!lastCompleted) return true;
  return lastConfirmed.seq > lastCompleted.seq;
}
