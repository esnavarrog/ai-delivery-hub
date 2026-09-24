/**
 * Manual smoke test for `ClaudeCodeTriageRunner` against the REAL Agent SDK, in subscription
 * mode. Runs ONE triage call for a tiny synthetic ticket using the real `packages/policies`
 * config, then prints the resulting `RunResult` (status, reason, usage, cost).
 *
 * This talks to Claude for real (through the developer's logged-in Claude Code session) and
 * must never run as part of `pnpm test` — there is no `*.test.ts` here on purpose; run it
 * explicitly with `pnpm --filter @ai-delivery-hub/server smoke:triage`.
 *
 * Requires: the developer is already logged in (`claude` works interactively) and
 * ANTHROPIC_API_KEY is unset in the shell — `stripApiKeyEnv: true` also strips it from the
 * child process regardless, so a key left in the shell does not silently switch this to API
 * billing, but an unset key makes the intent unambiguous when reading the output below.
 */
import { fileURLToPath } from 'node:url';
import { wrapUntrusted, type TicketSnapshot } from '@ai-delivery-hub/domain';
import { loadPolicies } from '@ai-delivery-hub/policies';
import { ClaudeCodeTriageRunner } from '../src/adapters/agent/claude-code-triage-runner.js';
import { loadLocalEnv } from '../src/local-env.js';

loadLocalEnv();

const policiesDir = process.env['POLICIES_DIR'] || fileURLToPath(new URL('../../../packages/policies/', import.meta.url));
const policies = await loadPolicies(policiesDir);

console.log(
  JSON.stringify({
    smoke: 'triage',
    anthropicApiKeyInShell: Boolean(process.env['ANTHROPIC_API_KEY']),
    note: 'stripApiKeyEnv strips it from the child process regardless of the value above',
    model: policies.models.triage,
    effort: policies.models.effort.triage,
    budget: policies.budgets.triage,
  }),
);

const now = new Date().toISOString();
const ticket: TicketSnapshot = {
  id: 'smoke-ticket-1',
  opWorkPackageId: 999_999,
  opProjectId: 1,
  opLockVersion: 0,
  subject: 'Smoke test: typo in README',
  state: 'triaging',
  flags: [],
  priority: 'low',
  planVersionCount: 0,
  unresolvedCommentCount: 0,
  createdAt: now,
  updatedAt: now,
};

const untrustedContext = wrapUntrusted(
  'ticket',
  [
    `Subject: ${ticket.subject}`,
    'Type: bug',
    'OpenProject status: New',
    `Priority: ${ticket.priority}`,
    `OpenProject project id: ${ticket.opProjectId}`,
    `Work package: #${ticket.opWorkPackageId}`,
    '',
    'Description:',
    'README.md says "recieve" instead of "receive" in the Getting started section. Fix the typo.',
  ].join('\n'),
);

const runner = new ClaudeCodeTriageRunner({
  model: policies.models.triage,
  effort: policies.models.effort.triage,
  policies,
  stripApiKeyEnv: true,
});

const startedAt = Date.now();
const result = await runner.runTriage({
  runId: 'smoke-run-1',
  ticket,
  untrustedContext,
  budget: policies.budgets.triage,
  allowedRepos: Object.keys(policies.repos),
});

console.log(JSON.stringify({ smoke: 'triage', wallClockMs: Date.now() - startedAt, result }, null, 2));
process.exit(result.ok ? 0 : 1);
