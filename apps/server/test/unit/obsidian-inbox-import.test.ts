import { mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ImportObsidianInbox } from '../../src/modules/ingest/obsidian-inbox-import.js';
import type { ManualKeySequence, ManualTicketInput } from '../../src/modules/ingest/manual-ticket.js';
import { ensureDir } from '../../src/adapters/obsidian/vault-fs.js';

class SequentialManualKeys implements ManualKeySequence {
  private n = 0;
  async next(): Promise<string> {
    this.n += 1;
    return `M-${String(this.n).padStart(4, '0')}`;
  }
}

interface Created {
  input: ManualTicketInput;
  presetKey?: string | undefined;
}

let vaultDir: string;

beforeEach(async () => {
  vaultDir = await mkdtemp(join(tmpdir(), 'hub-vault-'));
  await ensureDir(join(vaultDir, 'hub/inbox'));
});

afterEach(async () => {
  await rm(vaultDir, { recursive: true, force: true });
});

function harness() {
  const created: Created[] = [];
  const createTicket = {
    execute: async (input: ManualTicketInput, presetKey?: string) => {
      created.push({ input, presetKey });
      return { ticketId: `ticket-${created.length}`, key: presetKey! };
    },
  };
  const importer = new ImportObsidianInbox({
    vaultDir,
    inboxDir: 'hub/inbox',
    ticketsDir: 'hub/tickets',
    keys: new SequentialManualKeys(),
    createTicket,
  });
  return { importer, created };
}

const note = (fm: string, body: string) => `---\n${fm}\n---\n\n${body}\n`;

describe('ImportObsidianInbox', () => {
  it('imports a valid note: moves it to <ticketsDir>/<key>.md and creates the ticket with the preset key', async () => {
    await writeFile(join(vaultDir, 'hub/inbox/coffee.md'), note('title: Fix the coffee machine\npriority: low\ntags: [facilities]', 'It leaks.'));
    const { importer, created } = harness();

    const summary = await importer.importInbox();
    expect(summary).toEqual({ imported: 1, skipped: 0, errors: [] });

    expect(await readdir(join(vaultDir, 'hub/inbox'))).toEqual([]);
    const moved = await readFile(join(vaultDir, 'hub/tickets/M-0001.md'), 'utf8');
    expect(moved).toContain('It leaks.');

    expect(created).toEqual([{ input: { title: 'Fix the coffee machine', description: 'It leaks.', priority: 'low', tags: ['facilities'] }, presetKey: 'M-0001' }]);
  });

  it('folds an optional repo hint into the description and omits it from the ticket title', async () => {
    await writeFile(join(vaultDir, 'hub/inbox/x.md'), note('title: Add refund endpoint\nrepo: backend-parkingapp', 'Body text.'));
    const { importer, created } = harness();
    await importer.importInbox();
    expect(created[0]?.input.description).toBe('Repo hint: backend-parkingapp\n\nBody text.');
  });

  it('reports an invalid note (missing title) in the summary and leaves it in place', async () => {
    await writeFile(join(vaultDir, 'hub/inbox/bad.md'), note('priority: low', 'No title here.'));
    const { importer, created } = harness();

    const summary = await importer.importInbox();
    expect(summary.imported).toBe(0);
    expect(summary.skipped).toBe(1);
    expect(summary.errors).toHaveLength(1);
    expect(summary.errors[0]?.file).toBe('bad.md');
    expect(created).toEqual([]);

    expect(await readdir(join(vaultDir, 'hub/inbox'))).toEqual(['bad.md']);
    await expect(readdir(join(vaultDir, 'hub/tickets'))).rejects.toThrow();
  });

  it('processes multiple notes in sorted order with incrementing keys, one bad note does not block the rest', async () => {
    await writeFile(join(vaultDir, 'hub/inbox/a-bad.md'), note('nope: x', 'no title'));
    await writeFile(join(vaultDir, 'hub/inbox/b-good.md'), note('title: Second', ''));
    await writeFile(join(vaultDir, 'hub/inbox/c-good.md'), note('title: Third', ''));
    const { importer, created } = harness();

    const summary = await importer.importInbox();
    expect(summary).toMatchObject({ imported: 2, skipped: 1 });
    expect(created.map((c) => c.presetKey)).toEqual(['M-0001', 'M-0002']);
  });

  it('reports a note whose YAML frontmatter is malformed, without crashing the whole pass', async () => {
    await writeFile(join(vaultDir, 'hub/inbox/broken.md'), '---\ntitle: "unterminated\n---\nbody');
    const { importer } = harness();
    const summary = await importer.importInbox();
    expect(summary.skipped).toBe(1);
    expect(summary.errors[0]?.file).toBe('broken.md');
  });

  it('reports a symlink inside the inbox that escapes the vault, instead of following it', async () => {
    const outside = await mkdtemp(join(tmpdir(), 'hub-outside-'));
    await writeFile(join(outside, 'secret.md'), note('title: leaked', 'x'));
    await symlink(join(outside, 'secret.md'), join(vaultDir, 'hub/inbox/link.md'));
    const { importer, created } = harness();

    const summary = await importer.importInbox();
    expect(summary.imported).toBe(0);
    expect(summary.skipped).toBe(1);
    expect(created).toEqual([]);
    await rm(outside, { recursive: true, force: true });
  });

  it('rolls the note back to the inbox if ticket creation fails after the move', async () => {
    await writeFile(join(vaultDir, 'hub/inbox/x.md'), note('title: Will fail', ''));
    const importer = new ImportObsidianInbox({
      vaultDir,
      inboxDir: 'hub/inbox',
      ticketsDir: 'hub/tickets',
      keys: new SequentialManualKeys(),
      createTicket: { execute: async () => { throw new Error('db down'); } },
    });
    const summary = await importer.importInbox();
    expect(summary).toMatchObject({ imported: 0, skipped: 1 });
    expect(await readdir(join(vaultDir, 'hub/inbox'))).toEqual(['x.md']);
  });

  it('returns an empty summary when the inbox directory does not exist', async () => {
    await rm(join(vaultDir, 'hub/inbox'), { recursive: true, force: true });
    const { importer } = harness();
    expect(await importer.importInbox()).toEqual({ imported: 0, skipped: 0, errors: [] });
  });
});
