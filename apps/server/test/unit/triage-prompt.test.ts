import { UNTRUSTED_OPEN_PREFIX, wrapUntrusted, type TicketSnapshot } from '@ai-delivery-hub/domain';
import { describe, expect, it } from 'vitest';
import {
  buildTriageSystemPrompt,
  buildTriageUserPrompt,
  TRIAGE_ROLE_INSTRUCTIONS,
  type ClarificationRound,
  type TriagePolicies,
  type TriageRunnerInput,
} from '../../src/adapters/agent/triage-prompt.js';

const policies: TriagePolicies = {
  docs: { pillars: '# Pillars', conventions: '# Conventions', security: '# Security', steps: { triage: '# Step: Triage' } },
  repos: { 'backend-parkingapp': { stack: 'rails', defaultBranch: 'develop' } },
  output: { language: 'es' },
};

const ticket: TicketSnapshot = {
  id: 't-1',
  source: { kind: 'manual', key: 'M-0001' },
  displayKey: 'M-0001',
  subject: 'Speed up reconciliation',
  state: 'triaging',
  flags: [],
  priority: 'normal',
  planVersionCount: 0,
  unresolvedCommentCount: 0,
  createdAt: '2026-09-24T09:00:00.000Z',
  updatedAt: '2026-09-24T09:00:00.000Z',
};

function input(overrides: Partial<TriageRunnerInput> = {}): TriageRunnerInput {
  return {
    runId: 'run-1',
    ticket,
    untrustedContext: wrapUntrusted('ticket', 'Subject: Speed up reconciliation'),
    budget: { maxTokens: 40_000, maxDurationMs: 60_000 },
    allowedRepos: ['backend-parkingapp'],
    ...overrides,
  };
}

describe('TRIAGE_ROLE_INSTRUCTIONS: three-lens assessment', () => {
  it('spells out the functional, technical and management rubrics with recommendation rules', () => {
    expect(TRIAGE_ROLE_INSTRUCTIONS).toMatch(/functional analyst/i);
    expect(TRIAGE_ROLE_INSTRUCTIONS).toMatch(/senior developer/i);
    expect(TRIAGE_ROLE_INSTRUCTIONS).toMatch(/development manager/i);
    expect(TRIAGE_ROLE_INSTRUCTIONS).toMatch(/clarity/);
    expect(TRIAGE_ROLE_INSTRUCTIONS).toMatch(/at most 5/i);
    expect(TRIAGE_ROLE_INSTRUCTIONS).toMatch(/non-technical business user/);
    expect(TRIAGE_ROLE_INSTRUCTIONS).toMatch(/needs_info.*clarity.*2/is);
    expect(TRIAGE_ROLE_INSTRUCTIONS).toMatch(/confidence.*0\.8.*0\.5/is);
    expect(TRIAGE_ROLE_INSTRUCTIONS).toMatch(/"S".*"M".*"L".*"XL"/is);
    expect(TRIAGE_ROLE_INSTRUCTIONS).toMatch(/structured intake/i);
  });
});

describe('buildTriageSystemPrompt', () => {
  it('includes the three-lens instructions alongside the step policy and company docs', () => {
    const system = buildTriageSystemPrompt(policies, ['backend-parkingapp']);
    expect(system).toMatch(/functional analyst/i);
    expect(system).toContain('# Step: Triage');
    expect(system).toContain('# Pillars');
  });
});

describe('buildTriageUserPrompt: clarification history', () => {
  it('omits the clarification_history block and refine instruction on a first triage (no history)', () => {
    const prompt = buildTriageUserPrompt(input());
    expect(prompt).not.toContain('clarification_history');
    expect(prompt).not.toMatch(/re-triage/i);
  });

  it('renders prior rounds as untrusted data and instructs the model to refine, not restart', () => {
    const history: ClarificationRound[] = [
      {
        round: 1,
        questions: [
          { id: 'q1-1', text: 'Which team is affected?' },
          { id: 'q1-2', text: 'How often does this happen?' },
        ],
        answers: [{ questionId: 'q1-1', text: 'Finance' }],
      },
    ];
    const prompt = buildTriageUserPrompt(input({ clarificationHistory: history }));
    const blockStart = prompt.indexOf(`${UNTRUSTED_OPEN_PREFIX}clarification_history`);
    expect(blockStart).toBeGreaterThan(-1);
    const block = prompt.slice(blockStart);
    expect(block).toContain('Which team is affected?');
    expect(block).toContain('answer: Finance');
    // the second question was never answered
    expect(block).toContain('How often does this happen?');
    expect(block).toContain('(not answered)');
    expect(prompt).toMatch(/re-triage/i);
    expect(prompt).toMatch(/do not ask again/i);
  });

  it('is empty (no clarification_history block) when clarificationHistory is an empty array', () => {
    const prompt = buildTriageUserPrompt(input({ clarificationHistory: [] }));
    expect(prompt).not.toContain('clarification_history');
  });
});
