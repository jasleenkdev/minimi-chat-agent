import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { Source } from '../../../shared/types';

const CITATION = /\[(\d{1,2}(?:\s*,\s*\d{1,2})*)\](?!\()/g;

export function citedNumbers(text: string): Set<number> {
  const out = new Set<number>();
  for (const m of text.matchAll(CITATION)) for (const n of m[1].split(',')) out.add(Number(n.trim()));
  return out;
}

/** Turns [3] and [3, 5] into links the renderer swaps for citation chips; real markdown links are left alone. */
export function linkCitations(text: string): string {
  return text.replace(CITATION, (_, list: string) =>
    list
      .split(',')
      .map((n) => `[${n.trim()}](cite:${n.trim()})`)
      .join(''),
  );
}

export function Markdown({ text, sources }: { text: string; sources: Source[] }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      urlTransform={(url) => url}
      components={{
        a({ href, children }) {
          if (href?.startsWith('cite:')) {
            const n = Number(href.slice(5));
            const source = sources.find((s) => s.n === n);
            if (!source) return null;
            return (
              <a className="cite" href={source.url} target="_blank" rel="noreferrer" title={`${source.title} · ${source.domain}`}>
                {n}
              </a>
            );
          }
          const safe = href && /^https?:/.test(href) ? href : undefined;
          return (
            <a href={safe} target="_blank" rel="noreferrer">
              {children}
            </a>
          );
        },
        table({ children }) {
          return (
            <div className="table-wrap">
              <table>{children}</table>
            </div>
          );
        },
      }}
    >
      {linkCitations(text)}
    </ReactMarkdown>
  );
}
