import { describe, expect, it } from 'vitest';
import {
  RiskTier,
  TicketCategory,
  TicketFlag,
  TicketState,
} from '../../src/ticket/ticket-state.js';

describe('TicketState', () => {
  it('contains exactly the Phase 1-3 lifecycle states in order', () => {
    expect(TicketState.options).toEqual([
      'received',
      'triaging',
      'triaged',
      'awaiting_owner',
      'planning',
      'plan_review',
      'plan_changes_requested',
      'plan_approved',
      'rejected',
      'duplicate',
      'already_implemented',
      'implementing',
      'dev_review',
      'sandbox_qa',
      'qa_changes_requested',
      'staging_qa',
      'done',
    ]);
  });

  it('rejects unknown states', () => {
    expect(TicketState.safeParse('in_progress').success).toBe(false);
  });
});

describe('TicketFlag / RiskTier / TicketCategory', () => {
  it('TicketFlag has exactly the four flags', () => {
    expect(TicketFlag.options).toEqual(['blocked', 'needs_info', 'paused', 'stale_plan']);
  });

  it('RiskTier has low/medium/high', () => {
    expect(RiskTier.options).toEqual(['low', 'medium', 'high']);
  });

  it('TicketCategory has bug/feature/chore/question', () => {
    expect(TicketCategory.options).toEqual(['bug', 'feature', 'chore', 'question']);
  });
});
