import {
  OptimisticConcurrencyError,
  canTransition,
  type Actor,
  type Artifact,
  type Clock,
  type EventStore,
  type IdGenerator,
  type Role,
  type TicketEvent,
  type TicketEventType,
  type TicketSnapshot,
} from '@ai-delivery-hub/domain';
import { projectTicket } from '../ingest/ticket-received.js';

export class TicketNotFoundError extends Error {
  override readonly name = 'TicketNotFoundError';
  constructor(readonly ticketId: string) {
    super(`ticket ${ticketId} not found`);
  }
}

/** A domain guard refused the command; maps to HTTP 409. */
export class TransitionDeniedError extends Error {
  override readonly name = 'TransitionDeniedError';
  constructor(
    readonly ticketId: string,
    readonly eventType: TicketEventType,
    readonly reason: string,
  ) {
    super(reason);
  }
}

/** The actor's role may never perform this command; maps to HTTP 403. */
export class ForbiddenError extends Error {
  override readonly name = 'ForbiddenError';
}

/** The command body is well-formed but semantically unusable for this ticket; maps to HTTP 400. */
export class InvalidCommandError extends Error {
  override readonly name = 'InvalidCommandError';
}

export interface TicketCommandDeps {
  eventStore: EventStore;
  ids: IdGenerator;
  clock: Clock;
}

export interface LoadedTicket {
  events: TicketEvent[];
  snapshot: TicketSnapshot;
  /** Latest OpenProject description (untrusted text). */
  description: string;
}

export async function loadTicket(eventStore: EventStore, ticketId: string): Promise<LoadedTicket> {
  const events = await eventStore.load(ticketId);
  if (events.length === 0) throw new TicketNotFoundError(ticketId);
  const { snapshot, description } = projectTicket(events);
  return { events, snapshot, description };
}

export interface EventOptions {
  payload?: Record<string, unknown>;
  reason?: string;
  runId?: string;
  artifacts?: Artifact[];
}

export interface CommandContext extends LoadedTicket {
  /** Throws `TransitionDeniedError` unless `canTransition` allows `eventType` for `actor` on the current snapshot. */
  guard(actor: Actor, eventType: TicketEventType, extra?: { actorRole?: Role; payload?: Record<string, unknown> }): void;
  /** Builds the next event in the batch; seqs are assigned in call order. */
  event(type: TicketEventType, actor: Actor, options?: EventOptions): TicketEvent;
}

export interface CommandResult extends LoadedTicket {
  /** Events written by this command (empty when the builder produced none). */
  appended: TicketEvent[];
}

/**
 * Loads the ticket, lets `build` derive a batch of events from the current snapshot, and appends
 * it with optimistic concurrency. If another writer moved the stream in between, the whole
 * load → build → append cycle runs once more against the fresh stream; a second conflict propagates.
 */
export async function appendCommand(
  deps: TicketCommandDeps,
  ticketId: string,
  build: (ctx: CommandContext) => TicketEvent[] | Promise<TicketEvent[]>,
): Promise<CommandResult> {
  for (let attempt = 0; ; attempt += 1) {
    const loaded = await loadTicket(deps.eventStore, ticketId);
    let seq = loaded.events.length;
    const ctx: CommandContext = {
      ...loaded,
      guard(actor, eventType, extra) {
        const result = canTransition(
          {
            ticket: loaded.snapshot,
            actor,
            ...(extra?.actorRole !== undefined ? { actorRole: extra.actorRole } : {}),
            ...(extra?.payload !== undefined ? { payload: extra.payload } : {}),
          },
          eventType,
        );
        if (!result.allowed) throw new TransitionDeniedError(ticketId, eventType, result.reason);
      },
      event(type, actor, options = {}) {
        seq += 1;
        const event: Record<string, unknown> = {
          id: deps.ids.uuid(),
          ticketId,
          seq,
          type,
          actor,
          artifacts: options.artifacts ?? [],
          payload: options.payload ?? {},
          createdAt: deps.clock.nowIso(),
        };
        if (options.reason !== undefined) event['reason'] = options.reason;
        if (options.runId !== undefined) event['runId'] = options.runId;
        return event as TicketEvent;
      },
    };
    const appended = await build(ctx);
    if (appended.length === 0) return { ...loaded, appended: [] };
    try {
      await deps.eventStore.append(ticketId, loaded.events.length, appended);
    } catch (err) {
      if (err instanceof OptimisticConcurrencyError && attempt === 0) continue;
      throw err;
    }
    const events = await deps.eventStore.load(ticketId);
    const projected = projectTicket(events);
    return { snapshot: projected.snapshot, description: projected.description, events, appended };
  }
}
