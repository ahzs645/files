import { host } from '../bridge';
import { SOURCES } from './catalog';
import { deadlineState } from './deadline';

export const sourceName = (id: string) => SOURCES.find(source => source.id === id)?.label ?? id;

export async function sql(statement: string, parameters: (string | number)[] = []) {
  return (await host('catalog.query', { statement, parameters })).rows as any[];
}

export const INVENTORY_SQL = "SELECT CASE WHEN json_extract(data,'$.sourceId') IS NULL OR json_extract(data,'$.sourceId')='' THEN 'bc-bid' ELSE json_extract(data,'$.sourceId') END AS sourceId, kind, count(*) AS count, max(json_extract(data,'$.importedAt')) AS importedAt FROM records WHERE kind IN ('opportunity','award') GROUP BY sourceId, kind";

/** Compact result-row date; pure, so it lives with the deadline rules (re-exported here for existing callers). */
export { shortDate } from './deadline';

const OPEN_STATUSES = ['open', 'active', ''], ENDED_STATUSES = ['closed', 'cancelled', 'canceled'];
/**
 * Status shown for a notice. Sources often keep saying "Open" after the closing date (BC Bid does for weeks), so an
 * opportunity whose deadline has passed reads "Closed · deadline passed" while the stored source status is kept and
 * named in `title`. Unknown deadlines never close a notice. A source that says "Closed" or "Cancelled" before the
 * closing date is believed (`early`), so the date is not shown as an upcoming close.
 */
export function noticeStatus(status: unknown, deadline: unknown, kind: string, now = Date.now()): { text: string; key: string; title?: string; early?: boolean } | null {
  const source = typeof status === 'string' ? status.trim() : '', state = deadlineState(deadline, now);
  if (kind === 'opportunity' && OPEN_STATUSES.includes(source.toLowerCase()) && state === 'closed')
    return { text: 'Closed · deadline passed', key: 'closed', title: source ? `The source still says “${source}”; its closing date has passed.` : 'The closing date has passed.' };
  if (kind === 'opportunity' && ENDED_STATUSES.includes(source.toLowerCase()) && (state === 'open' || state === 'closing_today_time_unverified'))
    return { text: source, key: source.toLowerCase(), early: true, title: `The source says “${source}” before the closing date; it may have been cancelled or closed early.` };
  return source ? { text: source, key: source.toLowerCase() } : null;
}
