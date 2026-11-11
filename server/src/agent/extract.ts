import type { Source } from '../../../shared/types';
import type { LLMProvider } from '../llm/types';
import type { Claim, Store } from '../store/repo';

interface Extraction {
  summary: string;
  entities: string[];
  claims: { entity: string; attribute: string; value: string; source: number }[];
}

const SCHEMA = {
  type: 'object',
  properties: {
    summary: { type: 'string' },
    entities: { type: 'array', items: { type: 'string' }, maxItems: 10 },
    claims: {
      type: 'array',
      maxItems: 12,
      items: {
        type: 'object',
        properties: {
          entity: { type: 'string' },
          attribute: { type: 'string' },
          value: { type: 'string' },
          source: { type: 'integer' },
        },
        required: ['entity', 'attribute', 'value', 'source'],
      },
    },
  },
  required: ['summary', 'entities', 'claims'],
};

const SYSTEM = `You index a finished chat turn so it can be found and re-checked later. Output JSON only.

summary: one line, at most 25 words: what the user wanted and the gist of the answer. Name the products or topics.
entities: the products, companies, plans, people or places the turn is about (at most 10), using their full names.
claims: facts the assistant stated that can change over time and can be re-checked: prices, plan limits, versions, release dates, launches, who holds a role, availability. For each:
- entity: the specific thing, e.g. "HubSpot Sales Hub Starter" rather than "HubSpot"
- attribute: what was measured, e.g. "price per seat per month (billed annually)"
- value: exactly as the assistant stated it, with currency and units
- source: the citation number [n] that supports it in the answer, or 0 if uncited
Only include facts that appear in the answer. No opinions, recommendations or general knowledge. Use [] if there are none.`;

export interface ExtractInput {
  llm: LLMProvider;
  store: Store;
  userId: string;
  assistantMessageId: string;
  question: string;
  answer: string;
  sources: Source[];
  /** The user's local date of the turn: what "as of" means for every claim. */
  localDate: string;
}

export async function extractTurn(input: ExtractInput): Promise<void> {
  const prompt = [
    `Date of this turn: ${input.localDate}`,
    `User asked:\n${input.question}`,
    `Assistant answered:\n${input.answer}`,
    input.sources.length ? `Citations:\n${input.sources.map((s) => `[${s.n}] ${s.url}`).join('\n')}` : 'Citations: none',
  ].join('\n\n');

  const result = await input.llm.generateJson<Extraction>({
    tier: 'fast',
    system: SYSTEM,
    prompt,
    schema: SCHEMA,
    signal: AbortSignal.timeout(30_000),
  });

  const byNumber = new Map(input.sources.map((s) => [s.n, s.url]));
  const claims: Claim[] = (result.claims ?? [])
    .filter((c) => c.entity?.trim() && c.attribute?.trim() && c.value?.trim())
    .map((c) => ({ entity: c.entity.trim(), attribute: c.attribute.trim(), value: c.value.trim(), sourceUrl: byNumber.get(c.source), asOf: input.localDate }));
  const entities = [...new Set((result.entities ?? []).map((e) => e.trim()).filter(Boolean))];

  input.store.saveExtraction(input.assistantMessageId, input.userId, (result.summary ?? '').trim(), entities, claims);
}
