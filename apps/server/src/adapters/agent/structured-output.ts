import { AlreadyImplementedHint, TriageAssessment, TriageResult } from '@ai-delivery-hub/domain';
import { z } from 'zod';

/** String formats the structured-output grammar accepts; every other `format` is dropped. */
const SUPPORTED_FORMATS = new Set(['date-time', 'time', 'date', 'duration', 'email', 'hostname', 'uri', 'ipv4', 'ipv6', 'uuid']);

/** Keywords structured outputs reject; zod checks such as `.min()` are still enforced when we parse the reply. */
const UNSUPPORTED_KEYWORDS = new Set([
  '$schema',
  'minLength',
  'maxLength',
  'minimum',
  'maximum',
  'exclusiveMinimum',
  'exclusiveMaximum',
  'multipleOf',
  'pattern',
  'minItems',
  'maxItems',
  'uniqueItems',
  'default',
  'propertyNames',
  'patternProperties',
]);

function strip(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(strip);
  if (node === null || typeof node !== 'object') return node;
  const source = node as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(source)) {
    if (UNSUPPORTED_KEYWORDS.has(key)) continue;
    if (key === 'format') {
      if (typeof value === 'string' && SUPPORTED_FORMATS.has(value)) out[key] = value;
      continue;
    }
    if (key === 'oneOf') {
      out['anyOf'] = strip(value);
      continue;
    }
    if (key === 'properties' || key === '$defs') {
      out[key] = Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, strip(v)]));
      continue;
    }
    if (key === 'items' || key === 'anyOf' || key === 'allOf') {
      out[key] = strip(value);
      continue;
    }
    out[key] = value;
  }
  if (out['type'] === 'object') {
    out['additionalProperties'] = false;
    out['required'] ??= Object.keys((out['properties'] as Record<string, unknown> | undefined) ?? {});
  }
  return out;
}

/**
 * JSON Schema for `output_config.format` built from a zod schema: closed objects, enums kept,
 * unsupported constraint keywords removed (they are validated client-side after the reply).
 */
export function structuredOutputSchema(schema: z.ZodType): Record<string, unknown> {
  return strip(z.toJSONSchema(schema, { unrepresentable: 'any', io: 'output' })) as Record<string, unknown>;
}

/**
 * Wire shape the triage model must produce: `targetRepo` is an enum of the allowed repos and
 * the optional hint and assessment become nullable so every property can be `required` (more
 * reliable decoding). See `parseTriageCandidate` for the null -> undefined mapping back to the
 * domain `TriageResult`.
 */
export function triageWireSchema(repos: readonly string[]) {
  const [first, ...rest] = repos;
  if (first === undefined) throw new Error('triage needs at least one allowed repository');
  return TriageResult.extend({
    targetRepo: z.enum([first, ...rest]),
    alreadyImplementedHint: AlreadyImplementedHint.nullable(),
    assessment: TriageAssessment.nullable(),
  });
}
export type TriageWire = z.infer<ReturnType<typeof triageWireSchema>>;
