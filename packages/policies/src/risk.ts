import { matchesGlob } from 'node:path';
import type { RiskTier } from '@ai-delivery-hub/domain';
import type { RiskPathRule } from './schema.js';

const TIER_RANK: Record<RiskTier, number> = { low: 0, medium: 1, high: 2 };

/** Highest tier among every rule matching any path; `low` when nothing matches. */
export function riskTierForPaths(rules: readonly RiskPathRule[], paths: readonly string[]): RiskTier {
  let result: RiskTier = 'low';
  for (const path of paths) {
    for (const rule of rules) {
      if (TIER_RANK[rule.tier] > TIER_RANK[result] && matchesGlob(path, rule.glob)) {
        result = rule.tier;
        if (result === 'high') return result;
      }
    }
  }
  return result;
}
