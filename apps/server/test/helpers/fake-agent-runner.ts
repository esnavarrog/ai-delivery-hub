import type { AgentRunnerPort, Plan, PlanningRunInput, RunResult, TriageAssessment, TriageResult, TriageRunInput } from '@ai-delivery-hub/domain';
import type { AcquiredWorktree, RepoWorktreePort } from '../../src/adapters/repo/git-worktree.js';

export const SHA_HEAD = 'f'.repeat(40);

export const okUsage = { inputTokens: 1200, outputTokens: 300, durationMs: 1500 };

export function triageResult(overrides: Partial<TriageResult> = {}): TriageResult {
  return {
    category: 'bug',
    riskTier: 'medium',
    targetRepo: 'backend-parkingapp',
    summary: 'Login breaks when the session cookie is missing.',
    duplicateCandidates: [],
    riskSignals: ['auth'],
    ...overrides,
  };
}

export function triageAssessment(overrides: Partial<TriageAssessment> = {}): TriageAssessment {
  return {
    functional: { clarity: 4, acceptanceCriteria: ['Given a valid session, login succeeds'], questions: [] },
    technical: { feasibility: 'feasible', risks: [], dependencies: [] },
    management: { value: 4, reach: 3, confidence: 0.8, effort: 'M', recommendation: 'approve', rationale: 'High value, moderate effort.' },
    ...overrides,
  };
}

export function plan(overrides: Partial<Plan> = {}): Plan {
  return {
    goal: 'Fix login when the session cookie is missing',
    scopeIn: ['auth middleware'],
    scopeOut: ['password reset'],
    filesTouched: [{ path: 'app/controllers/sessions_controller.rb', action: 'modify', why: 'return 401 instead of raising' }],
    steps: [{ order: 1, title: 'Write failing spec', detail: 'Cover the missing-cookie path', tests: ['spec/requests/sessions_spec.rb'] }],
    tests: ['bundle exec rspec'],
    risks: [{ description: 'Session regressions', mitigation: 'Run the auth suite', tier: 'medium' }],
    rollback: 'Revert the commit',
    acceptanceCriteria: [{ id: 'AC-1', given: 'no cookie', when: 'GET /me', then: '401 returned' }],
    baseCommitSha: SHA_HEAD,
    openQuestions: [],
    ...overrides,
  };
}

/** Scripted AgentRunnerPort: results are consumed in order; every input is recorded for assertions. */
export class FakeAgentRunner implements AgentRunnerPort {
  readonly triageInputs: TriageRunInput[] = [];
  readonly planningInputs: PlanningRunInput[] = [];
  private readonly triageQueue: RunResult<TriageResult>[] = [];
  private readonly planningQueue: RunResult<Plan>[] = [];

  scriptTriage(...results: RunResult<TriageResult>[]): this {
    this.triageQueue.push(...results);
    return this;
  }

  scriptPlanning(...results: RunResult<Plan>[]): this {
    this.planningQueue.push(...results);
    return this;
  }

  async runTriage(input: TriageRunInput): Promise<RunResult<TriageResult>> {
    this.triageInputs.push(input);
    const next = this.triageQueue.shift();
    if (!next) throw new Error('FakeAgentRunner: no scripted triage result left');
    return next;
  }

  async runPlanning(input: PlanningRunInput): Promise<RunResult<Plan>> {
    this.planningInputs.push(input);
    const next = this.planningQueue.shift();
    if (!next) throw new Error('FakeAgentRunner: no scripted planning result left');
    return next;
  }
}

export class FakeWorktrees implements RepoWorktreePort {
  readonly acquired: string[] = [];
  readonly released: string[] = [];
  failWith: Error | undefined;

  constructor(private readonly headSha: string = SHA_HEAD) {}

  async acquireReadOnly(repo: string): Promise<AcquiredWorktree> {
    if (this.failWith) throw this.failWith;
    this.acquired.push(repo);
    const path = `/tmp/fake-worktrees/${repo}-${this.acquired.length}`;
    return {
      path,
      headSha: this.headSha,
      release: async () => {
        this.released.push(path);
      },
    };
  }
}
