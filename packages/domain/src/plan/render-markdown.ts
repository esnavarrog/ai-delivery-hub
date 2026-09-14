import type { Plan, PlanSectionKey } from './plan.js';

export interface PlanSection {
  key: PlanSectionKey;
  heading: string;
}

/** Fixed section order for rendered plans; never reorder without a migration of stored `renderedMarkdown`. */
export const PLAN_SECTION_ORDER: readonly PlanSection[] = [
  { key: 'goal', heading: 'Goal' },
  { key: 'scopeIn', heading: 'Scope In' },
  { key: 'scopeOut', heading: 'Scope Out' },
  { key: 'designDrafts', heading: 'Design Drafts' },
  { key: 'filesTouched', heading: 'Files Touched' },
  { key: 'steps', heading: 'Steps' },
  { key: 'tests', heading: 'Tests' },
  { key: 'risks', heading: 'Risks' },
  { key: 'rollback', heading: 'Rollback' },
  { key: 'acceptanceCriteria', heading: 'Acceptance Criteria' },
  { key: 'baseCommitSha', heading: 'Base Commit' },
  { key: 'openQuestions', heading: 'Open Questions' },
];

const NONE = '_None_';

const bullets = (items: readonly string[]): string =>
  items.length === 0 ? NONE : items.map((i) => `- ${i}`).join('\n');

/** Sections rendered only when they carry content. Every other section is always emitted. */
const OPTIONAL_SECTIONS: ReadonlySet<PlanSectionKey> = new Set(['designDrafts']);

function hasContent(plan: Plan, key: PlanSectionKey): boolean {
  const value = plan[key];
  return value !== undefined && (!Array.isArray(value) || value.length > 0);
}

function renderSection(plan: Plan, key: PlanSectionKey): string {
  switch (key) {
    case 'designDrafts':
      return bullets(
        (plan.designDrafts ?? []).map((d) => `**${d.id}** — ${d.title}: ${d.purpose} (\`${d.artifactRef}\`)`),
      );
    case 'goal':
      return plan.goal;
    case 'rollback':
      return plan.rollback;
    case 'baseCommitSha':
      return `\`${plan.baseCommitSha}\``;
    case 'scopeIn':
      return bullets(plan.scopeIn);
    case 'scopeOut':
      return bullets(plan.scopeOut);
    case 'tests':
      return bullets(plan.tests);
    case 'openQuestions':
      return bullets(plan.openQuestions);
    case 'filesTouched':
      return bullets(plan.filesTouched.map((f) => `\`${f.path}\` (${f.action}): ${f.why}`));
    case 'risks':
      return bullets(plan.risks.map((r) => `[${r.tier}] ${r.description} — Mitigation: ${r.mitigation}`));
    case 'acceptanceCriteria':
      return bullets(
        plan.acceptanceCriteria.map((ac) => `**${ac.id}** — Given ${ac.given}, when ${ac.when}, then ${ac.then}`),
      );
    case 'steps':
      return [...plan.steps]
        .sort((a, b) => a.order - b.order)
        .map((s) => {
          const tests = s.tests.length === 0 ? '' : `\n\nTests: ${s.tests.join(', ')}`;
          return `### ${s.order}. ${s.title}\n\n${s.detail}${tests}`;
        })
        .join('\n\n');
  }
}

/** Deterministic Markdown rendering of a plan: same plan in, byte-identical Markdown out. */
export function renderPlanMarkdown(plan: Plan): string {
  const parts = ['# Plan'];
  for (const { key, heading } of PLAN_SECTION_ORDER) {
    if (OPTIONAL_SECTIONS.has(key) && !hasContent(plan, key)) continue;
    parts.push(`## ${heading}\n\n${renderSection(plan, key)}`);
  }
  return `${parts.join('\n\n')}\n`;
}
