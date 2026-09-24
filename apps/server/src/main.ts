import { randomUUID } from 'node:crypto';
import { serve } from '@hono/node-server';
import Anthropic from '@anthropic-ai/sdk';
import type { Clock, IdGenerator } from '@ai-delivery-hub/domain';
import { loadPolicies } from '@ai-delivery-hub/policies';
import { ClaudeCodeTriageRunner } from './adapters/agent/claude-code-triage-runner.js';
import { AgentSdkPlanningRunner } from './adapters/agent/planning-runner.js';
import { AnthropicTriageRunner } from './adapters/agent/triage-runner.js';
import { createDb } from './adapters/db/client.js';
import { PgEventStore } from './adapters/db/event-store.js';
import { PgPlanCommentsRepository, PgPlanVersionsRepository, PgRunsRepository } from './adapters/db/plan-repositories.js';
import { PgTicketProjection, ProjectingEventStore } from './adapters/db/ticket-projection.js';
import { PgWatermarkStore } from './adapters/db/watermarks.js';
import { OpenProjectClient } from './adapters/openproject/client.js';
import { GitWorktreeAdapter } from './adapters/repo/git-worktree.js';
import { loadConfig, shouldWarnOnSubscriptionFallback } from './config.js';
import { createApp } from './http/app.js';
import { BossPlanningScheduler, BossTriageScheduler, createBoss, registerWorkers, type Logger } from './jobs/boss.js';
import { loadLocalEnv } from './local-env.js';
import { TicketCommands } from './modules/approval/commands.js';
import { RunIngestFetch } from './modules/ingest/fetch.js';
import { IngestWorkPackage } from './modules/ingest/ingest-work-package.js';
import { RunPlanning } from './modules/planning/run-planning.js';
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
  log.info('ai credentials mode resolved', { mode: config.aiCredentialsMode });
  if (shouldWarnOnSubscriptionFallback(config)) {
    log.warn('AI_CREDENTIALS=auto fell back to the personal Claude Code subscription login (no ANTHROPIC_API_KEY set) — fine for local/dev, never use this outside production for multi-user deployments');
  }
  const policies = await loadPolicies(config.POLICIES_DIR);

  const dbHandle = createDb(config.DATABASE_URL);
  const boss = await createBoss(config.DATABASE_URL, log);

  const projection = new PgTicketProjection(dbHandle.db);
  const eventStore = new ProjectingEventStore(new PgEventStore(dbHandle.db), projection, []);
  const planVersions = new PgPlanVersionsRepository(dbHandle.db);
  const planComments = new PgPlanCommentsRepository(dbHandle.db);
  const runs = new PgRunsRepository(dbHandle.db);

  const triageScheduler = new BossTriageScheduler(boss);
  const planningScheduler = new BossPlanningScheduler(boss);

  const op = new OpenProjectClient({ baseUrl: config.OP_BASE_URL, apiKey: config.OP_API_KEY, clock });
  const ingest = new IngestWorkPackage({ eventStore, ticketIndex: projection, triage: triageScheduler, ids, clock, trigger: policies.openproject.trigger });
  const watermarks = new PgWatermarkStore(dbHandle.db);

  // `api-key` mode: credentials are resolved by the SDKs from ANTHROPIC_API_KEY; nothing is read here.
  // `subscription` mode: the Agent SDK spawns the Claude Code CLI, which resolves the logged-in profile
  // once ANTHROPIC_API_KEY/ANTHROPIC_AUTH_TOKEN are stripped from its env (see agentSubprocessEnv).
  const stripApiKeyEnv = config.aiCredentialsMode === 'subscription';
  const triageRunner =
    config.aiCredentialsMode === 'api-key'
      ? new AnthropicTriageRunner({ client: new Anthropic(), model: policies.models.triage, effort: policies.models.effort.triage, policies })
      : new ClaudeCodeTriageRunner({
          model: policies.models.triage,
          effort: policies.models.effort.triage,
          policies,
          stripApiKeyEnv,
          ...(config.CLAUDE_CODE_PATH !== undefined ? { pathToClaudeCodeExecutable: config.CLAUDE_CODE_PATH } : {}),
        });
  const worktrees = new GitWorktreeAdapter({ dir: config.WORKTREES_DIR, repos: policies.repos });
  const planningRunner = new AgentSdkPlanningRunner({
    models: policies.models.planning,
    effort: policies.models.effort.planning,
    policies,
    stripApiKeyEnv,
    ...(config.CLAUDE_CODE_PATH !== undefined ? { pathToClaudeCodeExecutable: config.CLAUDE_CODE_PATH } : {}),
  });

  const runTriage = new RunTriage({ eventStore, ids, clock, runner: triageRunner, runs, tickets: projection, planning: planningScheduler, policies });
  const runPlanning = new RunPlanning({ eventStore, ids, clock, runner: planningRunner, runs, planVersions, planComments, worktrees, policies });
  const commands = new TicketCommands({ eventStore, ids, clock, planVersions, planComments, triage: triageScheduler, planning: planningScheduler, allowedRepos: Object.keys(policies.repos) });
  const ingestFetch = new RunIngestFetch({ op, watermarks, ingest, projectIds: policies.openproject.projectIds, clock });

  await registerWorkers(
    boss,
    {
      triage: (ticketId) => runTriage.execute(ticketId),
      planning: (ticketId) => runPlanning.execute(ticketId),
    },
    log,
  );

  const app = createApp({
    queries: projection,
    ingestFetch,
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
      aiCredentialsMode: config.aiCredentialsMode,
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
