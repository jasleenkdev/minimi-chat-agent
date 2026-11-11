# Design

The example prompts ("On Monday we shortlisted 5 CRM tools... has any of them changed?") need three things a plain "LLM + search tool" loop does badly: find a past conversation by a relative date, re-check what was said against today's web, and admit when there is no record. So the time-sensitive and memory work happens in code before the model is called. The model writes the answer.

## Pipeline

```
POST /api/chat {conversationId, message, timezone}        time stamped by one injectable Clock (DEV_NOW)
 ├─ greeting/thanks? ───────────────────────────► main model, no tools ─► stream
 ├─ resolveDates: chrono + past bias, user's zone → [start, end) ranges          code, <1 ms
 ├─ pre-recall: SQLite turns in those ranges + FTS5 match                        code, ~1 ms
 ├─ planner (Flash-Lite, JSON, 3.5 s budget): needsSearch, referencesPast, queries, freshness
 ├─ recall block: past turns + claims with exact local timestamps, or "NO RECORD for <date>"
 ├─ re-check? code adds a pricing query and a news-since-then query per recalled product
 ├─ all queries in parallel (Tavily; cache, dedupe, vendor-domain boost) ──► status events
 ├─ main model (Flash, streaming) + one web_search tool, max 4 rounds ──► sources / token events
 └─ save turn ─► done ─► background: Flash-Lite extracts summary, entities, claims ─► FTS5
```

## Key decisions

- **Dates are resolved by code, not the model.** "On Monday" means the most recent Monday before today in the user's IANA zone. "3 December" in November means last year. Output is explicit half-open ranges. Models guess these wrong around week boundaries and midnight. 26 tests cover a UTC server with an IST user at 00:15, DST, and future phrases.
- **Recall is assembled before the model runs and is the only record of the past.** An empty range becomes an explicit `NO RECORD for Tuesday, 3 November 2026` line, so the model says so and asks one question instead of inventing history.
- **A claims ledger makes "has it changed" checkable.** After each turn, Flash-Lite stores `{entity, attribute, value, sourceUrl, asOf}` rows. On a re-check, code (not the planner) makes sure every recalled product gets a pricing query and a news query since that date. It also lists the exact rows the then-vs-now table must cover, and requires "Could not verify" wherever no fresh source exists.
- **Planner plus speculative search.** One fast JSON call decides whether to search and writes up to 5 queries. They run in parallel before the main model starts, so its first call already has numbered sources. If the planner fails or times out, the main model decides with its tool. Same answer, one round-trip slower.
- **Cache-friendly prompt.** The system prompt is byte-stable, followed by one line with the date. Recall and search results go in front of the current user message, so the system prompt and earlier history stay a cacheable prefix.
- **Honest failure.** Exponential backoff with jitter. A daily quota is never retried: that model cools down and the next model in `MODEL_FALLBACK` takes over. Errors on the first stream chunk are retried, a 120 s turn deadline applies, a client disconnect aborts the model call and pending searches, and if search fails the answer says it could not check the web.

## Measured

| | First token (median) |
| --- | --- |
| Model decides via tool, `gemini-3.6-flash`, 3 questions | 12.9 s (4.4 to 13.3 s), 2 to 3 model rounds |
| Planner on vs off, Flash-Lite, interleaved, 3 questions x 3 | **4.4 s vs 6.6 s**, usually 1 vs 2 to 3 model rounds |

Planner 1.3 to 3.5 s; Tavily `basic` 1.5 s median (`fast` is 0.7 s but returns content-farm pages, so I kept `basic`). The planner also halves main-model calls, which matters on a 20-request/day free tier. Free-tier latency swings widely; during one eval run, under 503s, the median was 12 s. `npm run bench` reproduces the A/B.

**Evals** (`npm run eval`): 6 scenarios, 11 turns over simulated days. Last run: **21/21 deterministic checks** (date ranges, recall hits, valid citations, re-check table, fast path, no invented history) and **8/8 judge passes, mean 5.0/5**. Two turns needed one retry after provider 503s, and one judge call timed out. 96 unit tests.

## Considered and rejected

- **Model does everything through tools:** one extra slow round per search, and it cannot resolve "last Tuesday" reliably.
- **A separate recall tool:** the spec allows one tool, and deterministic recall beats the model guessing when to look.
- **Vector embeddings:** another dependency and store. FTS5 over questions, summaries and entities, plus exact date ranges, is enough at this scale.
- **Gemini's built-in Google Search grounding:** less control over caching, freshness, domain preference, and storing sources for later re-checks.
- **Open-weight models on Groq:** fastest tokens, but weaker at deciding what to search and at citing properly.
- **LangChain / AI SDK:** they hide the loop. Here it is about 100 lines I can explain.

## With another week

Stream the planner's JSON and start each search as soon as its query is complete. Fetch the full vendor pricing page for re-checks instead of extracts. Store claims with normalised numbers and diff them in code. Run evals on a schedule across more phrasings ("the week before last", other locales). Add per-user auth (the `user_id` columns are already there), and compact long conversations into summaries.
