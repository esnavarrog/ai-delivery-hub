import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { access, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import type { RepoIntelPort } from '@ai-delivery-hub/domain';

const execFileAsync = promisify(execFile);

export interface AcquiredWorktree {
  /** Absolute path of the detached, read-only checkout. */
  path: string;
  /** Commit the checkout is at (40-char sha). */
  headSha: string;
  release(): Promise<void>;
}

export interface RepoWorktreePort {
  acquireReadOnly(repo: string): Promise<AcquiredWorktree>;
}

export interface WorktreeRepoConfig {
  remote: string;
  defaultBranch: string;
}

export interface GitWorktreeAdapterOptions {
  /** Root for `mirrors/<repo>.git` and `worktrees/<repo>-<id>`; created on demand. */
  dir: string;
  repos: Record<string, WorktreeRepoConfig>;
  /** Command runner, injectable for tests. */
  exec?: (file: string, args: string[], cwd?: string) => Promise<string>;
}

export class UnknownRepoError extends Error {
  override readonly name = 'UnknownRepoError';
  constructor(readonly repo: string) {
    super(`repository "${repo}" is not configured in repos.yaml`);
  }
}

const GIT_ENV = { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0' };

async function defaultExec(file: string, args: string[], cwd?: string): Promise<string> {
  const { stdout } = await execFileAsync(file, args, { cwd, env: GIT_ENV, maxBuffer: 16 * 1024 * 1024 });
  return stdout.trim();
}

/**
 * Keeps one bare mirror per repository and hands out detached, read-only worktrees for planning.
 * Mirrors map remote branches onto `refs/heads/*`, so the default branch is resolved as
 * `refs/heads/<defaultBranch>` after `git fetch`. Nothing here ever writes inside a worktree.
 */
export class GitWorktreeAdapter implements RepoIntelPort, RepoWorktreePort {
  private readonly exec: NonNullable<GitWorktreeAdapterOptions['exec']>;
  private readonly locks = new Map<string, Promise<unknown>>();

  constructor(private readonly options: GitWorktreeAdapterOptions) {
    this.exec = options.exec ?? defaultExec;
  }

  async acquireReadOnly(repo: string): Promise<AcquiredWorktree> {
    const config = this.repoConfig(repo);
    const mirror = await this.syncMirror(repo, config);
    const headSha = await this.git(mirror, 'rev-parse', `refs/heads/${config.defaultBranch}`);
    const worktreesDir = join(this.options.dir, 'worktrees');
    await mkdir(worktreesDir, { recursive: true });
    const path = join(worktreesDir, `${repo}-${randomUUID()}`);
    await this.serialized(repo, () => this.git(mirror, 'worktree', 'add', '--detach', path, headSha));
    await this.exec('chmod', ['-R', 'a-w', path]).catch(() => undefined);
    return {
      path,
      headSha,
      release: async () => {
        await this.exec('chmod', ['-R', 'u+w', path]).catch(() => undefined);
        await this.serialized(repo, () => this.git(mirror, 'worktree', 'remove', '--force', path)).catch(() => undefined);
        await rm(path, { recursive: true, force: true });
        await this.serialized(repo, () => this.git(mirror, 'worktree', 'prune')).catch(() => undefined);
      },
    };
  }

  async headSha(repo: string, branch: string): Promise<string> {
    const mirror = await this.syncMirror(repo, this.repoConfig(repo));
    return this.git(mirror, 'rev-parse', `refs/heads/${branch}`);
  }

  async filesChangedSince(repo: string, sha: string, branch: string): Promise<string[]> {
    const mirror = await this.syncMirror(repo, this.repoConfig(repo));
    const out = await this.git(mirror, 'diff', '--name-only', sha, `refs/heads/${branch}`);
    return out.length === 0 ? [] : out.split('\n');
  }

  private repoConfig(repo: string): WorktreeRepoConfig {
    const config = this.options.repos[repo];
    if (!config) throw new UnknownRepoError(repo);
    return config;
  }

  /** Clones the mirror on first use, fetches otherwise; one git process per repo at a time. */
  private syncMirror(repo: string, config: WorktreeRepoConfig): Promise<string> {
    return this.serialized(repo, async () => {
      const mirrorsDir = join(this.options.dir, 'mirrors');
      const mirror = join(mirrorsDir, `${repo}.git`);
      await mkdir(mirrorsDir, { recursive: true });
      const exists = await access(join(mirror, 'HEAD')).then(
        () => true,
        () => false,
      );
      if (exists) await this.git(mirror, 'fetch', '--prune', '--quiet', 'origin');
      else await this.exec('git', ['clone', '--mirror', '--quiet', config.remote, mirror]);
      return mirror;
    });
  }

  private serialized<T>(repo: string, task: () => Promise<T>): Promise<T> {
    const previous = this.locks.get(repo) ?? Promise.resolve();
    const next = previous.then(task, task);
    this.locks.set(repo, next.catch(() => undefined));
    return next;
  }

  private git(cwd: string, ...args: string[]): Promise<string> {
    return this.exec('git', args, cwd);
  }
}
