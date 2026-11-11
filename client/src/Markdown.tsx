import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { Source } from '../../shared/types';

/** Turns [3] into a link the renderer can swap for a citation chip; leaves real markdown links alone. */
function linkCitations(text: string): string {
  return text.replace(/\[(\d{1,2})\](?!\()/g, '[$1](cite:$1)');
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
              <a className="cite" href={source.url} target="_blank" rel="noreferrer" title={`${source.title} (${source.domain})`}>
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
      }}
    >
      {linkCitations(text)}
    </ReactMarkdown>
  );
}
