import type { ServerEvent } from '../../../shared/types';
import type { Clock } from '../clock';
import { config } from '../config';
import { resolveDates, type DateRange } from '../dates/resolve';
import { isoDate, wallClock } from '../dates/zone';
import { LLMError } from '../llm/errors';
import type { LLMProvider } from '../llm/types';
import type { SearchService } from '../search/service';
import { LOCAL_USER, type Store, type Turn } from '../store/repo';
import { buildUserContent } from './context';
import { isTrivial } from './fastpath';
import { HISTORY_TURNS, historyMessages } from './history';
import { runAgent } from './loop';
import { planTurn } from './planner';
import { prefetch } from './prefetch';
import { buildSystem, formatInZone } from './prompt';
import { formatRecall, gatherRecall, mentionsPastConversation, recallRanges, recalledTurns } from './recall';
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

type Emit = (e: ServerEvent) => void;

interface Prepared {
  userContent: string;
  planMs?: number;
  searchMs?: number;
}

export async function handleTurn(deps: TurnDeps, input: TurnInput, emit: Emit, signal: AbortSignal): Promise<void> {
  const startedAt = Date.now();
  const userId = input.userId ?? LOCAL_USER;
  const askedAt = deps.clock.now();
  const registry = new SourceRegistry();
  const recent = deps.store.recentTurns(input.conversationId, HISTORY_TURNS);
  const trivial = isTrivial(input.message);

  try {
    const prepared: Prepared = trivial
      ? { userContent: input.message }
      : await prepare(deps, { ...input, userId }, { askedAt, recent, registry, emit, signal });

    emit({ type: 'status', phase: 'answering', text: registry.size ? `reading ${registry.size} sources` : 'thinking' });
    const result = await runAgent({
      llm: deps.llm,
      search: deps.search,
      system: buildSystem(askedAt, input.timezone),
      history: historyMessages(recent),
      userContent: prepared.userContent,
      registry,
      signal,
      emit,
      startedAt,
      allowTools: !trivial,
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
      timings: { firstTokenMs: result.firstTokenMs, totalMs: Date.now() - startedAt, planMs: prepared.planMs, searchMs: prepared.searchMs, rounds: result.rounds },
    });
  } catch (err) {
    if (signal.aborted) return;
    const llmError = err instanceof LLMError ? err : undefined;
    console.error('[turn] failed', err);
    emit({ type: 'error', kind: llmError?.kind ?? 'unknown', message: llmError?.userMessage ?? 'Something went wrong. Try again.' });
  }
}

interface PrepareCtx {
  askedAt: Date;
  recent: Turn[];
  registry: SourceRegistry;
  emit: Emit;
  signal: AbortSignal;
}

/** Dates and recall are deterministic and local; the planner and prefetch are the only network steps before answering. */
async function prepare(deps: TurnDeps, input: Required<TurnInput>, ctx: PrepareCtx): Promise<Prepared> {
  const { askedAt, emit, signal } = ctx;
  const nowMs = askedAt.getTime();
  const dates = recallRanges(resolveDates(input.message, askedAt, input.timezone));
  const cuePast = mentionsPastConversation(input.message);
  // Cheap first look at history so the planner can write re-check queries for the right products.
  const preRecall = cuePast || dates.length ? gatherRecall(deps.store, input.userId, dates, input.message, nowMs) : undefined;

  let plan;
  let planMs: number | undefined;
  if (config.plannerEnabled) {
    emit({ type: 'status', phase: 'planning', text: 'planning' });
    const t = Date.now();
    plan = await planTurn({
      llm: deps.llm,
      message: input.message,
      now: askedAt,
      timezone: input.timezone,
      recentTurns: ctx.recent.slice(-2),
      recalled: preRecall ? recalledTurns(preRecall) : [],
      timeoutMs: config.plannerTimeoutMs,
      signal,
    });
    planMs = Date.now() - t;
  }

  const referencesPast = cuePast || plan?.referencesPast === true;
  let ranges: DateRange[] = [];
  let recall: string | undefined;
  let recalled: Turn[] = [];
  if (referencesPast) {
    const hinted = (plan?.timeExpressions ?? []).flatMap((e) => resolveDates(e, askedAt, input.timezone));
    ranges = recallRanges(uniqueRanges([...dates, ...hinted]));
    emit({ type: 'status', phase: 'recalling', text: ranges.length ? `checking history for ${ranges.map((d) => d.label).join(', ')}` : 'checking past conversations' });
    const data = gatherRecall(deps.store, input.userId, ranges, [plan?.recallQuery, input.message].filter(Boolean).join(' '), nowMs);
    recall = formatRecall(data, input.timezone);
    recalled = recalledTurns(data);
  }

  const notes: string[] = [];
  let prefetched: string | undefined;
  let searchMs: number | undefined;
  if (plan?.needsSearch) {
    const t = Date.now();
    const result = await prefetch(deps.search, ctx.registry, plan.searchQueries, {
      freshness: plan.freshness,
      since: earliestLocalDate(recalled, input.timezone),
      checkedAt: formatInZone(askedAt, input.timezone),
      signal,
      emit,
    });
    searchMs = Date.now() - t;
    prefetched = result.block;
    if (result.failures === result.total) {
      notes.push('Web search failed for every query just now. Tell the user you could not check the web, and answer from general knowledge clearly marked as unverified.');
    }
    if (ctx.registry.size) emit({ type: 'sources', sources: ctx.registry.all() });
  }

  return { userContent: buildUserContent(input.message, { recall, prefetched, dates: ranges, notes }, input.timezone), planMs, searchMs };
}

function uniqueRanges(ranges: DateRange[]): DateRange[] {
  const seen = new Set<string>();
  return ranges.filter((r) => {
    const key = `${r.start.getTime()}-${r.end.getTime()}`;
    return !seen.has(key) && seen.add(key);
  });
}

function earliestLocalDate(turns: Turn[], timezone: string): string | undefined {
  if (!turns.length) return undefined;
  const first = Math.min(...turns.map((t) => t.createdAtMs));
  return isoDate(wallClock(new Date(first), timezone));
}
