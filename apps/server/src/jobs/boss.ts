import { PgBoss, type Job } from 'pg-boss';
import { z } from 'zod';
import type { TriageScheduler } from '../modules/ingest/ingest-work-package.js';
import type { PlanningScheduler } from '../modules/planning/run-planning.js';

export const QUEUES = {
  ingestPoll: 'ingest.poll',
  triageRun: 'triage.run',
  planningRun: 'planning.run',
  syncOutbox: 'sync.outbox',
} as const;

export const TriageJob = z.object({ ticketId: z.string().min(1) });
export const PlanningJob = z.object({ ticketId: z.string().min(1) });
export const OutboxJob = z.object({ key: z.string().min(1) });

/** pg-boss schedules are cron expressions, so the poll interval is rounded to whole minutes (min 1). */
export function pollCron(intervalMs: number): string {
  const minutes = Math.max(1, Math.round(intervalMs / 60_000));
  if (minutes === 1) return '* * * * *';
  if (minutes < 60) return `*/${minutes} * * * *`;
  return `0 */${Math.max(1, Math.round(minutes / 60))} * * *`;
}

export interface Logger {
  info(msg: string, meta?: Record<string, unknown>): void;
  warn(msg: string, meta?: Record<string, unknown>): void;
  error(msg: string, meta?: Record<string, unknown>): void;
}

export async function createBoss(connectionString: string, log: Logger): Promise<PgBoss> {
  const boss = new PgBoss({ connectionString, schema: 'pgboss' });
  boss.on('error', (err: unknown) => log.error('pg-boss error', { error: (err as Error).message }));
  await boss.start();
  for (const queue of Object.values(QUEUES)) await boss.createQueue(queue);
  return boss;
}

export interface JobHandlers {
  poll(): Promise<unknown>;
  triage(ticketId: string): Promise<unknown>;
  planning(ticketId: string): Promise<unknown>;
  outbox(key: string): Promise<unknown>;
}

export async function registerWorkers(boss: PgBoss, handlers: JobHandlers, options: { pollIntervalMs: number }, log: Logger): Promise<void> {
  await boss.work(QUEUES.ingestPoll, { batchSize: 1 }, async () => {
    const summary = await handlers.poll();
    log.info('ingest.poll done', { summary });
  });

  await boss.work<unknown>(QUEUES.triageRun, { batchSize: 1 }, async (jobs: Job<unknown>[]) => {
    for (const job of jobs) {
      const { ticketId } = TriageJob.parse(job.data);
      const outcome = await handlers.triage(ticketId);
      log.info('triage.run done', { ticketId, outcome });
    }
  });

  // Planning runs are long (minutes); one at a time per worker keeps the agent budget predictable.
  await boss.work<unknown>(QUEUES.planningRun, { batchSize: 1 }, async (jobs: Job<unknown>[]) => {
    for (const job of jobs) {
      const { ticketId } = PlanningJob.parse(job.data);
      const outcome = await handlers.planning(ticketId);
      log.info('planning.run done', { ticketId, outcome });
    }
  });

  await boss.work<unknown>(QUEUES.syncOutbox, { batchSize: 1 }, async (jobs: Job<unknown>[]) => {
    for (const job of jobs) {
      const { key } = OutboxJob.parse(job.data);
      const result = await handlers.outbox(key);
      log.info('sync.outbox processed', { key, result });
    }
  });

  await boss.schedule(QUEUES.ingestPoll, pollCron(options.pollIntervalMs), {}, { singletonKey: 'ingest.poll' });
}

export class BossTriageScheduler implements TriageScheduler {
  constructor(private readonly boss: PgBoss) {}
  async enqueueTriage(ticketId: string): Promise<void> {
    await this.boss.send(QUEUES.triageRun, { ticketId }, { singletonKey: ticketId });
  }
}

export class BossPlanningScheduler implements PlanningScheduler {
  constructor(private readonly boss: PgBoss) {}
  async enqueuePlanning(ticketId: string): Promise<void> {
    await this.boss.send(QUEUES.planningRun, { ticketId }, { singletonKey: ticketId });
  }
}

export interface OutboxJobQueue {
  enqueueOutbox(key: string): Promise<void>;
}

export class BossOutboxQueue implements OutboxJobQueue {
  constructor(private readonly boss: PgBoss) {}
  async enqueueOutbox(key: string): Promise<void> {
    await this.boss.send(QUEUES.syncOutbox, { key }, { singletonKey: key });
  }
}
