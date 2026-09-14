import { TriageResult } from '@ai-delivery-hub/domain';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { structuredOutputSchema, triageWireSchema } from '../../src/adapters/agent/structured-output.js';

describe('structuredOutputSchema', () => {
  it('emits a closed object schema with enums kept and unsupported keywords dropped', () => {
    const schema = z.object({
      kind: z.enum(['a', 'b']),
      name: z.string().min(1).max(10),
      score: z.number().min(0).max(1),
      count: z.number().int().positive(),
      tags: z.array(z.string().min(1)).min(2),
      nested: z.object({ flag: z.boolean() }).nullable(),
      maybe: z.string().optional(),
    });
    const json = structuredOutputSchema(schema);
    expect(json).toEqual({
      type: 'object',
      properties: {
        kind: { type: 'string', enum: ['a', 'b'] },
        name: { type: 'string' },
        score: { type: 'number' },
        count: { type: 'integer' },
        tags: { type: 'array', items: { type: 'string' } },
        nested: { anyOf: [{ type: 'object', properties: { flag: { type: 'boolean' } }, required: ['flag'], additionalProperties: false }, { type: 'null' }] },
        maybe: { type: 'string' },
      },
      required: ['kind', 'name', 'score', 'count', 'tags', 'nested'],
      additionalProperties: false,
    });
    expect(JSON.stringify(json)).not.toMatch(/\$schema|minLength|maxLength|minimum|maximum|minItems/);
  });
});

describe('triageWireSchema', () => {
  it('binds targetRepo to the allowed repos and makes the hint nullable so every property is required', () => {
    const wire = triageWireSchema(['backend-parkingapp', 'libredte-api']);
    const json = structuredOutputSchema(wire);
    const props = json['properties'] as Record<string, unknown>;
    expect(props['targetRepo']).toEqual({ type: 'string', enum: ['backend-parkingapp', 'libredte-api'] });
    expect(json['required']).toEqual(Object.keys(props));
    expect(json['required']).toContain('alreadyImplementedHint');
    const parsed = wire.parse({
      category: 'bug',
      riskTier: 'low',
      targetRepo: 'libredte-api',
      summary: 'x',
      duplicateCandidates: [],
      alreadyImplementedHint: null,
      riskSignals: [],
    });
    const { alreadyImplementedHint: _hint, ...domainShape } = parsed;
    expect(TriageResult.safeParse(domainShape).success).toBe(true);
    expect(wire.safeParse({ ...parsed, targetRepo: 'unknown' }).success).toBe(false);
  });
});
