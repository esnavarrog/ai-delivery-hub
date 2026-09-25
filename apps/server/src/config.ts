import { isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

const DEFAULT_POLICIES_DIR = fileURLToPath(new URL('../../../packages/policies/', import.meta.url));
const DEFAULT_WORKTREES_DIR = fileURLToPath(new URL('../../../.worktrees', import.meta.url));

const nonEmpty = z.string().trim().min(1);
const emptyToUndefined = (v: unknown) => (typeof v === 'string' && v.trim() === '' ? undefined : v);

/** A relative path that stays inside the vault: no absolute path, no `..` segment. */
function relativeVaultSubdir(defaultValue: string) {
  return z.preprocess(
    emptyToUndefined,
    nonEmpty
      .default(defaultValue)
      .refine(
        (p) => !isAbsolute(p) && !p.split(/[\\/]+/).some((segment) => segment === '..'),
        'must be a path relative to OBSIDIAN_VAULT_DIR, with no leading "/" and no ".." segment',
      ),
  );
}

export const Env = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  DATABASE_URL: nonEmpty.refine((u) => /^postgres(ql)?:\/\//.test(u), 'DATABASE_URL must be a postgres:// URL'),
  OP_BASE_URL: z.url({ protocol: /^https?$/ }),
  OP_API_KEY: nonEmpty,
  POLICIES_DIR: z.preprocess(emptyToUndefined, nonEmpty.default(DEFAULT_POLICIES_DIR)),
  PORT: z.preprocess(emptyToUndefined, z.coerce.number().int().min(1).max(65535).default(3000)),
  /** Root for bare mirrors and detached read-only worktrees used by planning runs. */
  WORKTREES_DIR: z.preprocess(emptyToUndefined, nonEmpty.default(DEFAULT_WORKTREES_DIR)),
  /** Optional explicit path to the Claude Code binary for the Agent SDK; defaults to the SDK's bundled lookup. */
  CLAUDE_CODE_PATH: z.preprocess(emptyToUndefined, nonEmpty.optional()),
  /** Public base URL of the web app, linked from a mirror note's frontmatter (no trailing slash). */
  HUB_PUBLIC_URL: z.preprocess(
    emptyToUndefined,
    z
      .url({ protocol: /^https?$/ })
      .default('http://localhost:5173')
      .transform((u) => u.replace(/\/+$/, '')),
  ),
  /** Obsidian vault root. Optional: without it, Fetch only pulls OpenProject and the mirror writer is disabled. */
  OBSIDIAN_VAULT_DIR: z.preprocess(emptyToUndefined, nonEmpty.optional()),
  /** Where manual-ticket inbox notes are read from, relative to OBSIDIAN_VAULT_DIR (PARA-friendly, configurable). */
  OBSIDIAN_INBOX_DIR: relativeVaultSubdir('hub/inbox'),
  /** Where the hub-managed ticket mirror notes live, relative to OBSIDIAN_VAULT_DIR. */
  OBSIDIAN_TICKETS_DIR: relativeVaultSubdir('hub/tickets'),
  /** Claude credentials for the model, if set explicitly (an empty string is treated as unset). */
  ANTHROPIC_API_KEY: z.preprocess(emptyToUndefined, nonEmpty.optional()),
  /**
   * How triage + planning authenticate to Claude: `auto` picks `api-key` when `ANTHROPIC_API_KEY`
   * is set, else `subscription`; `subscription` always uses the Claude Code CLI login; `api-key`
   * always requires `ANTHROPIC_API_KEY` (checked below, after zod parsing resolves the enum).
   */
  AI_CREDENTIALS: z.preprocess(emptyToUndefined, z.enum(['auto', 'subscription', 'api-key']).default('auto')),
});
export type EnvConfig = z.infer<typeof Env>;

/** What the server actually runs with, once `auto` has been resolved against `ANTHROPIC_API_KEY`. */
export type ResolvedAiCredentialsMode = 'subscription' | 'api-key';
export type Config = EnvConfig & { aiCredentialsMode: ResolvedAiCredentialsMode };

export class ConfigError extends Error {
  override readonly name = 'ConfigError';
}

/** Pure: `auto` follows whether a non-empty API key is present; an explicit mode is returned as-is. */
export function resolveAiCredentialsMode(mode: EnvConfig['AI_CREDENTIALS'], apiKey: string | undefined): ResolvedAiCredentialsMode {
  if (mode !== 'auto') return mode;
  return apiKey && apiKey.length > 0 ? 'api-key' : 'subscription';
}

/**
 * Pure: true when the caller should warn that the developer's personal Claude Code login is in
 * use — only for the implicit `auto` fallback, and never in production (production refuses to
 * start in subscription mode at all, so there is nothing to warn about there).
 */
export function shouldWarnOnSubscriptionFallback(config: Pick<Config, 'NODE_ENV' | 'AI_CREDENTIALS' | 'aiCredentialsMode'>): boolean {
  return config.NODE_ENV !== 'production' && config.AI_CREDENTIALS === 'auto' && config.aiCredentialsMode === 'subscription';
}

/** Validates the process environment; secrets never leave this object as strings in logs. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = Env.safeParse(env);
  if (!parsed.success) throw new ConfigError(`invalid environment:\n${z.prettifyError(parsed.error)}`);
  const aiCredentialsMode = resolveAiCredentialsMode(parsed.data.AI_CREDENTIALS, parsed.data.ANTHROPIC_API_KEY);
  if (aiCredentialsMode === 'api-key' && !parsed.data.ANTHROPIC_API_KEY) {
    throw new ConfigError('AI_CREDENTIALS=api-key requires a non-empty ANTHROPIC_API_KEY to be set');
  }
  if (parsed.data.NODE_ENV === 'production' && aiCredentialsMode !== 'api-key') {
    throw new ConfigError(
      `AI_CREDENTIALS must resolve to api-key when NODE_ENV=production (got AI_CREDENTIALS=${parsed.data.AI_CREDENTIALS}, which resolved to ${aiCredentialsMode}); ` +
        'set ANTHROPIC_API_KEY and AI_CREDENTIALS=api-key (or leave AI_CREDENTIALS=auto with the key set) — the Claude Code subscription login is for personal/dev use only',
    );
  }
  return { ...parsed.data, aiCredentialsMode };
}
