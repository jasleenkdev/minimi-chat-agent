import { describe, expect, it, vi } from 'vitest';
import { LruCache } from '../src/search/cache';
import { SearchService, canonicalUrl, normalizeQuery, officialBoost, trimExtract } from '../src/search/service';
import { SearchError, type SearchProvider } from '../src/search/types';

function fakeProvider(impl: SearchProvider['search']): SearchProvider & { search: ReturnType<typeof vi.fn> } {
  return { name: 'fake', search: vi.fn(impl) };
}

describe('LruCache', () => {
  it('expires entries after the TTL', () => {
    let now = 0;
    const cache = new LruCache<number>(10, 1000, () => now);
    cache.set('a', 1);
    now = 999;
    expect(cache.get('a')).toBe(1);
    now = 2000;
    expect(cache.get('a')).toBeUndefined();
  });

  it('evicts the least recently used entry', () => {
    const cache = new LruCache<number>(2, 60_000);
    cache.set('a', 1);
    cache.set('b', 2);
    cache.get('a');
    cache.set('c', 3);
    expect(cache.get('b')).toBeUndefined();
    expect(cache.get('a')).toBe(1);
  });
});

describe('helpers', () => {
  it('normalizes queries so near-duplicates share a cache key', () => {
    expect(normalizeQuery('  HubSpot   Pricing? ')).toBe(normalizeQuery('hubspot pricing'));
  });

  it('canonicalizes urls for dedupe', () => {
    expect(canonicalUrl('https://www.hubspot.com/pricing/?utm_source=x#top')).toBe(canonicalUrl('https://hubspot.com/pricing'));
  });

  it('trims long extracts at a sentence boundary', () => {
    const text = 'First sentence is here. '.repeat(100);
    const out = trimExtract(text, 200);
    expect(out.length).toBeLessThanOrEqual(202);
    expect(out.endsWith('. …')).toBe(true);
  });

  it('boosts the vendor domain for vendor queries', () => {
    expect(officialBoost('hubspot sales hub pricing', 'https://www.hubspot.com/pricing/sales')).toBeGreaterThan(0);
    expect(officialBoost('hubspot sales hub pricing', 'https://someblog.io/hubspot-pricing')).toBe(0);
  });
});

describe('SearchService', () => {
  it('caches normalized queries and dedupes urls', async () => {
    const provider = fakeProvider(async () => [
      { url: 'https://a.com/x', title: 'A', content: 'a', score: 0.5 },
      { url: 'https://www.a.com/x/', title: 'A again', content: 'a', score: 0.4 },
      { url: 'https://b.com', title: 'B', content: 'b', score: 0.9 },
    ]);
    const svc = new SearchService(provider);
    const first = await svc.search('Foo Bar');
    const second = await svc.search('foo bar?');
    expect(first.results.map((r) => r.title)).toEqual(['B', 'A']);
    expect(second.cached).toBe(true);
    expect(provider.search).toHaveBeenCalledTimes(1);
  });

  it('returns an error outcome instead of throwing', async () => {
    const svc = new SearchService(fakeProvider(async () => {
      throw new SearchError('rate_limited', 'slow down');
    }));
    const out = await svc.search('anything');
    expect(out.results).toEqual([]);
    expect(out.error?.kind).toBe('rate_limited');
  });

  it('passes a timeout signal to the provider', async () => {
    const provider = fakeProvider(async (_q, opts) => {
      expect(opts.signal).toBeInstanceOf(AbortSignal);
      return [];
    });
    await new SearchService(provider).search('x');
    expect(provider.search).toHaveBeenCalledOnce();
  });
});
