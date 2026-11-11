export type ModelTier = 'main' | 'fast';

export interface ToolCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
  /** Opaque provider data that must be echoed back with the call (Gemini thought signatures). */
  signature?: string;
}

export type ChatMessage =
  | { role: 'user'; content: string }
  | { role: 'assistant'; content: string; toolCalls?: ToolCall[] }
  | { role: 'tool'; toolCallId: string; name: string; content: string };

export interface ToolSpec {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

/**
 * The system prompt is split so providers can cache the stable prefix:
 * `stable` never changes between requests, `dynamic` holds the date, recall, sources.
 */
export interface SystemPrompt {
  stable: string;
  dynamic: string;
}

export interface Usage {
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
}

export type StreamEvent =
  | { type: 'text'; text: string }
  | { type: 'tool_call'; call: ToolCall }
  | { type: 'usage'; usage: Usage };

export interface ChatRequest {
  tier: ModelTier;
  system: SystemPrompt;
  messages: ChatMessage[];
  tools?: ToolSpec[];
  signal?: AbortSignal;
}

export interface JsonRequest {
  tier: ModelTier;
  system: string;
  prompt: string;
  schema: Record<string, unknown>;
  signal?: AbortSignal;
}

export interface LLMProvider {
  readonly name: string;
  modelFor(tier: ModelTier): string;
  streamChat(req: ChatRequest): AsyncIterable<StreamEvent>;
  generateJson<T>(req: JsonRequest): Promise<T>;
}
