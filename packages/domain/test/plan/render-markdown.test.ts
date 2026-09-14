import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { Plan } from '../../src/plan/plan.js';
import { PLAN_SECTION_ORDER, renderPlanMarkdown } from '../../src/plan/render-markdown.js';
import { validPlan } from '../fixtures.js';

const hexChar = fc.constantFrom(...'0123456789abcdef'.split(''));
const sha = fc.array(hexChar, { minLength: 40, maxLength: 40 }).map((c) => c.join(''));
const line = fc.string({ minLength: 1, maxLength: 40 }).filter((s) => s.trim().length > 0 && !s.includes('\n'));
const acId = fc.integer({ min: 1, max: 999 }).map((n) => `AC-${n}`);

const planArb: fc.Arbitrary<Plan> = fc
  .record({
    goal: line,
    scopeIn: fc.array(line, { maxLength: 4 }),
    scopeOut: fc.array(line, { maxLength: 4 }),
    filesTouched: fc.array(
      fc.record({ path: line, action: fc.constantFrom('create', 'modify', 'delete'), why: line }),
      { maxLength: 4 },
    ),
    steps: fc
      .array(fc.record({ title: line, detail: line, tests: fc.array(line, { maxLength: 2 }) }), { minLength: 1, maxLength: 5 })
      .map((steps) => steps.map((s, i) => ({ ...s, order: i + 1 }))),
    tests: fc.array(line, { maxLength: 3 }),
    risks: fc.array(
      fc.record({ description: line, mitigation: line, tier: fc.constantFrom('low', 'medium', 'high') }),
      { maxLength: 3 },
    ),
    rollback: line,
    acceptanceCriteria: fc
      .uniqueArray(acId, { minLength: 1, maxLength: 6 })
      .chain((ids) =>
        fc.tuple(...ids.map((id) => fc.record({ id: fc.constant(id), given: line, when: line, then: line }))),
      )
      .map((t) => [...t]),
    baseCommitSha: sha,
    openQuestions: fc.array(line, { maxLength: 3 }),
  })
  .map((p) => p as Plan);

describe('renderPlanMarkdown', () => {
  it('matches the snapshot for the fixture plan', () => {
    expect(renderPlanMarkdown(validPlan())).toMatchSnapshot();
  });

  it('emits sections in a fixed order', () => {
    const md = renderPlanMarkdown(
      validPlan({ designDrafts: [{ id: 'dd-1', title: 't', purpose: 'p', artifactRef: 'drafts/a.html' }] }),
    );
    const positions = PLAN_SECTION_ORDER.map((s) => md.indexOf(`## ${s.heading}`));
    expect(positions.every((p) => p >= 0)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
  });

  it('property: deterministic and includes every acceptance criterion id', () => {
    fc.assert(
      fc.property(planArb, (plan) => {
        const a = renderPlanMarkdown(plan);
        const b = renderPlanMarkdown(structuredCloneCompat(plan));
        expect(a).toBe(b);
        for (const ac of plan.acceptanceCriteria) expect(a).toContain(ac.id);
        expect(a).toContain(plan.baseCommitSha);
      }),
    );
  });

  it('renders placeholders for empty lists instead of dropping the section', () => {
    const md = renderPlanMarkdown(validPlan({ openQuestions: [], scopeOut: [] }));
    expect(md).toContain('## Open Questions');
    expect(md).toMatch(/## Open Questions\n\n_None_/);
  });
});

function structuredCloneCompat<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

describe('renderPlanMarkdown design drafts', () => {
  const drafts = [
    { id: 'dd-1', title: 'Login error state', purpose: 'Show the 401 message', artifactRef: 'drafts/login-v1.html' },
    { id: 'dd-2', title: 'Retry banner', purpose: 'Offer a retry', artifactRef: 'drafts/retry.html' },
  ];

  it('omits the section when no drafts are present', () => {
    expect(renderPlanMarkdown(validPlan())).not.toContain('## Design Drafts');
    expect(renderPlanMarkdown(validPlan({ designDrafts: [] }))).not.toContain('## Design Drafts');
  });

  it('renders every draft with id, title, purpose and artifact ref when present', () => {
    const md = renderPlanMarkdown(validPlan({ designDrafts: drafts }));
    expect(md).toContain('## Design Drafts');
    for (const d of drafts) {
      expect(md).toContain(d.id);
      expect(md).toContain(d.title);
      expect(md).toContain(d.purpose);
      expect(md).toContain(d.artifactRef);
    }
    expect(md).toMatchSnapshot();
  });

  it('keeps the section between Scope Out and Files Touched', () => {
    const md = renderPlanMarkdown(validPlan({ designDrafts: drafts }));
    expect(md.indexOf('## Scope Out')).toBeLessThan(md.indexOf('## Design Drafts'));
    expect(md.indexOf('## Design Drafts')).toBeLessThan(md.indexOf('## Files Touched'));
  });
});
