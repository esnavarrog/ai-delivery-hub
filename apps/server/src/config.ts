import { fileURLToPath } from 'node:url';
import { z } from 'zod';

const DEFAULT_POLICIES_DIR = fileURLToPath(new URL('../../../packages/policies/', import.meta.url));
const DEFAULT_WORKTREES_DIR = fileURLToPath(new URL('../../../.worktrees', import.meta.url));

const nonEmpty = z.string().trim().min(1);
const emptyToUndefined = (v: unknown) => (typeof v === 'string' && v.trim() === '' ? undefined : v);

export const Env = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  DATABASE_URL: nonEmpty.refine((u) => /^postgres(ql)?:\/\//.test(u), 'DATABASE_URL must be a postgres:// URL'),
  OP_BASE_URL: z.url({ protocol: /^https?$/ }),
  OP_API_KEY: nonEmpty,
  OP_WEBHOOK_SECRET: nonEmpty.min(16, 'OP_WEBHOOK_SECRET must be at least 16 characters'),
  POLICIES_DIR: z.preprocess(emptyToUndefined, nonEmpty.default(DEFAULT_POLICIES_DIR)),
  PORT: z.preprocess(emptyToUndefined, z.coerce.number().int().min(1).max(65535).default(3000)),
  POLL_INTERVAL_MS: z.preprocess(emptyToUndefined, z.coerce.number().int().min(1000).default(120_000)),
  /** Root for bare mirrors and detached read-only worktrees used by planning runs. */
  WORKTREES_DIR: z.preprocess(emptyToUndefined, nonEmpty.default(DEFAULT_WORKTREES_DIR)),
  /** Public base URL of the web app, used in OpenProject comments (no trailing slash). */
  HUB_PUBLIC_URL: z.preprocess(
    emptyToUndefined,
    z
      .url({ protocol: /^https?$/ })
      .default('http://localhost:5173')
      .transform((u) => u.replace(/\/+$/, '')),
  ),
  /** Optional explicit path to the Claude Code binary for the Agent SDK; defaults to the SDK's bundled lookup. */
  CLAUDE_CODE_PATH: z.preprocess(emptyToUndefined, nonEmpty.optional()),
});
export type Config = z.infer<typeof Env>;

export class ConfigError extends Error {
  override readonly name = 'ConfigError';
}

/** Validates the process environment; secrets never leave this object as strings in logs. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = Env.safeParse(env);
  if (!parsed.success) throw new ConfigError(`invalid environment:\n${z.prettifyError(parsed.error)}`);
  return parsed.data;
}
