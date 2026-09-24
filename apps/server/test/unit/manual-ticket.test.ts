import { describe, expect, it } from 'vitest';
import { CreateManualTicket, type ManualKeySequence } from '../../src/modules/ingest/manual-ticket.js';
import { projectTicket } from '../../src/modules/ingest/ticket-received.js';
import { FixedClock, MemoryEventStore, SequentialIds } from '../helpers/memory.js';

class SequentialManualKeys implements ManualKeySequence {
  private n = 0;
  async next(): Promise<string> {
    this.n += 1;
    return `M-${String(this.n).padStart(4, '0')}`;
  }
}

function harness() {
  const store = new MemoryEventStore();
  const triaged: string[] = [];
  const useCase = new CreateManualTicket({
    eventStore: store,
    keys: new SequentialManualKeys(),
    triage: { enqueueTriage: async (id) => void triaged.push(id) },
    ids: new SequentialIds(),
    clock: new FixedClock('2026-09-24T09:00:00.000Z'),
  });
  return { store, triaged, useCase };
}

describe('CreateManualTicket', () => {
  it('creates a ticket_received event with a manual source and enqueues triage', async () => {
    const { store, triaged, useCase } = harness();
    const result = await useCase.execute({ title: 'Fix the coffee machine', description: 'It leaks.', priority: 'low', tags: ['facilities'] });
    expect(result.key).toBe('M-0001');

    const events = await store.load(result.ticketId);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: 'ticket_received',
      actor: { kind: 'system', id: 'manual-intake' },
      payload: { source: { kind: 'manual', key: 'M-0001' }, subject: 'Fix the coffee machine', description: 'It leaks.', priority: 'low', tags: ['facilities'] },
    });
    expect(triaged).toEqual([result.ticketId]);

    const { snapshot } = projectTicket(events);
    expect(snapshot).toMatchObject({ source: { kind: 'manual', key: 'M-0001' }, displayKey: 'M-0001', subject: 'Fix the coffee machine', state: 'received' });
  });

  it('assigns incrementing keys and defaults priority to normal, omitting empty tags', async () => {
    const { store, useCase } = harness();
    const first = await useCase.execute({ title: 'A', description: '' });
    const second = await useCase.execute({ title: 'B', description: '' });
    expect([first.key, second.key]).toEqual(['M-0001', 'M-0002']);

    const events = await store.load(first.ticketId);
    expect(events[0]?.payload).not.toHaveProperty('tags');
    expect((events[0]?.payload as { priority: string }).priority).toBe('normal');
  });

  it('uses a caller-supplied key instead of drawing a new one when presetKey is given', async () => {
    const { useCase } = harness();
    const result = await useCase.execute({ title: 'Preset', description: '' }, 'M-0042');
    expect(result.key).toBe('M-0042');
  });
});
