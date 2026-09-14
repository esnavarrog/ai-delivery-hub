import { OptimisticConcurrencyError, TicketEvent, type EventStore } from '@ai-delivery-hub/domain';
import { asc, eq, max } from 'drizzle-orm';
import type { Db } from './client.js';
import { ticketEvents } from './schema.js';

type EventRow = typeof ticketEvents.$inferSelect;

function isUniqueViolation(err: unknown): boolean {
  const code = (err as { code?: string })?.code ?? (err as { cause?: { code?: string } })?.cause?.code;
  return code === '23505';
}

export function rowToEvent(row: EventRow): TicketEvent {
  const event: Record<string, unknown> = {
    id: row.id,
    ticketId: row.ticketId,
    seq: row.seq,
    type: row.type,
    actor: { kind: row.actorKind, id: row.actorId },
    artifacts: row.artifacts,
    payload: row.payload,
    createdAt: row.createdAt.toISOString(),
  };
  if (row.reason !== null) event['reason'] = row.reason;
  if (row.runId !== null) event['runId'] = row.runId;
  return TicketEvent.parse(event);
}

function eventToRow(event: TicketEvent): typeof ticketEvents.$inferInsert {
  return {
    id: event.id,
    ticketId: event.ticketId,
    seq: event.seq,
    type: event.type,
    actorKind: event.actor.kind,
    actorId: event.actor.id,
    reason: event.reason ?? null,
    runId: event.runId ?? null,
    payload: event.payload as Record<string, unknown>,
    artifacts: event.artifacts,
    createdAt: new Date(event.createdAt),
  };
}

/**
 * Postgres event store. `append` checks the stream head inside a transaction and relies on the
 * `(ticket_id, seq)` unique index to turn any race into `OptimisticConcurrencyError`.
 */
export class PgEventStore implements EventStore {
  constructor(private readonly db: Db) {}

  async append(ticketId: string, expectedSeq: number, events: readonly TicketEvent[]): Promise<void> {
    if (events.length === 0) return;
    events.forEach((event, i) => {
      if (event.ticketId !== ticketId) throw new Error(`event ${event.id} belongs to ticket ${event.ticketId}, not ${ticketId}`);
      if (event.seq !== expectedSeq + i + 1) {
        throw new Error(`event ${event.id} has seq ${event.seq}; expected ${expectedSeq + i + 1} for a stream at ${expectedSeq}`);
      }
    });
    try {
      await this.db.transaction(async (tx) => {
        const actual = await headSeq(tx, ticketId);
        if (actual !== expectedSeq) throw new OptimisticConcurrencyError(ticketId, expectedSeq, actual);
        await tx.insert(ticketEvents).values(events.map(eventToRow));
      });
    } catch (err) {
      if (isUniqueViolation(err)) throw new OptimisticConcurrencyError(ticketId, expectedSeq, await headSeq(this.db, ticketId));
      throw err;
    }
  }

  async load(ticketId: string): Promise<TicketEvent[]> {
    const rows = await this.db.select().from(ticketEvents).where(eq(ticketEvents.ticketId, ticketId)).orderBy(asc(ticketEvents.seq));
    return rows.map(rowToEvent);
  }

  async loadAfter(ticketId: string, seq: number): Promise<TicketEvent[]> {
    return (await this.load(ticketId)).filter((e) => e.seq > seq);
  }
}

type Queryable = Pick<Db, 'select'>;

async function headSeq(q: Queryable, ticketId: string): Promise<number> {
  const [row] = await q.select({ seq: max(ticketEvents.seq) }).from(ticketEvents).where(eq(ticketEvents.ticketId, ticketId));
  return row?.seq ?? 0;
}
