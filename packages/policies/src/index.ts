import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { RiskTier } from '@ai-delivery-hub/domain';
import { parse } from 'yaml';
import { z } from 'zod';
import { ReposFile, RiskPathsFile, type RiskPathRule } from './schema.js';
import { riskTierForPaths } from './risk.js';

export * from './schema.js';
export { riskTierForPaths } from './risk.js';

export class PoliciesError extends Error {
  override readonly name = 'PoliciesError';
  constructor(
    readonly file: string,
    message: string,
  ) {
    super(`${file}: ${message}`);
  }
}

export interface PolicyDocs {
  pillars: string;
  conventions: string;
  security: string;
}

export interface Policies extends ReposFile {
  riskPaths: RiskPathRule[];
  docs: PolicyDocs;
  riskTierForPaths(paths: readonly string[]): RiskTier;
}

async function readYaml<T>(dir: string, file: string, schema: z.ZodType<T>): Promise<T> {
  const text = await readFile(join(dir, file), 'utf8').catch((err: NodeJS.ErrnoException) => {
    throw new PoliciesError(file, err.message);
  });
  let raw: unknown;
  try {
    raw = parse(text);
  } catch (err) {
    throw new PoliciesError(file, `invalid YAML: ${(err as Error).message}`);
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) throw new PoliciesError(file, z.prettifyError(parsed.error));
  return parsed.data;
}

/** Loads and validates every policy file in `dir` (repos.yaml, risk-paths.yaml, *.md). */
export async function loadPolicies(dir: string): Promise<Policies> {
  const [repos, risk, pillars, conventions, security] = await Promise.all([
    readYaml(dir, 'repos.yaml', ReposFile),
    readYaml(dir, 'risk-paths.yaml', RiskPathsFile),
    readFile(join(dir, 'pillars.md'), 'utf8'),
    readFile(join(dir, 'conventions.md'), 'utf8'),
    readFile(join(dir, 'security.md'), 'utf8'),
  ]);
  return {
    ...repos,
    riskPaths: risk.rules,
    docs: { pillars, conventions, security },
    riskTierForPaths: (paths) => riskTierForPaths(risk.rules, paths),
  };
}
