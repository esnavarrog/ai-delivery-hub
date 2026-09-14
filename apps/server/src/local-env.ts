import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/** Loads the repo-root `.env` for local development only; production reads the real environment. */
export function loadLocalEnv(): void {
  if (process.env['NODE_ENV'] === 'production') return;
  const envPath = fileURLToPath(new URL('../../../.env', import.meta.url));
  if (!existsSync(envPath)) return;
  process.loadEnvFile?.(envPath);
}
