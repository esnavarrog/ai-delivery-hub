import { PLAN_SECTION_KEYS, type Plan, type SectionPath } from './plan.js';

/** JSON with object keys sorted recursively so that key order never counts as a change. */
function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`);
    return `{${entries.join(',')}}`;
  }
  return JSON.stringify(value);
}

/**
 * Shallow structural diff between two plans. Array sections report per-index
 * paths (`steps[1]`, including added/removed indices); scalar sections report
 * the bare key. Result follows canonical section order.
 */
export function diffPlans(a: Plan, b: Plan): SectionPath[] {
  const changed: SectionPath[] = [];
  for (const key of PLAN_SECTION_KEYS) {
    const left: unknown = a[key];
    const right: unknown = b[key];
    if (Array.isArray(left) && Array.isArray(right)) {
      const len = Math.max(left.length, right.length);
      for (let i = 0; i < len; i += 1) {
        if (stableStringify(left[i]) !== stableStringify(right[i])) changed.push(`${key}[${i}]`);
      }
    } else if (stableStringify(left) !== stableStringify(right)) {
      changed.push(key);
    }
  }
  return changed;
}
