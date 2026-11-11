import { LruCache } from './cache';
import { SearchError, type SearchOptions, type SearchProvider, type SearchResult } from './types';

const TIMEOUT_MS = 8_000;
const EXTRACT_CHARS = 900;

export interface SearchOutcome {
  query: string;
  results: SearchResult[];
  error?: SearchError;
  cached: boolean;
}

export function normalizeQuery(query: string): string {
  return query
    .toLowerCase()
    .replace(/[“”"'`?!.,;:]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Strip tracking params and trailing slashes so the same page found twice dedupes. */
export function canonicalUrl(url: string): string {
  try {
    const u = new URL(url);
    u.hash = '';
    for (const key of [...u.searchParams.keys()]) {
      if (key.startsWith('utm_') || key === 'ref' || key === 'gclid') u.searchParams.delete(key);
    }
    return `${u.hostname.replace(/^www\./, '')}${u.pathname.replace(/\/$/, '')}${u.search}`;
  } catch {
    return url;
  }
}

/** Trim to a sentence boundary so extracts stay small but readable. */
export function trimExtract(text: string, max = EXTRACT_CHARS): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max);
  const lastStop = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('] '));
  return (lastStop > max * 0.6 ? cut.slice(0, lastStop + 1) : cut) + ' …';
}

/**
 * Pricing and release facts should come from the vendor, not a reseller blog.
 * A host whose name matches a word in the query (hubspot.com for "hubspot pricing") gets a boost.
 */
export function officialBoost(query: string, url: string): number {
  let host: string;
  try {
    host = new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return 0;
  }
  const brand = host.split('.').slice(-2, -1)[0] ?? '';
  const words = normalizeQuery(query).split(' ').filter((w) => w.length >= 4);
  const matches = words.some((w) => brand === w || brand.replace(/-/g, '') === w);
  if (!matches) return 0;
  const isDocs = /pricing|changelog|release|blog|news|docs/.test(url);
  return isDocs ? 0.35 : 0.25;
}

export class SearchService {
  private cache = new LruCache<SearchResult[]>(200, 15 * 60_000);

  constructor(private provider: SearchProvider) {}

  async search(query: string, opts: SearchOptions = {}): Promise<SearchOutcome> {
    const normalized = normalizeQuery(query);
    const key = JSON.stringify([normalized, opts.topic, opts.timeRange, opts.startDate, opts.includeDomains, opts.maxResults]);
    const hit = this.cache.get(key);
    if (hit) return { query, results: hit, cached: true };

    const timeout = AbortSignal.timeout(TIMEOUT_MS);
    const signal = opts.signal ? AbortSignal.any([opts.signal, timeout]) : timeout;
    try {
      const raw = await this.provider.search(normalized, { ...opts, signal });
      const results = this.rank(query, raw);
      this.cache.set(key, results);
      return { query, results, cached: false };
    } catch (err) {
      const error = err instanceof SearchError ? err : new SearchError('failed', String(err));
      return { query, results: [], error, cached: false };
    }
  }

  private rank(query: string, results: SearchResult[]): SearchResult[] {
    const seen = new Set<string>();
    return results
      .filter((r) => {
        const key = canonicalUrl(r.url);
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .map((r) => ({ ...r, content: trimExtract(r.content), score: r.score + officialBoost(query, r.url) }))
      .sort((a, b) => b.score - a.score);
  }
}
