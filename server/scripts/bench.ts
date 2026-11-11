import { handleTurn } from '../src/agent/turn';
import { systemClock } from '../src/clock';
import { config } from '../src/config';
import { createLLM } from '../src/llm';
import { SearchService } from '../src/search/service';
import { TavilySearch } from '../src/search/tavily';
import { openDb } from '../src/store/db';
import { Store } from '../src/store/repo';
import type { ServerEvent } from '../../shared/types';

const QUESTIONS = [
  'How much does HubSpot Sales Hub Professional cost per seat right now?',
  'What changed in the latest PostgreSQL release?',
  'Who is the current CEO of Intel?',
];

const llm = createLLM();

async function run(question: string) {
  // Fresh store and search cache each run so nothing is warm.
  const store = new Store(openDb(':memory:'));
  store.ensureUser();
  const deps = { llm, search: new SearchService(new TavilySearch(config.tavilyApiKey)), clock: systemClock, store };
  let done: Extract<ServerEvent, { type: 'done' }> | undefined;
  let error: string | undefined;
  await handleTurn(deps, { conversationId: crypto.randomUUID(), message: question, timezone: 'Asia/Kolkata' }, (e) => {
    if (e.type === 'done') done = e;
    if (e.type === 'error') error = e.message;
  }, new AbortController().signal);
  return { question, firstTokenMs: done?.timings.firstTokenMs, totalMs: done?.timings.totalMs, rounds: done?.timings.rounds, error };
}

const rows = [];
for (const q of QUESTIONS) {
  rows.push(await run(q));
  await new Promise((r) => setTimeout(r, 4000));
}
console.table(rows);
const ok = rows.filter((r) => r.firstTokenMs !== undefined);
const median = (xs: number[]) => xs.sort((a, b) => a - b)[Math.floor(xs.length / 2)];
console.log(`mode=${process.env.PLANNER ?? 'on'} median first token ${median(ok.map((r) => r.firstTokenMs!))}ms, median total ${median(ok.map((r) => r.totalMs!))}ms`);
