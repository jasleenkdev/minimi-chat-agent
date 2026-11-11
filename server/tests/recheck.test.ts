import { describe, expect, it } from 'vitest';
import { isRecheckRequest, mergeQueries, recheckNote, recheckProducts, recheckQueries } from '../src/agent/recheck';
import type { Turn } from '../src/store/repo';

const turn = (over: Partial<Turn>): Turn => ({
  conversationId: 'c',
  conversationTitle: 't',
  userMessageId: 'u',
  assistantMessageId: 'a',
  question: 'q',
  answer: 'a',
  createdAt: '2026-11-09T04:30:00Z',
  createdAtMs: Date.parse('2026-11-09T04:30:00Z'),
  timezone: 'Asia/Kolkata',
  entities: [],
  sources: [],
  claims: [],
  ...over,
});

describe('recheck', () => {
  it.each(['Has any of them changed pricing?', 'Is your answer still correct today?', 'any updates since then?', 'did they ship something big'])(
    'detects "%s"',
    (m) => expect(isRecheckRequest(m)).toBe(true),
  );

  it('ignores plain recall', () => expect(isRecheckRequest('What did I ask you on 3 November?')).toBe(false));

  it('prefers extracted entities and falls back to claim entities', () => {
    expect(recheckProducts([turn({ entities: ['HubSpot Sales Hub', 'Pipedrive'] })])).toEqual(['HubSpot Sales Hub', 'Pipedrive']);
    expect(recheckProducts([turn({ claims: [{ entity: 'Neon', attribute: 'price', value: '$19', asOf: '2026-11-03' }] })])).toEqual(['Neon']);
  });

  it('builds a pricing and a news query per product, deduped against the planner', () => {
    const q = mergeQueries(recheckQueries(['Neon'], 'November 2026'), [{ query: 'neon pricing', kind: 'web' }, { query: 'Supabase pricing', kind: 'web' }]);
    expect(q.map((x) => x.query)).toEqual(['Neon pricing', 'Neon news announcement November 2026', 'Supabase pricing']);
  });

  it('lists every recorded claim as a row and forbids claiming unverified items are unchanged', () => {
    const note = recheckNote([turn({ claims: [{ entity: 'Neon Launch', attribute: 'monthly price', value: '$19/mo', asOf: '2026-11-03' }] })], ['Neon']);
    expect(note).toContain('- Neon Launch | monthly price | $19/mo (as of 2026-11-03)');
    expect(note).toContain('Could not verify');
  });
});
