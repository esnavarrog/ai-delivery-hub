import { describe, expect, it } from 'vitest';
import { RunBudget, RunFailureReason, RunUsage, type RunResult } from '../../src/ports/agent-runner.js';

describe('RunBudget', () => {
  it('requires positive integer limits', () => {
    expect(RunBudget.safeParse({ maxTokens: 50_000, maxDurationMs: 60_000 }).success).toBe(true);
    expect(RunBudget.safeParse({ maxTokens: 0, maxDurationMs: 60_000 }).success).toBe(false);
    expect(RunBudget.safeParse({ maxTokens: 10, maxDurationMs: -1 }).success).toBe(false);
  });

  it('accepts an optional positive maxTurns for agentic runs', () => {
    expect(RunBudget.safeParse({ maxTokens: 1, maxDurationMs: 1, maxTurns: 40 }).success).toBe(true);
    expect(RunBudget.safeParse({ maxTokens: 1, maxDurationMs: 1, maxTurns: 0 }).success).toBe(false);
  });
});

describe('RunUsage / RunFailureReason', () => {
  it('parses usage and rejects negative counters', () => {
    expect(RunUsage.safeParse({ inputTokens: 1, outputTokens: 2, durationMs: 3 }).success).toBe(true);
    expect(RunUsage.safeParse({ inputTokens: -1, outputTokens: 2, durationMs: 3 }).success).toBe(false);
  });

  it('carries an optional non-negative cost in USD', () => {
    expect(RunUsage.safeParse({ inputTokens: 1, outputTokens: 2, durationMs: 3, costUsd: 0.42 }).success).toBe(true);
    expect(RunUsage.safeParse({ inputTokens: 1, outputTokens: 2, durationMs: 3, costUsd: -1 }).success).toBe(false);
  });

  it('lists the four failure reasons', () => {
    expect(RunFailureReason.options).toEqual(['budget_exhausted', 'invalid_output', 'provider_error', 'cancelled']);
  });
});

describe('RunResult', () => {
  it('narrows on ok', () => {
    const usage = { inputTokens: 1, outputTokens: 1, durationMs: 1 };
    const ok: RunResult<number> = { ok: true, value: 42, usage };
    const ko: RunResult<number> = { ok: false, reason: 'cancelled', usage, message: 'stopped' };
    expect(ok.ok ? ok.value : ko.reason).toBe(42);
    expect(ko.ok ? 'unexpected' : ko.reason).toBe('cancelled');
  });
});
