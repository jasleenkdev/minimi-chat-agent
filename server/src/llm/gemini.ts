import { ApiError, GoogleGenAI, ThinkingLevel, type Content, type GenerateContentConfig, type Part } from '@google/genai';
import { LLMError, isAbortError, kindFromStatus } from './errors';
import { withRetry } from './retry';
import type { ChatMessage, ChatRequest, JsonRequest, LLMProvider, ModelTier, StreamEvent, ToolCall } from './types';

export interface GeminiOptions {
  apiKey: string;
  models: { main: string; fast: string; fallback?: string };
}

const REQUEST_TIMEOUT_MS = 45_000;

export class GeminiProvider implements LLMProvider {
  readonly name = 'gemini';
  private client: GoogleGenAI;

  constructor(private opts: GeminiOptions) {
    // SDK retries are disabled so backoff lives in one place (retry.ts) and stays visible.
    this.client = new GoogleGenAI({
      apiKey: opts.apiKey,
      httpOptions: { timeout: REQUEST_TIMEOUT_MS, retryOptions: { attempts: 1 } },
    });
  }

  modelFor(tier: ModelTier): string {
    return this.opts.models[tier];
  }

  async *streamChat(req: ChatRequest): AsyncIterable<StreamEvent> {
    const config: GenerateContentConfig = {
      abortSignal: req.signal,
      systemInstruction: { parts: [{ text: req.system.stable }, { text: req.system.dynamic }] },
      tools: req.tools?.length
        ? [{ functionDeclarations: req.tools.map((t) => ({ name: t.name, description: t.description, parametersJsonSchema: t.parameters })) }]
        : undefined,
    };
    const contents = toContents(req.messages);

    const stream = await this.withFallback(req.tier, req.signal, (model) =>
      this.client.models.generateContentStream({ model, contents, config: { ...config, thinkingConfig: thinkingFor(model, req.tier) } }),
    );

    try {
      for await (const chunk of stream) {
        for (const part of chunk.candidates?.[0]?.content?.parts ?? []) {
          if (part.thought) continue;
          if (part.functionCall) yield { type: 'tool_call', call: toToolCall(part) };
          else if (part.text) yield { type: 'text', text: part.text };
        }
        const u = chunk.usageMetadata;
        if (u && chunk.candidates?.[0]?.finishReason) {
          yield {
            type: 'usage',
            usage: {
              inputTokens: u.promptTokenCount ?? 0,
              outputTokens: (u.candidatesTokenCount ?? 0) + (u.thoughtsTokenCount ?? 0),
              cachedTokens: u.cachedContentTokenCount ?? 0,
            },
          };
        }
      }
    } catch (err) {
      throw toLLMError(err);
    }
  }

  async generateJson<T>(req: JsonRequest): Promise<T> {
    const res = await this.withFallback(req.tier, req.signal, (model) =>
      this.client.models.generateContent({
        model,
        contents: [{ role: 'user', parts: [{ text: req.prompt }] }],
        config: {
          abortSignal: req.signal,
          systemInstruction: req.system,
          responseMimeType: 'application/json',
          responseJsonSchema: req.schema,
          thinkingConfig: thinkingFor(model, 'fast'),
        },
      }),
    );
    try {
      return JSON.parse(res.text ?? '') as T;
    } catch {
      throw new LLMError('bad_request', 'model returned invalid JSON');
    }
  }

  /** Retries the primary model with backoff, then tries the fallback model once if the primary is overloaded. */
  private async withFallback<T>(tier: ModelTier, signal: AbortSignal | undefined, call: (model: string) => Promise<T>): Promise<T> {
    const primary = this.modelFor(tier);
    const attempt = (model: string, attempts: number) =>
      withRetry(
        async () => {
          try {
            return await call(model);
          } catch (err) {
            throw toLLMError(err);
          }
        },
        {
          attempts,
          signal,
          onRetry: (e, n, ms) => console.warn(`[gemini] ${model} ${e.kind} (${e.status}), retry ${n} in ${ms}ms`),
        },
      );

    try {
      return await attempt(primary, 3);
    } catch (err) {
      const fallback = this.opts.models.fallback;
      if (err instanceof LLMError && err.kind === 'unavailable' && fallback && fallback !== primary) {
        console.warn(`[gemini] ${primary} unavailable, falling back to ${fallback}`);
        return attempt(fallback, 2);
      }
      throw err;
    }
  }
}

/** Gemini 3 models take a thinking level; keep it low because latency matters more than depth here. */
function thinkingFor(model: string, tier: ModelTier) {
  if (!model.startsWith('gemini-3')) return undefined;
  if (tier === 'fast') return { thinkingLevel: model.includes('lite') ? ThinkingLevel.MINIMAL : ThinkingLevel.LOW };
  return { thinkingLevel: ThinkingLevel.LOW };
}

function toToolCall(part: Part): ToolCall {
  const fc = part.functionCall!;
  return {
    id: fc.id ?? `call_${Math.random().toString(36).slice(2)}`,
    name: fc.name ?? '',
    args: fc.args ?? {},
    signature: part.thoughtSignature,
  };
}

export function toContents(messages: ChatMessage[]): Content[] {
  const contents: Content[] = [];
  for (const m of messages) {
    if (m.role === 'user') {
      contents.push({ role: 'user', parts: [{ text: m.content }] });
    } else if (m.role === 'assistant') {
      const parts: Part[] = [];
      if (m.content) parts.push({ text: m.content });
      for (const call of m.toolCalls ?? []) {
        parts.push({ functionCall: { id: call.id, name: call.name, args: call.args }, thoughtSignature: call.signature });
      }
      if (parts.length) contents.push({ role: 'model', parts });
    } else {
      const part: Part = { functionResponse: { id: m.toolCallId, name: m.name, response: { result: m.content } } };
      const last = contents.at(-1);
      // Parallel tool results go back together in a single user turn.
      if (last?.role === 'user' && last.parts?.every((p) => p.functionResponse)) last.parts.push(part);
      else contents.push({ role: 'user', parts: [part] });
    }
  }
  return contents;
}

function toLLMError(err: unknown): LLMError {
  if (err instanceof LLMError) return err;
  if (isAbortError(err)) return new LLMError('aborted', 'aborted');
  if (err instanceof ApiError) {
    const delay = /"retryDelay":\s*"(\d+(?:\.\d+)?)s"/.exec(err.message);
    return new LLMError(kindFromStatus(err.status, err.message), err.message, err.status, delay ? Number(delay[1]) * 1000 : undefined);
  }
  const message = err instanceof Error ? err.message : String(err);
  if (/fetch failed|ECONNRESET|ETIMEDOUT|timed out/i.test(message)) return new LLMError('unavailable', message);
  return new LLMError('unknown', message);
}
