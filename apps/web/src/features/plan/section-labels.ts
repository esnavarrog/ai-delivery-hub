import type { PlanSectionKey } from '@ai-delivery-hub/domain';
import { es } from '@/i18n/es';

export const SECTION_LABELS: Record<PlanSectionKey, string> = es.sectionLabels;

/** `steps[2]` -> `Pasos, elemento 3`; `goal` -> `Objetivo`. */
export function describeSectionPath(path: string): string {
  const match = /^(\w+)(?:\[(\d+)\])?$/.exec(path);
  if (!match) return path;
  const label = SECTION_LABELS[match[1] as PlanSectionKey] ?? match[1];
  return match[2] !== undefined ? `${label}, elemento ${Number(match[2]) + 1}` : label;
}
