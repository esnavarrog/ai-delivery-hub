import type { Confidence, Effort } from './triage-result.js';

/** Divides the RICE numerator; a larger effort bucket lowers the resulting score. */
export const EFFORT_WEIGHTS: Record<Effort, number> = { S: 1, M: 2, L: 4, XL: 8 };

export interface RiceInput {
  value: number;
  reach: number;
  confidence: Confidence;
  effort: Effort;
}

/** Pure RICE priority score: value * reach * confidence / effortWeight, rounded to 2 decimals. */
export function riceScore({ value, reach, confidence, effort }: RiceInput): number {
  const score = (value * reach * confidence) / EFFORT_WEIGHTS[effort];
  return Math.round(score * 100) / 100;
}
