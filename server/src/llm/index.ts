import { config } from '../config';
import { AnthropicProvider } from './anthropic';
import { GeminiProvider } from './gemini';
import type { LLMProvider } from './types';

export function createLLM(): LLMProvider {
  if (config.llmProvider === 'anthropic') {
    if (!config.anthropicApiKey) throw new Error('LLM_PROVIDER=anthropic but ANTHROPIC_API_KEY is not set');
    return new AnthropicProvider({
      apiKey: config.anthropicApiKey,
      models: { main: config.modelMain ?? 'claude-opus-5-5', fast: config.modelFast ?? 'claude-haiku-5-5' },
    });
  }
  if (!config.geminiApiKey) throw new Error('GEMINI_API_KEY is not set (see .env.example)');
  return new GeminiProvider({
    apiKey: config.geminiApiKey,
    models: {
      main: config.modelMain ?? 'gemini-3.6-flash',
      fast: config.modelFast ?? 'gemini-3.5-flash-lite',
      fallbacks: config.modelFallbacks ?? ['gemini-3.5-flash-lite', 'gemini-3.1-flash-lite'],
    },
  });
}

export type { LLMProvider } from './types';
