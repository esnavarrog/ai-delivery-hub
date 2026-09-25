import type { TriageAssessment } from '@ai-delivery-hub/domain';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { AssessmentCard } from '@/features/ticket/AssessmentCard';
import { event, ticket } from '../fixtures/ticket';

const assessment: TriageAssessment = {
  functional: { clarity: 4, acceptanceCriteria: ['Refunds can be issued from the admin panel'], questions: ['¿Aplica a reembolsos parciales?'] },
  technical: { feasibility: 'feasible', risks: ['Double refund'], dependencies: ['payments-service'] },
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

describe('AssessmentCard', () => {
  it('renders the three lenses, the RICE score and an AI-suggested badge when not yet confirmed', () => {
    const t = ticket({ state: 'triaged', value: 4, reach: 3, confidence: 0.8, effort: 'M', riceScore: 4.8 });
    const events = [event({ type: 'triage_completed', seq: 1, payload: triageCompletedPayload({ assessment }) })];
    render(<AssessmentCard ticket={t} events={events} />);

    expect(screen.getByText('Análisis funcional')).toBeInTheDocument();
    expect(screen.getByText('Refunds can be issued from the admin panel')).toBeInTheDocument();
    expect(screen.getByText('¿Aplica a reembolsos parciales?')).toBeInTheDocument();
    expect(screen.getByText('Análisis técnico')).toBeInTheDocument();
    expect(screen.getByText('Double refund')).toBeInTheDocument();
    expect(screen.getByText('payments-service')).toBeInTheDocument();
    expect(screen.getByText('Gerencia')).toBeInTheDocument();
    expect(screen.getByText('Solid business case with moderate cost.')).toBeInTheDocument();
    expect(screen.getByText('Aprobar')).toBeInTheDocument();
    expect(screen.getByText('4.8')).toBeInTheDocument();
    expect(screen.getByText('Sugerido por la IA')).toBeInTheDocument();
  });

  it('shows a human-confirmed badge once triage_confirmed happened after triage_completed', () => {
    const t = ticket({ state: 'awaiting_owner', value: 5, reach: 5, confidence: 1, effort: 'S', riceScore: 25 });
    const events = [
      event({ type: 'triage_completed', seq: 1, payload: triageCompletedPayload({ assessment }) }),
      event({ type: 'triage_confirmed', seq: 2, payload: { scores: { value: 5, reach: 5, confidence: 1, effort: 'S' } } }),
    ];
    render(<AssessmentCard ticket={t} events={events} />);
    expect(screen.getByText('Confirmado por una persona')).toBeInTheDocument();
  });

  it('marks the assessment provisional while awaiting_requester', () => {
    const t = ticket({ state: 'awaiting_requester' });
    const events = [event({ type: 'requester_questions_asked', seq: 1, payload: { round: 1, questions: [{ id: 'q1', text: '¿Cuándo?' }], assessment } })];
    render(<AssessmentCard ticket={t} events={events} />);
    expect(screen.getByText(/Evaluación provisional/)).toBeInTheDocument();
  });

  it('renders nothing when there is no assessment (e.g. an OP ticket triaged before this feature)', () => {
    const t = ticket({ state: 'triaged' });
    const events = [event({ type: 'triage_completed', seq: 1, payload: triageCompletedPayload() })];
    const { container } = render(<AssessmentCard ticket={t} events={events} />);
    expect(container).toBeEmptyDOMElement();
  });
});
