import { host } from '../bridge';
import { SOURCES } from './catalog';
import { deadlineState } from './deadline';
import { canonicalNoticeSql } from './canonical';
import { AWARDED_WORDS, CANCELLED_WORDS, ENDED_WORDS, effectiveLifecycle } from './lifecycle';

export const sourceName = (id: string) => SOURCES.find(source => source.id === id)?.label ?? id;

export async function sql(statement: string, parameters: (string | number)[] = []) {
  return (await host('catalog.query', { statement, parameters })).rows as any[];
}

/**
 * Saved notices and awards per source. `count` is one row per notice/award (duplicates.ts canonical rule: current
 * CanadaBuys amendment, no merged rows or repeated awards); `saved` counts every stored row; `linked` counts a
 * source's copies of BC Bid notices, which all-source totals subtract so a notice is counted once.
 */
export const INVENTORY_SQL = `SELECT CASE WHEN json_extract(data,'$.sourceId') IS NULL OR json_extract(data,'$.sourceId')='' THEN 'bc-bid' ELSE json_extract(data,'$.sourceId') END AS sourceId, kind, sum(CASE WHEN ${canonicalNoticeSql()} THEN 1 ELSE 0 END) AS count, count(*) AS saved, sum(CASE WHEN kind='opportunity' AND json_extract(data,'$.duplicateOf') IS NOT NULL AND json_extract(data,'$.mergedInto') IS NULL THEN 1 ELSE 0 END) AS linked, max(json_extract(data,'$.importedAt')) AS importedAt FROM records WHERE kind IN ('opportunity','award') GROUP BY sourceId, kind`;
/** All-source total of INVENTORY_SQL rows of one kind (or both): each notice once. */
export const inventoryTotal = (rows: readonly any[] | undefined, kind?: string) => (rows ?? []).filter(row => !kind || kind === 'all' || row.kind === kind).reduce((sum, row) => sum + Number(row.count ?? 0) - Number(row.linked ?? 0), 0);

/** Compact result-row date; pure, so it lives with the deadline rules (re-exported here for existing callers). */
export { shortDate } from './deadline';

const ENDED_STATUSES = ['closed', 'cancelled', 'canceled'];
/**
 * Status shown for a notice, from the effective lifecycle (lifecycle.ts). Sources often keep saying "Open" after the
 * closing date (BC Bid does for weeks), so an opportunity whose deadline has passed reads "Closed · deadline passed"
 * while the stored source status is kept and named in `title`. Unknown deadlines never close a notice. A placeholder
 * closing date (2036 or later) reads "Open · no fixed closing date". A source that says "Closed" or "Cancelled" before
 * the closing date is believed (`early`), so the date is not shown as an upcoming close.
 */
export function noticeStatus(status: unknown, deadline: unknown, kind: string, now = Date.now()): { text: string; key: string; title?: string; early?: boolean } | null {
  const source = typeof status === 'string' ? status.trim() : '';
  if (kind !== 'opportunity') return source ? { text: source, key: source.toLowerCase() } : null;
  const life = effectiveLifecycle({ status: source, deadline }, now), state = deadlineState(deadline, now);
  // Closed by the passed closing date, not by a source status that already says it ended.
  const sourceEnded = [...CANCELLED_WORDS, ...AWARDED_WORDS, ...ENDED_WORDS].some(word => source.toLowerCase().includes(word));
  if (life.status === 'closed' && !sourceEnded)
    return { text: 'Closed · deadline passed', key: 'closed', title: source ? `The source still says “${source}”; its closing date has passed.` : 'The closing date has passed.' };
  if (ENDED_STATUSES.includes(source.toLowerCase()) && (state === 'open' || state === 'closing_today_time_unverified') && !life.noFixedDate)
    return { text: source, key: source.toLowerCase(), early: true, title: `The source says “${source}” before the closing date; it may have been cancelled or closed early.` };
  if (life.status === 'open' && life.noFixedDate)
    return { text: `${source || 'Open'} · no fixed closing date`, key: 'open', title: 'The source gives a placeholder closing date far in the future (2036 or later): this notice stays open until the buyer closes it.' };
  return source ? { text: source, key: source.toLowerCase() } : null;
}
