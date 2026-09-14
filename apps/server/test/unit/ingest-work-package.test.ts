import type { WorkPackage } from '@ai-delivery-hub/domain';
import { beforeEach, describe, expect, it } from 'vitest';
import { IngestWorkPackage } from '../../src/modules/ingest/ingest-work-package.js';
import { projectTicket } from '../../src/modules/ingest/ticket-received.js';
import { FixedClock, MemoryEventStore, MemoryTicketIndex, SequentialIds } from '../helpers/memory.js';

const trigger = { kind: 'status_or_prefix', statusName: 'Ready for AI', subjectPrefix: '[AI]' } as const;

function wp(overrides: Partial<WorkPackage> = {}): WorkPackage {
  return {
    id: 4711,
    subject: '[AI] Login fails without cookie',
    description: { raw: 'Steps...' },
    status: 'New',
    type: 'Bug',
    priority: 'High',
    project: { id: 15, name: 'ParkingApp' },
    assignee: { id: 4, name: 'Ana Dev' },
    lockVersion: 3,
    updatedAt: '2026-09-14T09:00:00Z',
    ...overrides,
  };
}

describe('IngestWorkPackage', () => {
  let store: MemoryEventStore;
  let triaged: string[];
  let ingest: IngestWorkPackage;

  beforeEach(() => {
    store = new MemoryEventStore();
    triaged = [];
    ingest = new IngestWorkPackage({
      eventStore: store,
      ticketIndex: new MemoryTicketIndex(store),
      triage: { enqueueTriage: async (id) => void triaged.push(id) },
      ids: new SequentialIds(),
      clock: new FixedClock(),
      trigger,
    });
  });

  it('creates a ticket with exactly one ticket_received event and enqueues triage', async () => {
    const outcome = await ingest.execute(wp());
    expect(outcome.kind).toBe('created');
    const events = store.all();
    expect(events).toHaveLength(1);
    const [event] = events;
    expect(event?.type).toBe('ticket_received');
    expect(event?.seq).toBe(1);
    expect(event?.actor).toEqual({ kind: 'system', id: 'ingest' });
    expect(event?.payload).toEqual({
      opWorkPackageId: 4711,
      opProjectId: 15,
      opLockVersion: 3,
      subject: '[AI] Login fails without cookie',
      description: 'Steps...',
      status: 'New',
      type: 'Bug',
      assignee: { id: 4, name: 'Ana Dev' },
      priority: 'high',
      opUpdatedAt: '2026-09-14T09:00:00Z',
    });
    expect(triaged).toEqual([event?.ticketId]);
  });

  it('ignores work packages that do not match the trigger', async () => {
    const outcome = await ingest.execute(wp({ subject: 'plain' }));
    expect(outcome).toEqual({ kind: 'ignored', reason: 'trigger_not_matched' });
    expect(store.all()).toHaveLength(0);
    expect(triaged).toEqual([]);
  });

  it('appends nothing when the same lockVersion is seen again', async () => {
    await ingest.execute(wp());
    const outcome = await ingest.execute(wp());
    expect(outcome.kind).toBe('unchanged');
    expect(store.all()).toHaveLength(1);
    expect(triaged).toHaveLength(1);
  });

  it('records ticket_updated_from_op when the description changed, even if the trigger no longer matches', async () => {
    await ingest.execute(wp());
    const outcome = await ingest.execute(wp({ lockVersion: 4, description: { raw: 'More steps' }, status: 'In specification', subject: 'Login fails without cookie' }));
    expect(outcome.kind).toBe('updated');
    const events = store.all();
    expect(events).toHaveLength(2);
    expect(events[1]?.type).toBe('ticket_updated_from_op');
    expect(events[1]?.payload).toEqual({
      opLockVersion: 4,
      changedFields: ['subject', 'description'],
      subject: 'Login fails without cookie',
      description: 'More steps',
    });
    const { snapshot, description } = projectTicket(events);
    expect(snapshot.subject).toBe('Login fails without cookie');
    expect(snapshot.opLockVersion).toBe(4);
    expect(snapshot.state).toBe('received');
    expect(description).toBe('More steps');
  });

  it('appends nothing when only the lockVersion moved', async () => {
    await ingest.execute(wp());
    const outcome = await ingest.execute(wp({ lockVersion: 9 }));
    expect(outcome.kind).toBe('unchanged');
    expect(store.all()).toHaveLength(1);
  });
});

describe('projectTicket', () => {
  it('builds the initial snapshot from ticket_received', async () => {
    const store = new MemoryEventStore();
    const ingest = new IngestWorkPackage({
      eventStore: store,
      ticketIndex: new MemoryTicketIndex(store),
      triage: { enqueueTriage: async () => {} },
      ids: new SequentialIds(),
      clock: new FixedClock('2026-09-14T12:00:00.000Z'),
      trigger,
    });
    await ingest.execute(wp());
    const { snapshot } = projectTicket(store.all());
    expect(snapshot).toMatchObject({
      opWorkPackageId: 4711,
      opProjectId: 15,
      opLockVersion: 3,
      subject: '[AI] Login fails without cookie',
      state: 'received',
      flags: [],
      priority: 'high',
      planVersionCount: 0,
      unresolvedCommentCount: 0,
      createdAt: '2026-09-14T12:00:00.000Z',
      updatedAt: '2026-09-14T12:00:00.000Z',
    });
  });

  it('throws when the stream does not start with ticket_received', () => {
    expect(() => projectTicket([])).toThrow(/ticket_received/);
  });
});
