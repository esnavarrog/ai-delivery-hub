import { triageResultSchemaFor } from '@ai-delivery-hub/domain';
import { describe, expect, it } from 'vitest';
import { triageWireSchema } from '../../src/adapters/agent/structured-output.js';
import { MAX_TRIAGE_ATTEMPTS, parseTriageCandidate, triageCorrectiveMessage } from '../../src/adapters/agent/triage-parse.js';

const allowedRepos = ['backend-parkingapp', 'libredte-api'];
const wire = triageWireSchema(allowedRepos);
const domainSchema = triageResultSchemaFor(allowedRepos);

const validTriage = {
  category: 'bug',
  riskTier: 'high',
  targetRepo: 'backend-parkingapp',
  summary: 'Login breaks when the session cookie is missing.',
  duplicateCandidates: [],
  alreadyImplementedHint: null,
  riskSignals: ['auth'],
};

describe('parseTriageCandidate', () => {
  it('accepts a valid wire candidate and drops a null alreadyImplementedHint entirely', () => {
    const result = parseTriageCandidate(validTriage, wire, domainSchema);
    expect(result).toEqual({ ok: true, value: { ...validTriage, alreadyImplementedHint: undefined } });
    if (result.ok) expect(result.value).not.toHaveProperty('alreadyImplementedHint', null);
  });

  it('keeps a non-null alreadyImplementedHint', () => {
    const withHint = { ...validTriage, alreadyImplementedHint: { evidencePaths: ['app/x.rb'], explanation: 'already there' } };
    const result = parseTriageCandidate(withHint, wire, domainSchema);
    expect(result).toEqual({ ok: true, value: withHint });
  });

  it('fails wire validation with a readable message', () => {
    const result = parseTriageCandidate({ category: 'bug' }, wire, domainSchema);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message.length).toBeGreaterThan(0);
  });

  it('fails domain validation when targetRepo is outside the allowed list', () => {
    const result = parseTriageCandidate({ ...validTriage, targetRepo: 'nope' }, wire, domainSchema);
    expect(result).toMatchObject({ ok: false, message: expect.stringMatching(/targetRepo/) });
  });

  it('fails cleanly on a non-object candidate (e.g. missing structured output)', () => {
    const result = parseTriageCandidate(undefined, wire, domainSchema);
    expect(result.ok).toBe(false);
  });
});

describe('triageCorrectiveMessage', () => {
  it('embeds the validation error and asks for a corrected JSON object only', () => {
    const message = triageCorrectiveMessage('targetRepo must be one of: backend-parkingapp');
    expect(message).toContain('targetRepo must be one of: backend-parkingapp');
    expect(message).toMatch(/ONLY the corrected JSON object/i);
  });
});

describe('MAX_TRIAGE_ATTEMPTS', () => {
  it('is 2 (one retry after the first attempt)', () => {
    expect(MAX_TRIAGE_ATTEMPTS).toBe(2);
  });
});
