import { describe, expect, it } from 'vitest';
import { toContents } from '../src/llm/gemini';

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
