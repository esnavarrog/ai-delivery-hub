import type { AfterAppendHook } from '../../adapters/db/ticket-projection.js';
import type { OutboxJobQueue } from '../../jobs/boss.js';
import { outboxRowsForEvent, type OutboxRepository, type SyncOptions } from './outbox.js';

/**
 * Turns appended events into outbox rows and schedules a job for each row actually inserted.
 * Uses the snapshot after the whole batch; batches are single events everywhere in Phase 1.
 */
export function createSyncAfterAppend(repo: OutboxRepository, queue: OutboxJobQueue, options: SyncOptions): AfterAppendHook {
  return async (appended, snapshot) => {
    const rows = appended.flatMap((event) => outboxRowsForEvent(event, snapshot, options));
    const inserted = await repo.enqueue(rows);
    for (const key of inserted) await queue.enqueueOutbox(key);
  };
}
