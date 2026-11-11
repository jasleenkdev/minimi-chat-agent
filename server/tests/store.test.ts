import { beforeEach, describe, expect, it } from 'vitest';
import { openDb } from '../src/store/db';
import { LOCAL_USER, Store, toFtsQuery, type NewTurn } from '../src/store/repo';

let store: Store;
let seq = 0;

function turn(conversationId: string, question: string, answer: string, atIso: string): NewTurn {
  const ms = Date.parse(atIso);
  seq++;
  return {
    conversationId,
    userId: LOCAL_USER,
    timezone: 'Asia/Kolkata',
    question: { id: `q${seq}`, content: question, createdAtMs: ms },
    answer: { id: `a${seq}`, content: answer, createdAtMs: ms + 5000 },
    sources: [{ n: 1, url: 'https://hubspot.com/pricing', title: 'Pricing', domain: 'hubspot.com' }],
  };
}

beforeEach(() => {
  store = new Store(openDb(':memory:'));
  store.ensureUser();
});

describe('Store', () => {
  it('saves turns and reads them back with sources', () => {
    store.saveTurn(turn('c1', 'Shortlist CRMs for a 20 person sales team', 'HubSpot, Pipedrive... [1]', '2026-11-09T05:00:00Z'));
    const messages = store.getMessages('c1');
    expect(messages.map((m) => m.role)).toEqual(['user', 'assistant']);
    expect(messages[1].sources[0].domain).toBe('hubspot.com');
    expect(store.listConversations(LOCAL_USER)[0].title).toContain('Shortlist CRMs');
  });

  it('finds turns by time range across conversations', () => {
    store.saveTurn(turn('c1', 'CRM question', 'a', '2026-11-09T05:00:00Z'));
    store.saveTurn(turn('c2', 'Postgres hosting', 'b', '2026-11-10T05:00:00Z'));
    const hits = store.turnsInRange(LOCAL_USER, Date.parse('2026-11-09T00:00:00Z'), Date.parse('2026-11-10T00:00:00Z'));
    expect(hits.map((t) => t.question)).toEqual(['CRM question']);
  });

  it('full-text search uses extracted summaries, entities and claims', () => {
    const t = turn('c1', 'What should we use?', 'Use Neon or Supabase', '2026-11-03T05:00:00Z');
    store.saveTurn(t);
    expect(store.searchTurns(LOCAL_USER, 'postgres hosting')).toHaveLength(0);
    store.saveExtraction(t.answer.id, LOCAL_USER, 'Compared managed Postgres hosting options', ['Neon', 'Supabase'], [
      { entity: 'Neon', attribute: 'Launch plan price', value: '$19/mo', sourceUrl: 'https://neon.tech/pricing', asOf: '2026-11-03' },
    ]);
    const hits = store.searchTurns(LOCAL_USER, 'postgres hosting pricing');
    expect(hits).toHaveLength(1);
    expect(hits[0].claims[0]).toMatchObject({ entity: 'Neon', value: '$19/mo' });
    expect(hits[0].entities).toEqual(['Neon', 'Supabase']);
  });

  it('recentTurns returns the conversation window oldest first', () => {
    store.saveTurn(turn('c1', 'first', '1', '2026-11-09T05:00:00Z'));
    store.saveTurn(turn('c1', 'second', '2', '2026-11-09T06:00:00Z'));
    store.saveTurn(turn('c1', 'third', '3', '2026-11-09T07:00:00Z'));
    expect(store.recentTurns('c1', 2).map((t) => t.question)).toEqual(['second', 'third']);
  });

  it('deleting a conversation removes it from the index', () => {
    store.saveTurn(turn('c1', 'kubernetes question', 'a', '2026-11-09T05:00:00Z'));
    expect(store.deleteConversation(LOCAL_USER, 'c1')).toBe(true);
    expect(store.searchTurns(LOCAL_USER, 'kubernetes')).toHaveLength(0);
  });
});

describe('toFtsQuery', () => {
  it('quotes terms and drops stopwords and punctuation', () => {
    expect(toFtsQuery('What did I ask about "Postgres" hosting?')).toBe('"postgres" OR "hosting"');
    expect(toFtsQuery('???')).toBe('');
  });
});
