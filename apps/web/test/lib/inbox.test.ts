import { describe, expect, it } from 'vitest';
import { groupInbox, sortTickets } from '@/lib/inbox';
import { ticket } from '../fixtures/ticket';

describe('sortTickets', () => {
  it('orders by priority immediate > high > normal > low, then oldest updatedAt first', () => {
    const list = [
      ticket({ id: 'low-old', priority: 'low', updatedAt: '2026-09-01T00:00:00.000Z' }),
      ticket({ id: 'normal-new', priority: 'normal', updatedAt: '2026-09-10T00:00:00.000Z' }),
      ticket({ id: 'normal-old', priority: 'normal', updatedAt: '2026-09-02T00:00:00.000Z' }),
      ticket({ id: 'immediate', priority: 'immediate', updatedAt: '2026-09-13T00:00:00.000Z' }),
      ticket({ id: 'high', priority: 'high', updatedAt: '2026-09-12T00:00:00.000Z' }),
    ];
    expect(sortTickets(list).map((t) => t.id)).toEqual(['immediate', 'high', 'normal-old', 'normal-new', 'low-old']);
  });

  it('does not mutate the input', () => {
    const list = [ticket({ id: 'b', priority: 'low' }), ticket({ id: 'a', priority: 'high' })];
    sortTickets(list);
    expect(list.map((t) => t.id)).toEqual(['b', 'a']);
  });
});

describe('groupInbox', () => {
  it('splits waiting-on-me from watching and drops terminal tickets from watching', () => {
    const all = [
      ticket({ id: 'mine', state: 'plan_review' }),
      ticket({ id: 'other', state: 'planning' }),
      ticket({ id: 'closed', state: 'rejected' }),
      ticket({ id: 'done', state: 'done' }),
    ];
    const waiting = [ticket({ id: 'mine', state: 'plan_review' })];
    const g = groupInbox(all, waiting);
    expect(g.waitingOnYou.map((t) => t.id)).toEqual(['mine']);
    expect(g.watching.map((t) => t.id)).toEqual(['other']);
  });

  it('sorts both groups', () => {
    const all = [ticket({ id: 'n', priority: 'normal' }), ticket({ id: 'i', priority: 'immediate' })];
    const g = groupInbox(all, all);
    expect(g.waitingOnYou.map((t) => t.id)).toEqual(['i', 'n']);
  });
});
