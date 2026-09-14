import { describe, expect, it } from 'vitest';
import { diffPlans } from '../../src/plan/diff.js';
import { SHA_B, validPlan } from '../fixtures.js';

describe('diffPlans', () => {
  it('is empty for identical plans', () => {
    expect(diffPlans(validPlan(), validPlan())).toEqual([]);
  });

  it('is empty when only key order differs', () => {
    const a = validPlan();
    const b = JSON.parse(JSON.stringify(a)) as typeof a;
    const reordered = Object.fromEntries(Object.entries(b).reverse()) as typeof a;
    expect(diffPlans(a, reordered)).toEqual([]);
  });

  it('reports scalar section changes', () => {
    expect(diffPlans(validPlan(), validPlan({ goal: 'other' }))).toEqual(['goal']);
    expect(diffPlans(validPlan(), validPlan({ baseCommitSha: SHA_B }))).toEqual(['baseCommitSha']);
  });

  it('reports indexed paths for changed array items', () => {
    const a = validPlan();
    const b = validPlan({
      steps: [a.steps[0]!, { ...a.steps[1]!, detail: 'changed' }],
    });
    expect(diffPlans(a, b)).toEqual(['steps[1]']);
  });

  it('reports added and removed array items by index', () => {
    const a = validPlan();
    const added = validPlan({ openQuestions: ['q1'] });
    expect(diffPlans(a, added)).toEqual(['openQuestions[0]']);
    const removed = validPlan({ acceptanceCriteria: [a.acceptanceCriteria[0]!] });
    expect(diffPlans(a, removed)).toEqual(['acceptanceCriteria[1]']);
  });

  it('returns paths sorted in plan section order', () => {
    const a = validPlan();
    const b = validPlan({ rollback: 'x', goal: 'y', tests: ['pnpm test', 'pnpm typecheck'] });
    expect(diffPlans(a, b)).toEqual(['goal', 'tests[1]', 'rollback']);
  });

  it('treats primitive arrays element-wise', () => {
    expect(diffPlans(validPlan({ scopeIn: ['a', 'b'] }), validPlan({ scopeIn: ['a', 'c'] }))).toEqual(['scopeIn[1]']);
  });
});

describe('diffPlans design drafts', () => {
  const draft = { id: 'dd-1', title: 't', purpose: 'p', artifactRef: 'drafts/a.html' };

  it('reports designDrafts when added and per index when changed', () => {
    expect(diffPlans(validPlan(), validPlan({ designDrafts: [draft] }))).toEqual(['designDrafts']);
    expect(diffPlans(validPlan({ designDrafts: [draft] }), validPlan({ designDrafts: [{ ...draft, title: 'u' }] }))).toEqual([
      'designDrafts[0]',
    ]);
  });
});
