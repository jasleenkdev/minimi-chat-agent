import { useRef, useState } from 'react';
import type { Source } from '../../shared/types';
import { streamChat } from './api';
import { Markdown } from './Markdown';

interface UiMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  sources: Source[];
}

const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;

export function App() {
  const [conversationId] = useState(() => crypto.randomUUID());
  const [messages, setMessages] = useState<UiMessage[]>([]);
  const [input, setInput] = useState('');
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  async function send() {
    const text = input.trim();
    if (!text || busy) return;
    setInput('');
    const assistantId = crypto.randomUUID();
    setMessages((m) => [...m, { id: crypto.randomUUID(), role: 'user', content: text, sources: [] }, { id: assistantId, role: 'assistant', content: '', sources: [] }]);
    const update = (fn: (m: UiMessage) => UiMessage) => setMessages((all) => all.map((m) => (m.id === assistantId ? fn(m) : m)));

    const controller = new AbortController();
    abortRef.current = controller;
    setBusy(true);
    try {
      await streamChat({ conversationId, message: text, timezone }, (e) => {
        if (e.type === 'status') setStatus(e.text);
        else if (e.type === 'sources') update((m) => ({ ...m, sources: e.sources }));
        else if (e.type === 'token') {
          setStatus('');
          update((m) => ({ ...m, content: m.content + e.text }));
        } else if (e.type === 'error') update((m) => ({ ...m, content: m.content + `\n\n_${e.message}_` }));
      }, controller.signal);
    } catch (err) {
      if (!controller.signal.aborted) update((m) => ({ ...m, content: `_${(err as Error).message}_` }));
    } finally {
      setBusy(false);
      setStatus('');
    }
  }

  return (
    <main>
      {messages.map((m) => (
        <div key={m.id} className={m.role}>
          {m.role === 'assistant' ? <Markdown text={m.content} sources={m.sources} /> : <p>{m.content}</p>}
          {m.sources.length > 0 && (
            <ol>
              {m.sources.map((s) => (
                <li key={s.n}>
                  <a href={s.url} target="_blank" rel="noreferrer">{s.title}</a> {s.domain}
                </li>
              ))}
            </ol>
          )}
        </div>
      ))}
      {status && <p className="status">{status}</p>}
      <form onSubmit={(e) => { e.preventDefault(); void send(); }}>
        <input value={input} onChange={(e) => setInput(e.target.value)} placeholder="Ask anything" />
        {busy ? <button type="button" onClick={() => abortRef.current?.abort()}>Stop</button> : <button type="submit">Send</button>}
      </form>
    </main>
  );
}
