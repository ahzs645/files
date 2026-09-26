import { host } from '../bridge';
import { SOURCES } from './catalog';

export const sourceName = (id: string) => SOURCES.find(source => source.id === id)?.label ?? id;

export async function sql(statement: string, parameters: (string | number)[] = []) {
  return (await host('catalog.query', { statement, parameters })).rows as any[];
}

export const INVENTORY_SQL = "SELECT CASE WHEN json_extract(data,'$.sourceId') IS NULL OR json_extract(data,'$.sourceId')='' THEN 'bc-bid' ELSE json_extract(data,'$.sourceId') END AS sourceId, kind, count(*) AS count, max(json_extract(data,'$.importedAt')) AS importedAt FROM records WHERE kind IN ('opportunity','award') GROUP BY sourceId, kind";

const DAY = 86_400_000;
const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/;
const zoned = /^\d{4}-\d{2}-\d{2}[Tt ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:[Zz]|[+-]\d{2}:\d{2})$/;

/**
 * Compact deadline for result rows. Only values with a timezone can be "passed" or
 * "closing soon"; date-only and unzoned values are shown as dates without a judgement.
 * The detail dialog keeps the source's exact text.
 */
export function shortDate(raw: unknown, now = Date.now()): { text: string; tone: '' | 'soon' | 'passed' } {
  if (typeof raw !== 'string' || !raw.trim()) return { text: 'No date', tone: '' };
  const value = raw.trim();
  const day = dateOnly.exec(value);
  if (day) return { text: new Date(Number(day[1]), Number(day[2]) - 1, Number(day[3])).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }), tone: '' };
  if (!zoned.test(value)) {
    const head = dateOnly.exec(value.slice(0, 10));
    return { text: head ? shortDate(value.slice(0, 10), now).text : value, tone: '' };
  }
  const time = Date.parse(value);
  if (!Number.isFinite(time)) return { text: value, tone: '' };
  const text = new Date(time).toLocaleString(undefined, { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
  if (time < now) return { text, tone: 'passed' };
  const days = Math.ceil((time - now) / DAY);
  return days <= 7 ? { text: `${text} · ${days === 1 ? '1 day' : `${days} days`} left`, tone: 'soon' } : { text, tone: '' };
}
