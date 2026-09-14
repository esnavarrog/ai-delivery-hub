import { describe, expect, it } from 'vitest';
import { Plan, PlanComment, PlanVersion, SECTION_PATH_PATTERN } from '../../src/plan/plan.js';
import { aiActor, SHA_A, validPlan } from '../fixtures.js';

describe('Plan', () => {
  it('parses a valid plan', () => {
    expect(Plan.safeParse(validPlan()).success).toBe(true);
  });

  it('rejects a bad baseCommitSha', () => {
    expect(Plan.safeParse(validPlan({ baseCommitSha: 'abc' })).success).toBe(false);
    expect(Plan.safeParse(validPlan({ baseCommitSha: 'A'.repeat(40) })).success).toBe(false);
  });

  it('rejects unknown file actions and risk tiers', () => {
    const badAction = { ...validPlan(), filesTouched: [{ path: 'a', action: 'rename', why: 'x' }] };
    expect(Plan.safeParse(badAction).success).toBe(false);
    const badTier = { ...validPlan(), risks: [{ description: 'd', mitigation: 'm', tier: 'severe' }] };
    expect(Plan.safeParse(badTier).success).toBe(false);
  });

  it('requires at least one step and one acceptance criterion', () => {
    expect(Plan.safeParse(validPlan({ steps: [] })).success).toBe(false);
    expect(Plan.safeParse(validPlan({ acceptanceCriteria: [] })).success).toBe(false);
  });

  it('rejects duplicate acceptance criterion ids and duplicate step orders', () => {
    const ac = validPlan().acceptanceCriteria[0]!;
    expect(Plan.safeParse(validPlan({ acceptanceCriteria: [ac, { ...ac, then: 'other' }] })).success).toBe(false);
    const st = validPlan().steps[0]!;
    expect(Plan.safeParse(validPlan({ steps: [st, { ...st, title: 'again' }] })).success).toBe(false);
  });
});

describe('PlanVersion', () => {
  it('parses', () => {
    const r = PlanVersion.safeParse({
      ticketId: 't-1',
      version: 1,
      plan: validPlan(),
      renderedMarkdown: '# Plan',
      createdBy: aiActor,
      createdAt: '2026-09-14T10:00:00.000Z',
    });
    expect(r.success).toBe(true);
  });

  it('rejects version 0', () => {
    const r = PlanVersion.safeParse({
      ticketId: 't-1',
      version: 0,
      plan: validPlan(),
      renderedMarkdown: '# Plan',
      createdBy: aiActor,
      createdAt: '2026-09-14T10:00:00.000Z',
    });
    expect(r.success).toBe(false);
  });
});

describe('PlanComment', () => {
  const comment = {
    id: 'c-1',
    planVersionId: 'pv-1',
    sectionPath: 'steps[2]',
    authorId: 'dev-owner',
    body: 'Why not reuse the existing middleware?',
  };

  it('parses with and without resolvedByVersion', () => {
    expect(PlanComment.safeParse(comment).success).toBe(true);
    expect(PlanComment.safeParse({ ...comment, resolvedByVersion: 2 }).success).toBe(true);
  });

  it('validates sectionPath shape', () => {
    for (const ok of ['goal', 'risks', 'steps[2]', 'acceptanceCriteria[0]', 'filesTouched[10]']) {
      expect(SECTION_PATH_PATTERN.test(ok), ok).toBe(true);
      expect(PlanComment.safeParse({ ...comment, sectionPath: ok }).success, ok).toBe(true);
    }
    for (const bad of ['', 'steps[', 'steps[a]', 'unknownSection', 'goal.extra']) {
      expect(PlanComment.safeParse({ ...comment, sectionPath: bad }).success, bad).toBe(false);
    }
  });

  it('accepts SHA_A style sha as baseCommitSha in nested plan', () => {
    expect(SHA_A).toHaveLength(40);
  });
});

describe('Plan.designDrafts', () => {
  const draft = { id: 'dd-1', title: 'Login error state', purpose: 'Show the 401 message', artifactRef: 'drafts/login-v1.html' };

  it('is optional', () => {
    expect(Plan.safeParse(validPlan()).success).toBe(true);
    const parsed = Plan.parse(validPlan());
    expect(parsed.designDrafts).toBeUndefined();
  });

  it('accepts up to two drafts and rejects a third', () => {
    expect(Plan.safeParse(validPlan({ designDrafts: [draft] })).success).toBe(true);
    expect(Plan.safeParse(validPlan({ designDrafts: [draft, { ...draft, id: 'dd-2' }] })).success).toBe(true);
    expect(
      Plan.safeParse(validPlan({ designDrafts: [draft, { ...draft, id: 'dd-2' }, { ...draft, id: 'dd-3' }] })).success,
    ).toBe(false);
  });

  it('requires all four fields and unique ids', () => {
    expect(Plan.safeParse(validPlan({ designDrafts: [{ ...draft, artifactRef: '' }] })).success).toBe(false);
    expect(Plan.safeParse(validPlan({ designDrafts: [draft, draft] })).success).toBe(false);
  });

  it('designDrafts is a valid comment section path', () => {
    expect(SECTION_PATH_PATTERN.test('designDrafts[1]')).toBe(true);
  });
});
