import { describe, expect, it } from 'vitest';
import { ApiError } from '@google/genai';
import { toContents, toLLMError } from '../src/llm/gemini';

describe('toContents', () => {
  it('echoes thought signatures and groups parallel tool results', () => {
    const contents = toContents([
      { role: 'user', content: 'compare a and b' },
      {
        role: 'assistant',
        content: '',
        toolCalls: [
          { id: '1', name: 'web_search', args: { query: 'a' }, signature: 'sig' },
          { id: '2', name: 'web_search', args: { query: 'b' } },
        ],
      },
      { role: 'tool', toolCallId: '1', name: 'web_search', content: 'A' },
      { role: 'tool', toolCallId: '2', name: 'web_search', content: 'B' },
    ]);
    expect(contents).toHaveLength(3);
    expect(contents[1].role).toBe('model');
    expect(contents[1].parts?.[0].thoughtSignature).toBe('sig');
    expect(contents[2].parts).toHaveLength(2);
    expect(contents[2].parts?.[1].functionResponse?.id).toBe('2');
  });
});

describe('toLLMError', () => {
  // Shape of a real free-tier daily quota error: JSON nested in a JSON string.
  const body = JSON.stringify({
    error: {
      message: JSON.stringify({ error: { code: 429, details: [{ quotaId: 'GenerateRequestsPerDayPerProjectPerModel-FreeTier' }, { retryDelay: '62108s' }] } }),
      code: 429,
    },
  });

  it('recognises an exhausted daily quota and its retry delay', () => {
    const err = toLLMError(new ApiError({ message: body, status: 429 }));
    expect(err.kind).toBe('quota_exhausted');
    expect(err.retryAfterMs).toBe(62_108_000);
    expect(err.retryable).toBe(false);
    expect(err.canFallback).toBe(true);
  });

  it('treats a per-minute 429 as a retryable rate limit', () => {
    const err = toLLMError(new ApiError({ message: '{"retryDelay": "7s"}', status: 429 }));
    expect(err.kind).toBe('rate_limited');
    expect(err.retryAfterMs).toBe(7000);
  });

  it('maps a bad key to auth', () => {
    expect(toLLMError(new ApiError({ message: 'API key not valid', status: 400 })).kind).toBe('auth');
  });
});
