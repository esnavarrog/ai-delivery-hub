import { eq, sql } from 'drizzle-orm';
import type { OutboxKind, OutboxPayload, OutboxRepository, OutboxRow, OutboxStatus, StoredOutboxRow } from '../../modules/sync/outbox.js';
import type { Db } from './client.js';
import { opSyncOutbox } from './schema.js';

export class PgOutboxRepository implements OutboxRepository {
  constructor(private readonly db: Db) {}

  async enqueue(rows: readonly OutboxRow[]): Promise<string[]> {
    if (rows.length === 0) return [];
    const inserted = await this.db
      .insert(opSyncOutbox)
      .values(rows.map((r) => ({ ...r, payload: r.payload as Record<string, unknown> })))
      .onConflictDoNothing({ target: opSyncOutbox.key })
      .returning({ key: opSyncOutbox.key });
    return inserted.map((r) => r.key);
  }

  async get(key: string): Promise<StoredOutboxRow | undefined> {
    const [row] = await this.db.select().from(opSyncOutbox).where(eq(opSyncOutbox.key, key));
    if (!row) return undefined;
    const stored: StoredOutboxRow = {
      key: row.key,
      ticketId: row.ticketId,
      eventSeq: row.eventSeq,
      kind: row.kind as OutboxKind,
      opWorkPackageId: row.opWorkPackageId,
      payload: row.payload as OutboxPayload,
      status: row.status as OutboxStatus,
      attempts: row.attempts,
    };
    if (row.externalRef !== null) stored.externalRef = row.externalRef;
    if (row.lastError !== null) stored.lastError = row.lastError;
    return stored;
  }

  async markPosted(key: string, externalRef: string): Promise<void> {
    await this.db
      .update(opSyncOutbox)
      .set({ status: 'posted', externalRef, postedAt: new Date(), attempts: sql`${opSyncOutbox.attempts} + 1`, lastError: null })
      .where(eq(opSyncOutbox.key, key));
  }

  async markFailed(key: string, error: string): Promise<void> {
    await this.db
      .update(opSyncOutbox)
      .set({ status: 'failed', lastError: error, attempts: sql`${opSyncOutbox.attempts} + 1` })
      .where(eq(opSyncOutbox.key, key));
  }
}
