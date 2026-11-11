import type { LLMProvider } from '../llm/types';
import type { Turn } from '../store/repo';
import { formatInZone } from './prompt';

export type Freshness = 'any' | 'day' | 'week' | 'month' | 'year';

export interface PlannedQuery {
  query: string;
  kind: 'web' | 'news';
}

export interface Plan {
  needsSearch: boolean;
  referencesPast: boolean;
  timeExpressions: string[];
  recallQuery: string;
  searchQueries: PlannedQuery[];
  freshness: Freshness;
}

const SCHEMA = {
  type: 'object',
  properties: {
    needsSearch: { type: 'boolean' },
    referencesPast: { type: 'boolean' },
    timeExpressions: { type: 'array', items: { type: 'string' } },
    recallQuery: { type: 'string' },
    searchQueries: {
      type: 'array',
      maxItems: 5,
      items: {
        type: 'object',
        properties: { query: { type: 'string' }, kind: { type: 'string', enum: ['web', 'news'] } },
        required: ['query', 'kind'],
      },
    },
    freshness: { type: 'string', enum: ['any', 'day', 'week', 'month', 'year'] },
  },
  required: ['needsSearch', 'referencesPast', 'timeExpressions', 'recallQuery', 'searchQueries', 'freshness'],
};

const SYSTEM = `You plan how a chat assistant with web search should handle the user's latest message. Output JSON only.

needsSearch: true when a good answer depends on facts that change or that must be exact: prices, plans, versions, releases, news, current events, who holds a role, availability, specific products or companies, statistics, schedules. Also true when the user asks whether something said earlier is still correct or has changed. False for greetings, thanks, chit-chat, rewriting or summarising text they gave, maths, coding help that needs no current docs, stable explanations, and pure memory questions like "what did I ask you on Monday?" that do not ask whether it is still true.

referencesPast: true only when the user refers to an earlier conversation with the assistant (what they asked, what the assistant said, something "we" did or decided before). Past events in the world do not count.

timeExpressions: the exact phrases that date that earlier conversation ("on Monday", "last Tuesday", "3 November"). Empty if none.

recallQuery: a few keywords to find that earlier conversation (topic, product names). Empty if referencesPast is false.

searchQueries: 0 to 5 specific, independent queries a researcher would type.
- Name products and vendors explicitly; resolve pronouns using the conversation and recalled history.
- For prices use "<product> pricing"; for releases use "<product> changelog" or "<product> release notes"; include the current month and year when recency matters.
- When the user asks whether earlier information changed, write targeted re-check queries per item from the recalled history: its pricing page and its recent news. Use kind "news" for announcements and launches, "web" for everything else.
- Prefer fewer, sharper queries. Use [] when needsSearch is false.

freshness: how recent results must be: "day", "week", "month", "year" or "any". Use "any" for pricing pages and reference facts; narrower windows only for news.`;

export interface PlannerInput {
  llm: LLMProvider;
  message: string;
  now: Date;
  timezone: string;
  recentTurns: Turn[];
  recalled: Turn[];
  timeoutMs: number;
  signal: AbortSignal;
}

/** Returns undefined on timeout or any failure; the caller then lets the main model decide with its tool. */
export async function planTurn(input: PlannerInput): Promise<Plan | undefined> {
  const signal = AbortSignal.any([input.signal, AbortSignal.timeout(input.timeoutMs)]);
  try {
    const plan = await input.llm.generateJson<Plan>({ tier: 'fast', system: SYSTEM, prompt: plannerPrompt(input), schema: SCHEMA, signal });
    return sanitize(plan);
  } catch (err) {
    if (!input.signal.aborted) console.warn(`[planner] skipped: ${err instanceof Error ? err.message.slice(0, 120) : err}`);
    return undefined;
  }
}

function plannerPrompt(input: PlannerInput): string {
  const parts = [`Now: ${formatInZone(input.now, input.timezone)} (${input.timezone})`];
  if (input.recentTurns.length) {
    parts.push(
      'Recent conversation:',
      ...input.recentTurns.map((t) => `User: ${clip(t.question, 300)}\nAssistant: ${clip(t.answer.replace(/\[\d{1,2}\]/g, ''), 400)}`),
    );
  }
  if (input.recalled.length) {
    parts.push(
      'Recalled history that may be relevant:',
      ...input.recalled.map((t) => {
        const date = new Date(t.createdAtMs).toISOString().slice(0, 10);
        const claims = t.claims.map((c) => `${c.entity}: ${c.attribute} = ${c.value}`).join('; ');
        return `- ${date}: asked "${clip(t.question, 200)}"${t.entities.length ? ` | entities: ${t.entities.join(', ')}` : ''}${claims ? ` | claims: ${claims}` : ''}`;
      }),
    );
  }
  parts.push(`Latest user message:\n${input.message}`);
  return parts.join('\n\n');
}

function sanitize(plan: Plan): Plan {
  const seen = new Set<string>();
  const searchQueries = (Array.isArray(plan.searchQueries) ? plan.searchQueries : [])
    .filter((q) => typeof q?.query === 'string' && q.query.trim())
    .map((q) => ({ query: q.query.trim(), kind: q.kind === 'news' ? ('news' as const) : ('web' as const) }))
    .filter((q) => !seen.has(q.query.toLowerCase()) && seen.add(q.query.toLowerCase()))
    .slice(0, 5);
  return {
    needsSearch: Boolean(plan.needsSearch) && searchQueries.length > 0,
    referencesPast: Boolean(plan.referencesPast),
    timeExpressions: (plan.timeExpressions ?? []).filter((t) => typeof t === 'string' && t.trim()),
    recallQuery: typeof plan.recallQuery === 'string' ? plan.recallQuery : '',
    searchQueries,
    freshness: ['day', 'week', 'month', 'year'].includes(plan.freshness) ? plan.freshness : 'any',
  };
}

function clip(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}
