import { describe, expect, it } from 'vitest';
import { isTrivial } from '../src/agent/fastpath';

describe('isTrivial', () => {
  it.each(['hi', 'Hello there!', 'thanks', 'thank you so much', 'ok', 'cool, thanks', 'got it', '👍', 'good morning'])('"%s" is trivial', (m) =>
    expect(isTrivial(m)).toBe(true),
  );

  it.each(['hi, what is hubspot pricing?', 'thanks, and what about pipedrive?', 'ok so which CRM is cheapest', '2+2', 'ok?? what did I ask you monday'])(
    '"%s" is not trivial',
    (m) => expect(isTrivial(m)).toBe(false),
  );
});
