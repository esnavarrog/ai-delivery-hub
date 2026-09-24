import { describe, expect, it } from 'vitest';
import { Department, Frequency, ManualIntake } from '../../src/ticket/manual-intake.js';

function validIntake(overrides: Partial<ManualIntake> = {}): ManualIntake {
  return {
    department: 'support',
    problem: 'Refunds take too long to process manually.',
    affected: 'The whole support team',
    frequency: 'daily',
    currentWorkaround: 'Manually copy data into a spreadsheet',
    expectedOutcome: 'Refunds are processed automatically within a minute',
    ...overrides,
  };
}

describe('Department / Frequency', () => {
  it('Department has exactly support/operations/finance/other', () => {
    expect(Department.options).toEqual(['support', 'operations', 'finance', 'other']);
  });

  it('Frequency has exactly daily/weekly/monthly/occasional', () => {
    expect(Frequency.options).toEqual(['daily', 'weekly', 'monthly', 'occasional']);
  });
});

describe('ManualIntake', () => {
  it('parses a minimal valid fixture without optional fields', () => {
    expect(ManualIntake.safeParse(validIntake()).success).toBe(true);
  });

  it('accepts optional successMetric, deadline and deadlineReason', () => {
    const r = ManualIntake.safeParse(
      validIntake({
        successMetric: 'Average processing time under 2 minutes',
        deadline: '2026-12-01',
        deadlineReason: 'Year-end close',
      }),
    );
    expect(r.success).toBe(true);
  });

  it('rejects an unknown department', () => {
    expect(ManualIntake.safeParse({ ...validIntake(), department: 'sales' }).success).toBe(false);
  });

  it('rejects an unknown frequency', () => {
    expect(ManualIntake.safeParse({ ...validIntake(), frequency: 'yearly' }).success).toBe(false);
  });

  it('rejects a malformed deadline date', () => {
    expect(ManualIntake.safeParse({ ...validIntake(), deadline: '12/01/2026' }).success).toBe(false);
  });

  it('requires non-empty problem, affected, currentWorkaround and expectedOutcome', () => {
    for (const field of ['problem', 'affected', 'currentWorkaround', 'expectedOutcome'] as const) {
      expect(ManualIntake.safeParse({ ...validIntake(), [field]: '' }).success, field).toBe(false);
    }
  });
});
