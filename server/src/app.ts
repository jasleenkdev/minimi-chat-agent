import { Hono } from 'hono';

export function createApp() {
  const app = new Hono().basePath('/api');
  app.get('/health', (c) => c.json({ ok: true }));
  return app;
}
