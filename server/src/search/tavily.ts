import { SearchError, type SearchOptions, type SearchProvider, type SearchResult } from './types';

interface TavilyResult {
  url: string;
  title: string;
  content: string;
  score: number;
  published_date?: string | null;
}

export class TavilySearch implements SearchProvider {
  readonly name = 'tavily';

  constructor(private apiKey: string) {}

  async search(query: string, opts: SearchOptions): Promise<SearchResult[]> {
    const body: Record<string, unknown> = {
      query,
      topic: opts.topic ?? 'general',
      search_depth: 'basic',
      chunks_per_source: 3,
      max_results: opts.maxResults ?? 6,
      include_published_date: true,
    };
    if (opts.timeRange) body.time_range = opts.timeRange;
    if (opts.startDate) body.start_date = opts.startDate;
    if (opts.includeDomains?.length) {
      body.include_domains = opts.includeDomains;
      // "prefer" ranks these domains first without hiding everything else.
      body.include_domains_mode = 'prefer';
    }

    let res: Response;
    try {
      res = await fetch('https://api.tavily.com/search', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${this.apiKey}` },
        body: JSON.stringify(body),
        signal: opts.signal,
      });
    } catch (err) {
      if (opts.signal?.aborted) {
        const reason = opts.signal.reason;
        throw new SearchError(reason instanceof DOMException && reason.name === 'TimeoutError' ? 'timeout' : 'aborted', 'search aborted');
      }
      throw new SearchError('failed', err instanceof Error ? err.message : String(err));
    }

    if (res.status === 401 || res.status === 403) throw new SearchError('auth', 'search API key was rejected');
    if (res.status === 429 || res.status === 432 || res.status === 433) throw new SearchError('rate_limited', `search rate limited (${res.status})`);
    if (!res.ok) throw new SearchError('failed', `search failed with ${res.status}`);

    const json = (await res.json()) as { results?: TavilyResult[] };
    const isNews = body.topic === 'news';
    return (json.results ?? []).map((r) => ({ url: r.url, title: r.title, content: r.content, score: r.score, ...resultDates(r, isNews) }));
  }
}

/**
 * Tavily's published_date is its estimate of when a page was "published or last updated". For news results
 * that is the article date; for general web pages it is often a later update and can be wrong, so there it is
 * kept only as an estimate. A date in the URL path (/2026/10/16/) is the publish date wherever it appears.
 */
export function resultDates(r: Pick<TavilyResult, 'url' | 'published_date'>, isNews: boolean): { publishedDate?: string; pageDate?: string } {
  const fromUrl = urlDate(r.url);
  const estimate = isoDay(r.published_date);
  if (fromUrl) return { publishedDate: fromUrl };
  if (isNews && estimate) return { publishedDate: estimate };
  return estimate ? { pageDate: estimate } : {};
}

export function urlDate(url: string): string | undefined {
  let path: string;
  try {
    path = new URL(url).pathname;
  } catch {
    return undefined;
  }
  const m = path.match(/\/((?:19|20)\d{2})[/-](\d{1,2})[/-](\d{1,2})(?=[/-]|$)/);
  if (!m) return undefined;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const date = new Date(Date.UTC(y, mo - 1, d));
  if (date.getUTCMonth() !== mo - 1 || date.getUTCDate() !== d) return undefined;
  return date.toISOString().slice(0, 10);
}

function isoDay(raw: string | null | undefined): string | undefined {
  if (!raw) return undefined;
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString().slice(0, 10);
}
