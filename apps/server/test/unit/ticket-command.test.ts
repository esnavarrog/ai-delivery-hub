import { OptimisticConcurrencyError, type TicketEvent } from '@ai-delivery-hub/domain';
import { describe, expect, it } from 'vitest';
import {
  TicketNotFoundError,
  TransitionDeniedError,
  appendCommand,
  loadTicket,
} from '../../src/modules/shared/ticket-command.js';
import { FixedClock, MemoryEventStore, SequentialIds, receivedEvent } from '../helpers/memory.js';

const dev = { kind: 'dev', id: 'ana' } as const;

function harness() {
  const store = new MemoryEventStore();
  const deps = { eventStore: store, ids: new SequentialIds(), clock: new FixedClock() };
  return { store, deps };
}

describe('loadTicket', () => {
  it('projects the stream and exposes the description', async () => {
    const { store } = harness();
    await store.append('t-1', 0, [receivedEvent('t-1', { subject: 'S', description: 'D' })]);
    const loaded = await loadTicket(store, 't-1');
    expect(loaded.snapshot).toMatchObject({ id: 't-1', state: 'received', subject: 'S' });
    expect(loaded.description).toBe('D');
    expect(loaded.events).toHaveLength(1);
  });

  it('throws TicketNotFoundError for an unknown ticket', async () => {
    const { store } = harness();
    await expect(loadTicket(store, 'nope')).rejects.toBeInstanceOf(TicketNotFoundError);
  });
});

describe('appendCommand', () => {
  it('appends guarded events with consecutive seqs and returns the new snapshot', async () => {
    const { store, deps } = harness();
    await store.append('t-1', 0, [receivedEvent('t-1')]);
    const result = await appendCommand(deps, 't-1', ({ guard, event }) => {
      guard({ kind: 'system', id: 'scheduler' }, 'triage_started');
      return [event('triage_started', { kind: 'system', id: 'scheduler' }), event('run_started', { kind: 'system', id: 'scheduler' }, { runId: 'r-1' })];
    });
    expect(result.snapshot.state).toBe('triaging');
    const events = await store.load('t-1');
    expect(events.map((e) => [e.seq, e.type])).toEqual([
      [1, 'ticket_received'],
      [2, 'triage_started'],
      [3, 'run_started'],
    ]);
    expect(events[2]?.runId).toBe('r-1');
    expect(result.appended).toHaveLength(2);
  });

  it('throws TransitionDeniedError with the guard reason and appends nothing', async () => {
    const { store, deps } = harness();
    await store.append('t-1', 0, [receivedEvent('t-1')]);
    const err = await appendCommand(deps, 't-1', ({ guard, event }) => {
      guard(dev, 'plan_approved');
      return [event('plan_approved', dev)];
    }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(TransitionDeniedError);
    expect((err as TransitionDeniedError).message).toMatch(/no transition from received/);
    expect(await store.load('t-1')).toHaveLength(1);
  });

  it('retries exactly once when the stream moved underneath the command', async () => {
    const { store, deps } = harness();
    await store.append('t-1', 0, [receivedEvent('t-1')]);
    let builds = 0;
    const original = store.append.bind(store);
    let raced = false;
    store.append = async (ticketId, expectedSeq, events) => {
      if (!raced) {
        raced = true;
        // someone else appended first
        await original(ticketId, expectedSeq, [
          { ...events[0]!, id: '11111111-1111-4111-8111-111111111111', type: 'flag_set', payload: { flag: 'needs_info' } } as TicketEvent,
        ]);
        throw new OptimisticConcurrencyError(ticketId, expectedSeq, expectedSeq + 1);
      }
      return original(ticketId, expectedSeq, events);
    };
    const result = await appendCommand(deps, 't-1', ({ event }) => {
      builds += 1;
      return [event('triage_started', { kind: 'system', id: 'scheduler' })];
    });
    expect(builds).toBe(2);
    expect(result.snapshot.state).toBe('triaging');
    expect(result.snapshot.flags).toEqual(['needs_info']);
    expect((await store.load('t-1')).map((e) => e.seq)).toEqual([1, 2, 3]);
  });

  it('gives up after the retry and surfaces the concurrency error', async () => {
    const { store, deps } = harness();
    await store.append('t-1', 0, [receivedEvent('t-1')]);
    store.append = async (ticketId, expectedSeq) => {
      throw new OptimisticConcurrencyError(ticketId, expectedSeq, expectedSeq + 1);
    };
    await expect(appendCommand(deps, 't-1', ({ event }) => [event('triage_started', { kind: 'system', id: 'scheduler' })])).rejects.toBeInstanceOf(
      OptimisticConcurrencyError,
    );
  });

  it('returns the current snapshot without appending when the builder yields no events', async () => {
    const { store, deps } = harness();
    await store.append('t-1', 0, [receivedEvent('t-1')]);
    const result = await appendCommand(deps, 't-1', () => []);
    expect(result.appended).toEqual([]);
    expect(await store.load('t-1')).toHaveLength(1);
  });
});
