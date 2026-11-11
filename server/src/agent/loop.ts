import type { ServerEvent } from '../../../shared/types';
import type { ChatMessage, LLMProvider, SystemPrompt, ToolCall, ToolSpec } from '../llm/types';
import type { SearchService } from '../search/service';
import type { TimeRange, Topic } from '../search/types';
import { formatResults, type SourceRegistry } from './sources';

export const MAX_TOOL_ROUNDS = 4;

const NO_ANSWER = "I couldn't put an answer together this time. Please try again, or rephrase the question.";

export const webSearchTool: ToolSpec = {
  name: 'web_search',
  description:
    'Search the web for current information. Returns numbered results with title, URL, publish date and an extract. Use specific queries; include product names, "pricing"/"changelog", and month/year when recency matters.',
  parameters: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'The search query.' },
      recency: { type: 'string', enum: ['day', 'week', 'month', 'year'], description: 'Only return results published within this window.' },
      topic: { type: 'string', enum: ['general', 'news'], description: 'Use news for recent events and announcements.' },
    },
    required: ['query'],
  },
};

export interface AgentInput {
  llm: LLMProvider;
  search: SearchService;
  system: SystemPrompt;
  history: ChatMessage[];
  userContent: string;
  registry: SourceRegistry;
  signal: AbortSignal;
  emit: (event: ServerEvent) => void;
  startedAt: number;
  /** False on the fast path: a greeting never needs a search. */
  allowTools: boolean;
}

export interface AgentResult {
  text: string;
  rounds: number;
  firstTokenMs?: number;
  searchFailures: number;
  /** False when the model produced no text and the fallback line was used instead. */
  answered: boolean;
}

export async function runAgent(input: AgentInput): Promise<AgentResult> {
  const { llm, emit, signal } = input;
  const messages: ChatMessage[] = [...input.history, { role: 'user', content: input.userContent }];
  let text = '';
  let firstTokenMs: number | undefined;
  let searchFailures = 0;

  for (let round = 0; ; round++) {
    const toolsAllowed = input.allowTools && round < MAX_TOOL_ROUNDS;
    if (input.allowTools && !toolsAllowed) {
      // Out of search rounds: a plain user-side instruction is what reliably gets the model to write instead of asking for more tools.
      messages.push({ role: 'user', content: 'Search budget used up. Answer now using the results above, and say plainly what you could not check.' });
    }

    let roundText = '';
    const calls: ToolCall[] = [];
    for await (const event of llm.streamChat({ tier: 'main', system: input.system, messages, tools: toolsAllowed ? [webSearchTool] : undefined, signal })) {
      if (event.type === 'text') {
        firstTokenMs ??= Date.now() - input.startedAt;
        roundText += event.text;
        emit({ type: 'token', text: event.text });
      } else if (event.type === 'tool_call') {
        calls.push(event.call);
      }
    }
    text += roundText;

    if (!calls.length || !toolsAllowed) {
      if (!text.trim()) {
        text = NO_ANSWER;
        emit({ type: 'token', text });
      }
      return { text, rounds: round + 1, firstTokenMs, searchFailures, answered: text !== NO_ANSWER };
    }

    messages.push({ role: 'assistant', content: roundText, toolCalls: calls });
    const results = await Promise.all(calls.map((call) => executeSearch(call, input)));
    for (const r of results) {
      if (r.failed) searchFailures++;
      messages.push({ role: 'tool', toolCallId: r.call.id, name: r.call.name, content: r.content });
    }
    emit({ type: 'sources', sources: input.registry.all() });
  }
}

async function executeSearch(call: ToolCall, input: AgentInput) {
  const query = typeof call.args.query === 'string' ? call.args.query.trim() : '';
  if (call.name !== 'web_search' || !query) {
    console.warn(`[agent] unusable tool call ${call.name} ${JSON.stringify(call.args).slice(0, 200)}`);
    return { call, failed: true, content: 'Error: web_search needs a non-empty "query" string.' };
  }
  input.emit({ type: 'status', phase: 'searching', text: `searching: ${query}` });
  const outcome = await input.search.search(query, {
    timeRange: asTimeRange(call.args.recency),
    topic: call.args.topic === 'news' ? ('news' as Topic) : undefined,
    signal: input.signal,
  });
  if (outcome.error) {
    return { call, failed: true, content: `Search failed (${outcome.error.kind}). Answer without it and tell the user you could not check the web for this.` };
  }
  return { call, failed: false, content: formatResults(input.registry.add(outcome.results)) };
}

function asTimeRange(value: unknown): TimeRange | undefined {
  return value === 'day' || value === 'week' || value === 'month' || value === 'year' ? value : undefined;
}
