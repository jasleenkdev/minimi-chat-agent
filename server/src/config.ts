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
  modelFallback: process.env.MODEL_FALLBACK,
  plannerTimeoutMs: num('PLANNER_TIMEOUT_MS', 3500),
  dbPath: process.env.DB_PATH ?? 'data/minimi.db',
  devNow: process.env.DEV_NOW || undefined,
};
