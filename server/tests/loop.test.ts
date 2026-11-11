import { describe, expect, it } from 'vitest';
import type { ServerEvent } from '../../shared/types';
import { MAX_TOOL_ROUNDS, runAgent } from '../src/agent/loop';
import { SourceRegistry } from '../src/agent/sources';
import type { ChatRequest, LLMProvider, StreamEvent } from '../src/llm/types';
import { SearchService } from '../src/search/service';
import { SearchError, type SearchProvider } from '../src/search/types';

/** An LLM whose every call is scripted: each entry is what one streamChat call yields. */
function scriptedLLM(script: (req: ChatRequest, call: number) => StreamEvent[]) {
  const calls: ChatRequest[] = [];
  const llm: LLMProvider = {
    name: 'fake',
    modelFor: () => 'fake',
    async *streamChat(req) {
      calls.push(structuredClone({ ...req, signal: undefined }));
      for (const e of script(req, calls.length - 1)) yield e;
    },
    generateJson: async () => {
      throw new Error('unused');
    },
  };
  return { llm, calls };
}

const searchProvider = (fail = false): SearchProvider => ({
  name: 'fake',
  search: async (query) => {
    if (fail) throw new SearchError('failed', 'down');
    return [{ url: `https://example.com/${encodeURIComponent(query)}`, title: query, content: `about ${query}`, score: 1 }];
  },
});

function run(llm: LLMProvider, opts: { allowTools?: boolean; failSearch?: boolean } = {}) {
  const events: ServerEvent[] = [];
  const registry = new SourceRegistry();
  const promise = runAgent({
    llm,
    search: new SearchService(searchProvider(opts.failSearch)),
    system: { stable: 's', dynamic: 'd' },
    history: [],
    userContent: 'question',
    registry,
    signal: new AbortController().signal,
    emit: (e) => events.push(e),
    startedAt: Date.now(),
    allowTools: opts.allowTools ?? true,
  });
  return { promise, events, registry };
}

const call = (id: string, query: string): StreamEvent => ({ type: 'tool_call', call: { id, name: 'web_search', args: { query } } });

describe('runAgent', () => {
  it('answers directly when no tool is called', async () => {
    const { llm, calls } = scriptedLLM(() => [{ type: 'text', text: 'Paris.' }]);
    const { promise, events } = run(llm);
    const result = await promise;
    expect(result).toMatchObject({ text: 'Paris.', rounds: 1, answered: true });
    expect(calls[0].tools?.map((t) => t.name)).toEqual(['web_search']);
    expect(events.filter((e) => e.type === 'token')).toHaveLength(1);
  });

  it('runs parallel tool calls and numbers sources across the turn', async () => {
    const { llm, calls } = scriptedLLM((_, i) => (i === 0 ? [call('1', 'a'), call('2', 'b')] : [{ type: 'text', text: 'See [1][2].' }]));
    const { promise, registry, events } = run(llm);
    await promise;
    expect(registry.all().map((s) => s.n)).toEqual([1, 2]);
    const toolMessages = calls[1].messages.filter((m) => m.role === 'tool');
    expect(toolMessages).toHaveLength(2);
    expect(toolMessages[1].content).toContain('[2]');
    expect(events.some((e) => e.type === 'status' && e.text === 'searching: a')).toBe(true);
  });

  it(`stops offering the tool after ${MAX_TOOL_ROUNDS} rounds and tells the model to answer`, async () => {
    const { llm, calls } = scriptedLLM((req, i) => (req.tools ? [call(String(i), `q${i}`)] : [{ type: 'text', text: 'Best effort.' }]));
    const result = await run(llm).promise;
    expect(result.rounds).toBe(MAX_TOOL_ROUNDS + 1);
    expect(calls.at(-1)?.tools).toBeUndefined();
    expect(calls.at(-1)?.messages.at(-1)).toMatchObject({ role: 'user', content: expect.stringContaining('Search budget used up') });
  });

  it('falls back to an honest line when the model returns nothing', async () => {
    const { llm } = scriptedLLM(() => []);
    const result = await run(llm).promise;
    expect(result.answered).toBe(false);
    expect(result.text).toContain("couldn't put an answer together");
  });

  it('tells the model when search failed instead of throwing', async () => {
    const { llm, calls } = scriptedLLM((_, i) => (i === 0 ? [call('1', 'x')] : [{ type: 'text', text: 'Could not check.' }]));
    const result = await run(llm, { failSearch: true }).promise;
    expect(result.searchFailures).toBe(1);
    expect(calls[1].messages.find((m) => m.role === 'tool')?.content).toContain('Search failed');
  });

  it('offers no tool on the fast path', async () => {
    const { llm, calls } = scriptedLLM(() => [{ type: 'text', text: 'Hi!' }]);
    await run(llm, { allowTools: false }).promise;
    expect(calls[0].tools).toBeUndefined();
  });
});
