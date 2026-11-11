import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import type { ChatRequestBody, ServerEvent } from '../../../shared/types';
import { handleTurn, type TurnDeps } from '../agent/turn';

export function chatRoutes(deps: TurnDeps) {
  const app = new Hono();

  app.post('/chat', async (c) => {
    const body = await c.req.json<Partial<ChatRequestBody>>().catch(() => ({}) as Partial<ChatRequestBody>);
    const message = body.message?.trim();
    if (!message || !body.conversationId) return c.json({ error: 'conversationId and message are required' }, 400);
    const timezone = validTimezone(body.timezone) ? body.timezone! : 'UTC';

    return streamSSE(c, async (stream) => {
      // One controller per request: a client disconnect cancels the model call and any pending searches.
      const controller = new AbortController();
      stream.onAbort(() => controller.abort());
      // Writes are chained so events keep their order and all of them flush before the stream closes.
      let pending = Promise.resolve();
      const emit = (event: ServerEvent) => {
        pending = pending.then(() => (stream.aborted ? undefined : stream.writeSSE({ event: event.type, data: JSON.stringify(event) })));
      };
      await handleTurn(deps, { conversationId: body.conversationId!, message, timezone }, emit, controller.signal);
      await pending;
    });
  });

  return app;
}

function validTimezone(tz: unknown): boolean {
  if (typeof tz !== 'string' || !tz) return false;
  try {
    new Intl.DateTimeFormat('en', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}
