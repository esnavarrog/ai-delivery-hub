import type { Actor, Clock, EventStore, IdGenerator, ManualIntake, TicketEvent, TicketPriority } from '@ai-delivery-hub/domain';
import type { TriageScheduler } from './ingest-work-package.js';
import type { TicketReceivedPayload } from './ticket-received.js';

export interface ManualKeySequence {
  /** Atomically returns the next manual ticket key, e.g. `M-0001`, then `M-0002`, ... */
  next(): Promise<string>;
}

export interface ManualTicketInput {
  title: string;
  description: string;
  priority?: TicketPriority;
  /** Free-form tags carried over from the Obsidian note frontmatter, if any. */
  tags?: string[];
  /** Structured problem-first intake for a feature request submitted from the web route. */
  intake?: ManualIntake;
  /** The login of the ticket's requester/creator (the web route's authenticated user). */
  requesterUserId?: string;
}

export interface CreateManualTicketDeps {
  eventStore: EventStore;
  keys: ManualKeySequence;
  triage: TriageScheduler;
  ids: IdGenerator;
  clock: Clock;
}

export const MANUAL_INTAKE_ACTOR: Actor = { kind: 'system', id: 'manual-intake' };

/**
 * Creates a manual ticket (today: from an Obsidian inbox note) and enqueues it for triage — the
 * same `ticket_received` → triage → planning path an OpenProject work package goes through.
 */
export class CreateManualTicket {
  constructor(private readonly deps: CreateManualTicketDeps) {}

  /**
   * `presetKey` lets a caller reserve the key up front (the Obsidian importer moves the note to
   * `hub/tickets/<key>.md` before the ticket exists, so the mirror hook finds it already there).
   */
  async execute(input: ManualTicketInput, presetKey?: string): Promise<{ ticketId: string; key: string }> {
    const key = presetKey ?? (await this.deps.keys.next());
    const ticketId = this.deps.ids.uuid();
    const payload: TicketReceivedPayload = {
      source: { kind: 'manual', key },
      subject: input.title,
      description: input.description,
      priority: input.priority ?? 'normal',
    };
    if (input.tags && input.tags.length > 0) payload.tags = input.tags;
    if (input.intake) payload.intake = input.intake;
    if (input.requesterUserId) payload.requesterUserId = input.requesterUserId;
    const event: TicketEvent = {
      id: this.deps.ids.uuid(),
      ticketId,
      seq: 1,
      type: 'ticket_received',
      actor: MANUAL_INTAKE_ACTOR,
      artifacts: [],
      payload,
      createdAt: this.deps.clock.nowIso(),
    } as TicketEvent;
    await this.deps.eventStore.append(ticketId, 0, [event]);
    await this.deps.triage.enqueueTriage(ticketId);
    return { ticketId, key };
  }
}
