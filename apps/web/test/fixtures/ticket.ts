import type { PlanCommentDto, PlanVersionDto, RunDto, TicketDetailResponse } from '@ai-delivery-hub/contracts';
import type { Plan, TicketEvent, TicketSnapshot } from '@ai-delivery-hub/domain';

export const SHA = 'a'.repeat(40);
export const NOW = '2026-09-14T12:00:00.000Z';

export function ticket(overrides: Partial<TicketSnapshot> = {}): TicketSnapshot {
  return {
    id: 't1',
    opWorkPackageId: 8378,
    opProjectId: 15,
    opLockVersion: 3,
    subject: 'Add refund endpoint',
    state: 'plan_review',
    flags: [],
    category: 'feature',
    riskTier: 'medium',
    targetRepo: 'backend-parkingapp',
    ownerUserId: 'esteban',
    priority: 'normal',
    planVersionCount: 1,
    unresolvedCommentCount: 0,
    lastPlanVersionAt: '2026-09-14T11:00:00.000Z',
    createdAt: '2026-09-14T10:00:00.000Z',
    updatedAt: '2026-09-14T11:00:00.000Z',
    ...overrides,
  };
}

let seq = 0;
export function event(overrides: Partial<TicketEvent> & { type: TicketEvent['type'] }): TicketEvent {
  seq += 1;
  const base = {
    id: `00000000-0000-4000-8000-${String(seq).padStart(12, '0')}`,
    ticketId: 't1',
    seq,
    actor: { kind: 'system' as const, id: 'scheduler' },
    artifacts: [],
    createdAt: NOW,
    payload: {},
  };
  return { ...base, ...overrides } as TicketEvent;
}

export function run(overrides: Partial<RunDto> = {}): RunDto {
  return {
    id: 'r1',
    ticketId: 't1',
    kind: 'planning',
    status: 'running',
    model: 'claude-opus-5',
    inputTokens: 1200,
    outputTokens: 300,
    costUsd: 0.42,
    budgetTokens: 150000,
    startedAt: '2026-09-14T11:58:00.000Z',
    endedAt: null,
    failureReason: null,
    errorMessage: null,
    ...overrides,
  };
}

export function plan(overrides: Partial<Plan> = {}): Plan {
  return {
    goal: 'Expose a refund endpoint',
    scopeIn: ['POST /refunds'],
    scopeOut: ['Partial refunds'],
    filesTouched: [{ path: 'app/controllers/refunds_controller.rb', action: 'create', why: 'new endpoint' }],
    steps: [{ order: 1, title: 'Add controller', detail: 'Create the controller', tests: ['refunds_controller_spec.rb'] }],
    tests: ['bundle exec rspec spec/requests/refunds_spec.rb'],
    risks: [{ description: 'Double refund', mitigation: 'Idempotency key', tier: 'high' }],
    rollback: 'Revert the merge commit',
    acceptanceCriteria: [{ id: 'AC1', given: 'a paid order', when: 'refund is requested', then: 'money returns' }],
    baseCommitSha: SHA,
    openQuestions: ['Who owns refunds ops?'],
    ...overrides,
  };
}

export function planVersion(overrides: Partial<PlanVersionDto> = {}): PlanVersionDto {
  return {
    id: 'pv1',
    ticketId: 't1',
    version: 1,
    plan: plan(),
    renderedMarkdown: '# Plan',
    baseCommitSha: SHA,
    status: 'review',
    createdAt: '2026-09-14T11:00:00.000Z',
    ...overrides,
  };
}

export function comment(overrides: Partial<PlanCommentDto> = {}): PlanCommentDto {
  return {
    id: 'c1',
    planVersionId: 'pv1',
    sectionPath: 'steps[0]',
    authorId: 'esteban',
    body: 'Please add a spec for the failure path',
    resolvedByVersion: null,
    createdAt: '2026-09-14T11:30:00.000Z',
    ...overrides,
  };
}

export function detail(overrides: Partial<TicketDetailResponse> = {}): TicketDetailResponse {
  return {
    ticket: ticket(),
    events: [],
    latestPlan: { id: 'pv1', version: 1, goal: 'Expose a refund endpoint', baseCommitSha: SHA, createdAt: '2026-09-14T11:00:00.000Z' },
    unresolvedCommentCount: 0,
    latestRun: null,
    ...overrides,
  };
}
