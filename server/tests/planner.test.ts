import { describe, expect, it } from 'vitest';
import { planTurn } from '../src/agent/planner';
import type { JsonRequest, LLMProvider } from '../src/llm/types';

function jsonLLM(generate: (req: JsonRequest) => Promise<unknown>): LLMProvider {
  return {
    name: 'fake',
    modelFor: () => 'fake',
    async *streamChat() {},
    generateJson: generate as LLMProvider['generateJson'],
  };
}

const input = (llm: LLMProvider, timeoutMs: number) => ({
  llm,
  message: 'How much is Notion Plus?',
  now: new Date('2026-11-11T06:00:00Z'),
  timezone: 'Asia/Kolkata',
  recentTurns: [],
  recalled: [],
  timeoutMs,
  signal: new AbortController().signal,
});

const plan = {
  needsSearch: true,
  referencesPast: false,
  timeExpressions: [],
  recallQuery: '',
  searchQueries: [{ query: 'Notion Plus pricing', kind: 'web' }],
  freshness: 'any',
};

describe('planTurn', () => {
  it('returns the plan when it arrives before the deadline', async () => {
    const result = await planTurn(input(jsonLLM(async () => plan), 200));
    expect(result?.searchQueries).toEqual([{ query: 'Notion Plus pricing', kind: 'web' }]);
  });

  it('gives up at the deadline and aborts the request, even if the provider ignores the abort', async () => {
    let seen: AbortSignal | undefined;
    const never = jsonLLM((req) => {
      seen = req.signal;
      return new Promise(() => {});
    });
    const started = Date.now();
    const result = await planTurn(input(never, 50));
    expect(result).toBeUndefined();
    expect(Date.now() - started).toBeLessThan(500);
    expect(seen?.aborted).toBe(true);
  });

  it('returns undefined when the planner fails', async () => {
    const failing = jsonLLM(async () => {
      throw new Error('503 overloaded');
    });
    expect(await planTurn(input(failing, 200))).toBeUndefined();
  });
});
