import type { TriageAssessment } from '@ai-delivery-hub/domain';
import { describe, expect, it } from 'vitest';
import { effectiveScores, isTriageConfirmed, latestAssessment } from '@/lib/assessment';
import { event, ticket } from '../fixtures/ticket';

const assessment: TriageAssessment = {
  functional: { clarity: 4, acceptanceCriteria: ['Refunds can be issued from the admin panel'], questions: [] },
  technical: { feasibility: 'feasible', risks: ['Double refund'], dependencies: [] },
  management: { value: 4, reach: 3, confidence: 0.8, effort: 'M', recommendation: 'approve', rationale: 'Solid business case with moderate cost.' },
};

const triageCompletedPayload = (extra: Partial<{ assessment: TriageAssessment }> = {}) => ({
  category: 'feature' as const,
  riskTier: 'low' as const,
  targetRepo: 'backend-parkingapp',
  summary: 'Refund endpoint',
  duplicateCandidates: [],
  riskSignals: [],
  ...extra,
});

describe('latestAssessment', () => {
  it('reads the latest triage_completed assessment for a ticket not awaiting the requester', () => {
    const t = ticket({ state: 'triaged' });
    const events = [event({ type: 'triage_completed', seq: 1, payload: triageCompletedPayload({ assessment }) })];
    expect(latestAssessment(t, events)).toEqual({ assessment, provisional: false });
  });

  it('reads the latest requester_questions_asked assessment when awaiting_requester', () => {
    const t = ticket({ state: 'awaiting_requester' });
    const events = [
      event({ type: 'triage_completed', seq: 1, payload: triageCompletedPayload() }),
      event({ type: 'requester_questions_asked', seq: 2, payload: { round: 1, questions: [{ id: 'q1', text: '¿Cuándo se necesita?' }], assessment } }),
    ];
    expect(latestAssessment(t, events)).toEqual({ assessment, provisional: true });
  });

  it('returns undefined when no assessment exists (e.g. an OP ticket triaged before this feature)', () => {
    const t = ticket({ state: 'triaged' });
    const events = [event({ type: 'triage_completed', seq: 1, payload: triageCompletedPayload() })];
    expect(latestAssessment(t, events)).toBeUndefined();
  });

  it('returns undefined for awaiting_requester when the questions event carries no assessment', () => {
    const t = ticket({ state: 'awaiting_requester' });
    const events = [event({ type: 'requester_questions_asked', seq: 1, payload: { round: 1, questions: [{ id: 'q1', text: '¿Cuándo?' }] } })];
    expect(latestAssessment(t, events)).toBeUndefined();
  });
});

describe('effectiveScores', () => {
  it('prefers the snapshot RICE inputs once triage_completed or triage_confirmed has set them', () => {
    const t = ticket({ value: 5, reach: 5, confidence: 1, effort: 'S' });
    expect(effectiveScores(t, assessment)).toEqual({ value: 5, reach: 5, confidence: 1, effort: 'S' });
  });

  it('falls back to the assessment management lens when the snapshot has no scores yet', () => {
    expect(effectiveScores(ticket({}), assessment)).toEqual(assessment.management);
  });

  it('returns undefined without a snapshot score or an assessment', () => {
    expect(effectiveScores(ticket({}), undefined)).toBeUndefined();
  });
});

describe('isTriageConfirmed', () => {
  it('is false with no triage_confirmed event', () => {
    const events = [event({ type: 'triage_completed', seq: 1, payload: triageCompletedPayload() })];
    expect(isTriageConfirmed(events)).toBe(false);
  });

  it('is true once triage_confirmed happened after the latest triage_completed', () => {
    const events = [event({ type: 'triage_completed', seq: 1, payload: triageCompletedPayload() }), event({ type: 'triage_confirmed', seq: 2, payload: {} })];
    expect(isTriageConfirmed(events)).toBe(true);
  });

  it('is false again once a re-triage produced a newer triage_completed than the last confirmation', () => {
    const events = [
      event({ type: 'triage_completed', seq: 1, payload: triageCompletedPayload() }),
      event({ type: 'triage_confirmed', seq: 2, payload: {} }),
      event({ type: 'triage_completed', seq: 3, payload: triageCompletedPayload() }),
    ];
    expect(isTriageConfirmed(events)).toBe(false);
  });
});
