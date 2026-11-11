import { serve } from '@hono/node-server';
import { createApp } from './app';
import { createClock } from './clock';
import { config } from './config';
import { createLLM } from './llm';
import { SearchService } from './search/service';
import { TavilySearch } from './search/tavily';
import { openDb } from './store/db';
import { Store } from './store/repo';

if (!config.tavilyApiKey) console.warn('TAVILY_API_KEY is not set: answers will say they could not check the web.');

const store = new Store(openDb(config.dbPath));
store.ensureUser();

const app = createApp({
  llm: createLLM(),
  search: new SearchService(new TavilySearch(config.tavilyApiKey)),
  clock: createClock(config.devNow),
  store,
});

serve({ fetch: app.fetch, port: config.port }, (info) => {
  console.log(`api listening on http://localhost:${info.port}`);
});
