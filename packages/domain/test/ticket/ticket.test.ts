import { describe, expect, it } from 'vitest';
import { TicketPriority, TicketSnapshot } from '../../src/ticket/ticket.js';
import { baseSnapshot } from '../fixtures.js';

describe('TicketSnapshot', () => {
  it('parses the base fixture', () => {
    expect(TicketSnapshot.safeParse(baseSnapshot()).success).toBe(true);
  });

  it('parses optional triage/owner fields when present', () => {
    const r = TicketSnapshot.safeParse(
      baseSnapshot({ category: 'bug', riskTier: 'high', targetRepo: 'backend', ownerUserId: 'u-1' }),
    );
    expect(r.success).toBe(true);
  });

  it('rejects negative counters and non-integer OpenProject ids', () => {
    expect(TicketSnapshot.safeParse(baseSnapshot({ planVersionCount: -1 })).success).toBe(false);
    expect(TicketSnapshot.safeParse(baseSnapshot({ unresolvedCommentCount: 1.5 })).success).toBe(false);
    expect(TicketSnapshot.safeParse(baseSnapshot({ opWorkPackageId: 1.2 })).success).toBe(false);
  });

  it('rejects unknown state, flag, and priority values', () => {
    expect(TicketSnapshot.safeParse({ ...baseSnapshot(), state: 'limbo' }).success).toBe(false);
    expect(TicketSnapshot.safeParse({ ...baseSnapshot(), flags: ['on_fire'] }).success).toBe(false);
    expect(TicketSnapshot.safeParse({ ...baseSnapshot(), priority: 'asap' }).success).toBe(false);
  });

  it('requires ISO datetimes', () => {
    expect(TicketSnapshot.safeParse(baseSnapshot({ createdAt: '14/09/2026' })).success).toBe(false);
  });

  it('TicketPriority mirrors OpenProject priorities', () => {
    expect(TicketPriority.options).toEqual(['low', 'normal', 'high', 'immediate']);
  });
});
