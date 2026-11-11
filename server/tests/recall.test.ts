import { beforeEach, describe, expect, it } from 'vitest';
import { formatRecall, gatherRecall, mentionsPastConversation, recallRanges } from '../src/agent/recall';
import { resolveDates } from '../src/dates/resolve';
import { openDb } from '../src/store/db';
import { LOCAL_USER, Store } from '../src/store/repo';

const NOW = new Date('2026-11-11T14:00:00Z'); // Wed 19:30 IST
const IST = 'Asia/Kolkata';
let store: Store;

beforeEach(() => {
  store = new Store(openDb(':memory:'));
  store.ensureUser();
  // Monday 9 Nov, 10:00 IST
  const asked = Date.parse('2026-11-09T04:30:00Z');
  store.saveTurn({
    conversationId: 'crm',
    userId: LOCAL_USER,
    timezone: IST,
    question: { id: 'q1', content: 'Shortlist 5 CRM tools for a 20-person sales team', createdAtMs: asked },
    answer: { id: 'a1', content: 'HubSpot, Pipedrive, Salesforce, Zoho, Close [1][2]', createdAtMs: asked + 8000 },
    sources: [{ n: 1, url: 'https://www.hubspot.com/pricing', title: 'HubSpot pricing', domain: 'hubspot.com' }],
  });
  store.saveExtraction('a1', LOCAL_USER, 'Shortlisted five CRMs for a 20-seat sales team', ['HubSpot', 'Pipedrive', 'Salesforce', 'Zoho', 'Close'], [
    { entity: 'HubSpot Sales Hub', attribute: 'Starter price per seat', value: '$20/mo', sourceUrl: 'https://www.hubspot.com/pricing', asOf: '2026-11-09' },
  ]);
});

function recallFor(message: string) {
  const ranges = resolveDates(message, NOW, IST);
  return gatherRecall(store, LOCAL_USER, ranges, message, NOW.getTime());
}

describe('recall', () => {
  it('finds the turn from the referenced day with its claims', () => {
    const data = recallFor('On Monday we shortlisted 5 CRM tools. Has any of them changed pricing?');
    expect(data.byRange[0].turns).toHaveLength(1);
    const block = formatRecall(data, IST);
    expect(block).toContain('Mon, 9 Nov 2026, 10:00');
    expect(block).toContain('HubSpot Sales Hub | Starter price per seat | $20/mo | as of 2026-11-09');
    expect(block).not.toContain('[1]');
    expect(block).not.toContain('NO RECORD');
  });

  it('says NO RECORD for an empty day and offers related turns by topic', () => {
    const data = recallFor('Last Tuesday I asked you about CRM pricing. Has it changed?');
    expect(data.byRange[0].turns).toHaveLength(0);
    expect(data.related.map((t) => t.assistantMessageId)).toEqual(['a1']);
    const block = formatRecall(data, IST);
    expect(block).toContain('NO RECORD for Tuesday, 10 November 2026');
    expect(block).toContain('Related turns found by topic');
  });

  it('says NO RECORD when nothing at all matches', () => {
    const block = formatRecall(recallFor('What did I ask you on 3 November about kubernetes?'), IST);
    expect(block).toContain('NO RECORD for Tuesday, 3 November 2026');
    expect(block).not.toContain('Related turns');
  });

  it('does not recall turns asked after now (simulated clocks)', () => {
    const data = gatherRecall(store, LOCAL_USER, [], 'CRM', Date.parse('2026-11-08T00:00:00Z'));
    expect(data.related).toHaveLength(0);
  });
});

describe('mentionsPastConversation', () => {
  it.each([
    'What did I ask you on 3 November?',
    'Last Tuesday I asked you about Postgres hosting',
    'On Monday we shortlisted 5 CRM tools',
    'Is your answer still correct today?',
    'you recommended Neon earlier',
  ])('detects "%s"', (m) => expect(mentionsPastConversation(m)).toBe(true));

  it.each(['What happened in the news yesterday?', 'hubspot pricing', 'thanks'])('ignores "%s"', (m) =>
    expect(mentionsPastConversation(m)).toBe(false),
  );
});

describe('recallRanges', () => {
  it('drops a present-tense "today" when another date is given', () => {
    const ranges = resolveDates('What did I ask you on 3 November? Is your answer still correct today?', NOW, IST);
    expect(recallRanges(ranges).map((r) => r.expression)).toEqual(['on 3 November']);
  });

  it('keeps "today" when it is the only date', () => {
    expect(recallRanges(resolveDates('what did I ask you today?', NOW, IST))).toHaveLength(1);
  });
});
