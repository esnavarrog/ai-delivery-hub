import type { TicketEvent } from './ticket-event.js';

/** Thrown when `append` is called with an `expectedSeq` that no longer matches the stream head. */
export class OptimisticConcurrencyError extends Error {
  override readonly name = 'OptimisticConcurrencyError';

  constructor(
    readonly ticketId: string,
    readonly expectedSeq: number,
    readonly actualSeq: number,
  ) {
    super(`ticket ${ticketId}: expected stream at seq ${expectedSeq} but found seq ${actualSeq}`);
  }
}

/**
 * Append-only per-ticket event stream with optimistic concurrency.
 * `expectedSeq` is the seq of the last stored event (0 for an empty stream).
 */
export interface EventStore {
  append(ticketId: string, expectedSeq: number, events: readonly TicketEvent[]): Promise<void>;
  load(ticketId: string): Promise<TicketEvent[]>;
}
