import { mkdtemp, rm, writeFile, cp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadPolicies, PoliciesError, riskTierForPaths, STEP_NAMES, type RiskPathRule } from '../src/index.js';

const packageRoot = resolve(import.meta.dirname, '..');

async function copyPoliciesWith(overrides: Record<string, string>): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'policies-'));
  for (const file of ['repos.yaml', 'risk-paths.yaml', 'pillars.md', 'conventions.md', 'security.md']) {
    await cp(join(packageRoot, file), join(dir, file));
  }
  await cp(join(packageRoot, 'steps'), join(dir, 'steps'), { recursive: true });
  for (const [file, content] of Object.entries(overrides)) await writeFile(join(dir, file), content);
  return dir;
}

describe('loadPolicies', () => {
  it('loads the seed policies shipped with the package', async () => {
    const policies = await loadPolicies(packageRoot);
    expect(Object.keys(policies.repos)).toEqual(['backend-parkingapp', 'libredte-api']);
    expect(policies.repos['backend-parkingapp']).toEqual({
      remote: 'git@github.com-redcomercio:Redcomercio/backend-parkingapp.git',
      defaultBranch: 'develop',
      testCommand: 'bundle exec rspec',
      stack: 'rails',
      branchPattern: '{wpId}-{slug}',
    });
    expect(policies.models.triage).toBe('claude-opus-5');
    expect(policies.models.planning.high).toBe('claude-opus-5');
    expect(policies.models.effort).toEqual({ triage: 'low', planning: 'high' });
    expect(policies.budgets.triage).toEqual({ maxTokens: 40_000, maxDurationMs: 180_000 });
    expect(policies.budgets.planning).toEqual({ maxTokens: 150_000, maxDurationMs: 600_000, maxTurns: 40 });
    expect(policies.openproject.projectIds).toEqual([15, 6]);
    expect(policies.openproject.trigger).toEqual({
      kind: 'status_or_prefix',
      statusName: 'Ready for AI',
      subjectPrefix: '[AI]',
    });
    expect(policies.roles['Macstban']).toBe('admin');
    expect(policies.riskPaths.length).toBeGreaterThan(5);
    expect(policies.docs.pillars).toContain('DRAFT');
    expect(policies.docs.conventions).toContain('Conventional commits');
    expect(policies.docs.security).toContain('PII');
    expect(Object.keys(policies.docs.steps).sort()).toEqual([...STEP_NAMES].sort());
    expect(policies.docs.steps.triage).toContain('# Step: Triage');
    expect(policies.docs.steps.planning).toContain('# Step: Planning');
    expect(policies.docs.steps.implement).toContain('# Step: Implement');
    expect(policies.docs.steps.review).toContain('# Step: Review');
    expect(policies.docs.steps.qa).toContain('# Step: QA');
    expect(policies.docs.steps.release).toContain('# Step: Release');
  });

  it('fails with a readable PoliciesError when a step doc is missing', async () => {
    const dir = await copyPoliciesWith({});
    await rm(join(dir, 'steps', 'qa.md'));
    await expect(loadPolicies(dir)).rejects.toBeInstanceOf(PoliciesError);
    await expect(loadPolicies(dir)).rejects.toThrow(/steps\/qa\.md/);
  });

  it('fails with a readable error when a repo field is missing', async () => {
    const dir = await copyPoliciesWith({
      'repos.yaml': `
repos:
  broken:
    remote: git@example.com:x/y.git
    defaultBranch: main
    stack: rails
    branchPattern: "{slug}"
models: { triage: m, planning: { low: m, medium: m, high: m } }
budgets:
  triage: { maxTokens: 1, maxDurationMs: 1 }
  planning: { maxTokens: 1, maxDurationMs: 1 }
openproject:
  projectIds: [1]
  trigger: { kind: prefix, subjectPrefix: "[AI]" }
roles: {}
`,
    });
    await expect(loadPolicies(dir)).rejects.toBeInstanceOf(PoliciesError);
    await expect(loadPolicies(dir)).rejects.toThrow(/repos\.broken\.testCommand/);
  });

  it('defaults effort to low/high when models.effort is omitted and rejects unknown levels', async () => {
    const raw = await loadRawRepos();
    const noEffort = raw.replace(/  # output_config\.effort[^\n]*\n  effort:\n    triage: low\n    planning: high\n/, '');
    expect(noEffort).not.toContain('effort:');
    const policies = await loadPolicies(await copyPoliciesWith({ 'repos.yaml': noEffort }));
    expect(policies.models.effort).toEqual({ triage: 'low', planning: 'high' });
    await expect(loadPolicies(await copyPoliciesWith({ 'repos.yaml': raw.replace('triage: low', 'triage: extreme') }))).rejects.toThrow(/effort/);
  });

  it('rejects a status trigger without a status name', async () => {
    const dir = await copyPoliciesWith({
      'repos.yaml': (await loadRawRepos()).replace('    statusName: Ready for AI\n', ''),
    });
    await expect(loadPolicies(dir)).rejects.toThrow(/statusName/);
  });

});

async function loadRawRepos(): Promise<string> {
  const { readFile } = await import('node:fs/promises');
  return readFile(join(packageRoot, 'repos.yaml'), 'utf8');
}

describe('riskTierForPaths', () => {
  const rules: RiskPathRule[] = [
    { glob: '**/auth/**', tier: 'high' },
    { glob: 'db/migrate/**', tier: 'medium' },
    { glob: '**/models/client*', tier: 'high' },
  ];

  it('returns low when nothing matches', () => {
    expect(riskTierForPaths(rules, ['app/controllers/home_controller.rb'])).toBe('low');
    expect(riskTierForPaths(rules, [])).toBe('low');
  });

  it('picks the highest tier among matched paths', () => {
    expect(riskTierForPaths(rules, ['db/migrate/2026_add_x.rb', 'README.md'])).toBe('medium');
    expect(riskTierForPaths(rules, ['db/migrate/2026_add_x.rb', 'app/services/auth/token.rb'])).toBe('high');
    expect(riskTierForPaths(rules, ['app/models/client_card.rb'])).toBe('high');
  });

  it('is exposed bound to the loaded rules', async () => {
    const policies = await loadPolicies(packageRoot);
    expect(policies.riskTierForPaths(['config/credentials.yml.enc'])).toBe('high');
    expect(policies.riskTierForPaths(['app/controllers/api/v2/things_controller.rb'])).toBe('medium');
    expect(policies.riskTierForPaths(['lib/util.rb'])).toBe('low');
  });
});
