import { serve } from '@hono/node-server';
import { createApp } from './app';
import { createClock } from './clock';
import { config } from './config';
import { createLLM } from './llm';
import { SearchService } from './search/service';
import { TavilySearch } from './search/tavily';

if (!config.tavilyApiKey) console.warn('TAVILY_API_KEY is not set: answers will say they could not check the web.');

const app = createApp({
  llm: createLLM(),
  search: new SearchService(new TavilySearch(config.tavilyApiKey)),
  clock: createClock(config.devNow),
});

serve({ fetch: app.fetch, port: config.port }, (info) => {
  console.log(`api listening on http://localhost:${info.port}`);
});
