import type { Actor } from '../src/ticket/actor.js';
import type { TicketEvent } from '../src/events/ticket-event.js';
import type { TicketSnapshot } from '../src/ticket/ticket.js';
import type { TicketState } from '../src/ticket/ticket-state.js';
import type { TriageResult } from '../src/triage/triage-result.js';
import type { Plan } from '../src/plan/plan.js';

export const SHA_A = 'a'.repeat(40);
export const SHA_B = 'b'.repeat(40);

export const systemActor: Actor = { kind: 'system', id: 'scheduler' };
export const aiActor: Actor = { kind: 'ai', id: 'planner' };
export const ownerDev: Actor = { kind: 'dev', id: 'dev-owner' };
export const otherDev: Actor = { kind: 'dev', id: 'dev-other' };
export const adminUser: Actor = { kind: 'dev', id: 'admin-1' };

export function validTriageResult(overrides: Partial<TriageResult> = {}): TriageResult {
  return {
    category: 'bug',
    riskTier: 'medium',
    targetRepo: 'backend',
    summary: 'Login fails when the session cookie is missing.',
    duplicateCandidates: [],
    riskSignals: ['auth'],
    ...overrides,
  };
}

export function baseSnapshot(overrides: Partial<TicketSnapshot> = {}): TicketSnapshot {
  return {
    id: 't-1',
    source: { kind: 'openproject', workPackageId: 1001, projectId: 7, lockVersion: 3 },
    displayKey: 'OP-1001',
    subject: 'Login fails without cookie',
    state: 'received',
    flags: [],
    priority: 'normal',
    planVersionCount: 0,
    unresolvedCommentCount: 0,
    createdAt: '2026-09-14T09:00:00.000Z',
    updatedAt: '2026-09-14T09:00:00.000Z',
    ...overrides,
  };
}

export function snapshotIn(state: TicketState, overrides: Partial<TicketSnapshot> = {}): TicketSnapshot {
  return baseSnapshot({ state, ...overrides });
}

let seqCounter = 0;
export function makeEvent(
  type: TicketEvent['type'],
  actor: Actor,
  payload: Record<string, unknown> = {},
  overrides: Partial<TicketEvent> = {},
): TicketEvent {
  seqCounter += 1;
  return {
    id: `00000000-0000-4000-8000-${String(seqCounter).padStart(12, '0')}`,
    ticketId: 't-1',
    seq: seqCounter,
    type,
    actor,
    artifacts: [],
    payload,
    createdAt: `2026-09-14T10:${String(seqCounter % 60).padStart(2, '0')}:00.000Z`,
    ...overrides,
  } as TicketEvent;
}

export function validPlan(overrides: Partial<Plan> = {}): Plan {
  return {
    goal: 'Fix login when session cookie is missing',
    scopeIn: ['auth middleware'],
    scopeOut: ['password reset'],
    filesTouched: [
      { path: 'src/auth/middleware.ts', action: 'modify', why: 'handle missing cookie' },
      { path: 'test/auth/middleware.test.ts', action: 'create', why: 'regression test' },
    ],
    steps: [
      { order: 1, title: 'Write failing test', detail: 'Cover the missing-cookie path', tests: ['middleware.test.ts'] },
      { order: 2, title: 'Fix middleware', detail: 'Return 401 instead of throwing', tests: [] },
    ],
    tests: ['pnpm test'],
    risks: [{ description: 'Session regressions', mitigation: 'Run auth suite', tier: 'medium' }],
    rollback: 'Revert the commit',
    acceptanceCriteria: [
      { id: 'AC-1', given: 'no cookie', when: 'GET /me', then: '401 returned' },
      { id: 'AC-2', given: 'valid cookie', when: 'GET /me', then: '200 returned' },
    ],
    baseCommitSha: SHA_A,
    openQuestions: [],
    ...overrides,
  };
}
