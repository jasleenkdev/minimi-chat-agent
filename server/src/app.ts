import { Hono } from 'hono';
import type { TurnDeps } from './agent/turn';
import { chatRoutes } from './routes/chat';
import { conversationRoutes } from './routes/conversations';

export function createApp(deps: TurnDeps) {
  const app = new Hono().basePath('/api');
  app.get('/health', (c) => c.json({ ok: true, provider: deps.llm.name, model: deps.llm.modelFor('main') }));
  app.route('/', chatRoutes(deps));
  app.route('/', conversationRoutes(deps.store));
  return app;
}
