import type { ServerEvent } from '../../../shared/types';
import type { Clock } from '../clock';
import { LLMError } from '../llm/errors';
import type { ChatMessage, LLMProvider } from '../llm/types';
import type { SearchService } from '../search/service';
import { runAgent } from './loop';
import { buildSystem } from './prompt';
import { SourceRegistry } from './sources';

export interface TurnDeps {
  llm: LLMProvider;
  search: SearchService;
  clock: Clock;
}

export interface TurnInput {
  conversationId: string;
  message: string;
  timezone: string;
}

const histories = new Map<string, ChatMessage[]>();

export async function handleTurn(deps: TurnDeps, input: TurnInput, emit: (e: ServerEvent) => void, signal: AbortSignal) {
  const startedAt = Date.now();
  const now = deps.clock.now();
  const history = histories.get(input.conversationId) ?? [];
  const registry = new SourceRegistry();

  emit({ type: 'status', phase: 'answering', text: 'thinking' });
  try {
    const result = await runAgent({
      llm: deps.llm,
      search: deps.search,
      system: buildSystem(now, input.timezone),
      history,
      userContent: input.message,
      registry,
      signal,
      emit,
      startedAt,
    });
    histories.set(input.conversationId, [...history, { role: 'user', content: input.message }, { role: 'assistant', content: result.text }]);
    emit({
      type: 'done',
      messageId: crypto.randomUUID(),
      createdAt: deps.clock.now().toISOString(),
      timings: { firstTokenMs: result.firstTokenMs, totalMs: Date.now() - startedAt, rounds: result.rounds },
    });
  } catch (err) {
    if (signal.aborted) return;
    const llmError = err instanceof LLMError ? err : undefined;
    console.error('[turn] failed', err);
    emit({ type: 'error', kind: llmError?.kind ?? 'unknown', message: llmError?.userMessage ?? 'Something went wrong. Try again.' });
  }
}
