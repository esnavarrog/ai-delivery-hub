import { Role, TicketState, TRANSITIONS, type TicketState as State } from '@ai-delivery-hub/domain';
import { describe, expect, it } from 'vitest';
import { resolveActions, type ActionId } from '@/lib/action-resolver';
import { run, ticket } from '../fixtures/ticket';

const ME = 'esteban';
const OTHER = 'someone-else';

function resolve(state: State, role: Role, extra: Parameters<typeof ticket>[0] = {}, opts: { login?: string; latestRun?: ReturnType<typeof run> | null } = {}) {
  return resolveActions({
    ticket: ticket({ state, ...extra }),
    role,
    login: opts.login ?? ME,
    latestRun: opts.latestRun ?? null,
    now: new Date('2026-09-14T12:00:00.000Z'),
  });
}

const ids = (r: ReturnType<typeof resolve>): ActionId[] =>
  [r.primary?.id, r.secondary?.id, ...r.more.map((a) => a.id), ...r.tertiary.map((a) => a.id)].filter((x): x is ActionId => x !== undefined);

describe('resolveActions', () => {
  it('never offers a primary action to requester or qa in any state', () => {
    for (const state of TicketState.options) {
      for (const role of ['requester', 'qa'] as const) {
        const r = resolve(state, role);
        expect(r.primary, `${state}/${role}`).toBeUndefined();
        expect(r.info.kind, `${state}/${role}`).toBe(state === 'rejected' || state === 'duplicate' || state === 'already_implemented' || state === 'done' ? 'closed' : 'read_only');
      }
    }
  });

  it('offers add_comment to requester only when a plan version exists', () => {
    expect(ids(resolve('plan_review', 'requester', { planVersionCount: 1 }))).toContain('add_comment');
    expect(ids(resolve('planning', 'requester', { planVersionCount: 0 }))).not.toContain('add_comment');
  });

  it('offers nothing on terminal states for every role', () => {
    for (const state of ['rejected', 'duplicate', 'already_implemented', 'done'] as const) {
      for (const role of Role.options) {
        const r = resolve(state, role);
        expect(ids(r), `${state}/${role}`).toEqual([]);
        expect(r.info.kind).toBe('closed');
      }
    }
  });

  it('received: retry triage only after a failed run, for dev/lead/admin', () => {
    const failed = run({ kind: 'triage', status: 'failed', failureReason: 'provider_error', errorMessage: 'boom' });
    for (const role of ['dev', 'lead', 'admin'] as const) {
      const r = resolve('received', role, {}, { latestRun: failed });
      expect(r.primary?.id).toBe('retriage');
      expect(r.info.kind).toBe('failed');
      expect(r.info.message).toContain('boom');
    }
    const waiting = resolve('received', 'dev');
    expect(waiting.primary).toBeUndefined();
    expect(waiting.info.kind).toBe('waiting');
  });

  it.each(['triaging', 'planning'] as const)('%s: AI working with Stop as primary; Resume when paused', (state) => {
    const r = resolve(state, 'dev', {}, { latestRun: run({ kind: state === 'triaging' ? 'triage' : 'planning' }) });
    expect(r.primary?.id).toBe('stop');
    expect(r.info.kind).toBe('ai_working');
    expect(r.info.message).toMatch(/La IA está trabajando/);
    expect(r.info.message).toMatch(/2m/);
    expect(r.tertiary.map((a) => a.id)).not.toContain('pause');

    const paused = resolve(state, 'dev', { flags: ['paused'] });
    expect(paused.primary?.id).toBe('resume');
    expect(paused.info.kind).toBe('paused');
  });

  it('triaged: lead/admin (and the owner) confirm triage; reject is secondary; duplicate and already implemented under more', () => {
    for (const role of ['lead', 'admin'] as const) {
      const r = resolve('triaged', role, { ownerUserId: undefined });
      expect(r.primary?.id).toBe('confirm_triage');
      expect(r.secondary?.id).toBe('reject');
      expect(r.more.map((a) => a.id)).toEqual(['duplicate', 'already_implemented']);
      expect(r.info.kind).toBe('triage_suggestion');
    }
    const ownerDev = resolve('triaged', 'dev', { ownerUserId: ME });
    expect(ownerDev.primary?.id).toBe('confirm_triage');
    const otherDev = resolve('triaged', 'dev', { ownerUserId: undefined });
    expect(otherDev.primary).toBeUndefined();
    expect(otherDev.info.kind).toBe('waiting');
  });

  it('awaiting_owner: any dev/lead/admin can claim, nothing else', () => {
    for (const role of ['dev', 'lead', 'admin'] as const) {
      const r = resolve('awaiting_owner', role, { ownerUserId: undefined });
      expect(r.primary?.id).toBe('claim');
      expect(r.secondary).toBeUndefined();
      expect(r.more).toEqual([]);
    }
  });

  it('plan_review: owner approves; approve disabled while unresolved comments > 0', () => {
    const ok = resolve('plan_review', 'dev', { ownerUserId: ME, unresolvedCommentCount: 0 });
    expect(ok.primary?.id).toBe('approve');
    expect(ok.primary?.disabledReason).toBeUndefined();
    expect(ok.secondary?.id).toBe('request_changes');
    expect(ok.more.map((a) => a.id)).toEqual(['reject', 'duplicate', 'already_implemented']);

    const blocked = resolve('plan_review', 'dev', { ownerUserId: ME, unresolvedCommentCount: 2 });
    expect(blocked.primary?.id).toBe('approve');
    expect(blocked.primary?.disabledReason).toMatch(/2 comentarios sin resolver/);
  });

  it('plan_review: high risk requires a second approver; non-owner dev only watches', () => {
    const high = resolve('plan_review', 'lead', { ownerUserId: OTHER, riskTier: 'high' });
    expect(high.primary?.id).toBe('approve');
    expect(high.requiresSecondApprover).toBe(true);
    expect(resolve('plan_review', 'dev', { ownerUserId: ME, riskTier: 'medium' }).requiresSecondApprover).toBe(false);

    const watcher = resolve('plan_review', 'dev', { ownerUserId: OTHER });
    expect(watcher.primary).toBeUndefined();
    expect(watcher.info.kind).toBe('waiting');
    expect(watcher.info.message).toContain(OTHER);
  });

  it('plan_changes_requested: re-plan primary, reject secondary; replan blocked after 3 versions without a new comment', () => {
    const r = resolve('plan_changes_requested', 'dev', { ownerUserId: ME, planVersionCount: 1 });
    expect(r.primary?.id).toBe('replan');
    expect(r.primary?.disabledReason).toBeUndefined();
    expect(r.secondary?.id).toBe('reject');

    const capped = resolve('plan_changes_requested', 'admin', { planVersionCount: 3, lastPlanVersionAt: '2026-09-14T11:00:00.000Z', lastHumanCommentAt: '2026-09-14T10:00:00.000Z' });
    expect(capped.primary?.disabledReason).toMatch(/3 versiones del plan/);
    const fed = resolve('plan_changes_requested', 'admin', { planVersionCount: 3, lastPlanVersionAt: '2026-09-14T11:00:00.000Z', lastHumanCommentAt: '2026-09-14T11:30:00.000Z' });
    expect(fed.primary?.disabledReason).toBeUndefined();

    const failed = resolve('plan_changes_requested', 'dev', { ownerUserId: ME }, { latestRun: run({ status: 'budget_exhausted', failureReason: 'budget_exhausted', errorMessage: null }) });
    expect(failed.info.kind).toBe('failed');
    expect(failed.info.message).toMatch(/presupuesto/i);
  });

  it('plan_approved: what happens next card with Reopen as the only action', () => {
    const r = resolve('plan_approved', 'lead', { ownerUserId: OTHER });
    expect(r.primary).toBeUndefined();
    expect(r.secondary?.id).toBe('reopen');
    expect(r.info.kind).toBe('approved');
    expect(resolve('plan_approved', 'dev', { ownerUserId: OTHER }).secondary).toBeUndefined();
  });

  it('phase 2+ states are informational for every role', () => {
    for (const state of ['implementing', 'dev_review', 'sandbox_qa', 'qa_changes_requested', 'staging_qa'] as const) {
      for (const role of ['dev', 'lead', 'admin'] as const) {
        const r = resolve(state, role);
        expect(r.primary, `${state}/${role}`).toBeUndefined();
        expect(r.info.kind).toBe('later_phase');
      }
    }
  });

  it('pause/resume is a tertiary action for dev/lead/admin on every non-terminal, non-running state', () => {
    const states = TicketState.options.filter((s) => !['rejected', 'duplicate', 'already_implemented', 'done', 'triaging', 'planning'].includes(s));
    for (const state of states) {
      for (const role of ['dev', 'lead', 'admin'] as const) {
        expect(resolve(state, role).tertiary.map((a) => a.id), `${state}/${role}`).toContain('pause');
        expect(resolve(state, role, { flags: ['paused'] }).tertiary.map((a) => a.id), `${state}/${role} paused`).toContain('resume');
      }
      expect(resolve(state, 'requester').tertiary.map((a) => a.id)).not.toContain('pause');
    }
  });

  it('every human-triggered phase 1 edge in the transitions table has an action in some state x role', () => {
    const humanEdges = TRANSITIONS.filter((t) => t.phase === 1 && t.allowedActors.includes('dev'));
    const eventToAction: Record<string, ActionId> = {
      ticket_claimed: 'claim',
      plan_changes_requested: 'request_changes',
      replan_requested: 'replan',
      plan_approved: 'approve',
      plan_reopened: 'reopen',
      ticket_rejected: 'reject',
      ticket_marked_duplicate: 'duplicate',
      ticket_marked_already_implemented: 'already_implemented',
    };
    for (const edge of humanEdges) {
      const action = eventToAction[edge.event];
      expect(action, edge.event).toBeDefined();
      const offered = ids(resolve(edge.from, 'admin', { ownerUserId: undefined }));
      expect(offered, `${edge.from} -> ${edge.event}`).toContain(action);
    }
  });

  it('every action carries an accessible label', () => {
    for (const state of TicketState.options) {
      for (const role of Role.options) {
        const r = resolve(state, role, {}, { latestRun: run({ status: 'failed', failureReason: 'provider_error' }) });
        for (const a of [r.primary, r.secondary, ...r.more, ...r.tertiary]) {
          if (a) expect(a.label.length).toBeGreaterThan(1);
        }
      }
    }
  });
});
