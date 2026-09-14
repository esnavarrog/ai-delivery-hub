import { replay, TicketPriority, TicketUpdatedFromOpPayload, type TicketEvent, type TicketSnapshot } from '@ai-delivery-hub/domain';
import { z } from 'zod';

/** Payload of `ticket_received`: the OpenProject facts the hub needs to build the first snapshot. */
export const TicketReceivedPayload = z.object({
  opWorkPackageId: z.number().int().positive(),
  opProjectId: z.number().int().positive(),
  opLockVersion: z.number().int().min(0),
  subject: z.string().min(1),
  description: z.string(),
  status: z.string(),
  type: z.string(),
  assignee: z.object({ id: z.number().int().positive(), name: z.string() }).optional(),
  priority: TicketPriority,
  opUpdatedAt: z.string(),
});
export type TicketReceivedPayload = z.infer<typeof TicketReceivedPayload>;

export function initialSnapshot(received: TicketEvent): TicketSnapshot {
  if (received.type !== 'ticket_received') {
    throw new Error(`ticket ${received.ticketId}: stream must start with ticket_received, got ${received.type}`);
  }
  const p = TicketReceivedPayload.parse(received.payload);
  return {
    id: received.ticketId,
    opWorkPackageId: p.opWorkPackageId,
    opProjectId: p.opProjectId,
    opLockVersion: p.opLockVersion,
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
  let description = TicketReceivedPayload.parse(first.payload).description;
  for (const event of rest) {
    if (event.type === 'ticket_updated_from_op') {
      const p = TicketUpdatedFromOpPayload.parse(event.payload);
      if (p.description !== undefined) description = p.description;
    }
  }
  return { snapshot: replay(initial, rest), description };
}
