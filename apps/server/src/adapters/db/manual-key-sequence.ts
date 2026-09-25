import { formatManualKey } from '@ai-delivery-hub/domain';
import { eq, sql } from 'drizzle-orm';
import type { ManualKeySequence } from '../../modules/ingest/manual-ticket.js';
import type { Db } from './client.js';
import { manualTicketCounter } from './schema.js';

const SINGLETON_ID = 'singleton';

/**
 * Postgres-backed `ManualKeySequence`: a single row, incremented with `UPDATE ... RETURNING` so
 * concurrent callers each get a distinct value (Postgres serializes concurrent updates to the same
 * row). The row is created lazily on first use.
 */
export class PgManualKeySequence implements ManualKeySequence {
  constructor(private readonly db: Db) {}

  async next(): Promise<string> {
    await this.db.insert(manualTicketCounter).values({ id: SINGLETON_ID, nextValue: 1 }).onConflictDoNothing();
    const [row] = await this.db
      .update(manualTicketCounter)
      .set({ nextValue: sql`${manualTicketCounter.nextValue} + 1` })
      .where(eq(manualTicketCounter.id, SINGLETON_ID))
      .returning({ nextValue: manualTicketCounter.nextValue });
    if (!row) throw new Error('manual_ticket_counter singleton row is missing after insert');
    // `nextValue` is the value AFTER this increment; the key handed out is the value before it.
    return formatManualKey(row.nextValue - 1);
  }
}
