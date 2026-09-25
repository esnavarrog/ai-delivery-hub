import { describe, expect, it } from 'vitest';
import {
  AddCommentBody,
  ApproveBody,
  ConfirmTriageBody,
  ErrorResponse,
  FlagBody,
  MeResponse,
  PlanCommentDto,
  PlanVersionDto,
  RequestChangesBody,
  RunDto,
  TicketDetailResponse,
  TicketListQuery,
  TicketPlanResponse,
} from '../src/index.js';

const SHA = 'a'.repeat(40);
const ISO = '2026-09-14T12:00:00.000Z';

const ticket = {
  id: 't-1',
  source: { kind: 'openproject', workPackageId: 4711, projectId: 15, lockVersion: 3 },
  displayKey: 'OP-4711',
  subject: 'Login fails',
  state: 'plan_review',
  flags: [],
  priority: 'normal',
  planVersionCount: 1,
  unresolvedCommentCount: 0,
  createdAt: ISO,
  updatedAt: ISO,
};

const plan = {
  goal: 'Fix login',
  scopeIn: ['auth'],
  scopeOut: [],
  filesTouched: [{ path: 'a.rb', action: 'modify', why: 'fix' }],
  steps: [{ order: 1, title: 'Write test', detail: 'cover it', tests: ['spec'] }],
  tests: ['rspec'],
  risks: [],
  rollback: 'revert',
  acceptanceCriteria: [{ id: 'AC-1', given: 'x', when: 'y', then: 'z' }],
  baseCommitSha: SHA,
  openQuestions: [],
};

describe('response contracts', () => {
  it('round-trips MeResponse and ErrorResponse', () => {
    expect(MeResponse.parse({ login: 'ana', role: 'dev' })).toEqual({ login: 'ana', role: 'dev' });
    expect(MeResponse.safeParse({ login: 'ana', role: 'boss' }).success).toBe(false);
    const err = { error: { code: 'conflict', message: 'plan has unresolved comments' } };
    expect(ErrorResponse.parse(err)).toEqual(err);
    expect(ErrorResponse.safeParse({ error: 'nope' }).success).toBe(false);
  });

  it('round-trips a RunDto with nullable cost and end time', () => {
    const run = {
      id: '00000000-0000-4000-8000-000000000001',
      ticketId: 't-1',
      kind: 'triage',
      status: 'succeeded',
      model: 'claude-opus-5',
      inputTokens: 100,
      outputTokens: 20,
      costUsd: null,
      budgetTokens: 40_000,
      startedAt: ISO,
      endedAt: ISO,
      failureReason: null,
      errorMessage: null,
    };
    expect(RunDto.parse(run)).toEqual(run);
    expect(RunDto.safeParse({ ...run, kind: 'deploy' }).success).toBe(false);
    expect(RunDto.parse({ ...run, status: 'running', endedAt: null }).endedAt).toBeNull();
  });

  it('round-trips plan versions, comments and the ticket detail envelope', () => {
    const version = { id: 'v-1', ticketId: 't-1', version: 1, plan, renderedMarkdown: '# Plan', baseCommitSha: SHA, status: 'review', createdAt: ISO };
    expect(PlanVersionDto.parse(version)).toEqual(version);
    const comment = { id: 'c-1', planVersionId: 'v-1', sectionPath: 'steps[0]', authorId: 'ana', body: 'why?', resolvedByVersion: null, createdAt: ISO };
    expect(PlanCommentDto.parse(comment)).toEqual(comment);
    expect(PlanCommentDto.safeParse({ ...comment, sectionPath: 'nope' }).success).toBe(false);
    expect(TicketPlanResponse.parse({ versions: [version], comments: [comment] }).versions).toHaveLength(1);

    const detail = {
      ticket,
      events: [],
      latestPlan: { id: 'v-1', version: 1, goal: 'Fix login', baseCommitSha: SHA, createdAt: ISO },
      unresolvedCommentCount: 0,
      latestRun: null,
    };
    expect(TicketDetailResponse.parse(detail)).toEqual(detail);
  });
});

describe('request contracts', () => {
  it('validates list filters and command bodies', () => {
    expect(TicketListQuery.parse({ state: 'planning', waitingOn: 'me' })).toEqual({ state: 'planning', waitingOn: 'me' });
    expect(TicketListQuery.safeParse({ waitingOn: 'you' }).success).toBe(false);
    expect(ConfirmTriageBody.parse({ riskTier: 'high' })).toEqual({ riskTier: 'high' });
    expect(ConfirmTriageBody.safeParse({ riskTier: 'extreme' }).success).toBe(false);
    expect(RequestChangesBody.parse({})).toEqual({});
    expect(ApproveBody.parse({ secondApproverId: 'lead-1' })).toEqual({ secondApproverId: 'lead-1' });
    expect(FlagBody.parse({ flag: 'paused', set: true })).toEqual({ flag: 'paused', set: true });
    expect(FlagBody.safeParse({ flag: 'urgent', set: true }).success).toBe(false);
    expect(AddCommentBody.parse({ sectionPath: 'goal', body: 'Too broad' })).toEqual({ sectionPath: 'goal', body: 'Too broad' });
    expect(AddCommentBody.safeParse({ sectionPath: 'goal', body: '' }).success).toBe(false);
  });
});
