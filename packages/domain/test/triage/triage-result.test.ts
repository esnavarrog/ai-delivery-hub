import { describe, expect, it } from 'vitest';
import { TriageResult, triageResultSchemaFor } from '../../src/triage/triage-result.js';
import { validAssessment, validTriageResult } from '../fixtures.js';

describe('TriageResult', () => {
  it('parses a valid fixture', () => {
    expect(TriageResult.safeParse(validTriageResult()).success).toBe(true);
  });

  it('rejects a summary longer than 600 chars', () => {
    const r = TriageResult.safeParse({ ...validTriageResult(), summary: 'x'.repeat(601) });
    expect(r.success).toBe(false);
  });

  it('accepts a summary of exactly 600 chars', () => {
    expect(TriageResult.safeParse({ ...validTriageResult(), summary: 'x'.repeat(600) }).success).toBe(
      true,
    );
  });

  it('rejects similarity outside 0..1', () => {
    const r = TriageResult.safeParse({
      ...validTriageResult(),
      duplicateCandidates: [{ ticketId: 't-2', displayKey: 'OP-42', similarity: 1.2, reason: 'same' }],
    });
    expect(r.success).toBe(false);
  });

  it('rejects unknown category / riskTier', () => {
    expect(TriageResult.safeParse({ ...validTriageResult(), category: 'epic' }).success).toBe(false);
    expect(TriageResult.safeParse({ ...validTriageResult(), riskTier: 'critical' }).success).toBe(
      false,
    );
  });

  it('alreadyImplementedHint is optional but validated when present', () => {
    const withHint = TriageResult.safeParse({
      ...validTriageResult(),
      alreadyImplementedHint: { evidencePaths: ['src/a.ts'], explanation: 'exists' },
    });
    expect(withHint.success).toBe(true);
    const badHint = TriageResult.safeParse({
      ...validTriageResult(),
      alreadyImplementedHint: { evidencePaths: 'src/a.ts', explanation: 'exists' },
    });
    expect(badHint.success).toBe(false);
  });
});

describe('TriageResult.assessment (optional, backward compatible)', () => {
  it('parses without an assessment (old triage results keep working)', () => {
    expect(TriageResult.safeParse(validTriageResult()).success).toBe(true);
  });

  it('parses a full three-lens assessment', () => {
    const r = TriageResult.safeParse({ ...validTriageResult(), assessment: validAssessment() });
    expect(r.success).toBe(true);
  });

  it('rejects an out-of-range functional clarity', () => {
    const bad = validAssessment({ functional: { clarity: 6, acceptanceCriteria: [], questions: [] } });
    expect(TriageResult.safeParse({ ...validTriageResult(), assessment: bad }).success).toBe(false);
  });

  it('rejects an unknown technical feasibility', () => {
    const bad = validAssessment();
    // @ts-expect-error testing invalid input
    bad.technical.feasibility = 'maybe';
    expect(TriageResult.safeParse({ ...validTriageResult(), assessment: bad }).success).toBe(false);
  });

  it('rejects a management confidence outside 0.5/0.8/1', () => {
    const bad = validAssessment();
    // @ts-expect-error testing invalid input
    bad.management.confidence = 0.9;
    expect(TriageResult.safeParse({ ...validTriageResult(), assessment: bad }).success).toBe(false);
  });

  it('rejects an unknown management recommendation', () => {
    const bad = validAssessment();
    // @ts-expect-error testing invalid input
    bad.management.recommendation = 'maybe_later';
    expect(TriageResult.safeParse({ ...validTriageResult(), assessment: bad }).success).toBe(false);
  });

  it('rejects value/reach outside 1..5', () => {
    const bad = validAssessment({ management: { ...validAssessment().management, value: 0 } });
    expect(TriageResult.safeParse({ ...validTriageResult(), assessment: bad }).success).toBe(false);
  });
});

describe('triageResultSchemaFor(repos)', () => {
  const schema = triageResultSchemaFor(['backend', 'web']);

  it('accepts a targetRepo in the allowlist', () => {
    expect(schema.safeParse({ ...validTriageResult(), targetRepo: 'web' }).success).toBe(true);
  });

  it('rejects a targetRepo outside the allowlist', () => {
    const r = schema.safeParse({ ...validTriageResult(), targetRepo: 'mobile' });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.issues.some((i) => i.path.join('.') === 'targetRepo')).toBe(true);
    }
  });

  it('is case-sensitive about repo names', () => {
    expect(schema.safeParse({ ...validTriageResult(), targetRepo: 'Web' }).success).toBe(false);
  });
});
