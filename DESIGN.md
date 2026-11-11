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

- **Dates are resolved by code.** "On Monday" is the most recent Monday in the user's IANA zone; "3 December" asked in November is last year. 26 tests cover a UTC server with an IST user at 00:15, DST, and future phrases.
- **Recall is the only record of the past.** An empty range becomes `NO RECORD for Tuesday, 3 November 2026`, so the model says so instead of inventing history. Unanswered turns are never stored.
- **A claims ledger makes "has it changed" checkable.** Each turn stores `{entity, attribute, value, sourceUrl, asOf}`. On a re-check, code guarantees a pricing and a news query per recalled product, lists the rows the then-vs-now table must cover, and requires "Could not verify" where no fresh source exists.
- **Planner raced against a deadline.** One fast JSON call writes up to 5 queries, run in parallel before the main model starts. If it misses the deadline the main model decides with its tool, so the planner costs at most 2 s (`PLANNER_TIMEOUT_MS`).
- **Cache-friendly prompt and honest failure.** The system prompt is byte-stable; recall and results go in the user message. Backoff with jitter; a daily quota is never retried; a disconnect aborts the model and searches; a failed search becomes "I could not check the web".

## Models and quota

Defaults: `gemini-3.6-flash` answers; `gemini-3.5-flash-lite` plans, indexes and judges evals; the fallback chain is `gemini-3.5-flash-lite` then `gemini-3.1-flash-lite`. The free tier gives about 20 Flash requests a day, so much of the testing ran on Flash-Lite, and 503s were common. The Anthropic provider is a second implementation of the same interface: **untested against the live API**, covered only by unit tests against a mocked SDK.

## Measured

Time to first token, planner on vs off, `gemini-3.5-flash-lite` in both arms. Each row is 3 questions x 3 reps, interleaved per question; medians over completed runs (`npm run bench`).

| Planner deadline | On | Off | Planner in time |
| --- | --- | --- | --- |
| 1.2 s | 6.5 s (8 of 9 ran) | 6.6 s (7 of 9) | 0 of 9 |
| 2.0 s (default) | **5.0 s** (9 of 9) | 8.5 s (9 of 9) | 5 of 9 |
| 3.5 s (earlier run, before the race) | 4.4 s (7 of 9) | 6.6 s (9 of 9) | not recorded |

Healthy planner calls take 1.6 to 2.0 s, so at 1.2 s it never finished and was pure overhead. In time, a turn usually needs 1 main-model call instead of 2 or 3. Nine runs per arm on a noisy free tier: direction, not precise effect sizes.

**Evals** (`npm run eval`, one run): 6 scenarios, 11 turns over simulated days. **20 of 21 code checks** passed (date ranges, recall hits, valid citations, re-check table, fast path, no invented history); the miss was a correct follow-up ("He has been CEO since February 2014") that never repeated the name the check expects. A Flash-Lite judge passed 9 of the 9 turns it grades, all 5/5: a small sample graded by the same model family, so a smoke test. Flash's quota ran out after the first turn; the rest ran on Flash-Lite. 105 unit tests.

## Considered and rejected

- **Model does everything through tools:** an extra slow round per search, and unreliable "last Tuesday".
- **A separate recall tool:** the spec allows one tool, and deterministic recall beats the model guessing when to look.
- **Vector embeddings, LangChain:** more dependencies; FTS5 plus exact date ranges is enough here, and the loop is ~100 lines I can explain.

## With another week

Stream the planner's JSON so searches start per query. Fetch full vendor pricing pages for re-checks and diff claims numerically. A larger eval set, run several times, with a judge from another model family.
