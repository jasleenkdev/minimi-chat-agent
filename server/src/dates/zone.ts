/** A calendar date with no time zone attached. Month is 1-12. */
export interface CivilDate {
  year: number;
  month: number;
  day: number;
}

export interface WallClock extends CivilDate {
  hour: number;
  minute: number;
  /** 0 = Sunday ... 6 = Saturday */
  weekday: number;
}

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timezone: string): Intl.DateTimeFormat {
  let f = formatters.get(timezone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      hourCycle: 'h23',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
    });
    formatters.set(timezone, f);
  }
  return f;
}

/** What a clock on the wall in `timezone` shows at `instant`. */
export function wallClock(instant: Date, timezone: string): WallClock {
  const parts = Object.fromEntries(formatterFor(timezone).formatToParts(instant).map((p) => [p.type, p.value]));
  const civil = { year: Number(parts.year), month: Number(parts.month), day: Number(parts.day) };
  return { ...civil, hour: Number(parts.hour), minute: Number(parts.minute), weekday: weekdayOf(civil) };
}

/** Offset of `timezone` from UTC at `instant`, in ms. */
function offsetMs(instant: number, timezone: string): number {
  const parts = Object.fromEntries(formatterFor(timezone).formatToParts(new Date(instant)).map((p) => [p.type, p.value]));
  const asUtc = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute), Number(parts.second));
  return asUtc - Math.floor(instant / 1000) * 1000;
}

/** The instant midnight starts on `date` in `timezone`. Re-checks the offset so DST transitions land right. */
export function startOfDay(date: CivilDate, timezone: string): Date {
  const guess = Date.UTC(date.year, date.month - 1, date.day);
  const first = guess - offsetMs(guess, timezone);
  const second = guess - offsetMs(first, timezone);
  return new Date(second);
}

export function addDays(date: CivilDate, days: number): CivilDate {
  const d = new Date(Date.UTC(date.year, date.month - 1, date.day + days));
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
}

export function addMonths(date: CivilDate, months: number): CivilDate {
  const d = new Date(Date.UTC(date.year, date.month - 1 + months, 1));
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: 1 };
}

export function weekdayOf(date: CivilDate): number {
  return new Date(Date.UTC(date.year, date.month - 1, date.day)).getUTCDay();
}

export function compareDates(a: CivilDate, b: CivilDate): number {
  return a.year - b.year || a.month - b.month || a.day - b.day;
}

export function isoDate(date: CivilDate): string {
  return `${date.year}-${String(date.month).padStart(2, '0')}-${String(date.day).padStart(2, '0')}`;
}
