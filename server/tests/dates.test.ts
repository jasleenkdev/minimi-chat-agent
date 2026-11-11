import { describe, expect, it } from 'vitest';
import { resolveDates } from '../src/dates/resolve';
import { startOfDay, wallClock } from '../src/dates/zone';

const IST = 'Asia/Kolkata';
// Wednesday 11 November 2026, 19:30 IST
const WED_EVENING = new Date('2026-11-11T14:00:00Z');

function days(text: string, now = WED_EVENING, tz = IST) {
  return resolveDates(text, now, tz).map((r) => [r.firstDay, r.lastDay].map((d) => `${d.year}-${String(d.month).padStart(2, '0')}-${String(d.day).padStart(2, '0')}`).join('..'));
}

describe('zone helpers', () => {
  it('reads the wall clock in the user zone, not the server zone', () => {
    expect(wallClock(new Date('2026-11-10T18:45:00Z'), IST)).toMatchObject({ year: 2026, month: 11, day: 11, hour: 0, minute: 15, weekday: 3 });
  });

  it('finds midnight in the user zone', () => {
    expect(startOfDay({ year: 2026, month: 11, day: 9 }, IST).toISOString()).toBe('2026-11-08T18:30:00.000Z');
    expect(startOfDay({ year: 2026, month: 11, day: 9 }, 'UTC').toISOString()).toBe('2026-11-09T00:00:00.000Z');
  });

  it('handles the US daylight saving change (25 hour day)', () => {
    const start = startOfDay({ year: 2026, month: 11, day: 1 }, 'America/New_York');
    const end = startOfDay({ year: 2026, month: 11, day: 2 }, 'America/New_York');
    expect(start.toISOString()).toBe('2026-11-01T04:00:00.000Z');
    expect(end.toISOString()).toBe('2026-11-02T05:00:00.000Z');
  });
});

describe('the dataset examples', () => {
  it('"On Monday we shortlisted..." is the most recent past Monday', () => {
    expect(days('On Monday we shortlisted 5 CRM tools for a 20-person sales team. Has any of them changed pricing?')).toEqual(['2026-11-09..2026-11-10']);
  });

  it('"What did I ask you on 3 November?" is 3 Nov this year', () => {
    expect(days('What did I ask you on 3 November? Is your answer still correct today?')).toContain('2026-11-03..2026-11-04');
  });

  it('"Last Tuesday I asked you about Postgres hosting" is the most recent past Tuesday', () => {
    expect(days('Last Tuesday I asked you about Postgres hosting. Has any pricing changed since then?')).toEqual(['2026-11-10..2026-11-11']);
  });

  it('returns real instants for the IST day', () => {
    const [r] = resolveDates('on Monday', WED_EVENING, IST);
    expect(r.start.toISOString()).toBe('2026-11-08T18:30:00.000Z');
    expect(r.end.toISOString()).toBe('2026-11-09T18:30:00.000Z');
    expect(r.label).toBe('Monday, 9 November 2026');
  });
});

describe('past bias', () => {
  it('a bare weekday that is still ahead this week means last week', () => {
    expect(days('on Friday')).toEqual(['2026-11-06..2026-11-07']);
  });

  it('the same weekday as today means a week ago', () => {
    expect(days('what did we discuss on Wednesday')).toEqual(['2026-11-04..2026-11-05']);
  });

  it('a date later this year without a year means last year', () => {
    expect(days('on 3 December')).toEqual(['2025-12-03..2025-12-04']);
  });

  it('an explicit year is respected', () => {
    expect(days('on 3 November 2025')).toEqual(['2025-11-03..2025-11-04']);
  });

  it('a month name later in the year means last year', () => {
    expect(days('in December')).toEqual(['2025-12-01..2026-01-01']);
    expect(days('in October')).toEqual(['2026-10-01..2026-11-01']);
  });

  it('future expressions produce no recall range', () => {
    expect(days('what about tomorrow')).toEqual([]);
    expect(days('next Friday')).toEqual([]);
  });
});

describe('relative days', () => {
  it('today and yesterday', () => {
    expect(days('today')).toEqual(['2026-11-11..2026-11-12']);
    expect(days('yesterday')).toEqual(['2026-11-10..2026-11-11']);
    expect(days('the day before yesterday')).toEqual(['2026-11-09..2026-11-10']);
    expect(days('3 days ago')).toEqual(['2026-11-08..2026-11-09']);
  });

  it('this morning is today', () => {
    expect(days('what did I ask this morning')).toEqual(['2026-11-11..2026-11-12']);
  });

  it('past N days is a span ending today', () => {
    expect(days('in the past 3 days')).toEqual(['2026-11-08..2026-11-12']);
    expect(days('over the last two weeks')).toEqual(['2026-10-28..2026-11-12']);
  });
});

describe('week and month boundaries', () => {
  // Monday 9 November 2026, 10:00 IST
  const MONDAY = new Date('2026-11-09T04:30:00Z');
  // Sunday 15 November 2026, 22:00 IST
  const SUNDAY = new Date('2026-11-15T16:30:00Z');

  it('last week is the previous Monday-Sunday', () => {
    expect(days('last week', WED_EVENING)).toEqual(['2026-11-02..2026-11-09']);
    expect(days('last week', MONDAY)).toEqual(['2026-11-02..2026-11-09']);
  });

  it('this week runs from Monday through today', () => {
    expect(days('this week', MONDAY)).toEqual(['2026-11-09..2026-11-10']);
    expect(days('earlier this week', SUNDAY)).toEqual(['2026-11-09..2026-11-16']);
  });

  it('on a Monday, "on Monday" means a week ago and "on Sunday" means yesterday', () => {
    expect(days('on Monday', MONDAY)).toEqual(['2026-11-02..2026-11-03']);
    expect(days('on Sunday', MONDAY)).toEqual(['2026-11-08..2026-11-09']);
  });

  it('last month is the previous calendar month, across a year boundary too', () => {
    expect(days('last month')).toEqual(['2026-10-01..2026-11-01']);
    expect(days('last month', new Date('2027-01-05T06:00:00Z'))).toEqual(['2026-12-01..2027-01-01']);
  });
});

describe('time zones', () => {
  // 00:15 IST on Wednesday 11 Nov is still Tuesday 10 Nov 18:45 in UTC.
  const JUST_AFTER_MIDNIGHT_IST = new Date('2026-11-10T18:45:00Z');

  it('uses the IST date, not the UTC server date, just after midnight', () => {
    expect(days('today', JUST_AFTER_MIDNIGHT_IST)).toEqual(['2026-11-11..2026-11-12']);
    expect(days('yesterday', JUST_AFTER_MIDNIGHT_IST)).toEqual(['2026-11-10..2026-11-11']);
    expect(days('on Tuesday', JUST_AFTER_MIDNIGHT_IST)).toEqual(['2026-11-10..2026-11-11']);
  });

  it('the same instant in UTC gives the UTC calendar day', () => {
    expect(days('today', JUST_AFTER_MIDNIGHT_IST, 'UTC')).toEqual(['2026-11-10..2026-11-11']);
  });

  it('a US user late in the evening is still on the previous day', () => {
    // 22:00 PST on Tuesday 10 Nov
    expect(days('today', new Date('2026-11-11T06:00:00Z'), 'America/Los_Angeles')).toEqual(['2026-11-10..2026-11-11']);
  });

  it('day ranges are exact local midnights', () => {
    const [r] = resolveDates('yesterday', JUST_AFTER_MIDNIGHT_IST, IST);
    expect(r.start.toISOString()).toBe('2026-11-09T18:30:00.000Z');
    expect(r.end.toISOString()).toBe('2026-11-10T18:30:00.000Z');
  });
});

describe('no false positives', () => {
  it('ignores numbers and bare times', () => {
    expect(days('compare 5 CRM tools for a 20-person sales team')).toEqual([]);
    expect(days('is Postgres 17 faster at 3 replicas')).toEqual([]);
    expect(days('hello there')).toEqual([]);
  });

  it('finds several expressions in one message', () => {
    expect(days('what did I ask on Monday and on 3 November')).toEqual(['2026-11-03..2026-11-04', '2026-11-09..2026-11-10']);
  });
});
