import { useCallback, useEffect, useRef, useState } from 'react';
import type { ConversationDTO, ServerEvent } from '../../shared/types';
import { deleteConversation, getMessages, listConversations, streamChat } from './api';
import { Composer } from './components/Composer';
import { Message, type UiMessage } from './components/Message';
import { Sidebar } from './components/Sidebar';

const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;

const EXAMPLES = [
  'Shortlist 5 CRM tools for a 20-person sales team, with current per-seat pricing.',
  'What did I ask you yesterday? Is your answer still correct?',
  'Compare managed Postgres hosting: Neon, Supabase and RDS pricing.',
  'What are the biggest tech news stories this week?',
];

function idFromHash(): string | undefined {
  const match = /^#\/c\/([\w-]+)$/.exec(window.location.hash);
  return match?.[1];
}

export function App() {
  const [conversationId, setConversationId] = useState(() => idFromHash() ?? crypto.randomUUID());
  const [conversations, setConversations] = useState<ConversationDTO[]>([]);
  const [messages, setMessages] = useState<UiMessage[]>([]);
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  const refreshConversations = useCallback(() => {
    listConversations().then(setConversations).catch(() => undefined);
  }, []);

  useEffect(refreshConversations, [refreshConversations]);

  useEffect(() => {
    abortRef.current?.abort();
    getMessages(conversationId)
      .then((list) => setMessages(list.map((m) => ({ ...m }))))
      .catch(() => setMessages([]));
  }, [conversationId]);

  useEffect(() => {
    const onHash = () => {
      const id = idFromHash();
      if (id) setConversationId(id);
    };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: 'end' });
  }, [messages, status]);

  function open(id: string) {
    window.location.hash = `/c/${id}`;
    setConversationId(id);
    setSidebarOpen(false);
  }

  function newChat() {
    abortRef.current?.abort();
    history.replaceState(null, '', window.location.pathname);
    setConversationId(crypto.randomUUID());
    setMessages([]);
    setSidebarOpen(false);
  }

  async function remove(id: string) {
    await deleteConversation(id);
    if (id === conversationId) newChat();
    refreshConversations();
  }

  async function send(text: string) {
    const now = new Date().toISOString();
    const userId = crypto.randomUUID();
    const assistantId = crypto.randomUUID();
    setMessages((m) => [
      ...m,
      { id: userId, role: 'user', content: text, createdAt: now, sources: [] },
      { id: assistantId, role: 'assistant', content: '', createdAt: now, sources: [], pending: true },
    ]);
    const patch = (id: string, fn: (m: UiMessage) => UiMessage) => setMessages((all) => all.map((m) => (m.id === id ? fn(m) : m)));
    if (!idFromHash()) history.replaceState(null, '', `#/c/${conversationId}`);

    const controller = new AbortController();
    abortRef.current = controller;
    setBusy(true);
    setStatus('thinking');

    const onEvent = (e: ServerEvent) => {
      switch (e.type) {
        case 'status':
          setStatus(e.text);
          break;
        case 'sources':
          patch(assistantId, (m) => ({ ...m, sources: e.sources }));
          break;
        case 'token':
          setStatus('');
          patch(assistantId, (m) => ({ ...m, content: m.content + e.text }));
          break;
        case 'done':
          patch(assistantId, (m) => ({ ...m, pending: false, createdAt: e.createdAt }));
          patch(userId, (m) => ({ ...m, createdAt: e.askedAt }));
          break;
        case 'error':
          patch(assistantId, (m) => ({ ...m, pending: false, error: e.message }));
          break;
      }
    };

    try {
      await streamChat({ conversationId, message: text, timezone }, onEvent, controller.signal);
    } catch (err) {
      const message = controller.signal.aborted ? 'Stopped.' : 'Could not reach the server. Is it running?';
      patch(assistantId, (m) => ({ ...m, error: m.error ?? message }));
    } finally {
      patch(assistantId, (m) => ({ ...m, pending: false }));
      setBusy(false);
      setStatus('');
      refreshConversations();
    }
  }

  const title = conversations.find((c) => c.id === conversationId)?.title ?? 'New chat';

  return (
    <div className="app">
      <Sidebar
        conversations={conversations}
        activeId={conversationId}
        open={sidebarOpen}
        onSelect={open}
        onNew={newChat}
        onDelete={remove}
        onClose={() => setSidebarOpen(false)}
      />
      <main className="chat">
        <header>
          <button className="ghost menu" aria-label="Open conversations" onClick={() => setSidebarOpen(true)}>
            ☰
          </button>
          <h1>{title}</h1>
          <button className="ghost" onClick={newChat}>
            New chat
          </button>
        </header>

        <div className="scroll">
          <div className="thread">
            {messages.length === 0 && (
              <div className="empty">
                <p className="lead">Ask about anything current. I search the web, cite sources, and remember what we discussed and when.</p>
                <div className="examples">
                  {EXAMPLES.map((e) => (
                    <button key={e} className="example" onClick={() => void send(e)} disabled={busy}>
                      {e}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {messages.map((m) => (
              <Message key={m.id} message={m} />
            ))}
            {status && (
              <p className="status" role="status">
                <span className="dot" />
                {status}
              </p>
            )}
            <div ref={bottomRef} />
          </div>
        </div>

        <Composer busy={busy} onSend={(t) => void send(t)} onStop={() => abortRef.current?.abort()} />
      </main>
    </div>
  );
}
