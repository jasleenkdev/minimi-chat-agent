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
    return (json.results ?? []).map((r) => ({
      url: r.url,
      title: r.title,
      content: r.content,
      publishedDate: r.published_date ? new Date(r.published_date).toISOString().slice(0, 10) : undefined,
      score: r.score,
    }));
  }
}
