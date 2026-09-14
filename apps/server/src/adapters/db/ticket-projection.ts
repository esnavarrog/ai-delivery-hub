import { TicketSnapshot, type EventStore, type TicketEvent } from '@ai-delivery-hub/domain';
import { and, asc, desc, eq, gt, type SQL } from 'drizzle-orm';
import type { TicketFilters, TicketQueries } from '../../http/app.js';
import type { TicketIndex } from '../../modules/ingest/ingest-work-package.js';
import { projectTicket } from '../../modules/ingest/ticket-received.js';
import type { Db } from './client.js';
import { rowToEvent } from './event-store.js';
import { ticketEvents, tickets } from './schema.js';

type TicketRow = typeof tickets.$inferSelect;

const iso = (d: Date | null): string | undefined => d?.toISOString();

export function rowToSnapshot(row: TicketRow): TicketSnapshot {
  const snapshot: Record<string, unknown> = {
    id: row.id,
    opWorkPackageId: row.opWorkPackageId,
    opProjectId: row.opProjectId,
    opLockVersion: row.opLockVersion,
    subject: row.subject,
    state: row.state,
    flags: row.flags,
    priority: row.priority,
    planVersionCount: row.planVersionCount,
    unresolvedCommentCount: row.unresolvedCommentCount,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
  const optional: Array<[string, unknown]> = [
    ['category', row.category ?? undefined],
    ['riskTier', row.riskTier ?? undefined],
    ['targetRepo', row.targetRepo ?? undefined],
    ['ownerUserId', row.ownerUserId ?? undefined],
    ['lastPlanVersionAt', iso(row.lastPlanVersionAt)],
    ['lastHumanCommentAt', iso(row.lastHumanCommentAt)],
  ];
  for (const [k, v] of optional) if (v !== undefined) snapshot[k] = v;
  return TicketSnapshot.parse(snapshot);
}

/** Tickets read model: upserted after every append, queried by the API and the ingest index. */
export class PgTicketProjection implements TicketIndex, TicketQueries {
  constructor(private readonly db: Db) {}

  /** Rebuilds the snapshot from the full stream and upserts it. Returns the projected snapshot. */
  async rebuild(events: readonly TicketEvent[]): Promise<TicketSnapshot> {
    const { snapshot, description } = projectTicket(events);
    const row: typeof tickets.$inferInsert = {
      id: snapshot.id,
      opWorkPackageId: snapshot.opWorkPackageId,
      opProjectId: snapshot.opProjectId,
      opLockVersion: snapshot.opLockVersion,
      subject: snapshot.subject,
      description,
      state: snapshot.state,
      flags: snapshot.flags,
      category: snapshot.category ?? null,
      riskTier: snapshot.riskTier ?? null,
      targetRepo: snapshot.targetRepo ?? null,
      ownerUserId: snapshot.ownerUserId ?? null,
      priority: snapshot.priority,
      planVersionCount: snapshot.planVersionCount,
      unresolvedCommentCount: snapshot.unresolvedCommentCount,
      lastPlanVersionAt: snapshot.lastPlanVersionAt ? new Date(snapshot.lastPlanVersionAt) : null,
      lastHumanCommentAt: snapshot.lastHumanCommentAt ? new Date(snapshot.lastHumanCommentAt) : null,
      headSeq: events.at(-1)?.seq ?? 0,
      createdAt: new Date(snapshot.createdAt),
      updatedAt: new Date(snapshot.updatedAt),
    };
    const { id: _id, ...update } = row;
    await this.db.insert(tickets).values(row).onConflictDoUpdate({ target: tickets.id, set: update });
    return snapshot;
  }

  async findTicketIdByWorkPackage(opWorkPackageId: number): Promise<string | undefined> {
    const [row] = await this.db.select({ id: tickets.id }).from(tickets).where(eq(tickets.opWorkPackageId, opWorkPackageId));
    return row?.id;
  }

  async list(filters: TicketFilters): Promise<TicketSnapshot[]> {
    const where: SQL[] = [];
    if (filters.state) where.push(eq(tickets.state, filters.state));
    if (filters.repo) where.push(eq(tickets.targetRepo, filters.repo));
    if (filters.owner) where.push(eq(tickets.ownerUserId, filters.owner));
    const rows = await this.db
      .select()
      .from(tickets)
      .where(where.length ? and(...where) : undefined)
      .orderBy(desc(tickets.updatedAt));
    return rows.map(rowToSnapshot);
  }

  async get(id: string): Promise<{ snapshot: TicketSnapshot; events: TicketEvent[] } | undefined> {
    const [row] = await this.db.select().from(tickets).where(eq(tickets.id, id));
    if (!row) return undefined;
    const events = await this.db.select().from(ticketEvents).where(eq(ticketEvents.ticketId, id)).orderBy(asc(ticketEvents.seq));
    return { snapshot: rowToSnapshot(row), events: events.map(rowToEvent) };
  }

  async eventsAfter(id: string, seq: number): Promise<TicketEvent[]> {
    const rows = await this.db
      .select()
      .from(ticketEvents)
      .where(and(eq(ticketEvents.ticketId, id), gt(ticketEvents.seq, seq)))
      .orderBy(asc(ticketEvents.seq));
    return rows.map(rowToEvent);
  }
}

export type AfterAppendHook = (appended: readonly TicketEvent[], snapshot: TicketSnapshot) => Promise<void>;

/**
 * Event store decorator: after a successful append, rebuilds the ticket projection and runs the
 * hooks (e.g. OpenProject sync outbox) with the snapshot after the appended batch.
 */
export class ProjectingEventStore implements EventStore {
  constructor(
    private readonly inner: EventStore,
    private readonly projection: PgTicketProjection,
    private readonly hooks: readonly AfterAppendHook[] = [],
  ) {}

  async append(ticketId: string, expectedSeq: number, events: readonly TicketEvent[]): Promise<void> {
    await this.inner.append(ticketId, expectedSeq, events);
    const snapshot = await this.projection.rebuild(await this.inner.load(ticketId));
    for (const hook of this.hooks) await hook(events, snapshot);
  }

  load(ticketId: string): Promise<TicketEvent[]> {
    return this.inner.load(ticketId);
  }
}
