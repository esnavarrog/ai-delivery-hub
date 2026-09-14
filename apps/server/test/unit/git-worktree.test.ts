import { execFile } from 'node:child_process';
import { access, constants, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { GitWorktreeAdapter } from '../../src/adapters/repo/git-worktree.js';

const run = promisify(execFile);
const git = async (cwd: string, ...args: string[]) => (await run('git', args, { cwd, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } })).stdout.trim();

async function commit(repo: string, file: string, content: string, message: string): Promise<string> {
  await writeFile(join(repo, file), content);
  await git(repo, 'add', file);
  await git(repo, '-c', 'user.email=t@example.com', '-c', 'user.name=t', 'commit', '-q', '-m', message);
  return git(repo, 'rev-parse', 'HEAD');
}

describe('GitWorktreeAdapter (local temp remote, no network)', () => {
  let root: string;
  let remote: string;
  let firstSha: string;
  let adapter: GitWorktreeAdapter;

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'hub-worktrees-'));
    remote = join(root, 'remote');
    await run('git', ['init', '-q', '-b', 'develop', remote]);
    firstSha = await commit(remote, 'README.md', '# demo\n', 'init');
    adapter = new GitWorktreeAdapter({
      dir: join(root, 'store'),
      repos: { demo: { remote, defaultBranch: 'develop' } },
    });
  });

  afterAll(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('acquires a detached read-only worktree at the default branch head and releases it', async () => {
    const wt = await adapter.acquireReadOnly('demo');
    expect(wt.headSha).toBe(firstSha);
    expect(wt.path.startsWith(join(root, 'store'))).toBe(true);
    expect(await readFile(join(wt.path, 'README.md'), 'utf8')).toBe('# demo\n');
    expect(await git(wt.path, 'rev-parse', 'HEAD')).toBe(firstSha);
    expect(await git(wt.path, 'symbolic-ref', '-q', 'HEAD').catch(() => 'detached')).toBe('detached');
    // best-effort read-only: no write bits on files
    const mode = (await stat(join(wt.path, 'README.md'))).mode & 0o222;
    expect(mode).toBe(0);
    await expect(access(join(wt.path, 'README.md'), constants.W_OK)).rejects.toThrow();

    await wt.release();
    await expect(stat(wt.path)).rejects.toThrow();
    const list = await git(join(root, 'store', 'mirrors', 'demo.git'), 'worktree', 'list', '--porcelain');
    expect(list).not.toContain(wt.path);
  });

  it('fetches before use so a new remote commit is visible, and answers RepoIntelPort questions', async () => {
    const secondSha = await commit(remote, 'new.txt', 'hello\n', 'add new file');
    expect(await adapter.headSha('demo', 'develop')).toBe(secondSha);
    expect(await adapter.filesChangedSince('demo', firstSha, 'develop')).toEqual(['new.txt']);
    expect(await adapter.filesChangedSince('demo', secondSha, 'develop')).toEqual([]);

    const wt = await adapter.acquireReadOnly('demo');
    expect(wt.headSha).toBe(secondSha);
    expect(await readFile(join(wt.path, 'new.txt'), 'utf8')).toBe('hello\n');
    await wt.release();
  });

  it('gives every acquisition its own directory', async () => {
    const [a, b] = await Promise.all([adapter.acquireReadOnly('demo'), adapter.acquireReadOnly('demo')]);
    expect(a.path).not.toBe(b.path);
    await Promise.all([a.release(), b.release()]);
  });

  it('rejects repositories that are not in the policies', async () => {
    await expect(adapter.acquireReadOnly('unknown')).rejects.toThrow(/unknown/);
    await expect(adapter.headSha('unknown', 'main')).rejects.toThrow(/unknown/);
  });
});
