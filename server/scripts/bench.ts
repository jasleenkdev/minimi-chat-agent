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
  const statuses: string[] = [];
  await handleTurn(deps, { conversationId: crypto.randomUUID(), message: question, timezone: 'Asia/Kolkata' }, (e) => {
    if (e.type === 'done') done = e;
    if (e.type === 'error') error = e.message;
    if (e.type === 'status') statuses.push(e.text);
  }, new AbortController().signal);
  if (process.env.VERBOSE) console.log(question, statuses);
  const t = done?.timings;
  return { question: question.slice(0, 40), firstTokenMs: t?.firstTokenMs, planMs: t?.planMs, searchMs: t?.searchMs, totalMs: t?.totalMs, rounds: t?.rounds, error };
}

const reps = Number(process.env.REPS ?? 1);
const rows: Awaited<ReturnType<typeof run>>[] = [];
const byMode: Record<string, number[]> = { on: [], off: [] };
// Interleave modes per question so both see the same provider conditions.
for (let rep = 0; rep < reps; rep++) {
  for (const q of QUESTIONS) {
    for (const mode of ['on', 'off'] as const) {
      config.plannerEnabled = mode === 'on';
      const row = { mode, ...(await run(q)) };
      rows.push(row);
      if (row.firstTokenMs !== undefined) byMode[mode].push(row.firstTokenMs);
      await new Promise((r) => setTimeout(r, 3000));
    }
  }
}
console.table(rows);
const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
for (const mode of ['on', 'off']) {
  console.log(`planner ${mode}: median first token ${median(byMode[mode])}ms over ${byMode[mode].length} runs (model ${llm.modelFor('main')})`);
}
