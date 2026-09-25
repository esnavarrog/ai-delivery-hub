import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { TicketSnapshot } from '@ai-delivery-hub/domain';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMirrorAfterAppend } from '../../src/modules/sync/mirror.js';
import { ensureDir } from '../../src/adapters/obsidian/vault-fs.js';
import { MIRROR_MARKER } from '../../src/adapters/obsidian/mirror-note.js';

let vaultDir: string;

beforeEach(async () => {
  vaultDir = await mkdtemp(join(tmpdir(), 'hub-vault-'));
});

afterEach(async () => {
  await rm(vaultDir, { recursive: true, force: true });
});

const snapshot = (overrides: Partial<TicketSnapshot> = {}): TicketSnapshot =>
  ({
    id: 't-1',
    source: { kind: 'openproject', workPackageId: 4711, projectId: 15, lockVersion: 1 },
    displayKey: 'OP-4711',
    subject: 'Login fails without cookie',
    state: 'plan_review',
    flags: [],
    priority: 'normal',
    planVersionCount: 0,
    unresolvedCommentCount: 0,
    createdAt: '2026-09-24T09:00:00.000Z',
    updatedAt: '2026-09-24T10:00:00.000Z',
    ...overrides,
  }) as TicketSnapshot;

function harness() {
  const warnings: Array<{ msg: string; meta: Record<string, unknown> | undefined }> = [];
  const hook = createMirrorAfterAppend({ vaultDir, ticketsDir: 'hub/tickets', hubPublicUrl: 'http://localhost:5173' }, { warn: (msg, meta) => warnings.push({ msg, meta }) });
  return { hook, warnings };
}

describe('createMirrorAfterAppend', () => {
  it('writes a fresh mirror note with hub-owned frontmatter and an empty body when none existed', async () => {
    const { hook } = harness();
    await hook([], snapshot());
    const content = await readFile(join(vaultDir, 'hub/tickets/OP-4711.md'), 'utf8');
    expect(content).toContain('key: OP-4711');
    expect(content).toContain('source: openproject');
    expect(content).toContain('state: plan_review');
    expect(content).toContain('hubUrl: http://localhost:5173/tickets/t-1');
    expect(content.endsWith(`${MIRROR_MARKER}\n`)).toBe(true);
  });

  it('preserves an existing mirror note body across an update, refreshing only the frontmatter', async () => {
    const { hook } = harness();
    await hook([], snapshot({ state: 'plan_review' }));
    await ensureDir(join(vaultDir, 'hub/tickets'));
    const path = join(vaultDir, 'hub/tickets/OP-4711.md');
    const original = await readFile(path, 'utf8');
    await writeFile(path, `${original}My own notes.\n- todo item\n`);

    await hook([], snapshot({ state: 'plan_approved', riskTier: 'high', targetRepo: 'backend-parkingapp' }));
    const updated = await readFile(path, 'utf8');
    expect(updated).toContain('state: plan_approved');
    expect(updated).toContain('riskTier: high');
    expect(updated).toContain('targetRepo: backend-parkingapp');
    expect(updated).toContain('My own notes.\n- todo item\n');
  });

  it('preserves the original note body when it moved in as a raw (pre-mirror) note, e.g. from the Obsidian import', async () => {
    const { hook } = harness();
    await ensureDir(join(vaultDir, 'hub/tickets'));
    await writeFile(join(vaultDir, 'hub/tickets/M-0001.md'), '---\ntitle: Fix the coffee machine\npriority: low\n---\n\nIt leaks from the side.\n');

    await hook([], snapshot({ id: 't-2', source: { kind: 'manual', key: 'M-0001' }, displayKey: 'M-0001' }));
    const content = await readFile(join(vaultDir, 'hub/tickets/M-0001.md'), 'utf8');
    expect(content).toContain('source: manual');
    expect(content).toContain('key: M-0001');
    expect(content).toContain('It leaks from the side.\n');
    expect(content).not.toContain('priority: low');
  });

  it('logs a warning and never throws when the write fails', async () => {
    // A file where the tickets directory should be forces ensureDir/mkdir to fail with ENOTDIR.
    await writeFile(join(vaultDir, 'hub'), 'not a directory');
    const hook = createMirrorAfterAppend({ vaultDir, ticketsDir: 'hub/tickets', hubPublicUrl: 'http://localhost:5173' }, { warn: vi.fn() });
    await expect(hook([], snapshot())).resolves.toBeUndefined();
  });

  it('reports the failure through the injected logger', async () => {
    await writeFile(join(vaultDir, 'hub'), 'not a directory');
    const { hook, warnings } = harness();
    await hook([], snapshot());
    expect(warnings).toHaveLength(1);
    expect(warnings[0]?.msg).toMatch(/mirror write failed/);
    expect(warnings[0]?.meta).toMatchObject({ ticketId: 't-1', displayKey: 'OP-4711' });
  });
});
