import { describe, expect, it } from 'vitest';
import { checkUpcoming, datesIn, upcomingChanges } from '../evals/upcoming';

const now = new Date('2026-11-11T10:00:00Z');

describe('datesIn', () => {
  it('reads the common written forms', () => {
    const text = 'GA on November 19, 2026; beta was 2026-06-18; RC on 3rd Dec; old news from Sept 25 2025.';
    expect(datesIn(text, now).map((d) => d.iso).sort()).toEqual(['2025-09-25', '2026-06-18', '2026-11-19', '2026-12-03']);
  });

  it('gives a yearless date the year closest to now', () => {
    expect(datesIn('due Jan 5', now).map((d) => d.iso)).toEqual(['2027-01-05']);
  });
});

describe('upcomingChanges', () => {
  it('finds a scheduled change in the next 30 days', () => {
    const sources = ['Version 5 general availability moved to November 19, with a second release candidate first.'];
    expect(upcomingChanges(sources, now)).toEqual(['2026-11-19']);
  });

  it('ignores past dates, far-off dates and dates with no change nearby', () => {
    const sources = [
      'Version 4 was released on October 2, 2026.',
      'End of life for version 2 is scheduled for March 1, 2027.',
      'Our office party is on November 20.',
    ];
    expect(upcomingChanges(sources, now)).toEqual([]);
  });
});

describe('checkUpcoming', () => {
  const evidence = ['Release candidate 1 is out. General availability of version 5 is scheduled for November 19, 2026.'];

  it('fails an answer that calls the old version current and skips the scheduled release', () => {
    const answer = 'Version 4.6 is the current release [1]. Its main features, from 2025, are faster I/O and better JSON support [2].';
    expect(checkUpcoming(evidence, answer, now)).toMatchObject({ applicable: true, ok: false });
  });

  it('passes when the answer states the scheduled date in any common form', () => {
    for (const date of ['November 19', '19 November 2026', '2026-11-19', 'Nov 19th']) {
      expect(checkUpcoming(evidence, `Version 4.6 is current [1]; version 5 ships on ${date} [2].`, now).ok).toBe(true);
    }
  });

  it('does not apply when the sources show nothing scheduled soon', () => {
    expect(checkUpcoming(['Version 4.6 was released on 2 October 2026.'], 'Version 4.6 is current.', now).applicable).toBe(false);
  });
});
