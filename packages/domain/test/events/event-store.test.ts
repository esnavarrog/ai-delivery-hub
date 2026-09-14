import { describe, expect, it } from 'vitest';
import { OptimisticConcurrencyError, type EventStore } from '../../src/events/event-store.js';
import type { TicketEvent } from '../../src/events/ticket-event.js';
import { makeEvent, systemActor } from '../fixtures.js';

/** Minimal in-memory implementation used only to exercise the port contract. */
class MemoryEventStore implements EventStore {
  private readonly streams = new Map<string, TicketEvent[]>();

  async append(ticketId: string, expectedSeq: number, events: readonly TicketEvent[]): Promise<void> {
    const current = this.streams.get(ticketId) ?? [];
    if (current.length !== expectedSeq) {
      throw new OptimisticConcurrencyError(ticketId, expectedSeq, current.length);
    }
    this.streams.set(ticketId, [...current, ...events]);
  }

  async load(ticketId: string): Promise<TicketEvent[]> {
    return [...(this.streams.get(ticketId) ?? [])];
  }
}

describe('EventStore port', () => {
  it('appends at the expected seq and loads back', async () => {
    const store = new MemoryEventStore();
    await store.append('t-1', 0, [makeEvent('ticket_received', systemActor)]);
    expect(await store.load('t-1')).toHaveLength(1);
  });

  it('raises OptimisticConcurrencyError on a stale expectedSeq', async () => {
    const store = new MemoryEventStore();
    await store.append('t-1', 0, [makeEvent('ticket_received', systemActor)]);
    await expect(store.append('t-1', 0, [makeEvent('triage_started', systemActor)])).rejects.toBeInstanceOf(
      OptimisticConcurrencyError,
    );
  });
});

describe('OptimisticConcurrencyError', () => {
  it('carries ticketId, expected and actual seq', () => {
    const err = new OptimisticConcurrencyError('t-1', 3, 5);
    expect(err.name).toBe('OptimisticConcurrencyError');
    expect(err.ticketId).toBe('t-1');
    expect(err.expectedSeq).toBe(3);
    expect(err.actualSeq).toBe(5);
    expect(err.message).toContain('t-1');
    expect(err).toBeInstanceOf(Error);
  });
});
