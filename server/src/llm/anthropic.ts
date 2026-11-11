import Anthropic from '@anthropic-ai/sdk';
import { LLMError, isAbortError, kindFromStatus } from './errors';
import { withRetry } from './retry';
import type { ChatMessage, ChatRequest, JsonRequest, LLMProvider, ModelTier, StreamEvent } from './types';

export interface AnthropicOptions {
  apiKey: string;
  models: { main: string; fast: string };
}

export class AnthropicProvider implements LLMProvider {
  readonly name = 'anthropic';
  private client: Anthropic;

  constructor(private opts: AnthropicOptions) {
    this.client = new Anthropic({ apiKey: opts.apiKey, maxRetries: 0, timeout: 45_000 });
  }

  modelFor(tier: ModelTier): string {
    return this.opts.models[tier];
  }

  async *streamChat(req: ChatRequest): AsyncIterable<StreamEvent> {
    const stream = await withRetry(
      async () => {
        try {
          return await this.client.messages.create(
            {
              model: this.modelFor(req.tier),
              max_tokens: 8000,
              stream: true,
              output_config: { effort: 'low' },
              // The stable block is marked cacheable; the dynamic block (date, recall, sources) follows it.
              system: [
                { type: 'text', text: req.system.stable, cache_control: { type: 'ephemeral' } },
                { type: 'text', text: req.system.dynamic },
              ],
              tools: req.tools?.map((t) => ({
                name: t.name,
                description: t.description,
                input_schema: t.parameters as Anthropic.Tool.InputSchema,
              })),
              messages: toMessages(req.messages),
            },
            { signal: req.signal },
          );
        } catch (err) {
          throw toLLMError(err);
        }
      },
      { signal: req.signal },
    );

    const pending = new Map<number, { id: string; name: string; json: string }>();
    try {
      for await (const event of stream) {
        if (event.type === 'content_block_start' && event.content_block.type === 'tool_use') {
          pending.set(event.index, { id: event.content_block.id, name: event.content_block.name, json: '' });
        } else if (event.type === 'content_block_delta') {
          if (event.delta.type === 'text_delta') yield { type: 'text', text: event.delta.text };
          else if (event.delta.type === 'input_json_delta') {
            const call = pending.get(event.index);
            if (call) call.json += event.delta.partial_json;
          }
        } else if (event.type === 'content_block_stop') {
          const call = pending.get(event.index);
          if (call) {
            pending.delete(event.index);
            yield { type: 'tool_call', call: { id: call.id, name: call.name, args: parseArgs(call.json) } };
          }
        } else if (event.type === 'message_delta') {
          yield {
            type: 'usage',
            usage: {
              inputTokens: event.usage.input_tokens ?? 0,
              outputTokens: event.usage.output_tokens,
              cachedTokens: event.usage.cache_read_input_tokens ?? 0,
            },
          };
        }
      }
    } catch (err) {
      throw toLLMError(err);
    }
  }

  async generateJson<T>(req: JsonRequest): Promise<T> {
    const res = await withRetry(
      async () => {
        try {
          return await this.client.messages.create(
            {
              model: this.modelFor(req.tier),
              max_tokens: 4000,
              system: req.system,
              output_config: { format: { type: 'json_schema', schema: req.schema } },
              messages: [{ role: 'user', content: req.prompt }],
            },
            { signal: req.signal },
          );
        } catch (err) {
          throw toLLMError(err);
        }
      },
      { signal: req.signal },
    );
    const text = res.content.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('');
    try {
      return JSON.parse(text) as T;
    } catch {
      throw new LLMError('bad_request', 'model returned invalid JSON');
    }
  }
}

function parseArgs(json: string): Record<string, unknown> {
  try {
    return json ? JSON.parse(json) : {};
  } catch {
    return {};
  }
}

function toMessages(messages: ChatMessage[]): Anthropic.MessageParam[] {
  const out: Anthropic.MessageParam[] = [];
  for (const m of messages) {
    if (m.role === 'user') {
      out.push({ role: 'user', content: m.content });
    } else if (m.role === 'assistant') {
      const content: Anthropic.ContentBlockParam[] = [];
      if (m.content) content.push({ type: 'text', text: m.content });
      for (const c of m.toolCalls ?? []) content.push({ type: 'tool_use', id: c.id, name: c.name, input: c.args });
      if (content.length) out.push({ role: 'assistant', content });
    } else {
      const block: Anthropic.ToolResultBlockParam = { type: 'tool_result', tool_use_id: m.toolCallId, content: m.content };
      const last = out.at(-1);
      // All tool results for one assistant turn go back in a single user message.
      if (last?.role === 'user' && Array.isArray(last.content) && last.content.every((b) => b.type === 'tool_result')) {
        last.content.push(block);
      } else {
        out.push({ role: 'user', content: [block] });
      }
    }
  }
  return out;
}

function toLLMError(err: unknown): LLMError {
  if (err instanceof LLMError) return err;
  if (isAbortError(err) || err instanceof Anthropic.APIUserAbortError) return new LLMError('aborted', 'aborted');
  if (err instanceof Anthropic.APIError) {
    const retryAfter = Number(err.headers?.get?.('retry-after'));
    return new LLMError(kindFromStatus(err.status, err.message), err.message, err.status, retryAfter ? retryAfter * 1000 : undefined);
  }
  return new LLMError('unknown', err instanceof Error ? err.message : String(err));
}
