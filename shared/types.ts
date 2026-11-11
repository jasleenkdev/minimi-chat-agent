export interface Source {
  n: number;
  url: string;
  title: string;
  domain: string;
  publishedDate?: string;
}

export type StatusPhase = 'planning' | 'recalling' | 'searching' | 'answering';

export type ServerEvent =
  | { type: 'status'; phase: StatusPhase; text: string }
  | { type: 'sources'; sources: Source[] }
  | { type: 'token'; text: string }
  | { type: 'done'; messageId: string; createdAt: string; timings: Timings }
  | { type: 'error'; kind: string; message: string };

export interface Timings {
  firstTokenMs?: number;
  totalMs: number;
  planMs?: number;
  searchMs?: number;
  rounds: number;
}

export interface ChatRequestBody {
  conversationId: string;
  message: string;
  timezone: string;
}

export interface MessageDTO {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: string;
  timezone: string;
  sources: Source[];
}

export interface ConversationDTO {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
}
