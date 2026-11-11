import type { ServerEvent } from '../../../shared/types';
import type { SearchService } from '../search/service';
import type { TimeRange } from '../search/types';
import type { Freshness, PlannedQuery } from './planner';
import { formatResults, type SourceRegistry } from './sources';

export interface PrefetchResult {
  block: string;
  failures: number;
  total: number;
}

/**
 * Runs the planner's queries in parallel before the main model starts, so its first call already
 * has numbered sources instead of spending a round-trip deciding to search.
 */
export async function prefetch(
  search: SearchService,
  registry: SourceRegistry,
  queries: PlannedQuery[],
  opts: { freshness: Freshness; since?: string; checkedAt: string; signal: AbortSignal; emit: (e: ServerEvent) => void },
): Promise<PrefetchResult> {
  const timeRange: TimeRange | undefined = opts.freshness === 'any' ? undefined : opts.freshness;
  const outcomes = await Promise.all(
    queries.map((q) => {
      opts.emit({ type: 'status', phase: 'searching', text: `searching: ${q.query}` });
      const isNews = q.kind === 'news';
      return search.search(q.query, {
        topic: isNews ? 'news' : 'general',
        // News re-checks look from the recalled date onward; everything else uses the planner's window.
        startDate: isNews ? opts.since : undefined,
        timeRange: isNews && opts.since ? undefined : timeRange,
        // Many parallel queries (a re-check) keep fewer results each, so the prompt stays small and fast.
        maxResults: queries.length > 5 ? 3 : 5,
        signal: opts.signal,
      });
    }),
  );

  const sections = outcomes.map((o) => {
    if (o.error) return `Query: "${o.query}" -> search failed (${o.error.kind}).`;
    return `Query: "${o.query}"\n${formatResults(registry.add(o.results))}`;
  });
  const failures = outcomes.filter((o) => o.error).length;
  return {
    block: `<prefetched_results checked_at="${opts.checkedAt}">\n${sections.join('\n\n')}\n</prefetched_results>`,
    failures,
    total: outcomes.length,
  };
}
