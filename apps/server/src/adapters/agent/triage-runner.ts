import Anthropic from '@anthropic-ai/sdk';
import { triageResultSchemaFor, type AgentRunnerPort, type RunFailureReason, type RunResult, type RunUsage, type TriageResult } from '@ai-delivery-hub/domain';
import type { EffortLevel } from '@ai-delivery-hub/policies';
import { structuredOutputSchema, triageWireSchema } from './structured-output.js';
import { MAX_TRIAGE_ATTEMPTS, parseTriageCandidate, triageCorrectiveMessage } from './triage-parse.js';
import {
  buildTriageSystemPrompt,
  buildTriageUserPrompt,
  MAX_RECENT_TICKETS,
  type ClarificationRound,
  type RecentTicket,
  type TriagePolicies,
  type TriageRunnerInput,
} from './triage-prompt.js';

export { MAX_RECENT_TICKETS, type ClarificationRound, type RecentTicket, type TriagePolicies, type TriageRunnerInput };

/** The slice of the Anthropic client the runner needs; tests inject a scripted double. */
export interface TriageMessagesClient {
  messages: {
    create(params: Anthropic.MessageCreateParamsNonStreaming, options?: { signal?: AbortSignal | null }): Promise<Anthropic.Message>;
  };
}

export interface AnthropicTriageRunnerOptions {
  client: TriageMessagesClient;
  model: string;
  effort: EffortLevel;
  policies: TriagePolicies;
  /** Non-streaming ceiling; the reply is a small JSON object, so this only guards runaway output. */
  maxOutputTokens?: number;
}

const DEFAULT_MAX_OUTPUT_TOKENS = 16_000;

export class AnthropicTriageRunner implements Pick<AgentRunnerPort, 'runTriage'> {
  private readonly maxOutputTokens: number;

  constructor(private readonly options: AnthropicTriageRunnerOptions) {
    this.maxOutputTokens = options.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS;
  }

  async runTriage(input: TriageRunnerInput): Promise<RunResult<TriageResult>> {
    const startedAt = Date.now();
    const usage = { inputTokens: 0, outputTokens: 0 };
    const finish = (): RunUsage => ({ ...usage, durationMs: Date.now() - startedAt });
    const fail = (reason: RunFailureReason, message: string): RunResult<TriageResult> => ({ ok: false, reason, message, usage: finish() });

    const wire = triageWireSchema(input.allowedRepos);
    const domainSchema = triageResultSchemaFor(input.allowedRepos);
    const format: Anthropic.JSONOutputFormat = { type: 'json_schema', schema: structuredOutputSchema(wire) };
    const system = buildTriageSystemPrompt(this.options.policies, input.allowedRepos);
    const messages: Anthropic.MessageParam[] = [{ role: 'user', content: buildTriageUserPrompt(input) }];

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), input.budget.maxDurationMs);
    try {
      let lastError = 'no output';
      for (let attempt = 0; attempt < MAX_TRIAGE_ATTEMPTS; attempt += 1) {
        let response: Anthropic.Message;
        try {
          response = await this.options.client.messages.create(
            {
              model: this.options.model,
              max_tokens: this.maxOutputTokens,
              system,
              messages: [...messages],
              output_config: { effort: this.options.effort, format },
            },
            { signal: controller.signal },
          );
        } catch (err) {
          if (controller.signal.aborted || err instanceof Anthropic.APIUserAbortError) {
            return fail('budget_exhausted', `time budget of ${input.budget.maxDurationMs}ms exhausted`);
          }
          return fail('provider_error', describeError(err));
        }

        usage.inputTokens += response.usage.input_tokens + (response.usage.cache_creation_input_tokens ?? 0) + (response.usage.cache_read_input_tokens ?? 0);
        usage.outputTokens += response.usage.output_tokens;

        if (response.stop_reason === 'refusal') {
          const category = response.stop_details?.category ?? 'unknown';
          return fail('provider_error', `model refusal (category: ${category})${response.stop_details?.explanation ? `: ${response.stop_details.explanation}` : ''}`);
        }
        if (usage.inputTokens + usage.outputTokens > input.budget.maxTokens) {
          return fail('budget_exhausted', `token budget of ${input.budget.maxTokens} exceeded (${usage.inputTokens + usage.outputTokens} used)`);
        }

        const text = response.content
          .filter((block): block is Anthropic.TextBlock => block.type === 'text')
          .map((block) => block.text)
          .join('');
        const parsed = parseAnthropicTriageReply(text, response.stop_reason, wire, domainSchema);
        if (parsed.ok) return { ok: true, value: parsed.value, usage: finish() };
        lastError = parsed.message;
        if (attempt === MAX_TRIAGE_ATTEMPTS - 1) break;
        messages.push(
          { role: 'assistant', content: text.length > 0 ? text : '(empty response)' },
          { role: 'user', content: triageCorrectiveMessage(parsed.message) },
        );
      }
      return fail('invalid_output', lastError);
    } finally {
      clearTimeout(timer);
    }
  }
}

/** Decodes the Messages API reply text into JSON, then delegates to the shared wire→domain parse. */
function parseAnthropicTriageReply(
  text: string,
  stopReason: Anthropic.StopReason | null,
  wire: ReturnType<typeof triageWireSchema>,
  domainSchema: ReturnType<typeof triageResultSchemaFor>,
) {
  if (stopReason === 'max_tokens') return { ok: false as const, message: 'response was cut off (stop_reason max_tokens)' };
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (err) {
    return { ok: false as const, message: `not valid JSON (${(err as Error).message})` };
  }
  return parseTriageCandidate(json, wire, domainSchema);
}

function describeError(err: unknown): string {
  if (err instanceof Anthropic.RateLimitError) return `rate limited by the Claude API: ${err.message}`;
  if (err instanceof Anthropic.APIConnectionError) return `connection error: ${err.message}`;
  if (err instanceof Anthropic.APIError) return `Claude API error ${err.status ?? ''}: ${err.message}`.replace('  ', ' ');
  return err instanceof Error ? err.message : String(err);
}
