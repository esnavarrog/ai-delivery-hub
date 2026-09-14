import { describe, expect, it } from 'vitest';
import { formatCost, formatDuration, formatElapsed, formatTokens, humanize } from '@/lib/format';

describe('format helpers', () => {
  it('formats durations compactly', () => {
    expect(formatDuration(0)).toBe('0s');
    expect(formatDuration(45_000)).toBe('45s');
    expect(formatDuration(125_000)).toBe('2m 5s');
    expect(formatDuration(3_725_000)).toBe('1h 2m');
  });
  it('formats elapsed time between two dates', () => {
    expect(formatElapsed('2026-09-14T11:58:00.000Z', new Date('2026-09-14T12:00:00.000Z'))).toBe('2m');
  });
  it('formats cost and tokens', () => {
    expect(formatCost(null)).toBe('n/a');
    expect(formatCost(0.4213)).toBe('$0.42');
    expect(formatCost(12)).toBe('$12.00');
    expect(formatTokens(950)).toBe('950');
    expect(formatTokens(12_400)).toBe('12.4k');
    expect(formatTokens(1_250_000)).toBe('1.25M');
  });
  it('humanizes snake_case identifiers', () => {
    expect(humanize('plan_changes_requested')).toBe('plan changes requested');
    expect(humanize('budget_exhausted', true)).toBe('Budget exhausted');
  });
});
