import type { ChatMessage } from '../llm/types';
import type { Turn } from '../store/repo';

export const HISTORY_TURNS = 6;

/**
 * Replays recent turns as plain user/assistant messages. Each answer keeps a compact source list
 * so follow-ups like "what did source 2 say" still make sense; tool calls are not replayed.
 */
export function historyMessages(turns: Turn[]): ChatMessage[] {
  return turns.flatMap((t): ChatMessage[] => {
    const sources = t.sources.length ? `\n\n(Sources used in that answer: ${t.sources.map((s) => `[${s.n}] ${s.url}`).join(' ')})` : '';
    return [
      { role: 'user', content: t.question },
      { role: 'assistant', content: t.answer + sources },
    ];
  });
}
