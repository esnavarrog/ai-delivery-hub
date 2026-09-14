import { randomUUID } from 'node:crypto';
import { serve } from '@hono/node-server';
import Anthropic from '@anthropic-ai/sdk';
import type { Clock, IdGenerator } from '@ai-delivery-hub/domain';
import { loadPolicies } from '@ai-delivery-hub/policies';
import { AgentSdkPlanningRunner } from './adapters/agent/planning-runner.js';
import { AnthropicTriageRunner } from './adapters/agent/triage-runner.js';
import { createDb } from './adapters/db/client.js';
import { PgEventStore } from './adapters/db/event-store.js';
import { PgOutboxRepository } from './adapters/db/outbox-repository.js';
import { PgPlanCommentsRepository, PgPlanVersionsRepository, PgRunsRepository } from './adapters/db/plan-repositories.js';
import { PgTicketProjection, ProjectingEventStore } from './adapters/db/ticket-projection.js';
import { PgWatermarkStore } from './adapters/db/watermarks.js';
import { OpenProjectClient } from './adapters/openproject/client.js';
import { GitWorktreeAdapter } from './adapters/repo/git-worktree.js';
import { loadConfig } from './config.js';
import { createApp } from './http/app.js';
import { BossOutboxQueue, BossPlanningScheduler, BossTriageScheduler, createBoss, registerWorkers, type Logger } from './jobs/boss.js';
import { loadLocalEnv } from './local-env.js';
import { TicketCommands } from './modules/approval/commands.js';
import { IngestWorkPackage } from './modules/ingest/ingest-work-package.js';
import { pollOnce } from './modules/ingest/poll.js';
import { RunPlanning } from './modules/planning/run-planning.js';
import { createSyncAfterAppend } from './modules/sync/after-append.js';
import { OutboxWorker } from './modules/sync/outbox.js';
import { RunTriage } from './modules/triage/run-triage.js';

const log: Logger = {
  info: (msg, meta) => console.log(JSON.stringify({ level: 'info', msg, ...meta })),
  warn: (msg, meta) => console.warn(JSON.stringify({ level: 'warn', msg, ...meta })),
  error: (msg, meta) => console.error(JSON.stringify({ level: 'error', msg, ...meta })),
};

const clock: Clock = { now: () => new Date(), nowIso: () => new Date().toISOString() };
const ids: IdGenerator = { uuid: () => randomUUID() };

async function main(): Promise<void> {
  loadLocalEnv();
  const config = loadConfig();
  const policies = await loadPolicies(config.POLICIES_DIR);

  const dbHandle = createDb(config.DATABASE_URL);
  const boss = await createBoss(config.DATABASE_URL, log);

  const projection = new PgTicketProjection(dbHandle.db);
  const outboxRepo = new PgOutboxRepository(dbHandle.db);
  const eventStore = new ProjectingEventStore(new PgEventStore(dbHandle.db), projection, [
    createSyncAfterAppend(outboxRepo, new BossOutboxQueue(boss), { statusSync: policies.openproject.statusSync, hubPublicUrl: config.HUB_PUBLIC_URL }),
  ]);
  const planVersions = new PgPlanVersionsRepository(dbHandle.db);
  const planComments = new PgPlanCommentsRepository(dbHandle.db);
  const runs = new PgRunsRepository(dbHandle.db);

  const triageScheduler = new BossTriageScheduler(boss);
  const planningScheduler = new BossPlanningScheduler(boss);

  const op = new OpenProjectClient({ baseUrl: config.OP_BASE_URL, apiKey: config.OP_API_KEY, clock });
  const ingest = new IngestWorkPackage({ eventStore, ticketIndex: projection, triage: triageScheduler, ids, clock, trigger: policies.openproject.trigger });
  const watermarks = new PgWatermarkStore(dbHandle.db);
  const outboxWorker = new OutboxWorker({ repo: outboxRepo, op, eventStore, ids, clock });

  // Credentials are resolved by the SDKs (ANTHROPIC_API_KEY or a logged-in profile); nothing is read here.
  const anthropic = new Anthropic();
  const triageRunner = new AnthropicTriageRunner({ client: anthropic, model: policies.models.triage, effort: policies.models.effort.triage, policies });
  const worktrees = new GitWorktreeAdapter({ dir: config.WORKTREES_DIR, repos: policies.repos });
  const planningRunner = new AgentSdkPlanningRunner({
    models: policies.models.planning,
    effort: policies.models.effort.planning,
    policies,
    ...(config.CLAUDE_CODE_PATH !== undefined ? { pathToClaudeCodeExecutable: config.CLAUDE_CODE_PATH } : {}),
  });

  const runTriage = new RunTriage({ eventStore, ids, clock, runner: triageRunner, runs, tickets: projection, planning: planningScheduler, policies });
  const runPlanning = new RunPlanning({ eventStore, ids, clock, runner: planningRunner, runs, planVersions, planComments, worktrees, policies });
  const commands = new TicketCommands({ eventStore, ids, clock, planVersions, planComments, triage: triageScheduler, planning: planningScheduler, allowedRepos: Object.keys(policies.repos) });

  await registerWorkers(
    boss,
    {
      poll: () => pollOnce({ op, watermarks, ingest, projectIds: policies.openproject.projectIds, clock }),
      triage: (ticketId) => runTriage.execute(ticketId),
      planning: (ticketId) => runPlanning.execute(ticketId),
      outbox: (key) => outboxWorker.process(key),
    },
    { pollIntervalMs: config.POLL_INTERVAL_MS },
    log,
  );

  const app = createApp({
    queries: projection,
    webhook: { secret: config.OP_WEBHOOK_SECRET, ingest, op },
    auth: { roles: policies.roles },
    commands,
    planVersions,
    planComments,
    runs,
  });
  const server = serve({ fetch: app.fetch, port: config.PORT }, (info) => {
    log.info('server listening', {
      port: info.port,
      policiesDir: config.POLICIES_DIR,
      projects: policies.openproject.projectIds,
      worktreesDir: config.WORKTREES_DIR,
      models: { triage: policies.models.triage, planning: policies.models.planning },
    });
  });

  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    log.info('shutting down', { signal });
    server.close();
    await boss.stop({ graceful: true, timeout: 10_000 });
    await dbHandle.close();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((err) => {
  log.error('fatal', { error: err instanceof Error ? err.message : String(err) });
  process.exit(1);
});
