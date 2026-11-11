import type { Turn } from '../store/repo';
import type { PlannedQuery } from './planner';

const MAX_PRODUCTS = 5;
export const MAX_RECHECK_QUERIES = 10;

const RECHECK_CUE =
  /\b(?:chang(?:e|ed|es)|still\s+(?:correct|true|accurate|valid|right|the case|current)|any\s+(?:updates?|news)|anything\s+new|up\s+to\s+date|out\s*dated|different\s+now|ship(?:ped)?|launch(?:ed)?|release[sd]?|raised|cut|dropped)\b/i;

/** "Has any of them changed?", "Is your answer still correct?" */
export function isRecheckRequest(message: string): boolean {
  return RECHECK_CUE.test(message);
}

/** Products to re-check: extracted entities first, then claim entities for turns that were never indexed. */
export function recheckProducts(turns: Turn[]): string[] {
  const names = turns.flatMap((t) => (t.entities.length ? t.entities : t.claims.map((c) => c.entity)));
  return [...new Set(names.map((n) => n.trim()).filter(Boolean))].slice(0, MAX_PRODUCTS);
}

/**
 * Code guarantees every recalled product gets checked; the planner's own queries are added after these.
 * Pricing pages are often undated, so only the news query is limited to "since then".
 */
export function recheckQueries(products: string[], monthYear: string): PlannedQuery[] {
  return products.flatMap((p) => [
    { query: `${p} pricing`, kind: 'web' as const },
    { query: `${p} news announcement ${monthYear}`, kind: 'news' as const },
  ]);
}

export function mergeQueries(primary: PlannedQuery[], extra: PlannedQuery[], max = MAX_RECHECK_QUERIES): PlannedQuery[] {
  const seen = new Set<string>();
  return [...primary, ...extra]
    .filter((q) => {
      const key = q.query.toLowerCase();
      return !seen.has(key) && seen.add(key);
    })
    .slice(0, max);
}

/** Spells out the exact rows the answer must cover, so no recalled item silently drops out of the comparison. */
export function recheckNote(turns: Turn[], products: string[]): string {
  const claims = turns.flatMap((t) => t.claims);
  const dates = [...new Set(claims.map((c) => c.asOf))].join(', ');
  const rows = claims.length
    ? claims.map((c) => `- ${c.entity} | ${c.attribute} | ${c.value} (as of ${c.asOf})`).join('\n')
    : products.map((p) => `- ${p} | (no specific figures were recorded; describe what was said from the recalled answer)`).join('\n');
  return [
    `RE-CHECK REQUEST: the user wants to know whether what you said before still holds${dates ? ` (said on ${dates})` : ''}.`,
    'Items recorded from that answer:',
    rows,
    'Lead with a one-sentence verdict. Then a table: Item | What I said then | Now | Changed? | Source. One row per product (combine its plans in one row if that keeps it readable).',
    '"Now" must come from this turn\'s search results with a citation. If no fresh result covers an item, write "Could not verify" and do not claim it is unchanged.',
    'Write "No" under Changed? only if every figure in the row matches. If any figure differs, write "Yes" and name it, or "Sources differ" if the fresh sources disagree with each other.',
    `After the table, list notable launches or announcements dated on or after ${dates || 'that date'} (check each result's published date and leave out anything older), with citations, or say none turned up.`,
  ].join('\n');
}
