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

  it('rejects negative counters and a non-integer OpenProject work package id', () => {
    expect(TicketSnapshot.safeParse(baseSnapshot({ planVersionCount: -1 })).success).toBe(false);
    expect(TicketSnapshot.safeParse(baseSnapshot({ unresolvedCommentCount: 1.5 })).success).toBe(false);
    expect(TicketSnapshot.safeParse(baseSnapshot({ source: { kind: 'openproject', workPackageId: 1.2, projectId: 7, lockVersion: 3 } })).success).toBe(false);
  });

  it('accepts a manual ticket source', () => {
    const r = TicketSnapshot.safeParse(baseSnapshot({ source: { kind: 'manual', key: 'M-0001' }, displayKey: 'M-0001' }));
    expect(r.success).toBe(true);
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

  it('parses optional department, requesterUserId, clarification and RICE fields when present', () => {
    const r = TicketSnapshot.safeParse(
      baseSnapshot({
        department: 'support',
        requesterUserId: 'req-1',
        clarificationRound: 1,
        pendingQuestionCount: 2,
        value: 4,
        reach: 3,
        confidence: 0.8,
        effort: 'M',
        riceScore: 4.8,
      }),
    );
    expect(r.success).toBe(true);
  });

  it('still parses without any of the new optional fields (backward compatible)', () => {
    expect(TicketSnapshot.safeParse(baseSnapshot()).success).toBe(true);
  });

  it('rejects an unknown department or effort', () => {
    expect(TicketSnapshot.safeParse({ ...baseSnapshot(), department: 'sales' }).success).toBe(false);
    expect(TicketSnapshot.safeParse({ ...baseSnapshot(), effort: 'XXL' }).success).toBe(false);
  });
});
