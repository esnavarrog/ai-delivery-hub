import { eq } from 'drizzle-orm';
import type { WatermarkStore } from '../../modules/ingest/poll.js';
import type { Db } from './client.js';
import { ingestWatermarks } from './schema.js';

export class PgWatermarkStore implements WatermarkStore {
  constructor(private readonly db: Db) {}

  async get(projectId: number): Promise<string | undefined> {
    const [row] = await this.db.select({ since: ingestWatermarks.since }).from(ingestWatermarks).where(eq(ingestWatermarks.projectId, projectId));
    return row?.since.toISOString();
  }

  async set(projectId: number, sinceIso: string): Promise<void> {
    const since = new Date(sinceIso);
    await this.db
      .insert(ingestWatermarks)
      .values({ projectId, since, updatedAt: new Date() })
      .onConflictDoUpdate({ target: ingestWatermarks.projectId, set: { since, updatedAt: new Date() } });
  }
}
