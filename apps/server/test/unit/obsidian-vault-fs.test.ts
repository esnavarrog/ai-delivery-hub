import { mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { assertRealpathInsideVault, ensureDir, insideVault, listMarkdownFiles, VaultPathEscapeError, writeFileAtomic } from '../../src/adapters/obsidian/vault-fs.js';

let vaultDir: string;

beforeEach(async () => {
  vaultDir = await mkdtemp(join(tmpdir(), 'hub-vault-'));
});

afterEach(async () => {
  await rm(vaultDir, { recursive: true, force: true });
});

describe('insideVault', () => {
  it('joins a relative path under the vault', () => {
    expect(insideVault(vaultDir, 'hub/inbox')).toBe(join(vaultDir, 'hub/inbox'));
  });

  it('rejects an absolute path and a ".." escape', () => {
    expect(() => insideVault(vaultDir, '/etc/passwd')).toThrow(VaultPathEscapeError);
    expect(() => insideVault(vaultDir, '../outside')).toThrow(VaultPathEscapeError);
    expect(() => insideVault(vaultDir, 'ok/../../escape')).toThrow(VaultPathEscapeError);
  });
});

describe('assertRealpathInsideVault', () => {
  it('accepts a real file inside the vault', async () => {
    const file = join(vaultDir, 'note.md');
    await writeFile(file, 'x');
    await expect(assertRealpathInsideVault(vaultDir, file)).resolves.toContain('note.md');
  });

  it('rejects a symlink inside the vault that points outside it', async () => {
    const outside = await mkdtemp(join(tmpdir(), 'hub-outside-'));
    const target = join(outside, 'secret.md');
    await writeFile(target, 'x');
    const link = join(vaultDir, 'escape.md');
    await symlink(target, link);
    await expect(assertRealpathInsideVault(vaultDir, link)).rejects.toBeInstanceOf(VaultPathEscapeError);
    await rm(outside, { recursive: true, force: true });
  });
});

describe('listMarkdownFiles', () => {
  it('lists only *.md files, sorted, and returns [] for a missing directory', async () => {
    const dir = join(vaultDir, 'hub/inbox');
    await ensureDir(dir);
    await writeFile(join(dir, 'b.md'), '');
    await writeFile(join(dir, 'a.md'), '');
    await writeFile(join(dir, 'notes.txt'), '');
    expect(await listMarkdownFiles(dir)).toEqual(['a.md', 'b.md']);
    expect(await listMarkdownFiles(join(vaultDir, 'missing'))).toEqual([]);
  });
});

describe('writeFileAtomic', () => {
  it('writes the final content with no leftover temp file', async () => {
    const dir = join(vaultDir, 'hub/tickets');
    await ensureDir(dir);
    const file = join(dir, 'M-0001.md');
    await writeFileAtomic(file, 'hello');
    expect(await readFile(file, 'utf8')).toBe('hello');
    const leftovers = await listMarkdownFiles(dir);
    expect(leftovers).toEqual(['M-0001.md']);
  });
});
