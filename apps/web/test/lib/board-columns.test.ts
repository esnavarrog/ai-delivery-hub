import { describe, expect, it } from 'vitest';
import { applyFilters, buildColumns, PHASE1_COLUMNS } from '@/features/board/board-columns';
import { ticket } from '../fixtures/ticket';

describe('buildColumns', () => {
  it('has every Phase 1 state in order plus one collapsed Closed column', () => {
    const cols = buildColumns([ticket({ id: 'a', state: 'plan_review' }), ticket({ id: 'b', state: 'rejected' }), ticket({ id: 'c', state: 'done' })]);
    expect(cols.map((c) => c.id)).toEqual([...PHASE1_COLUMNS, 'closed']);
    expect(cols.find((c) => c.id === 'closed')?.tickets.map((t) => t.id)).toEqual(['b', 'c']);
    expect(cols.find((c) => c.id === 'plan_review')?.tickets.map((t) => t.id)).toEqual(['a']);
  });

  it('adds a later-phases column only when such tickets exist', () => {
    expect(buildColumns([]).some((c) => c.id === 'later')).toBe(false);
    const cols = buildColumns([ticket({ id: 'x', state: 'implementing' })]);
    expect(cols.find((c) => c.id === 'later')?.tickets.map((t) => t.id)).toEqual(['x']);
  });
});

describe('applyFilters', () => {
  const list = [ticket({ id: 'a', targetRepo: 'r1', ownerUserId: 'ana', riskTier: 'high' }), ticket({ id: 'b', targetRepo: 'r2', ownerUserId: 'bob', riskTier: 'low' })];
  it('filters by repo, owner and risk independently and combined', () => {
    expect(applyFilters(list, { repo: 'r1' }).map((t) => t.id)).toEqual(['a']);
    expect(applyFilters(list, { owner: 'bob' }).map((t) => t.id)).toEqual(['b']);
    expect(applyFilters(list, { risk: 'low' }).map((t) => t.id)).toEqual(['b']);
    expect(applyFilters(list, { repo: 'r1', risk: 'low' })).toEqual([]);
    expect(applyFilters(list, {})).toHaveLength(2);
  });
});
