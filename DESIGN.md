# Design

The example prompts need three things a plain "LLM + search tool" loop does badly: find a past conversation by a relative date, re-check what was said against today's web, and admit when there is no record. So dates, memory and search planning happen before the main model runs; the model writes the answer.

## Pipeline

```
POST /api/chat {conversationId, message, timezone}        time from one injectable Clock (DEV_NOW)
 ├─ greeting/thanks? ─────────────────────────► main model, no tools ─► stream
 ├─ resolveDates: chrono + past bias in the user's zone → [start, end) ranges     code
 ├─ pre-recall: SQLite turns in those ranges + FTS5 match                        code
 ├─ planner (Flash-Lite, JSON) raced against a 2 s deadline; late → aborted, ignored
 ├─ recall block: past turns + claims with local timestamps, or "NO RECORD for <date>"
 ├─ re-check? code adds a pricing and a news-since-then query per recalled product
 ├─ all queries in parallel (Tavily; cache, dedupe, vendor-domain boost)
 ├─ main model (streaming) + one web_search tool, max 4 rounds ──► sources / tokens
 └─ save ─► done ─► background: Flash-Lite extracts summary, entities, claims ─► FTS5
```

## Key decisions

- **Dates are resolved by code.** "On Monday" is the most recent Monday in the user's IANA zone; "3 December" asked in November is last year. 26 tests cover midnight across zones, DST and future phrases.
- **Recall is the only record of the past.** An empty range becomes `NO RECORD for <date>`, so the model says so instead of inventing history. Unanswered turns are never stored.
- **A claims ledger makes "has it changed" checkable.** Each turn stores `{entity, attribute, value, sourceUrl, asOf}`. On a re-check, code adds a pricing and a news query per recalled product and requires "Could not verify" where no fresh source exists.
- **Planner raced against a deadline.** One fast JSON call writes up to 5 queries that run in parallel before the main model starts. If it misses the 2 s deadline (`PLANNER_TIMEOUT_MS`), the main model decides with its tool.
- **Cache-friendly prompt and honest failure.** The system prompt is byte-stable; per-turn context goes in the user message. Backoff with jitter, no retries on a spent daily quota, aborts on disconnect, and "I could not check the web" when search fails.

## Models and quota

`gemini-3.6-flash` answers and `gemini-3.5-flash-lite` plans, indexes and judges, falling back to Flash-Lite 3.5 then 3.1 when a model is overloaded or out of quota. The free tier allows about 20 Flash requests a day, so most testing ran on Flash-Lite. The Anthropic provider implements the same interface but is **untested against the live API**, covered only by mocked-SDK unit tests.

## Measured

Time to first token, planner on vs off, `gemini-3.5-flash-lite` in both arms. Each row is 3 questions x 3 reps, interleaved per question; medians over completed runs (`npm run bench`).

| Planner deadline | On | Off | Planner in time |
| --- | --- | --- | --- |
| 1.2 s | 6.5 s (8 of 9 ran) | 6.6 s (7 of 9) | 0 of 9 |
| 2.0 s (default) | **5.0 s** (9 of 9) | 8.5 s (9 of 9) | 5 of 9 |

Compare within a row, not across: rows ran at different times, and the identical "off" arm measured 6.6 s and 8.5 s. Healthy planner calls take 1.6 to 2.0 s, so at 1.2 s it never finished; when it does, a turn usually needs 1 main-model call instead of 2 or 3.

**Evals** (`npm run eval`): one run of 6 scenarios, 11 turns over simulated days, passed 20 of 21 code checks (dates, recall, citations, re-check table, no invented history); the miss was a correct answer that said "He" instead of the expected name. A Flash-Lite judge passed all 9 turns it grades. With 9 runs per bench arm and a same-family judge, treat all numbers as direction, not precise results.

## Considered and rejected

- **Model does everything through tools:** an extra slow round per search, and unreliable "last Tuesday".
- **A separate recall tool:** the spec allows one tool, and deterministic recall beats the model guessing when to look.
- **Vector embeddings, LangChain:** more dependencies; FTS5 plus date ranges is enough, and the loop is ~100 lines I can explain.

## With another week

Stream the planner's JSON so searches start per query. Diff claims numerically against full pricing pages. A larger eval set, run repeatedly, with a judge from another model family.
