import { PgBoss, type Job } from 'pg-boss';
import { z } from 'zod';
import type { TriageScheduler } from '../modules/ingest/ingest-work-package.js';
import type { PlanningScheduler } from '../modules/planning/run-planning.js';

export const QUEUES = {
  triageRun: 'triage.run',
  planningRun: 'planning.run',
} as const;

export const TriageJob = z.object({ ticketId: z.string().min(1) });
export const PlanningJob = z.object({ ticketId: z.string().min(1) });

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
  triage(ticketId: string): Promise<unknown>;
  planning(ticketId: string): Promise<unknown>;
}

export async function registerWorkers(boss: PgBoss, handlers: JobHandlers, log: Logger): Promise<void> {
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
