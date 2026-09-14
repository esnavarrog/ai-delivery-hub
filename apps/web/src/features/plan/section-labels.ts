import type { PlanSectionKey } from '@ai-delivery-hub/domain';

export const SECTION_LABELS: Record<PlanSectionKey, string> = {
  goal: 'Goal',
  scopeIn: 'Scope in',
  scopeOut: 'Scope out',
  designDrafts: 'Design drafts',
  filesTouched: 'Files touched',
  steps: 'Steps',
  tests: 'Tests',
  risks: 'Risks',
  rollback: 'Rollback',
  acceptanceCriteria: 'Acceptance criteria',
  baseCommitSha: 'Base commit',
  openQuestions: 'Open questions',
};

/** `steps[2]` -> `Steps, item 3`; `goal` -> `Goal`. */
export function describeSectionPath(path: string): string {
  const match = /^(\w+)(?:\[(\d+)\])?$/.exec(path);
  if (!match) return path;
  const label = SECTION_LABELS[match[1] as PlanSectionKey] ?? match[1];
  return match[2] !== undefined ? `${label}, item ${Number(match[2]) + 1}` : label;
}
