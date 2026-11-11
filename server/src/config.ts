import { existsSync } from 'node:fs';

// Values already in the environment win over .env, so `MODEL_MAIN=... npm run eval` works as expected.
if (existsSync('.env')) process.loadEnvFile('.env');

function num(name: string, fallback: number): number {
  const raw = process.env[name];
  const n = raw ? Number(raw) : NaN;
  return Number.isFinite(n) ? n : fallback;
}

export const config = {
  port: num('PORT', 8787),
  llmProvider: (process.env.LLM_PROVIDER ?? 'gemini').toLowerCase(),
  geminiApiKey: process.env.GEMINI_API_KEY ?? '',
  anthropicApiKey: process.env.ANTHROPIC_API_KEY ?? '',
  tavilyApiKey: process.env.TAVILY_API_KEY ?? '',
  modelMain: process.env.MODEL_MAIN,
  modelFast: process.env.MODEL_FAST,
  /** Comma-separated, tried in order when the tier's own model is overloaded or out of quota. */
  modelFallbacks: process.env.MODEL_FALLBACK?.split(',').map((m) => m.trim()).filter(Boolean),
  plannerTimeoutMs: num('PLANNER_TIMEOUT_MS', 1200),
  /** PLANNER=off skips planning and prefetch, leaving every decision to the main model (used to benchmark the difference). */
  plannerEnabled: process.env.PLANNER !== 'off',
  dbPath: process.env.DB_PATH ?? 'data/minimi.db',
  devNow: process.env.DEV_NOW || undefined,
};
