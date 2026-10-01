// Pure helpers for pursuit cards and the task panel. No bridge or DOM imports (tested directly).

/** Human-confirmed reasons for closing a pursuit; kept distinct, never inferred from award history. */
export const CLOSED_REASONS = [['lost', 'Lost: another bidder was awarded'], ['withdrawn', 'Withdrawn by us'], ['no-bid', 'No bid: we decided not to submit'], ['cancelled', 'Cancelled by the buyer']] as const;
export type ClosedReason = typeof CLOSED_REASONS[number][0];
const REASON_LINE = /^Closed reason: (lost|withdrawn|no-bid|cancelled)\b.*$/m;
const SUBMITTED_LINE = /^Submitted outside Zoer \(recorded [^)]*\).*$/m;
const AWARDED_LINE = /^Award confirmed by the buyer \(recorded [^)]*\).*$/m;
const MAX_NOTES = 4000;

/** Put a stage line at the top of the notes, replacing an earlier line of the same kind. Notes stay within the 4,000-character limit. */
function withLine(notes: string, pattern: RegExp, line: string) {
  const rest = notes.replace(pattern, '').replace(/^\n+/, '');
  return (rest ? `${line}\n${rest}` : line).slice(0, MAX_NOTES);
}
const detail = (text: string) => text.trim() ? ` — ${text.trim().replace(/\s+/g, ' ')}` : '';
export const withClosedReason = (notes: string, reason: ClosedReason, text = '') => withLine(notes, REASON_LINE, `Closed reason: ${reason}${detail(text)}`);
export const withSubmitted = (notes: string, day: string, text = '') => withLine(notes, SUBMITTED_LINE, `Submitted outside Zoer (recorded ${day})${detail(text)}`);
export const withAwarded = (notes: string, day: string, text = '') => withLine(notes, AWARDED_LINE, `Award confirmed by the buyer (recorded ${day})${detail(text)}`);
export const closedReason = (notes: string): ClosedReason | null => (notes.match(REASON_LINE)?.[1] as ClosedReason | undefined) ?? null;
export const closedReasonLabel = (reason: ClosedReason | null) => CLOSED_REASONS.find(([id]) => id === reason)?.[1] ?? null;

/** Calendar day (days since epoch) for a due/closing value; the stated date is used as-is, unknown stays null. */
export function dueDay(raw: unknown): number | null {
  if (typeof raw !== 'string' || !raw.trim()) return null;
  const match = raw.trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
  const time = match ? Date.UTC(+match[1], +match[2] - 1, +match[3]) : Date.parse(raw);
  if (!Number.isFinite(time)) return null;
  return Math.floor(time / 86_400_000);
}
export const dayText = (day: number) => new Date(day * 86_400_000).toISOString().slice(0, 10);

export interface DueItem { id: string; recordId: string; label: string; due: string | null; kind: 'closing' | 'task'; owner?: string | null }
export interface DueCluster { from: string; to: string; items: DueItem[]; records: number; owner: string | null }

/**
 * Items due within `windowDays` of each other that span at least two different notices. Grouped per owner when
 * `byOwner` is set (tasks with no owner are grouped together). Items without a usable date are left out, never
 * placed on day zero. Each notice's own "feasible" label does not account for these overlaps.
 */
export function dueClusters(items: DueItem[], windowDays = 3, byOwner = false): DueCluster[] {
  const groups = new Map<string, (DueItem & { day: number })[]>();
  for (const item of items) {
    const day = dueDay(item.due);
    if (day == null) continue;
    const key = byOwner ? (item.owner?.trim() || '') : '*';
    groups.set(key, [...(groups.get(key) ?? []), { ...item, day }]);
  }
  const clusters: DueCluster[] = [];
  for (const [key, list] of groups) {
    list.sort((a, b) => a.day - b.day || a.id.localeCompare(b.id));
    let start = 0;
    while (start < list.length) {
      let end = start;
      while (end + 1 < list.length && list[end + 1].day - list[start].day <= windowDays) end++;
      const group = list.slice(start, end + 1), records = new Set(group.map(item => item.recordId)).size;
      if (records >= 2) clusters.push({ from: dayText(group[0].day), to: dayText(group[group.length - 1].day), items: group.map(({ day: _day, ...item }) => item), records, owner: byOwner ? key || null : null });
      start = records >= 2 ? end + 1 : start + 1;
    }
  }
  return clusters.sort((a, b) => a.from.localeCompare(b.from));
}

/** The next open task for a notice: earliest due date first, undated tasks last. */
export function nextTask<T extends { dueAt: string | null; createdAt?: string; status: string }>(tasks: T[]): T | null {
  const open = tasks.filter(task => task.status === 'open');
  open.sort((a, b) => (dueDay(a.dueAt) ?? Infinity) - (dueDay(b.dueAt) ?? Infinity) || String(a.createdAt ?? '').localeCompare(String(b.createdAt ?? '')));
  return open[0] ?? null;
}
