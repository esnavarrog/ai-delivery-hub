import { replay, ticketDisplayKey, TicketPriority, TicketSource, TicketUpdatedFromOpPayload, type TicketEvent, type TicketSnapshot } from '@ai-delivery-hub/domain';
import { z } from 'zod';

/**
 * Payload of `ticket_received`: the facts the hub needs to build the first snapshot, for either an
 * OpenProject work package or a manually authored ticket (see `TicketSource`). OP-only fields
 * (`status`, `type`, `assignee`, `opUpdatedAt`) are absent on a manual ticket.
 */
export const TicketReceivedPayload = z.object({
  source: TicketSource,
  subject: z.string().min(1),
  description: z.string(),
  status: z.string().optional(),
  type: z.string().optional(),
  assignee: z.object({ id: z.number().int().positive(), name: z.string() }).optional(),
  priority: TicketPriority,
  opUpdatedAt: z.string().optional(),
  /** Manual tickets only: free-form tags carried over from the Obsidian note frontmatter. */
  tags: z.array(z.string().min(1)).optional(),
});
export type TicketReceivedPayload = z.infer<typeof TicketReceivedPayload>;

/**
 * Upcasts an already-persisted `ticket_received` payload from before manual tickets existed (flat
 * `opWorkPackageId`/`opProjectId`/`opLockVersion`, no `source`) into the current shape, so old
 * events keep replaying. New events are always written in the current shape; this only reads.
 */
function upcastLegacyReceivedPayload(payload: unknown): unknown {
  if (!payload || typeof payload !== 'object' || 'source' in payload || !('opWorkPackageId' in payload)) return payload;
  const { opWorkPackageId, opProjectId, opLockVersion, ...rest } = payload as {
    opWorkPackageId: number;
    opProjectId: number;
    opLockVersion: number;
  } & Record<string, unknown>;
  return { ...rest, source: { kind: 'openproject', workPackageId: opWorkPackageId, projectId: opProjectId, lockVersion: opLockVersion } };
}

export function initialSnapshot(received: TicketEvent): TicketSnapshot {
  if (received.type !== 'ticket_received') {
    throw new Error(`ticket ${received.ticketId}: stream must start with ticket_received, got ${received.type}`);
  }
  const p = TicketReceivedPayload.parse(upcastLegacyReceivedPayload(received.payload));
  return {
    id: received.ticketId,
    source: p.source,
    displayKey: ticketDisplayKey(p.source),
    subject: p.subject,
    state: 'received',
    flags: [],
    priority: p.priority,
    planVersionCount: 0,
    unresolvedCommentCount: 0,
    createdAt: received.createdAt,
    updatedAt: received.createdAt,
  };
}

export interface ProjectedTicket {
  snapshot: TicketSnapshot;
  /** Latest OpenProject description; not part of the domain snapshot but needed to detect changes. */
  description: string;
}

/** Folds a full, seq-ordered stream into the snapshot plus the latest description. */
export function projectTicket(events: readonly TicketEvent[]): ProjectedTicket {
  const [first, ...rest] = events;
  if (!first) throw new Error('cannot project an empty stream: ticket_received is missing');
  const initial = initialSnapshot(first);
  let description = TicketReceivedPayload.parse(upcastLegacyReceivedPayload(first.payload)).description;
  for (const event of rest) {
    if (event.type === 'ticket_updated_from_op') {
      const p = TicketUpdatedFromOpPayload.parse(event.payload);
      if (p.description !== undefined) description = p.description;
    }
  }
  return { snapshot: replay(initial, rest), description };
}
