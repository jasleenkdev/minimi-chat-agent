import type { ServerEvent } from '../../shared/types';
import { handleTurn } from '../src/agent/turn';
import { config } from '../src/config';
import { addDays, startOfDay, wallClock } from '../src/dates/zone';
import { createLLM } from '../src/llm';
import { formatInZone } from '../src/agent/prompt';
import { SearchService } from '../src/search/service';
import { TavilySearch } from '../src/search/tavily';
import { openDb } from '../src/store/db';
import { LOCAL_USER, Store } from '../src/store/repo';

/**
 * Replays real questions through the real agent with the clock set to past dates, so a fresh install
 * has history to ask about. Nothing is written by hand: every stored answer and price comes from a live run.
 */
const QUESTIONS = [
  { daysAgo: 6, hour: 10, minute: 30, message: 'We need a CRM for a 20-person sales team. Shortlist 5 options with current per-seat pricing.' },
  { daysAgo: 4, hour: 16, minute: 5, message: 'Which managed Postgres hosts are good for a small SaaS, and what do their entry plans cost?' },
  { daysAgo: 2, hour: 11, minute: 15, message: 'What is the latest stable version of Node.js, and when does it reach end of life?' },
  { daysAgo: 1, hour: 18, minute: 40, message: 'What are the best noise-cancelling headphones under $300 right now?' },
];

const timezone = process.env.SEED_TZ ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
const store = new Store(openDb(config.dbPath));
store.ensureUser();
const existing = new Set(store.listConversations(LOCAL_USER).map((c) => c.id));

const today = wallClock(new Date(), timezone);
let now = new Date();
const deps = { llm: createLLM(), search: new SearchService(new TavilySearch(config.tavilyApiKey)), store, clock: { now: () => now } };

console.log(`seeding ${config.dbPath} in ${timezone}\n`);
for (const [i, q] of QUESTIONS.entries()) {
  const conversationId = `seed-${i + 1}`;
  const day = addDays(today, -q.daysAgo);
  now = new Date(startOfDay(day, timezone).getTime() + (q.hour * 60 + q.minute) * 60_000);
  const when = formatInZone(now, timezone);
  if (existing.has(conversationId)) {
    console.log(`skip  ${when}  already seeded`);
    continue;
  }

  let error = '';
  const { background } = await handleTurn(
    deps,
    { conversationId, message: q.message, timezone },
    (e: ServerEvent) => {
      if (e.type === 'error') error = e.message;
    },
    new AbortController().signal,
  );
  await background;
  console.log(`${error ? 'FAIL' : 'ok  '}  ${when}  ${q.message}${error ? `  (${error})` : ''}`);
  await new Promise((r) => setTimeout(r, 3000));
}

const seeded = new Set(store.listConversations(LOCAL_USER).map((c) => c.id));
const firstIndex = QUESTIONS.findIndex((_, i) => seeded.has(`seed-${i + 1}`));
if (firstIndex === -1) process.exit(1);
const first = addDays(today, -QUESTIONS[firstIndex].daysAgo);
const label = new Intl.DateTimeFormat('en-GB', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' }).format(new Date(Date.UTC(first.year, first.month - 1, first.day)));
console.log(`\nTry: "What did I ask you on ${label}? Is your answer still correct?" or "What did I ask you yesterday?"`);
