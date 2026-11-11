import { mkdirSync, writeFileSync } from 'node:fs';
import type { ServerEvent } from '../../shared/types';
import { handleTurn, type TurnTrace } from '../src/agent/turn';
import { config } from '../src/config';
import { addDays, isoDate, startOfDay, wallClock, type CivilDate } from '../src/dates/zone';
import { createLLM } from '../src/llm';
import { SearchService } from '../src/search/service';
import { TavilySearch } from '../src/search/tavily';
import { openDb } from '../src/store/db';
import { Store } from '../src/store/repo';
import { checkUpcoming } from './upcoming';

const IST = 'Asia/Kolkata';
const TURN_DELAY_MS = Number(process.env.EVAL_DELAY_MS ?? 4000);

// Scenarios are anchored to the most recent Wednesday so "on Monday" and "last Tuesday" always mean something.
const today = wallClock(new Date(), IST);
const anchor: CivilDate = addDays(today, -((today.weekday - 3 + 7) % 7));
const day = (offset: number) => isoDate(addDays(anchor, offset));
const at = (offset: number, hour: number, minute = 0) =>
  new Date(startOfDay(addDays(anchor, offset), IST).getTime() + (hour * 60 + minute) * 60_000).toISOString();

interface Expect {
  trivial?: boolean;
  rangeDays?: string[];
  recallsSteps?: number[];
  recallsNothing?: boolean;
  citations?: boolean;
  table?: boolean;
  admitsNoRecord?: boolean;
  queriesMatch?: RegExp;
  answerMatches?: RegExp;
  /** If the sources show a scheduled change in the next 30 days, the answer must mention its date. */
  mentionsUpcoming?: boolean;
}

interface Step {
  at: string;
  conversation: string;
  message: string;
  expect: Expect;
  rubric?: string;
}

interface Scenario {
  name: string;
  steps: Step[];
}

const scenarios: Scenario[] = [
  {
    name: 'crm shortlist, then "has anything changed since Monday?"',
    steps: [
      {
        at: at(-2, 10),
        conversation: 'crm-1',
        message: 'We need a CRM for a 20-person sales team. Shortlist 5 options with current per-seat pricing.',
        expect: { citations: true },
        rubric: 'Gives 5 named CRM products with per-seat prices, each price backed by an inline citation. Concise, leads with the answer.',
      },
      {
        at: at(0, 18, 30),
        conversation: 'crm-2',
        message: 'On Monday we shortlisted 5 CRM tools for a 20-person sales team. Has any of them changed pricing or shipped something big since?',
        expect: { rangeDays: [day(-2)], recallsSteps: [0], citations: true, table: true, queriesMatch: /pricing/i },
        rubric:
          'Refers to the shortlist from Monday by name, compares what was said then with what the sources say now item by item (ideally a table), cites fresh sources, and says "could not verify" rather than claiming no change for items it has no fresh source for.',
      },
    ],
  },
  {
    name: 'asks about a date with no history',
    steps: [
      {
        at: at(0, 12),
        conversation: 'empty-1',
        message: 'What did I ask you on 3 November? Is your answer still correct today?',
        expect: { recallsNothing: true, admitsNoRecord: true },
        rubric:
          'Says plainly it has no record of a conversation on 3 November, does not invent any question or answer, and asks at most one short clarifying question.',
      },
    ],
  },
  {
    name: 'postgres hosting last Tuesday, pricing re-check',
    steps: [
      {
        at: at(-1, 11),
        conversation: 'pg-1',
        message: 'Which managed Postgres hosts are good for a small SaaS, and what do their entry plans cost?',
        expect: { citations: true },
        rubric: 'Names several managed Postgres providers with entry-plan prices, each backed by citations.',
      },
      {
        at: at(0, 19),
        conversation: 'pg-2',
        message: 'Last Tuesday I asked you about Postgres hosting. Has any pricing changed since then?',
        expect: { rangeDays: [day(-1)], recallsSteps: [0], citations: true },
        rubric:
          'Recalls the providers discussed on Tuesday, re-checks their pricing against fresh sources with citations, and is explicit about what changed, what did not, and what could not be verified.',
      },
    ],
  },
  {
    name: 'plain current-events question',
    steps: [
      {
        at: at(0, 9),
        conversation: 'news-1',
        message: 'What is the latest stable release of Node.js right now?',
        expect: { citations: true, queriesMatch: /node/i, mentionsUpcoming: true },
        rubric: 'Leads with a specific version number, cites a source for it, mentions when it was released or checked, no filler.',
      },
    ],
  },
  {
    name: '"what changed" in the latest release',
    steps: [
      {
        at: at(0, 10),
        conversation: 'release-1',
        message: 'What changed in the latest PostgreSQL release?',
        expect: { citations: true, mentionsUpcoming: true },
        rubric:
          'Names the newest release and its date and focuses on what it changed; if the sources show a new release scheduled within about a month, says so with the date right after the direct answer. Does not pad with older releases.',
      },
    ],
  },
  {
    name: 'follow-up that depends on the previous turn',
    steps: [
      {
        at: at(0, 14),
        conversation: 'follow-1',
        message: 'Who is the CEO of Microsoft?',
        expect: { citations: true },
        rubric: 'Names the current CEO with a citation.',
      },
      {
        at: at(0, 14, 2),
        conversation: 'follow-1',
        message: 'How long has he been in the role, and what did he do before that?',
        expect: { citations: true, answerMatches: /nadella/i },
        rubric: 'Understands "he" is the CEO from the previous turn, gives the start year and prior roles with citations.',
      },
    ],
  },
  {
    name: 'greeting fast path, then "yesterday" just after midnight IST',
    steps: [
      {
        at: at(-1, 9),
        conversation: 'tz-1',
        message: 'hi',
        expect: { trivial: true },
      },
      {
        at: at(-1, 9, 1),
        conversation: 'tz-1',
        message: 'What is the population of Tokyo?',
        expect: { citations: true },
      },
      {
        // 00:15 IST on the anchor day is still the previous evening in UTC.
        at: at(0, 0, 15),
        conversation: 'tz-2',
        message: 'What did I ask you yesterday?',
        expect: { rangeDays: [day(-1)], recallsSteps: [0, 1] },
        rubric: 'Correctly says the user asked about the population of Tokyo yesterday (and greeted), with the date, without inventing anything else.',
      },
    ],
  },
];

interface Check {
  name: string;
  ok: boolean;
  detail?: string;
}

function runChecks(expect: Expect, trace: TurnTrace, stepIds: string[], now: Date): Check[] {
  const checks: Check[] = [];
  const answer = trace.answer;
  if (trace.error) checks.push({ name: 'no error', ok: false, detail: trace.error.slice(0, 80) });
  if (expect.trivial !== undefined) {
    checks.push({ name: 'fast path', ok: trace.trivial === expect.trivial && (!expect.trivial || (trace.queries.length === 0 && trace.sources.length === 0)) });
  }
  if (expect.rangeDays) {
    const got = trace.ranges.map((r) => isoDate(wallClock(new Date(r.start), IST)));
    checks.push({ name: 'date range', ok: JSON.stringify(got) === JSON.stringify(expect.rangeDays), detail: `got ${got.join(',') || 'none'}` });
  }
  if (expect.recallsSteps) {
    const wanted = expect.recallsSteps.map((i) => stepIds[i]).filter(Boolean);
    const missing = wanted.filter((id) => !trace.recalledMessageIds.includes(id));
    checks.push({ name: 'recall hit', ok: wanted.length === expect.recallsSteps.length && missing.length === 0, detail: missing.length ? `missing ${missing.length}` : undefined });
  }
  if (expect.recallsNothing) checks.push({ name: 'no recall', ok: trace.recalledMessageIds.length === 0 });
  if (expect.citations) {
    const cited = [...answer.matchAll(/\[(\d{1,2}(?:\s*,\s*\d{1,2})*)\]/g)].flatMap((m) => m[1].split(',').map((n) => Number(n.trim())));
    const valid = cited.length > 0 && cited.every((n) => n >= 1 && n <= trace.sources.length);
    checks.push({ name: 'citations', ok: valid, detail: `${cited.length} cites, ${trace.sources.length} sources` });
  }
  if (expect.table) checks.push({ name: 'table', ok: /\|\s*:?-{3,}/.test(answer) });
  if (expect.admitsNoRecord) {
    checks.push({ name: 'admits no record', ok: /no record|don'?t have (?:a |any )?(?:record|conversation)|do not have (?:a |any )?(?:record|conversation)|no (?:past )?conversation|couldn'?t find|can'?t find/i.test(answer) });
  }
  if (expect.queriesMatch) checks.push({ name: 'search queries', ok: trace.queries.some((q) => expect.queriesMatch!.test(q)) || trace.sources.length > 0 });
  if (expect.answerMatches) checks.push({ name: 'answer content', ok: expect.answerMatches.test(answer) });
  if (expect.mentionsUpcoming) {
    // Only applies when the sources actually show something scheduled soon; otherwise there is nothing to mention.
    const upcoming = checkUpcoming(trace.evidence, answer, now);
    if (upcoming.applicable) checks.push({ name: 'upcoming change', ok: upcoming.ok, detail: upcoming.detail });
    else console.log(`          upcoming change: not applicable, ${upcoming.detail}`);
  }
  return checks;
}

const llm = createLLM();

interface Verdict {
  score: number;
  pass: boolean;
  reason: string;
}

async function judge(step: Step, trace: TurnTrace, context: string): Promise<Verdict | undefined> {
  if (!step.rubric || !trace.answer) return undefined;
  const prompt = [
    `Context: ${context}`,
    `User message:\n${step.message}`,
    `Assistant answer:\n${trace.answer}`,
    `Sources available to the assistant:\n${trace.sources.map((s) => `[${s.n}] ${s.title} (${s.domain})`).join('\n') || 'none'}`,
    `Past turns the system recalled for this answer: ${trace.recalledMessageIds.length}`,
    `Rubric:\n${step.rubric}`,
  ].join('\n\n');
  try {
    return await llm.generateJson<Verdict>({
      tier: 'fast',
      system:
        'You grade a chat assistant answer against a rubric. Be strict about invented facts or invented history. Score 1-5 (5 = fully meets the rubric). pass = score >= 4. Give a one-sentence reason.',
      prompt,
      schema: {
        type: 'object',
        properties: { score: { type: 'integer' }, pass: { type: 'boolean' }, reason: { type: 'string' } },
        required: ['score', 'pass', 'reason'],
      },
      signal: AbortSignal.timeout(30_000),
    });
  } catch (err) {
    console.warn(`[judge] failed: ${err instanceof Error ? err.message.slice(0, 80) : err}`);
    return undefined;
  }
}

interface StepReport {
  scenario: string;
  step: number;
  message: string;
  checks: Check[];
  verdict?: Verdict;
  firstTokenMs?: number;
  answer: string;
}

async function runScenario(scenario: Scenario, search: SearchService): Promise<StepReport[]> {
  let now = new Date(scenario.steps[0].at);
  const store = new Store(openDb(':memory:'));
  store.ensureUser();
  const deps = { llm, search, store, clock: { now: () => now } };
  const stepIds: string[] = [];
  const reports: StepReport[] = [];

  for (const [i, step] of scenario.steps.entries()) {
    now = new Date(step.at);
    let answerId = '';
    const runStep = () =>
      handleTurn(
        deps,
        { conversationId: step.conversation, message: step.message, timezone: IST },
        (e: ServerEvent) => {
          if (e.type === 'done') answerId = e.messageId;
        },
        new AbortController().signal,
      );
    let { background, trace } = await runStep();
    // A free-tier 503 says nothing about the agent; give the provider one more chance before scoring.
    if (trace.error) {
      console.log(`  step ${i + 1}: provider error, retrying once in 20s`);
      await new Promise((r) => setTimeout(r, 20_000));
      ({ background, trace } = await runStep());
    }
    await background;
    stepIds.push(answerId);

    const checks = runChecks(step.expect, trace, stepIds, now);
    const verdict = await judge(step, trace, `${scenario.name}. Simulated time: ${step.at} (user timezone ${IST}).`);
    reports.push({ scenario: scenario.name, step: i + 1, message: step.message, checks, verdict, firstTokenMs: trace.timings?.firstTokenMs, answer: trace.answer });

    const failed = checks.filter((c) => !c.ok);
    console.log(
      `  step ${i + 1}: ${failed.length ? 'FAIL' : 'ok  '} checks ${checks.length - failed.length}/${checks.length}` +
        `${verdict ? ` | judge ${verdict.score}/5` : ''}${trace.timings?.firstTokenMs ? ` | first token ${trace.timings.firstTokenMs}ms` : ''}` +
        `${failed.length ? ` | failed: ${failed.map((c) => `${c.name}${c.detail ? ` (${c.detail})` : ''}`).join(', ')}` : ''}`,
    );
    if (verdict && !verdict.pass) console.log(`          judge: ${verdict.reason}`);
    await new Promise((r) => setTimeout(r, TURN_DELAY_MS));
  }
  return reports;
}

const only = process.argv[2];
const search = new SearchService(new TavilySearch(config.tavilyApiKey));
const all: StepReport[] = [];
console.log(`evals: main=${llm.modelFor('main')} fast=${llm.modelFor('fast')} anchor=${isoDate(anchor)} (${IST})\n`);
for (const [i, scenario] of scenarios.entries()) {
  if (only && !scenario.name.includes(only)) continue;
  console.log(`${i + 1}. ${scenario.name}`);
  all.push(...(await runScenario(scenario, search)));
}

const checks = all.flatMap((r) => r.checks);
const judged = all.filter((r) => r.verdict);
const ttft = all.map((r) => r.firstTokenMs).filter((x): x is number => x !== undefined).sort((a, b) => a - b);
console.log('\nsummary');
console.log(`  deterministic checks: ${checks.filter((c) => c.ok).length}/${checks.length} passed`);
console.log(`  judge: ${judged.filter((r) => r.verdict!.pass).length}/${judged.length} passed, mean score ${(judged.reduce((s, r) => s + r.verdict!.score, 0) / (judged.length || 1)).toFixed(1)}/5`);
if (ttft.length) console.log(`  first token: median ${ttft[Math.floor(ttft.length / 2)]}ms over ${ttft.length} answers`);

mkdirSync('data', { recursive: true });
writeFileSync('data/eval-report.json', JSON.stringify({ at: new Date().toISOString(), models: { main: llm.modelFor('main'), fast: llm.modelFor('fast') }, steps: all }, null, 2));
process.exitCode = checks.every((c) => c.ok) ? 0 : 1;
