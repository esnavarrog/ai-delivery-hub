import { diffPlans, type Plan, type PlanSectionKey, type SectionPath } from '@ai-delivery-hub/domain';

/** Section paths (`goal`, `steps[1]`) whose content differs between two plan versions, canonical order. */
export function changedSectionPaths(previous: Plan, current: Plan): SectionPath[] {
  return diffPlans(previous, current);
}

/** `steps[1]`, `steps[3]` -> `steps`; keeps first-seen order. */
export function changedTopLevelSections(paths: readonly SectionPath[]): Set<PlanSectionKey> {
  const keys = new Set<PlanSectionKey>();
  for (const path of paths) keys.add(path.replace(/\[\d+\]$/, '') as PlanSectionKey);
  return keys;
}
