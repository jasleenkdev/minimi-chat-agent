import type { ChatRequestBody, ConversationDTO, MessageDTO, ServerEvent } from '../../shared/types';

export async function listConversations(): Promise<ConversationDTO[]> {
  const res = await fetch('/api/conversations');
  if (!res.ok) throw new Error('Could not load conversations');
  return res.json();
}

export async function getMessages(conversationId: string): Promise<MessageDTO[]> {
  const res = await fetch(`/api/conversations/${encodeURIComponent(conversationId)}/messages`);
  if (!res.ok) throw new Error('Could not load messages');
  return res.json();
}

export async function deleteConversation(conversationId: string): Promise<void> {
  await fetch(`/api/conversations/${encodeURIComponent(conversationId)}`, { method: 'DELETE' });
}

/** POSTs a message and parses the SSE response by hand, since EventSource only supports GET. */
export async function streamChat(body: ChatRequestBody, onEvent: (e: ServerEvent) => void, signal: AbortSignal): Promise<void> {
  const res = await fetch('/api/chat', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok || !res.body) {
    const text = await res.text().catch(() => '');
    throw new Error(text || `Request failed (${res.status})`);
  }

  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += value;
    let boundary: number;
    while ((boundary = buffer.indexOf('\n\n')) !== -1) {
      const frame = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      const data = frame
        .split('\n')
        .filter((line) => line.startsWith('data:'))
        .map((line) => line.slice(5).trimStart())
        .join('\n');
      if (data) onEvent(JSON.parse(data) as ServerEvent);
    }
  }
}
