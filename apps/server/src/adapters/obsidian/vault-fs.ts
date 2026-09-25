import { randomUUID } from 'node:crypto';
import { mkdir, readdir, realpath, rename, writeFile } from 'node:fs/promises';
import { isAbsolute, relative, resolve } from 'node:path';

export class VaultPathEscapeError extends Error {
  override readonly name = 'VaultPathEscapeError';
  constructor(readonly attemptedPath: string) {
    super(`path escapes the Obsidian vault: ${attemptedPath}`);
  }
}

/**
 * Joins `vaultDir` + `relativePath` and rejects a result that would resolve outside the vault
 * (no absolute override, no `..` escape). Purely textual — does not touch the filesystem or
 * follow symlinks; pair with `assertRealpathInsideVault` for a path whose target already exists.
 */
export function insideVault(vaultDir: string, relativePath: string): string {
  const root = resolve(vaultDir);
  const candidate = resolve(root, relativePath);
  const rel = relative(root, candidate);
  if (rel !== '' && (rel.startsWith('..') || isAbsolute(rel))) throw new VaultPathEscapeError(relativePath);
  return candidate;
}

/**
 * Resolves an existing path's realpath and verifies it still lands inside the vault's realpath —
 * catches a symlink placed inside the vault (or the vault dir itself) that points elsewhere.
 */
export async function assertRealpathInsideVault(vaultDir: string, absolutePath: string): Promise<string> {
  const [realVault, realTarget] = await Promise.all([realpath(resolve(vaultDir)), realpath(absolutePath)]);
  const rel = relative(realVault, realTarget);
  if (rel !== '' && (rel.startsWith('..') || isAbsolute(rel))) throw new VaultPathEscapeError(absolutePath);
  return realTarget;
}

/**
 * Lists `*.md` basenames directly inside `dir` (non-recursive, alphabetical); `[]` if `dir` does
 * not exist. Includes symlinks (Obsidian vaults commonly use them) — pair with
 * `assertRealpathInsideVault` per file so a symlink pointing outside the vault is reported as an
 * error rather than silently skipped or, worse, silently followed.
 */
export async function listMarkdownFiles(dir: string): Promise<string[]> {
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    return entries
      .filter((e) => (e.isFile() || e.isSymbolicLink()) && e.name.toLowerCase().endsWith('.md'))
      .map((e) => e.name)
      .sort();
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw err;
  }
}

/** Ensures `dir` exists (`mkdir -p` semantics). */
export async function ensureDir(dir: string): Promise<void> {
  await mkdir(dir, { recursive: true });
}

/** Atomic write: writes a temp file in the same directory, then renames it over `path` (rename is atomic on the same filesystem). */
export async function writeFileAtomic(path: string, content: string): Promise<void> {
  const tmp = `${path}.tmp-${randomUUID()}`;
  await writeFile(tmp, content, 'utf8');
  await rename(tmp, path);
}
