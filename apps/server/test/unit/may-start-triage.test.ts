import type { TicketEvent } from '@ai-delivery-hub/domain';
import { describe, expect, it } from 'vitest';
import { mayStartTriageFromTriaging } from '../../src/modules/triage/run-triage.js';

const at = (iso: string, type: string, payload: Record<string, unknown> = {}) => ({ type, payload, createdAt: iso }) as unknown as TicketEvent;
const STALE_AFTER_MS = 6 * 60_000;
const now = new Date('2026-09-24T12:00:00.000Z');

describe('mayStartTriageFromTriaging', () => {
  it('skips while the latest run of the leg is in flight, even if an earlier run of the same leg was abandoned', () => {
    const events = [
      at('2026-09-24T11:00:00.000Z', 'triage_started'),
      at('2026-09-24T11:00:00.000Z', 'run_started', { kind: 'triage' }),
      at('2026-09-24T11:58:00.000Z', 'run_started', { kind: 'triage' }),
    ];
    expect(mayStartTriageFromTriaging(events, now, STALE_AFTER_MS)).toBe(false);
  });

  it('allows once the latest run of the leg is older than the stale window', () => {
    const events = [at('2026-09-24T11:00:00.000Z', 'triage_started'), at('2026-09-24T11:00:00.000Z', 'run_started', { kind: 'triage' })];
    expect(mayStartTriageFromTriaging(events, now, STALE_AFTER_MS)).toBe(true);
  });

  it('allows a leg with no run yet (answers just submitted)', () => {
    const events = [at('2026-09-24T11:00:00.000Z', 'run_started', { kind: 'triage' }), at('2026-09-24T11:59:00.000Z', 'requester_answers_submitted')];
    expect(mayStartTriageFromTriaging(events, now, STALE_AFTER_MS)).toBe(true);
  });
});
