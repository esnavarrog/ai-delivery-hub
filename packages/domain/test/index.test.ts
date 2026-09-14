import { describe, expect, it } from 'vitest';
import * as domain from '../src/index.js';

describe('package barrel', () => {
  it('exports the public surface', () => {
    const expected = [
      'TicketState',
      'TicketFlag',
      'RiskTier',
      'TicketCategory',
      'Actor',
      'Role',
      'TRANSITIONS',
      'TERMINAL_STATES',
      'canTransition',
      'nextState',
      'TicketSnapshot',
      'reduceTicket',
      'replay',
      'TicketEventType',
      'TicketEvent',
      'OptimisticConcurrencyError',
      'TriageResult',
      'triageResultSchemaFor',
      'Plan',
      'PlanVersion',
      'PlanComment',
      'renderPlanMarkdown',
      'diffPlans',
      'RunBudget',
      'WorkPackage',
      'wrapUntrusted',
      'stripControlChars',
    ];
    for (const name of expected) {
      expect(name in domain, `missing export ${name}`).toBe(true);
    }
  });
});
