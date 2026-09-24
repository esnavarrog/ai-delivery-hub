import type { TicketEvent } from '@ai-delivery-hub/domain';
import { describe, expect, it } from 'vitest';
import { initialSnapshot } from '../../src/modules/ingest/ticket-received.js';

const base = {
  id: '10000000-0000-4000-8000-000000000001',
  ticketId: 't-1',
  seq: 1,
  type: 'ticket_received' as const,
  actor: { kind: 'system', id: 'ingest' },
  artifacts: [],
  createdAt: '2026-09-14T11:00:00.000Z',
};

/** Shape persisted before this slice: flat OP fields, no `source`/`displayKey`. */
function legacyEvent(): TicketEvent {
  return {
    ...base,
    payload: {
      opWorkPackageId: 4711,
      opProjectId: 15,
      opLockVersion: 3,
      subject: 'Login fails without cookie',
      description: 'Steps...',
      status: 'New',
      type: 'Bug',
      priority: 'normal',
      opUpdatedAt: '2026-09-14T09:00:00Z',
    },
  } as TicketEvent;
}

function currentEvent(): TicketEvent {
  return {
    ...base,
    payload: {
      source: { kind: 'openproject', workPackageId: 4711, projectId: 15, lockVersion: 3 },
      subject: 'Login fails without cookie',
      description: 'Steps...',
      status: 'New',
      type: 'Bug',
      priority: 'normal',
      opUpdatedAt: '2026-09-14T09:00:00Z',
    },
  } as TicketEvent;
}

describe('initialSnapshot: legacy ticket_received replay', () => {
  it('upcasts a pre-manual-source payload (flat opWorkPackageId/opProjectId/opLockVersion) into the same snapshot as the current source-shaped payload', () => {
    expect(initialSnapshot(legacyEvent())).toEqual(initialSnapshot(currentEvent()));
  });
});
