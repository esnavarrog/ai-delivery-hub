import { TicketEventType } from '@ai-delivery-hub/domain';
import { describe, expect, it } from 'vitest';
import { eventToSentence } from '@/lib/event-to-sentence';
import { event, SHA } from '../fixtures/ticket';

describe('eventToSentence', () => {
  it('renders every known event type as a non-empty sentence that is not the raw type', () => {
    for (const type of TicketEventType.options) {
      const s = eventToSentence(event({ type, actor: { kind: 'dev', id: 'Esteban' } } as never));
      expect(s.text.length, type).toBeGreaterThan(5);
      expect(s.text, type).not.toBe(type);
      expect(s.text, type).not.toContain('_');
    }
  });

  it('falls back to a generic sentence for an unknown type', () => {
    const s = eventToSentence(event({ type: 'something_new' as never, actor: { kind: 'system', id: 'x' } }));
    expect(s.text).toBe('Sistema registró something new');
  });

  it('summarises triage_completed with category, risk and repo', () => {
    const s = eventToSentence(
      event({
        type: 'triage_completed',
        actor: { kind: 'ai', id: 'claude' },
        payload: { category: 'feature', riskTier: 'medium', targetRepo: 'backend-parkingapp', summary: 'x', duplicateCandidates: [], riskSignals: [] },
      }),
    );
    expect(s.text).toBe('La IA terminó el triaje: Función, riesgo medio, backend-parkingapp');
  });

  it('names the human actor on claim and the plan version on creation', () => {
    expect(eventToSentence(event({ type: 'ticket_claimed', actor: { kind: 'dev', id: 'Esteban' }, payload: { ownerUserId: 'Esteban' } })).text).toBe('Esteban reclamó el ticket');
    const s = eventToSentence(event({ type: 'plan_version_created', actor: { kind: 'ai', id: 'claude' }, payload: { version: 2, baseCommitSha: SHA }, artifacts: [{ kind: 'plan_version', ref: 'pv2' }] }));
    expect(s.text).toBe('La IA creó el plan v2');
    expect(s.artifacts).toEqual([{ kind: 'plan_version', ref: 'pv2' }]);
  });

  it('includes flag names and reasons', () => {
    const s = eventToSentence(event({ type: 'flag_set', actor: { kind: 'dev', id: 'Ana' }, payload: { flag: 'paused' }, reason: 'waiting for product' }));
    expect(s.text).toBe('Ana activó la marca pausado');
    expect(s.reason).toBe('waiting for product');
    expect(eventToSentence(event({ type: 'flag_cleared', actor: { kind: 'dev', id: 'Ana' }, payload: { flag: 'needs_info' } })).text).toBe('Ana quitó la marca necesita información');
  });

  it('describes run failures with the failure reason', () => {
    const s = eventToSentence(event({ type: 'run_failed', actor: { kind: 'system', id: 'runner' }, payload: { kind: 'planning', failureReason: 'budget_exhausted' } }));
    expect(s.text).toBe('Ejecución de Planificación falló: presupuesto agotado');
  });

  it('describes triage_confirmed overrides', () => {
    expect(eventToSentence(event({ type: 'triage_confirmed', actor: { kind: 'dev', id: 'Ana' }, payload: {} })).text).toBe('Ana confirmó el triaje de la IA');
    expect(eventToSentence(event({ type: 'triage_confirmed', actor: { kind: 'dev', id: 'Ana' }, payload: { riskTier: 'high' } })).text).toBe('Ana confirmó el triaje con cambios: riesgo alto');
  });
});
