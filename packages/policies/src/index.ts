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

/** Hub pipeline steps that have a policy doc under `steps/<name>.md`. */
export const STEP_NAMES = ['triage', 'planning', 'implement', 'review', 'qa', 'release'] as const;
export type StepName = (typeof STEP_NAMES)[number];

export interface PolicyDocs {
  pillars: string;
  conventions: string;
  security: string;
  /** One markdown policy doc per pipeline step (`steps/<name>.md`); all required. */
  steps: Record<StepName, string>;
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

/** Reads `steps/<name>.md` for every `StepName`; each missing/unreadable file fails with a PoliciesError naming it. */
async function readStepDocs(dir: string): Promise<Record<StepName, string>> {
  const entries = await Promise.all(
    STEP_NAMES.map(async (name): Promise<[StepName, string]> => {
      const file = `steps/${name}.md`;
      const text = await readFile(join(dir, file), 'utf8').catch((err: NodeJS.ErrnoException) => {
        throw new PoliciesError(file, err.message);
      });
      return [name, text];
    }),
  );
  return Object.fromEntries(entries) as Record<StepName, string>;
}

/** Loads and validates every policy file in `dir` (repos.yaml, risk-paths.yaml, *.md, steps/*.md). */
export async function loadPolicies(dir: string): Promise<Policies> {
  const [repos, risk, pillars, conventions, security, steps] = await Promise.all([
    readYaml(dir, 'repos.yaml', ReposFile),
    readYaml(dir, 'risk-paths.yaml', RiskPathsFile),
    readFile(join(dir, 'pillars.md'), 'utf8'),
    readFile(join(dir, 'conventions.md'), 'utf8'),
    readFile(join(dir, 'security.md'), 'utf8'),
    readStepDocs(dir),
  ]);
  return {
    ...repos,
    riskPaths: risk.rules,
    docs: { pillars, conventions, security, steps },
    riskTierForPaths: (paths) => riskTierForPaths(risk.rules, paths),
  };
}
