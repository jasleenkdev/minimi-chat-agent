import type { ServerEvent } from '../../../shared/types';
import type { Clock } from '../clock';
import { LLMError } from '../llm/errors';
import type { LLMProvider } from '../llm/types';
import type { SearchService } from '../search/service';
import { LOCAL_USER, type Store } from '../store/repo';
import { resolveDates } from '../dates/resolve';
import { buildUserContent } from './context';
import { HISTORY_TURNS, historyMessages } from './history';
import { runAgent } from './loop';
import { buildSystem } from './prompt';
import { formatRecall, gatherRecall, mentionsPastConversation, recallRanges } from './recall';
import { SourceRegistry } from './sources';

export interface TurnDeps {
  llm: LLMProvider;
  search: SearchService;
  clock: Clock;
  store: Store;
}

export interface TurnInput {
  conversationId: string;
  message: string;
  timezone: string;
  userId?: string;
}

export async function handleTurn(deps: TurnDeps, input: TurnInput, emit: (e: ServerEvent) => void, signal: AbortSignal) {
  const startedAt = Date.now();
  const userId = input.userId ?? LOCAL_USER;
  const askedAt = deps.clock.now();
  const registry = new SourceRegistry();
  const history = historyMessages(deps.store.recentTurns(input.conversationId, HISTORY_TURNS));

  const dates = recallRanges(resolveDates(input.message, askedAt, input.timezone));
  const referencesPast = mentionsPastConversation(input.message);
  let recall: string | undefined;
  if (referencesPast) {
    emit({ type: 'status', phase: 'recalling', text: dates.length ? `checking history for ${dates.map((d) => d.label).join(', ')}` : 'checking past conversations' });
    recall = formatRecall(gatherRecall(deps.store, userId, dates, input.message, askedAt.getTime()), input.timezone);
  }
  const userContent = buildUserContent(input.message, { recall, dates: referencesPast ? dates : [], notes: [] }, input.timezone);

  emit({ type: 'status', phase: 'answering', text: 'thinking' });
  try {
    const result = await runAgent({
      llm: deps.llm,
      search: deps.search,
      system: buildSystem(askedAt, input.timezone),
      history,
      userContent,
      registry,
      signal,
      emit,
      startedAt,
    });

    const answeredAt = deps.clock.now();
    const answerId = crypto.randomUUID();
    deps.store.saveTurn({
      conversationId: input.conversationId,
      userId,
      timezone: input.timezone,
      question: { id: crypto.randomUUID(), content: input.message, createdAtMs: askedAt.getTime() },
      answer: { id: answerId, content: result.text, createdAtMs: answeredAt.getTime() },
      sources: registry.all(),
    });
    emit({
      type: 'done',
      messageId: answerId,
      createdAt: answeredAt.toISOString(),
      timings: { firstTokenMs: result.firstTokenMs, totalMs: Date.now() - startedAt, rounds: result.rounds },
    });
  } catch (err) {
    if (signal.aborted) return;
    const llmError = err instanceof LLMError ? err : undefined;
    console.error('[turn] failed', err);
    emit({ type: 'error', kind: llmError?.kind ?? 'unknown', message: llmError?.userMessage ?? 'Something went wrong. Try again.' });
  }
}
