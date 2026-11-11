import { describe, expect, it } from 'vitest';
import { SourceRegistry, formatResults } from '../src/agent/sources';
import { resultDates, urlDate } from '../src/search/tavily';

describe('resultDates', () => {
  it('treats a general-topic date as an estimate, not a publish date', () => {
    expect(resultDates({ url: 'https://example.org/docs/release', published_date: 'Thu, 24 Sep 2026 00:00:00 GMT' }, false)).toEqual({
      pageDate: '2026-09-24',
    });
  });

  it('trusts the date on news results', () => {
    expect(resultDates({ url: 'https://news.example.com/story', published_date: 'Fri, 16 Oct 2026 10:00:00 GMT' }, true)).toEqual({
      publishedDate: '2026-10-16',
    });
  });

  it('prefers a date in the URL path over the provider estimate', () => {
    expect(resultDates({ url: 'https://example.com/2026/10/19/some-story', published_date: 'Sat, 01 Nov 2026 00:00:00 GMT' }, false)).toEqual({
      publishedDate: '2026-10-19',
    });
  });

  it('returns nothing when there is no date', () => {
    expect(resultDates({ url: 'https://example.com/pricing', published_date: null }, false)).toEqual({});
  });
});

describe('urlDate', () => {
  it.each([
    ['https://site.com/blog/2026/10/16/title', '2026-10-16'],
    ['https://site.com/news/2025-09-25-launch', '2025-09-25'],
    ['https://site.com/2026/1/5/', '2026-01-05'],
  ])('reads %s', (url, expected) => expect(urlDate(url)).toBe(expected));

  it.each(['https://site.com/2026/13/40/x', 'https://site.com/v18/2/1', 'https://site.com/pricing', 'https://site.com/2026/10/'])(
    'ignores %s',
    (url) => expect(urlDate(url)).toBeUndefined(),
  );
});

describe('source dates in prompt and UI', () => {
  const registry = new SourceRegistry();
  const results = registry.add([
    { url: 'https://a.com/x', title: 'A', content: 'a', score: 1, publishedDate: '2026-10-16' },
    { url: 'https://b.com/y', title: 'B', content: 'b', score: 1, pageDate: '2026-09-24' },
    { url: 'https://c.com/z', title: 'C', content: 'c', score: 1 },
  ]);

  it('tells the model which dates are publish dates', () => {
    const text = formatResults(results);
    expect(text).toContain('(published 2026-10-16)');
    expect(text).toContain('(date unconfirmed: published or last updated around 2026-09-24)');
    expect(text).toContain('(publish date unknown)');
  });

  it('only sends real publish dates to the client', () => {
    const sources = registry.all();
    expect(sources.map((s) => s.publishedDate)).toEqual(['2026-10-16', undefined, undefined]);
    expect(sources.every((s) => !('pageDate' in s))).toBe(true);
  });
});
