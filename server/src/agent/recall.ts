import type { DateRange } from '../dates/resolve';
import type { Store, Turn } from '../store/repo';

const MAX_TURNS_PER_RANGE = 6;
const MAX_RELATED = 4;
const ANSWER_CHARS = 1500;

/** Phrases that point at an earlier conversation rather than at the world. */
const CONVERSATION_CUE =
  /\b(?:i|we)\s+(?:asked|said|told|mentioned|discussed|talked|shortlisted|looked at|compared|chose|picked|were looking)\b|\byou\s+(?:said|told|recommended|suggested|answered|mentioned|gave|listed|found)\b|\b(?:our|last|previous|earlier)\s+(?:chat|conversation|discussion)\b|\bdid\s+i\s+ask\b|\bwhat\s+did\s+(?:i|we|you)\b|\bstill\s+(?:correct|true|accurate|valid|right)\b|\bsince\s+then\b|\byour\s+(?:answer|recommendation|list)\b/i;

export function mentionsPastConversation(message: string): boolean {
  return CONVERSATION_CUE.test(message);
}

/**
 * "What did I ask on 3 November, is it still correct today?": the bare "today" there means the present,
 * not a day to recall. It only counts as a recall range when it is the only date in the message.
 */
export function recallRanges(ranges: DateRange[]): DateRange[] {
  if (ranges.length < 2) return ranges;
  return ranges.filter((r) => r.expression.toLowerCase() !== 'today');
}

export interface RecallData {
  byRange: { range: DateRange; turns: Turn[] }[];
  related: Turn[];
}

export function gatherRecall(store: Store, userId: string, ranges: DateRange[], ftsQuery: string, nowMs: number): RecallData {
  const byRange = ranges.map((range) => ({ range, turns: store.turnsInRange(userId, range.start.getTime(), range.end.getTime(), MAX_TURNS_PER_RANGE) }));
  const seen = new Set(byRange.flatMap((r) => r.turns.map((t) => t.assistantMessageId)));
  const related = store
    .searchTurns(userId, ftsQuery, MAX_RELATED + seen.size, nowMs)
    .filter((t) => !seen.has(t.assistantMessageId))
    .slice(0, MAX_RELATED);
  return { byRange, related };
}

export function recalledTurns(data: RecallData): Turn[] {
  return [...data.byRange.flatMap((r) => r.turns), ...data.related];
}

export function isEmptyRecall(data: RecallData): boolean {
  return recalledTurns(data).length === 0;
}

/** Renders recall as a block for the model. Empty ranges become explicit "no record" notes so the model cannot fill the gap. */
export function formatRecall(data: RecallData, timezone: string): string {
  const lines: string[] = [`<recalled_history timezone="${timezone}">`];

  for (const { range, turns } of data.byRange) {
    if (!turns.length) {
      lines.push(
        `NO RECORD for ${range.label} ("${range.expression}"): there is no conversation with this user in that period. Do not guess what was asked or answered. Say so plainly, then either point to a related turn below if one clearly fits, or ask one short question that lets you help (for example, which items they mean).`,
        '',
      );
      continue;
    }
    lines.push(`## ${range.label} ("${range.expression}"): ${turns.length} turn(s)`, '');
    for (const turn of turns) lines.push(formatTurn(turn, timezone), '');
  }

  if (data.related.length) {
    lines.push('## Related turns found by topic (other dates)', '');
    for (const turn of data.related) lines.push(formatTurn(turn, timezone), '');
  }

  if (!data.byRange.length && !data.related.length) {
    lines.push('NO RECORD: no past conversation matches this message. Do not invent one. Say you have no record of it and ask one short clarifying question.');
  }

  lines.push('</recalled_history>');
  return lines.join('\n');
}

function formatTurn(turn: Turn, timezone: string): string {
  const when = new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone,
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(turn.createdAtMs));
  // Old [n] markers would collide with this turn's source numbers, so they are dropped and the old sources listed by URL.
  const plain = turn.answer.replace(/\[\d{1,2}\]/g, '');
  const answer = plain.length > ANSWER_CHARS ? `${plain.slice(0, ANSWER_CHARS)} …[truncated]` : plain;
  const parts = [`### ${when} (conversation "${turn.conversationTitle}")`, `User asked: ${turn.question}`];
  if (turn.summary) parts.push(`Summary: ${turn.summary}`);
  parts.push(`You answered:\n${answer}`);
  if (turn.claims.length) {
    parts.push('Checkable claims recorded from that answer:');
    for (const c of turn.claims) parts.push(`- ${c.entity} | ${c.attribute} | ${c.value} | as of ${c.asOf}${c.sourceUrl ? ` | ${c.sourceUrl}` : ''}`);
  }
  if (turn.sources.length) parts.push(`Sources used then (not citable now): ${turn.sources.map((s) => s.url).join(' , ')}`);
  return parts.join('\n');
}
