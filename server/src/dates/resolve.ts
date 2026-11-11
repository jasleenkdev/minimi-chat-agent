import * as chrono from 'chrono-node';
import { addDays, addMonths, compareDates, isoDate, startOfDay, wallClock, weekdayOf, type CivilDate } from './zone';

export type Granularity = 'day' | 'week' | 'month' | 'span';

/** A resolved, half-open interval [start, end) in real time, plus the calendar days it covers in the user's zone. */
export interface DateRange {
  expression: string;
  granularity: Granularity;
  start: Date;
  end: Date;
  firstDay: CivilDate;
  /** Exclusive. */
  lastDay: CivilDate;
  label: string;
}

const NUMBER_WORDS: Record<string, number> = { a: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, couple: 2, few: 3 };
const FUTURE_CUE = /\b(next|tomorrow|upcoming|coming|in \d+ (?:days?|weeks?|months?))\b/i;
const WEEK_STARTS_ON = 1; // Monday

interface Span {
  index: number;
  length: number;
}

/**
 * Finds date expressions in `text` and resolves them to ranges in the user's time zone.
 * Everything is biased to the past: this exists to find earlier conversations, so
 * "Monday" is the most recent Monday before today and "3 December" is the most recent one that has happened.
 */
export function resolveDates(text: string, now: Date, timezone: string): DateRange[] {
  const clock = wallClock(now, timezone);
  const today: CivilDate = { year: clock.year, month: clock.month, day: clock.day };
  const ranges: DateRange[] = [];
  const consumed: Span[] = [];
  const add = (expression: string, granularity: Granularity, firstDay: CivilDate, lastDay: CivilDate) => {
    if (compareDates(firstDay, addDays(today, 1)) >= 0) return;
    ranges.push(makeRange(expression, granularity, firstDay, lastDay, timezone));
  };

  for (const rule of phraseRules(today)) {
    for (const match of text.matchAll(rule.pattern)) {
      const resolved = rule.resolve(match);
      if (!resolved) continue;
      consumed.push({ index: match.index, length: match[0].length });
      add(match[0], resolved.granularity, resolved.first, resolved.last);
    }
  }

  // chrono parses against the user's wall clock expressed as if it were UTC, so its calendar fields are the user's.
  const reference = { instant: new Date(Date.UTC(clock.year, clock.month - 1, clock.day, clock.hour, clock.minute)), timezone: 0 };
  for (const result of chrono.parse(text, reference)) {
    if (overlaps(result, consumed) || FUTURE_CUE.test(result.text)) continue;
    const resolved = fromChrono(result, today);
    if (resolved) add(result.text, resolved.granularity, resolved.first, resolved.last);
  }

  return dedupe(ranges).sort((a, b) => a.start.getTime() - b.start.getTime());
}

interface Resolved {
  granularity: Granularity;
  first: CivilDate;
  last: CivilDate;
}

function phraseRules(today: CivilDate): { pattern: RegExp; resolve: (m: RegExpMatchArray) => Resolved | undefined }[] {
  const weekStart = addDays(today, -((weekdayOf(today) - WEEK_STARTS_ON + 7) % 7));
  const monthStart = { ...today, day: 1 };
  const tomorrow = addDays(today, 1);
  return [
    {
      pattern: /\b(?:last|previous|past) week\b/gi,
      resolve: () => ({ granularity: 'week', first: addDays(weekStart, -7), last: weekStart }),
    },
    {
      pattern: /\b(?:earlier )?this week\b/gi,
      resolve: () => ({ granularity: 'week', first: weekStart, last: tomorrow }),
    },
    {
      pattern: /\b(?:last|previous|past) month\b/gi,
      resolve: () => ({ granularity: 'month', first: addMonths(monthStart, -1), last: monthStart }),
    },
    {
      pattern: /\b(?:earlier )?this month\b/gi,
      resolve: () => ({ granularity: 'month', first: monthStart, last: tomorrow }),
    },
    {
      pattern: /\b(?:in the |over the )?(?:past|last) (\d+|a|one|two|three|four|five|six|seven|eight|nine|ten|couple of|few) (days?|weeks?)\b/gi,
      resolve: (m) => {
        const n = toNumber(m[1]);
        if (!n) return undefined;
        const days = m[2].toLowerCase().startsWith('week') ? n * 7 : n;
        return { granularity: 'span', first: addDays(today, -days), last: tomorrow };
      },
    },
    {
      pattern: /\b(?:this morning|this afternoon|this evening|tonight|earlier today)\b/gi,
      resolve: () => ({ granularity: 'day', first: today, last: tomorrow }),
    },
  ];
}

function fromChrono(result: chrono.ParsedResult, today: CivilDate): Resolved | undefined {
  const start = result.start;
  const certainDay = start.isCertain('day');
  const certainMonth = start.isCertain('month');
  const certainYear = start.isCertain('year');

  if (result.end && certainDay) {
    const first = pastBiased(civilOf(start), today, certainYear);
    let last = addDays(pastBiased(civilOf(result.end), today, result.end.isCertain('year')), 1);
    if (compareDates(last, first) <= 0) last = addDays(first, 1);
    return { granularity: 'span', first, last };
  }
  if (certainDay) {
    const day = pastBiased(civilOf(start), today, certainYear);
    return { granularity: 'day', first: day, last: addDays(day, 1) };
  }
  if (start.isCertain('weekday')) {
    const target = start.get('weekday') ?? 0;
    // Strictly before today: on a Monday, "on Monday" means a week ago, since today would be "today".
    const back = (weekdayOf(today) - target + 7) % 7 || 7;
    const day = addDays(today, -back);
    return { granularity: 'day', first: day, last: addDays(day, 1) };
  }
  if (certainMonth) {
    const { month } = civilOf(start);
    let year = certainYear ? civilOf(start).year : today.year;
    if (!certainYear && month > today.month) year -= 1;
    const first = { year, month, day: 1 };
    return { granularity: 'month', first, last: addMonths(first, 1) };
  }
  return undefined;
}

/**
 * Reads the calendar date from the parsed instant in UTC (our reference is wall-clock-as-UTC).
 * chrono's implied component values are computed in the host's zone, so `get('day')` can be off by one on a non-UTC server.
 */
function civilOf(c: chrono.ParsedComponents): CivilDate {
  const d = c.date();
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
}

/** A date written without a year that would be in the future means the same date last year. */
function pastBiased(date: CivilDate, today: CivilDate, yearCertain: boolean): CivilDate {
  if (yearCertain || compareDates(date, today) <= 0) return date;
  return { ...date, year: date.year - 1 };
}

function toNumber(word: string): number | undefined {
  const w = word.toLowerCase().replace(/ of$/, '');
  return /^\d+$/.test(w) ? Number(w) : NUMBER_WORDS[w];
}

function overlaps(result: chrono.ParsedResult, spans: Span[]): boolean {
  const end = result.index + result.text.length;
  return spans.some((s) => result.index < s.index + s.length && s.index < end);
}

function makeRange(expression: string, granularity: Granularity, firstDay: CivilDate, lastDay: CivilDate, timezone: string): DateRange {
  return {
    expression: expression.trim(),
    granularity,
    start: startOfDay(firstDay, timezone),
    end: startOfDay(lastDay, timezone),
    firstDay,
    lastDay,
    label: labelFor(granularity, firstDay, lastDay),
  };
}

function dedupe(ranges: DateRange[]): DateRange[] {
  const seen = new Set<string>();
  return ranges.filter((r) => {
    const key = `${r.start.getTime()}-${r.end.getTime()}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

const dayFormat = new Intl.DateTimeFormat('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
const shortFormat = new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
const monthFormat = new Intl.DateTimeFormat('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });

function asUtc(d: CivilDate): Date {
  return new Date(Date.UTC(d.year, d.month - 1, d.day));
}

export function labelFor(granularity: Granularity, first: CivilDate, lastExclusive: CivilDate): string {
  const last = addDays(lastExclusive, -1);
  if (compareDates(first, last) === 0) return dayFormat.format(asUtc(first));
  if (granularity === 'month' && first.day === 1 && lastExclusive.day === 1) return monthFormat.format(asUtc(first));
  return `${shortFormat.format(asUtc(first))} to ${shortFormat.format(asUtc(last))} ${last.year}`;
}

export { isoDate };
