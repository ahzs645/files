import { host } from '../bridge';
import { SOURCES } from './catalog';
import { CLOSING_TODAY_TEXT, deadlineState, parseDeadline, validDate } from './deadline';

export const sourceName = (id: string) => SOURCES.find(source => source.id === id)?.label ?? id;

export async function sql(statement: string, parameters: (string | number)[] = []) {
  return (await host('catalog.query', { statement, parameters })).rows as any[];
}

export const INVENTORY_SQL = "SELECT CASE WHEN json_extract(data,'$.sourceId') IS NULL OR json_extract(data,'$.sourceId')='' THEN 'bc-bid' ELSE json_extract(data,'$.sourceId') END AS sourceId, kind, count(*) AS count, max(json_extract(data,'$.importedAt')) AS importedAt FROM records WHERE kind IN ('opportunity','award') GROUP BY sourceId, kind";

const DAY = 86_400_000;
const dayText = (date: string) => { const [y, m, d] = date.split('-').map(Number); return new Date(y, m - 1, d).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }); };

/**
 * Compact date for result rows. With `deadline` (the default), the tone comes from `deadlineState`:
 * date-only and timezone-less values are judged by their calendar day in the source zone, and the current
 * day reads "closing date today; time unverified" rather than open or closed. Award and import dates pass
 * `deadline = false` and are only formatted. The detail dialog keeps the source's exact text.
 */
export function shortDate(raw: unknown, now = Date.now(), deadline = true): { text: string; tone: '' | 'soon' | 'passed' } {
  if (typeof raw !== 'string' || !raw.trim()) return { text: 'No date', tone: '' };
  const value = raw.trim(), parsed = parseDeadline(value);
  if (!parsed) return { text: /^\d{4}-\d{2}-\d{2}/.test(value) && validDate(value.slice(0, 10)) ? dayText(value.slice(0, 10)) : value, tone: '' };
  const state = deadline ? deadlineState(value, now) : 'unknown';
  if (parsed.precision === 'date') {
    const text = dayText(parsed.date);
    return state === 'closing_today_time_unverified' ? { text: `${text} · ${CLOSING_TODAY_TEXT}`, tone: 'soon' } : { text, tone: state === 'closed' ? 'passed' : '' };
  }
  const text = new Date(parsed.time).toLocaleString(undefined, { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
  if (!deadline) return { text, tone: '' };
  if (state === 'closed') return { text, tone: 'passed' };
  const days = Math.ceil((parsed.time - now) / DAY);
  return days <= 7 ? { text: `${text} · ${days === 1 ? '1 day' : `${days} days`} left`, tone: 'soon' } : { text, tone: '' };
}

const OPEN_STATUSES = ['open', 'active', ''];
/**
 * Status shown for a notice. Sources often keep saying "Open" after the closing date (BC Bid does for weeks), so an
 * opportunity whose deadline has passed reads "Closed · deadline passed" while the stored source status is kept and
 * named in `title`. Unknown deadlines never close a notice.
 */
export function noticeStatus(status: unknown, deadline: unknown, kind: string, now = Date.now()): { text: string; key: string; title?: string } | null {
  const source = typeof status === 'string' ? status.trim() : '';
  if (kind === 'opportunity' && OPEN_STATUSES.includes(source.toLowerCase()) && deadlineState(deadline, now) === 'closed')
    return { text: 'Closed · deadline passed', key: 'closed', title: source ? `The source still says “${source}”; its closing date has passed.` : 'The closing date has passed.' };
  return source ? { text: source, key: source.toLowerCase() } : null;
}
