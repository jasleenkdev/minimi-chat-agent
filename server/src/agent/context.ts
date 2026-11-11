import type { DateRange } from '../dates/resolve';

export interface TurnContext {
  recall?: string;
  prefetched?: string;
  dates: DateRange[];
  notes: string[];
}

/**
 * Per-turn context goes in front of the user's message rather than in the system prompt,
 * so the system prompt and earlier history stay byte-identical and cacheable across turns.
 */
export function buildUserContent(message: string, ctx: TurnContext, timezone: string): string {
  const blocks: string[] = [];
  if (ctx.dates.length) {
    const lines = ctx.dates.map(
      (d) => `"${d.expression}" = ${d.label} [${localStamp(d.start, timezone)} to ${localStamp(d.end, timezone)}) ${timezone}`,
    );
    blocks.push(`<resolved_dates>\n${lines.join('\n')}\n</resolved_dates>`);
  }
  if (ctx.recall) blocks.push(ctx.recall);
  if (ctx.prefetched) blocks.push(ctx.prefetched);
  if (ctx.notes.length) blocks.push(`<notes>\n${ctx.notes.join('\n')}\n</notes>`);
  if (!blocks.length) return message;
  return `${blocks.join('\n\n')}\n\n<user_message>\n${message}\n</user_message>`;
}

function localStamp(date: Date, timezone: string): string {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
      .formatToParts(date)
      .map((x) => [x.type, x.value]),
  );
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}`;
}
