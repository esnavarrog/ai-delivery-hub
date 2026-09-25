import {
  canTransition,
  type Actor,
  type Clock,
  type EventStore,
  type IdGenerator,
  type OpChangedField,
  type TicketEvent,
  type TicketUpdatedFromOpPayload,
  type WorkPackage,
} from '@ai-delivery-hub/domain';
import type { TriggerRule } from '@ai-delivery-hub/policies';
import { mapPriority, matchesTrigger } from '../../adapters/openproject/mapping.js';
import { projectTicket, type TicketReceivedPayload } from './ticket-received.js';

export interface TicketIndex {
  findTicketIdByWorkPackage(opWorkPackageId: number): Promise<string | undefined>;
}

export interface TriageScheduler {
  enqueueTriage(ticketId: string): Promise<void>;
}

export interface IngestDeps {
  eventStore: EventStore;
  ticketIndex: TicketIndex;
  triage: TriageScheduler;
  ids: IdGenerator;
  clock: Clock;
  trigger: TriggerRule;
}

export type IngestOutcome =
  | { kind: 'created'; ticketId: string }
  | { kind: 'updated'; ticketId: string; changedFields: OpChangedField[] }
  | { kind: 'unchanged'; ticketId: string }
  | { kind: 'ignored'; reason: 'trigger_not_matched' | 'terminal_state' };

export const INGEST_ACTOR: Actor = { kind: 'system', id: 'ingest' };

/**
 * Turns an OpenProject work package into ticket events. Idempotent: the same
 * `lockVersion` never produces a second event, and a changed work package only
 * produces `ticket_updated_from_op` when subject or description differ.
 */
export class IngestWorkPackage {
  constructor(private readonly deps: IngestDeps) {}

  async execute(wp: WorkPackage): Promise<IngestOutcome> {
    const existingId = await this.deps.ticketIndex.findTicketIdByWorkPackage(wp.id);
    if (existingId !== undefined) return this.update(existingId, wp);
    if (!matchesTrigger(wp, this.deps.trigger)) return { kind: 'ignored', reason: 'trigger_not_matched' };
    return this.create(wp);
  }

  private async create(wp: WorkPackage): Promise<IngestOutcome> {
    const ticketId = this.deps.ids.uuid();
    const payload: TicketReceivedPayload = {
      source: { kind: 'openproject', workPackageId: wp.id, projectId: wp.project.id, lockVersion: wp.lockVersion },
      subject: wp.subject,
      description: wp.description.raw,
      status: wp.status,
      type: wp.type,
      priority: mapPriority(wp.priority),
      opUpdatedAt: wp.updatedAt,
    };
    if (wp.assignee) payload.assignee = wp.assignee;
    await this.deps.eventStore.append(ticketId, 0, [this.event(ticketId, 1, 'ticket_received', payload)]);
    await this.deps.triage.enqueueTriage(ticketId);
    return { kind: 'created', ticketId };
  }

  private async update(ticketId: string, wp: WorkPackage): Promise<IngestOutcome> {
    const events = await this.deps.eventStore.load(ticketId);
    const { snapshot, description } = projectTicket(events);
    // Only an openproject-sourced ticket is ever found by findTicketIdByWorkPackage; guard defensively.
    const currentLockVersion = snapshot.source.kind === 'openproject' ? snapshot.source.lockVersion : undefined;
    if (wp.lockVersion === currentLockVersion) return { kind: 'unchanged', ticketId };

    const changedFields: OpChangedField[] = [];
    if (wp.subject !== snapshot.subject) changedFields.push('subject');
    if (wp.description.raw !== description) changedFields.push('description');
    if (changedFields.length === 0) return { kind: 'unchanged', ticketId };

    const guard = canTransition({ ticket: snapshot, actor: INGEST_ACTOR }, 'ticket_updated_from_op');
    if (!guard.allowed) return { kind: 'ignored', reason: 'terminal_state' };

    const payload: TicketUpdatedFromOpPayload = { opLockVersion: wp.lockVersion, changedFields };
    if (changedFields.includes('subject')) payload.subject = wp.subject;
    if (changedFields.includes('description')) payload.description = wp.description.raw;
    const seq = events.length;
    await this.deps.eventStore.append(ticketId, seq, [this.event(ticketId, seq + 1, 'ticket_updated_from_op', payload)]);
    return { kind: 'updated', ticketId, changedFields };
  }

  private event(ticketId: string, seq: number, type: 'ticket_received' | 'ticket_updated_from_op', payload: Record<string, unknown>): TicketEvent {
    return {
      id: this.deps.ids.uuid(),
      ticketId,
      seq,
      type,
      actor: INGEST_ACTOR,
      artifacts: [],
      payload,
      createdAt: this.deps.clock.nowIso(),
    } as TicketEvent;
  }
}
