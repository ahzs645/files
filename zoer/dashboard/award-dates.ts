import { addDays, zoneDate } from './procurement/deadline';

/** Awards are past events. A date further ahead than this is a source typo (2107 for 2017), not a real award. */
export const AWARD_DATE_MARGIN_DAYS = 366;
const latestAwardDate = (now: number) => addDays(zoneDate(now), AWARD_DATE_MARGIN_DAYS);
const dated = (value: string) => /^\d{4}-\d{2}-\d{2}/.test(value);

/** False only for a dated value past the limit; undated and free-text values are handled by their own display. */
export function plausibleAwardDate(raw: unknown, now = Date.now()) {
  return !(typeof raw === 'string' && dated(raw.trim()) && raw.trim().slice(0, 10) > latestAwardDate(now));
}
/** The record keeps the source's value; this is how lists show one that can't be right. */
export const awardDateText = (raw: unknown, now = Date.now()) => plausibleAwardDate(raw, now) ? String(raw ?? '') : `Date unknown (source says ${String(raw).trim().slice(0, 10)})`;
/** ORDER BY term: 1 for a date that fails `plausibleAwardDate`, so those sort last in both directions. The limit is a formatted date, never input. */
export const implausibleAwardOrder = (value: string, now = Date.now()) => `CASE WHEN ${value} GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]*' AND ${value}>'${latestAwardDate(now)}Z' THEN 1 ELSE 0 END`;
