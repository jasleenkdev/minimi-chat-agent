export type Topic = 'general' | 'news';
export type TimeRange = 'day' | 'week' | 'month' | 'year';

export interface SearchOptions {
  topic?: Topic;
  timeRange?: TimeRange;
  /** YYYY-MM-DD; results published on or after this date. */
  startDate?: string;
  includeDomains?: string[];
  maxResults?: number;
  signal?: AbortSignal;
}

export interface SearchResult {
  url: string;
  title: string;
  content: string;
  publishedDate?: string;
  score: number;
}

export interface SearchProvider {
  readonly name: string;
  search(query: string, opts: SearchOptions): Promise<SearchResult[]>;
}

export class SearchError extends Error {
  constructor(
    readonly kind: 'auth' | 'rate_limited' | 'timeout' | 'aborted' | 'failed',
    message: string,
  ) {
    super(message);
    this.name = 'SearchError';
  }
}
