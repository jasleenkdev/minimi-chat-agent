# Minimi

A chat agent with one tool, web search, that remembers past conversations by date and can re-check what it said back then against the web today.

## Setup

```
cp .env.example .env        # add GEMINI_API_KEY and TAVILY_API_KEY
npm install
npm run dev                 # http://localhost:5173
```

Node 22 or newer. The SQLite database is created in `./data` on first run.

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | API (Hono, port 8787) and UI (Vite, port 5173) together |
| `npm test` | Unit tests (date resolution, recall, search cache, agent loop, retries) |
| `npm run eval` | Six scripted multi-day scenarios against the real models, with checks and an LLM judge |
| `npm run seed` | Optional. Replays four real questions through the agent at past dates so there is history to ask about |
| `npm run bench` | Time to first token with the planner on vs off, same questions, interleaved |

## Trying the memory

Run `npm run seed` once (it takes a minute or two and never runs on its own). It asks the live agent four questions with the clock set to 1, 2, 4 and 6 days ago, then prints a prompt to try, such as "What did I ask you on Thursday 5 November? Is your answer still correct?". Nothing in the seeded history is written by hand.

## Configuration

Every key and option is listed in `.env.example`. The defaults use the Gemini free tier: `gemini-3.6-flash` for answers and `gemini-3.5-flash-lite` for planning and indexing. The free tier allows about 20 Flash requests a day; after that the app falls back to Flash-Lite automatically (`MODEL_FALLBACK`). `LLM_PROVIDER=anthropic` switches to the Anthropic provider. `DEV_NOW` pins the server clock to a given time.

See [DESIGN.md](DESIGN.md) for how it works and why.
