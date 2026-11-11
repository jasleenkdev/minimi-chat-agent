import Anthropic from '@anthropic-ai/sdk';
import { describe, expect, it } from 'vitest';
import { LLMError } from '../src/llm/errors';
import { AnthropicProvider } from '../src/llm/anthropic';
import type { StreamEvent } from '../src/llm/types';

// The provider has never been run against the live API. These tests pin down the contract with the
// interface: what it sends to the SDK and how it turns SDK output and errors into provider events.

type Create = (body: Record<string, unknown>, opts: { signal?: AbortSignal }) => unknown;

function provider(create: Create) {
  const calls: Record<string, unknown>[] = [];
  const client = {
    messages: {
      create: async (body: Record<string, unknown>, opts: { signal?: AbortSignal }) => {
        calls.push(body);
        return create(body, opts);
      },
    },
  } as unknown as Anthropic;
  return { llm: new AnthropicProvider({ apiKey: 'test', models: { main: 'main-model', fast: 'fast-model' }, client }), calls };
}

async function* events(list: unknown[]) {
  for (const e of list) yield e;
}

async function collect(stream: AsyncIterable<StreamEvent>) {
  const out: StreamEvent[] = [];
  for await (const e of stream) out.push(e);
  return out;
}

const apiError = (status: number, message: string, headers: Record<string, string> = {}) =>
  Anthropic.APIError.generate(status, { type: 'error', error: { type: 'error', message } }, message, new Headers(headers));

describe('AnthropicProvider (mocked SDK)', () => {
  it('sends a cacheable system prefix, tool schemas and grouped tool results', async () => {
    const { llm, calls } = provider(() => events([]));
    await collect(
      llm.streamChat({
        tier: 'main',
        system: { stable: 'rules', dynamic: 'today' },
        tools: [{ name: 'web_search', description: 'search', parameters: { type: 'object', properties: { query: { type: 'string' } } } }],
        messages: [
          { role: 'user', content: 'compare a and b' },
          { role: 'assistant', content: '', toolCalls: [{ id: 't1', name: 'web_search', args: { query: 'a' } }, { id: 't2', name: 'web_search', args: { query: 'b' } }] },
          { role: 'tool', toolCallId: 't1', name: 'web_search', content: 'A' },
          { role: 'tool', toolCallId: 't2', name: 'web_search', content: 'B' },
        ],
      }),
    );
    const body = calls[0] as any;
    expect(body.model).toBe('main-model');
    expect(body.stream).toBe(true);
    expect(body.system).toEqual([
      { type: 'text', text: 'rules', cache_control: { type: 'ephemeral' } },
      { type: 'text', text: 'today' },
    ]);
    expect(body.tools[0]).toMatchObject({ name: 'web_search', input_schema: { type: 'object' } });
    expect(body.messages).toHaveLength(3);
    expect(body.messages[1].content.map((b: any) => b.type)).toEqual(['tool_use', 'tool_use']);
    expect(body.messages[2].content.map((b: any) => b.tool_use_id)).toEqual(['t1', 't2']);
  });

  it('turns stream events into text, tool calls and usage', async () => {
    const { llm } = provider(() =>
      events([
        { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
        { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Checking' } },
        { type: 'content_block_stop', index: 0 },
        { type: 'content_block_start', index: 1, content_block: { type: 'tool_use', id: 'call_1', name: 'web_search', input: {} } },
        { type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: '{"query":"notion ' } },
        { type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: 'pricing"}' } },
        { type: 'content_block_stop', index: 1 },
        { type: 'message_delta', delta: { stop_reason: 'tool_use' }, usage: { input_tokens: 120, output_tokens: 30, cache_read_input_tokens: 100 } },
      ]),
    );
    const out = await collect(llm.streamChat({ tier: 'main', system: { stable: 's', dynamic: 'd' }, messages: [{ role: 'user', content: 'hi' }] }));
    expect(out).toEqual([
      { type: 'text', text: 'Checking' },
      { type: 'tool_call', call: { id: 'call_1', name: 'web_search', args: { query: 'notion pricing' } } },
      { type: 'usage', usage: { inputTokens: 120, outputTokens: 30, cachedTokens: 100 } },
    ]);
  });

  it('parses structured JSON output on the fast tier', async () => {
    const { llm, calls } = provider(() => ({ content: [{ type: 'text', text: '{"needsSearch":true}' }] }));
    const result = await llm.generateJson<{ needsSearch: boolean }>({ tier: 'fast', system: 'plan', prompt: 'q', schema: { type: 'object' } });
    expect(result).toEqual({ needsSearch: true });
    expect((calls[0] as any).model).toBe('fast-model');
    expect((calls[0] as any).output_config).toEqual({ format: { type: 'json_schema', schema: { type: 'object' } } });
  });

  it('rejects output that is not JSON', async () => {
    const { llm } = provider(() => ({ content: [{ type: 'text', text: 'not json' }] }));
    await expect(llm.generateJson({ tier: 'fast', system: 's', prompt: 'q', schema: {} })).rejects.toMatchObject({ kind: 'bad_request' });
  });

  it('maps a rejected key to auth without retrying', async () => {
    const { llm, calls } = provider(() => {
      throw apiError(401, 'invalid x-api-key');
    });
    const err = await llm.generateJson<never>({ tier: 'fast', system: 's', prompt: 'q', schema: {} }).catch((e: LLMError) => e);
    expect(err).toBeInstanceOf(LLMError);
    expect(err.kind).toBe('auth');
    expect(calls).toHaveLength(1);
  });

  it('retries a rate limit after the server-given delay', async () => {
    let n = 0;
    const { llm, calls } = provider(() => {
      if (n++ === 0) throw apiError(429, 'rate limited', { 'retry-after': '1' });
      return { content: [{ type: 'text', text: '{}' }] };
    });
    await expect(llm.generateJson({ tier: 'fast', system: 's', prompt: 'q', schema: {} })).resolves.toEqual({});
    expect(calls).toHaveLength(2);
  });
});
