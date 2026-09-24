import { describe, expect, it } from 'vitest';
import { EFFORT_WEIGHTS, riceScore } from '../../src/triage/rice-score.js';

describe('EFFORT_WEIGHTS', () => {
  it('maps S/M/L/XL to 1/2/4/8', () => {
    expect(EFFORT_WEIGHTS).toEqual({ S: 1, M: 2, L: 4, XL: 8 });
  });
});

describe('riceScore', () => {
  it('computes value * reach * confidence / weight, rounded to 2 decimals', () => {
    expect(riceScore({ value: 4, reach: 3, confidence: 0.8, effort: 'M' })).toBe(4.8);
  });

  it('is pure: same input always yields the same output', () => {
    const input = { value: 5, reach: 5, confidence: 1, effort: 'S' } as const;
    expect(riceScore(input)).toBe(riceScore(input));
  });

  it('divides by the effort weight (higher effort lowers the score)', () => {
    const base = { value: 4, reach: 4, confidence: 1 } as const;
    expect(riceScore({ ...base, effort: 'S' })).toBe(16);
    expect(riceScore({ ...base, effort: 'M' })).toBe(8);
    expect(riceScore({ ...base, effort: 'L' })).toBe(4);
    expect(riceScore({ ...base, effort: 'XL' })).toBe(2);
  });

  it('rounds to exactly 2 decimals', () => {
    expect(riceScore({ value: 1, reach: 3, confidence: 0.5, effort: 'S' })).toBe(1.5);
    expect(riceScore({ value: 2, reach: 1, confidence: 0.5, effort: 'M' })).toBe(0.5);
    expect(riceScore({ value: 1, reach: 1, confidence: 0.5, effort: 'S' })).toBeCloseTo(0.5, 2);
  });
});
