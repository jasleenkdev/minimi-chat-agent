import type { Source } from '../../../shared/types';
import { fullDate, messageTime } from '../format';
import { Markdown, citedNumbers } from './Markdown';

export interface UiMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: string;
  sources: Source[];
  error?: string;
  pending?: boolean;
}

function SourceList({ sources, label }: { sources: Source[]; label: string }) {
  return (
    <ol className="sources" aria-label={label}>
      {sources.map((s) => (
        <li key={s.n}>
          <a href={s.url} target="_blank" rel="noreferrer" title={s.title}>
            <span className="n">{s.n}</span>
            <span className="domain">{s.domain}</span>
            {s.publishedDate && <span className="date">{s.publishedDate}</span>}
          </a>
        </li>
      ))}
    </ol>
  );
}

export function Message({ message }: { message: UiMessage }) {
  const { role, content, sources, createdAt, error, pending } = message;
  // While streaming, every source is shown; once done, the ones the answer actually cites come first.
  const cited = citedNumbers(content);
  const used = pending ? sources : sources.filter((s) => cited.has(s.n));
  const unused = pending ? [] : sources.filter((s) => !cited.has(s.n));

  return (
    <article className={`msg ${role}`}>
      <div className="bubble">
        {role === 'assistant' ? <Markdown text={content} sources={sources} /> : <p>{content}</p>}
        {pending && !content && <span className="cursor" aria-hidden />}
        {error && <p className="error">{error}</p>}
      </div>
      {role === 'assistant' && used.length > 0 && <SourceList sources={used} label="Sources" />}
      {role === 'assistant' && unused.length > 0 && (
        <details className="more">
          <summary>{used.length ? `${unused.length} more searched` : `${unused.length} sources searched`}</summary>
          <SourceList sources={unused} label="Other sources searched" />
        </details>
      )}
      {!pending && (
        <time dateTime={createdAt} title={fullDate(createdAt)}>
          {messageTime(createdAt)}
        </time>
      )}
    </article>
  );
}
