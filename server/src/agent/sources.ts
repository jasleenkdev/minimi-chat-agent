import type { Source } from '../../../shared/types';
import { canonicalUrl } from '../search/service';
import type { SearchResult } from '../search/types';

export interface NumberedResult extends Source {
  content: string;
  pageDate?: string;
}

/** Gives every source a stable number for the whole turn so citations [n] match the list the UI shows. */
export class SourceRegistry {
  private byKey = new Map<string, NumberedResult>();

  add(results: SearchResult[]): NumberedResult[] {
    return results.map((r) => {
      const key = canonicalUrl(r.url);
      const existing = this.byKey.get(key);
      if (existing) return existing;
      const numbered: NumberedResult = {
        n: this.byKey.size + 1,
        url: r.url,
        title: r.title,
        domain: domainOf(r.url),
        publishedDate: r.publishedDate,
        pageDate: r.pageDate,
        content: r.content,
      };
      this.byKey.set(key, numbered);
      return numbered;
    });
  }

  all(): Source[] {
    return [...this.byKey.values()].map(({ content: _content, pageDate: _pageDate, ...source }) => source);
  }

  /** The text of every result the model was shown this turn, for evals. */
  texts(): string[] {
    return [...this.byKey.values()].map((r) => `${r.title}\n${r.content}`);
  }

  get size(): number {
    return this.byKey.size;
  }
}

export function domainOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

export function formatResults(results: NumberedResult[]): string {
  if (!results.length) return 'No results.';
  return results
    .map((r) => {
      const date = r.publishedDate
        ? ` (published ${r.publishedDate})`
        : r.pageDate
          ? ` (date unconfirmed: published or last updated around ${r.pageDate})`
          : ' (publish date unknown)';
      return `[${r.n}] ${r.title} — ${r.domain}${date}\nURL: ${r.url}\n${r.content}`;
    })
    .join('\n\n');
}
