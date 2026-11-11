import type { ConversationDTO, MessageDTO, Source } from '../../../shared/types';
import type { DB } from './db';

export const LOCAL_USER = 'local';

export interface Claim {
  entity: string;
  attribute: string;
  value: string;
  sourceUrl?: string;
  asOf: string;
}

/** A past question and the answer to it, with everything recall needs. */
export interface Turn {
  conversationId: string;
  conversationTitle: string;
  userMessageId: string;
  assistantMessageId: string;
  question: string;
  answer: string;
  createdAt: string;
  createdAtMs: number;
  timezone: string;
  summary?: string;
  entities: string[];
  sources: Source[];
  claims: Claim[];
}

export interface NewTurn {
  conversationId: string;
  userId: string;
  timezone: string;
  question: { id: string; content: string; createdAtMs: number };
  answer: { id: string; content: string; createdAtMs: number };
  sources: Source[];
}

interface TurnRow {
  conversation_id: string;
  title: string;
  user_message_id: string;
  assistant_message_id: string;
  question: string;
  answer: string;
  created_at: string;
  created_at_ms: number;
  timezone: string;
  summary: string | null;
  entities: string | null;
}

const TURN_SELECT = `
  SELECT u.conversation_id, c.title, u.id AS user_message_id, a.id AS assistant_message_id,
         u.content AS question, a.content AS answer, u.created_at, u.created_at_ms, u.timezone,
         s.summary, s.entities
  FROM messages a
  JOIN messages u ON u.id = a.reply_to
  JOIN conversations c ON c.id = a.conversation_id
  LEFT JOIN turn_summaries s ON s.message_id = a.id`;

export class Store {
  constructor(private db: DB) {}

  ensureUser(id = LOCAL_USER, name = 'Local user'): void {
    this.db.prepare('INSERT OR IGNORE INTO users (id, name, created_at) VALUES (?, ?, ?)').run(id, name, new Date().toISOString());
  }

  listConversations(userId: string): ConversationDTO[] {
    return this.db
      .prepare('SELECT id, title, created_at AS createdAt, updated_at AS updatedAt FROM conversations WHERE user_id = ? ORDER BY updated_at DESC')
      .all(userId) as ConversationDTO[];
  }

  deleteConversation(userId: string, id: string): boolean {
    const tx = this.db.transaction(() => {
      this.db.prepare(`DELETE FROM turn_fts WHERE message_id IN (SELECT id FROM messages WHERE conversation_id = ?)`).run(id);
      return this.db.prepare('DELETE FROM conversations WHERE id = ? AND user_id = ?').run(id, userId).changes > 0;
    });
    return tx();
  }

  getMessages(conversationId: string): MessageDTO[] {
    const rows = this.db
      .prepare('SELECT id, role, content, created_at AS createdAt, timezone FROM messages WHERE conversation_id = ? ORDER BY created_at_ms, role DESC')
      .all(conversationId) as Omit<MessageDTO, 'sources'>[];
    const sources = this.sourcesFor(rows.map((r) => r.id));
    return rows.map((r) => ({ ...r, sources: sources.get(r.id) ?? [] }));
  }

  /** The last `limit` turns of a conversation, oldest first, for the model's context window. */
  recentTurns(conversationId: string, limit: number): Turn[] {
    const rows = this.db
      .prepare(`${TURN_SELECT} WHERE a.conversation_id = ? ORDER BY u.created_at_ms DESC LIMIT ?`)
      .all(conversationId, limit) as TurnRow[];
    return this.hydrate(rows.reverse());
  }

  saveTurn(t: NewTurn): void {
    const iso = (ms: number) => new Date(ms).toISOString();
    const insertMessage = this.db.prepare(
      `INSERT INTO messages (id, conversation_id, user_id, role, content, reply_to, created_at, created_at_ms, timezone)
       VALUES (@id, @conversationId, @userId, @role, @content, @replyTo, @createdAt, @createdAtMs, @timezone)`,
    );
    const insertSource = this.db.prepare(
      'INSERT INTO sources (message_id, n, url, title, domain, published_date) VALUES (?, ?, ?, ?, ?, ?)',
    );

    this.db.transaction(() => {
      const existing = this.db.prepare('SELECT 1 FROM conversations WHERE id = ?').get(t.conversationId);
      if (existing) {
        this.db.prepare('UPDATE conversations SET updated_at = ? WHERE id = ?').run(iso(t.answer.createdAtMs), t.conversationId);
      } else {
        this.db
          .prepare('INSERT INTO conversations (id, user_id, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
          .run(t.conversationId, t.userId, titleFrom(t.question.content), iso(t.question.createdAtMs), iso(t.answer.createdAtMs));
      }
      const base = { conversationId: t.conversationId, userId: t.userId, timezone: t.timezone };
      insertMessage.run({ ...base, id: t.question.id, role: 'user', content: t.question.content, replyTo: null, createdAt: iso(t.question.createdAtMs), createdAtMs: t.question.createdAtMs });
      insertMessage.run({ ...base, id: t.answer.id, role: 'assistant', content: t.answer.content, replyTo: t.question.id, createdAt: iso(t.answer.createdAtMs), createdAtMs: t.answer.createdAtMs });
      for (const s of t.sources) insertSource.run(t.answer.id, s.n, s.url, s.title, s.domain, s.publishedDate ?? null);
      this.db
        .prepare('INSERT INTO turn_fts (message_id, user_id, question, summary, entities) VALUES (?, ?, ?, ?, ?)')
        .run(t.answer.id, t.userId, t.question.content, '', '');
    })();
  }

  saveExtraction(assistantMessageId: string, userId: string, summary: string, entities: string[], claims: Claim[]): void {
    this.db.transaction(() => {
      this.db
        .prepare('INSERT OR REPLACE INTO turn_summaries (message_id, summary, entities) VALUES (?, ?, ?)')
        .run(assistantMessageId, summary, JSON.stringify(entities));
      this.db.prepare('UPDATE turn_fts SET summary = ?, entities = ? WHERE message_id = ?').run(summary, entities.join(', '), assistantMessageId);
      this.db.prepare('DELETE FROM claims WHERE message_id = ?').run(assistantMessageId);
      const insert = this.db.prepare(
        'INSERT INTO claims (message_id, user_id, entity, attribute, value, source_url, as_of) VALUES (?, ?, ?, ?, ?, ?, ?)',
      );
      for (const c of claims) insert.run(assistantMessageId, userId, c.entity, c.attribute, c.value, c.sourceUrl ?? null, c.asOf);
    })();
  }

  /** Every turn whose question was asked in [startMs, endMs), across all conversations. */
  turnsInRange(userId: string, startMs: number, endMs: number, limit = 20): Turn[] {
    const rows = this.db
      .prepare(`${TURN_SELECT} WHERE a.user_id = ? AND u.created_at_ms >= ? AND u.created_at_ms < ? ORDER BY u.created_at_ms LIMIT ?`)
      .all(userId, startMs, endMs, limit) as TurnRow[];
    return this.hydrate(rows);
  }

  /** Full-text search over past questions, summaries and entities, best match first. */
  searchTurns(userId: string, query: string, limit = 5, beforeMs?: number): Turn[] {
    const match = toFtsQuery(query);
    if (!match) return [];
    const rows = this.db
      .prepare(
        `${TURN_SELECT}
         JOIN (SELECT message_id, bm25(turn_fts, 0, 0, 1.0, 2.0, 3.0) AS rank FROM turn_fts WHERE turn_fts MATCH ? AND user_id = ?) f
           ON f.message_id = a.id
         WHERE u.created_at_ms < ?
         ORDER BY f.rank LIMIT ?`,
      )
      .all(match, userId, beforeMs ?? Number.MAX_SAFE_INTEGER, limit) as TurnRow[];
    return this.hydrate(rows);
  }

  private hydrate(rows: TurnRow[]): Turn[] {
    const ids = rows.map((r) => r.assistant_message_id);
    const sources = this.sourcesFor(ids);
    const claims = this.claimsFor(ids);
    return rows.map((r) => ({
      conversationId: r.conversation_id,
      conversationTitle: r.title,
      userMessageId: r.user_message_id,
      assistantMessageId: r.assistant_message_id,
      question: r.question,
      answer: r.answer,
      createdAt: r.created_at,
      createdAtMs: r.created_at_ms,
      timezone: r.timezone,
      summary: r.summary ?? undefined,
      entities: r.entities ? (JSON.parse(r.entities) as string[]) : [],
      sources: sources.get(r.assistant_message_id) ?? [],
      claims: claims.get(r.assistant_message_id) ?? [],
    }));
  }

  private sourcesFor(messageIds: string[]): Map<string, Source[]> {
    const out = new Map<string, Source[]>();
    if (!messageIds.length) return out;
    const rows = this.db
      .prepare(`SELECT message_id, n, url, title, domain, published_date FROM sources WHERE message_id IN (${placeholders(messageIds)}) ORDER BY n`)
      .all(...messageIds) as { message_id: string; n: number; url: string; title: string; domain: string; published_date: string | null }[];
    for (const r of rows) {
      const list = out.get(r.message_id) ?? [];
      list.push({ n: r.n, url: r.url, title: r.title, domain: r.domain, publishedDate: r.published_date ?? undefined });
      out.set(r.message_id, list);
    }
    return out;
  }

  private claimsFor(messageIds: string[]): Map<string, Claim[]> {
    const out = new Map<string, Claim[]>();
    if (!messageIds.length) return out;
    const rows = this.db
      .prepare(`SELECT message_id, entity, attribute, value, source_url, as_of FROM claims WHERE message_id IN (${placeholders(messageIds)}) ORDER BY id`)
      .all(...messageIds) as { message_id: string; entity: string; attribute: string; value: string; source_url: string | null; as_of: string }[];
    for (const r of rows) {
      const list = out.get(r.message_id) ?? [];
      list.push({ entity: r.entity, attribute: r.attribute, value: r.value, sourceUrl: r.source_url ?? undefined, asOf: r.as_of });
      out.set(r.message_id, list);
    }
    return out;
  }
}

function placeholders(items: unknown[]): string {
  return items.map(() => '?').join(', ');
}

const STOPWORDS = new Set(
  'a an and any are as at be been but by can did do does for from had has have how i if in is it its me my of on or our since so that the then there these they this to was we were what when which who why will with you your about asked ask said tell still correct changed change anything something today yesterday week last monday tuesday wednesday thursday friday saturday sunday'.split(' '),
);

/** Builds a safe FTS5 query: quoted terms OR-ed together, so user punctuation can never break MATCH syntax. */
export function toFtsQuery(text: string): string {
  const terms = [...new Set(text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [])].filter((t) => t.length > 1 && !STOPWORDS.has(t));
  return terms.map((t) => `"${t}"`).join(' OR ');
}

function titleFrom(text: string): string {
  const oneLine = text.replace(/\s+/g, ' ').trim();
  return oneLine.length > 60 ? `${oneLine.slice(0, 57).trimEnd()}…` : oneLine;
}
