import type { ConversationDTO } from '../../shared/types';

const time = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' });
const dayTime = new Intl.DateTimeFormat(undefined, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const fullDay = new Intl.DateTimeFormat(undefined, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

function dayKey(d: Date): string {
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

function daysBetween(a: Date, b: Date): number {
  const start = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  return Math.round((start(b) - start(a)) / 86_400_000);
}

/** "14:05" today, "Mon 9 Nov, 10:14" otherwise: the date always matters in a product that remembers by date. */
export function messageTime(iso: string, now = new Date()): string {
  const d = new Date(iso);
  return dayKey(d) === dayKey(now) ? `Today, ${time.format(d)}` : dayTime.format(d);
}

export function fullDate(iso: string): string {
  return fullDay.format(new Date(iso));
}

export function groupConversations(conversations: ConversationDTO[], now = new Date()): { label: string; items: ConversationDTO[] }[] {
  const groups = new Map<string, ConversationDTO[]>();
  for (const c of conversations) {
    const diff = daysBetween(new Date(c.updatedAt), now);
    const label = diff <= 0 ? 'Today' : diff === 1 ? 'Yesterday' : diff < 7 ? 'Previous 7 days' : diff < 30 ? 'Previous 30 days' : 'Older';
    groups.set(label, [...(groups.get(label) ?? []), c]);
  }
  return [...groups].map(([label, items]) => ({ label, items }));
}
