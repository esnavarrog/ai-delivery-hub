import { query as sdkQuery, type Options } from '@anthropic-ai/claude-agent-sdk';
import { triageResultSchemaFor, type AgentRunnerPort, type RunFailureReason, type RunResult, type RunUsage, type TriageResult } from '@ai-delivery-hub/domain';
import type { EffortLevel } from '@ai-delivery-hub/policies';
import { agentSubprocessEnv, type AgentQuery } from './planning-runner.js';
import { structuredOutputSchema, triageWireSchema } from './structured-output.js';
import { MAX_TRIAGE_ATTEMPTS, parseTriageCandidate, triageCorrectiveMessage } from './triage-parse.js';
import { buildTriageSystemPrompt, buildTriageUserPrompt, type TriagePolicies, type TriageRunnerInput } from './triage-prompt.js';

// Re-exported for callers that imported the type from this module before it moved to planning-runner.ts.
export type { AgentQuery };

export interface ClaudeCodeTriageRunnerOptions {
  query?: AgentQuery;
  model: string;
  effort: EffortLevel;
  policies: TriagePolicies;
  /** Environment for the Claude Code subprocess; filtered through `agentSubprocessEnv`. Defaults to `process.env`. */
  env?: NodeJS.ProcessEnv;
  /** Subscription mode: drop `ANTHROPIC_API_KEY`/`ANTHROPIC_AUTH_TOKEN` so the Claude Code CLI login is used. */
  stripApiKeyEnv?: boolean;
  pathToClaudeCodeExecutable?: string;
  /** Hard cap on user/assistant turns: this run classifies from the prompt alone, it never explores a repo. */
  maxTurns?: number;
}

export const DEFAULT_MAX_TURNS = 2;

/**
 * Same contract as `AnthropicTriageRunner` (`runTriage`), but executed through the Agent SDK's `query()`
 * so the developer's logged-in Claude Code session can be used instead of an API key. No tools are
 * exposed: the run is a single structured-output classification, not an agentic exploration.
 */
export class ClaudeCodeTriageRunner implements Pick<AgentRunnerPort, 'runTriage'> {
  private readonly query: AgentQuery;
  private readonly env: Record<string, string>;
  private readonly maxTurns: number;

  constructor(private readonly options: ClaudeCodeTriageRunnerOptions) {
    this.query = options.query ?? (sdkQuery as AgentQuery);
    this.env = agentSubprocessEnv(options.env ?? process.env, { stripApiKeyEnv: options.stripApiKeyEnv });
    this.maxTurns = options.maxTurns ?? DEFAULT_MAX_TURNS;
  }

  async runTriage(input: TriageRunnerInput): Promise<RunResult<TriageResult>> {
    const startedAt = Date.now();
    const usage = { inputTokens: 0, outputTokens: 0, costUsd: 0 };
    const finish = (): RunUsage => ({ ...usage, durationMs: Date.now() - startedAt });
    const fail = (reason: RunFailureReason, message: string): RunResult<TriageResult> => ({ ok: false, reason, message, usage: finish() });

    const wire = triageWireSchema(input.allowedRepos);
    const domainSchema = triageResultSchemaFor(input.allowedRepos);
    const outputFormat = { type: 'json_schema' as const, schema: structuredOutputSchema(wire) };
    const systemPrompt = buildTriageSystemPrompt(this.options.policies, input.allowedRepos);
    const basePrompt = buildTriageUserPrompt(input);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), input.budget.maxDurationMs);
    try {
      let lastError = 'no output';
      for (let attempt = 0; attempt < MAX_TRIAGE_ATTEMPTS; attempt += 1) {
        const prompt = attempt === 0 ? basePrompt : `${basePrompt}\n\n${triageCorrectiveMessage(lastError)}`;
        const outcome = await this.runOnce(prompt, systemPrompt, outputFormat, controller);
        usage.inputTokens += outcome.usage.inputTokens;
        usage.outputTokens += outcome.usage.outputTokens;
        usage.costUsd += outcome.usage.costUsd;

        if (outcome.kind === 'aborted') return fail('budget_exhausted', `time budget of ${input.budget.maxDurationMs}ms exhausted`);
        if (outcome.kind === 'failed') return fail(outcome.reason, outcome.message);
        if (usage.inputTokens + usage.outputTokens > input.budget.maxTokens) {
          return fail('budget_exhausted', `token budget of ${input.budget.maxTokens} exceeded (${usage.inputTokens + usage.outputTokens} used)`);
        }
        const parsed = parseClaudeCodeTriageReply(outcome.structuredOutput, wire, domainSchema);
        if (parsed.ok) return { ok: true, value: parsed.value, usage: finish() };
        lastError = parsed.message;
      }
      return fail('invalid_output', lastError);
    } finally {
      clearTimeout(timer);
    }
  }

  private async runOnce(
    prompt: string,
    systemPrompt: string,
    outputFormat: { type: 'json_schema'; schema: Record<string, unknown> },
    controller: AbortController,
  ): Promise<RunOnceOutcome> {
    const usage = { inputTokens: 0, outputTokens: 0, costUsd: 0 };
    const options: Options = {
      model: this.options.model,
      effort: this.options.effort,
      maxTurns: this.maxTurns,
      permissionMode: 'dontAsk',
      tools: [],
      allowedTools: [],
      settingSources: [],
      persistSession: false,
      systemPrompt: { type: 'custom', prompt: systemPrompt },
      outputFormat,
      abortController: controller,
      env: this.env,
    };
    if (this.options.pathToClaudeCodeExecutable) options.pathToClaudeCodeExecutable = this.options.pathToClaudeCodeExecutable;

    let structuredOutput: unknown;
    let failure: { reason: RunFailureReason; message: string } | undefined;
    let stream: ReturnType<AgentQuery> | undefined;
    try {
      stream = this.query({ prompt, options });
      for await (const message of stream) {
        if (message.type !== 'result') continue;
        usage.inputTokens += message.usage.input_tokens + (message.usage.cache_creation_input_tokens ?? 0) + (message.usage.cache_read_input_tokens ?? 0);
        usage.outputTokens += message.usage.output_tokens;
        usage.costUsd += message.total_cost_usd;
        if (message.subtype === 'success') {
          structuredOutput = message.structured_output;
        } else {
          const errors = message.errors.join('; ');
          switch (message.subtype) {
            case 'error_max_turns':
              failure = { reason: 'budget_exhausted', message: `agent hit the turn limit after ${message.num_turns} turns${errors ? `: ${errors}` : ''}` };
              break;
            case 'error_max_budget_usd':
              failure = { reason: 'budget_exhausted', message: `agent hit the USD budget${errors ? `: ${errors}` : ''}` };
              break;
            case 'error_max_structured_output_retries':
              failure = { reason: 'invalid_output', message: errors || 'structured output retries exhausted' };
              break;
            default:
              failure = { reason: 'provider_error', message: errors || `agent run failed (${message.subtype})` };
          }
        }
      }
    } catch (err) {
      if (controller.signal.aborted) return { kind: 'aborted', usage };
      return { kind: 'failed', reason: 'provider_error', message: err instanceof Error ? err.message : String(err), usage };
    } finally {
      stream?.close?.();
    }
    if (controller.signal.aborted) return { kind: 'aborted', usage };
    if (failure) return { kind: 'failed', ...failure, usage };
    return { kind: 'completed', structuredOutput, usage };
  }
}

type RunOnceUsage = { inputTokens: number; outputTokens: number; costUsd: number };
type RunOnceOutcome =
  | { kind: 'completed'; structuredOutput: unknown; usage: RunOnceUsage }
  | { kind: 'failed'; reason: RunFailureReason; message: string; usage: RunOnceUsage }
  | { kind: 'aborted'; usage: RunOnceUsage };

/** The Agent SDK already decoded `structured_output` for us; only guard the "no output at all" case before the shared parse. */
function parseClaudeCodeTriageReply(structuredOutput: unknown, wire: ReturnType<typeof triageWireSchema>, domainSchema: ReturnType<typeof triageResultSchemaFor>) {
  if (structuredOutput === undefined) return { ok: false as const, message: 'no structured output returned by the agent' };
  return parseTriageCandidate(structuredOutput, wire, domainSchema);
}
