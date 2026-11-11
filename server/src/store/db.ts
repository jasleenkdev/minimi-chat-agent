import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS conversations (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  title TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS conversations_user ON conversations(user_id, updated_at);

-- created_at_ms drives date-range recall; timezone is what the user was in when they wrote it.
CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id),
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  content TEXT NOT NULL,
  reply_to TEXT REFERENCES messages(id),
  created_at TEXT NOT NULL,
  created_at_ms INTEGER NOT NULL,
  timezone TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS messages_conversation ON messages(conversation_id, created_at_ms);
CREATE INDEX IF NOT EXISTS messages_user_time ON messages(user_id, created_at_ms);

CREATE TABLE IF NOT EXISTS sources (
  message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  n INTEGER NOT NULL,
  url TEXT NOT NULL,
  title TEXT NOT NULL,
  domain TEXT NOT NULL,
  published_date TEXT,
  PRIMARY KEY (message_id, n)
);

-- One row per answered turn, keyed by the assistant message.
CREATE TABLE IF NOT EXISTS turn_summaries (
  message_id TEXT PRIMARY KEY REFERENCES messages(id) ON DELETE CASCADE,
  summary TEXT NOT NULL,
  entities TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS claims (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id),
  entity TEXT NOT NULL,
  attribute TEXT NOT NULL,
  value TEXT NOT NULL,
  source_url TEXT,
  as_of TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS claims_message ON claims(message_id);

-- Full-text index over each turn: the question right away, summary and entities once extracted.
CREATE VIRTUAL TABLE IF NOT EXISTS turn_fts USING fts5(
  message_id UNINDEXED,
  user_id UNINDEXED,
  question,
  summary,
  entities,
  tokenize = 'porter unicode61'
);
`;

export type DB = Database.Database;

export function openDb(path: string): DB {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(SCHEMA);
  return db;
}
