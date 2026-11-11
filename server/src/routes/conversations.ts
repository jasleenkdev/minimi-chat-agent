import { Hono } from 'hono';
import { LOCAL_USER, type Store } from '../store/repo';

export function conversationRoutes(store: Store) {
  const app = new Hono();
  app.get('/conversations', (c) => c.json(store.listConversations(LOCAL_USER)));
  app.get('/conversations/:id/messages', (c) => c.json(store.getMessages(c.req.param('id'))));
  app.delete('/conversations/:id', (c) => {
    const deleted = store.deleteConversation(LOCAL_USER, c.req.param('id'));
    return deleted ? c.body(null, 204) : c.json({ error: 'not found' }, 404);
  });
  return app;
}
