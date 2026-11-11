const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const MONTH = '(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\\.?';
const PATTERNS = [
  { re: /\b(20\d{2})-(\d{2})-(\d{2})\b/g, parts: (m: RegExpMatchArray) => [m[1], m[2], m[3]] },
  { re: new RegExp(`\\b${MONTH}\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s+(20\\d{2}))?\\b`, 'gi'), parts: (m: RegExpMatchArray) => [m[3], month(m[1]), m[2]] },
  { re: new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:of\\s+)?${MONTH}(?:,?\\s+(20\\d{2}))?\\b`, 'gi'), parts: (m: RegExpMatchArray) => [m[3], month(m[2]), m[1]] },
];
const CHANGE_WORDS = /\b(releas\w*|GA|general availability|launch\w*|ship\w*|availab\w*|pric\w*|deprecat\w*|end[- ]of[- ]life|EOL|sunset\w*|retir\w*|schedul\w*|planned|expected|due)\b/i;
const DAY = 86_400_000;

export interface FoundDate {
  iso: string;
  index: number;
}

/** Calendar dates written in the text. A date without a year takes the year that puts it closest to `now`. */
export function datesIn(text: string, now: Date): FoundDate[] {
  const found: FoundDate[] = [];
  for (const { re, parts } of PATTERNS) {
    for (const m of text.matchAll(re)) {
      const [y, mo, d] = parts(m);
      const date = civil(y ? Number(y) : undefined, Number(mo), Number(d), now);
      if (date) found.push({ iso: date, index: m.index ?? 0 });
    }
  }
  return found;
}

/** Dates in the next `days` days that sit next to words about a scheduled change (release, price, deprecation...). */
export function upcomingChanges(texts: string[], now: Date, days = 30): string[] {
  const out = new Set<string>();
  for (const text of texts) {
    for (const d of datesIn(text, now)) {
      if (!inWindow(d.iso, now, days)) continue;
      const around = text.slice(Math.max(0, d.index - 120), d.index + 120);
      if (CHANGE_WORDS.test(around)) out.add(d.iso);
    }
  }
  return [...out].sort();
}

export interface UpcomingCheck {
  applicable: boolean;
  ok: boolean;
  detail: string;
}

/** Passes when the answer mentions at least one of the scheduled-change dates the sources contain. */
export function checkUpcoming(evidence: string[], answer: string, now: Date, days = 30): UpcomingCheck {
  const upcoming = upcomingChanges(evidence, now, days);
  if (!upcoming.length) return { applicable: false, ok: true, detail: 'no scheduled change in the sources' };
  const mentioned = new Set(datesIn(answer, now).map((d) => d.iso).filter((d) => inWindow(d, now, days)));
  return {
    applicable: true,
    ok: upcoming.some((d) => mentioned.has(d)),
    detail: `sources ${upcoming.join(',')}; answer ${[...mentioned].join(',') || 'none'}`,
  };
}

export function inWindow(iso: string, now: Date, days: number): boolean {
  const t = Date.parse(`${iso}T00:00:00Z`);
  const today = Date.parse(`${now.toISOString().slice(0, 10)}T00:00:00Z`);
  return t > today && t <= today + days * DAY;
}

function month(name: string): string {
  return String(MONTHS.indexOf(name.slice(0, 3).toLowerCase()) + 1);
}

function civil(year: number | undefined, mo: number, d: number, now: Date): string | undefined {
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return undefined;
  const candidates = year ? [year] : [now.getUTCFullYear() - 1, now.getUTCFullYear(), now.getUTCFullYear() + 1];
  let best: Date | undefined;
  for (const y of candidates) {
    const date = new Date(Date.UTC(y, mo - 1, d));
    if (date.getUTCMonth() !== mo - 1) continue;
    if (!best || Math.abs(date.getTime() - now.getTime()) < Math.abs(best.getTime() - now.getTime())) best = date;
  }
  return best?.toISOString().slice(0, 10);
}
