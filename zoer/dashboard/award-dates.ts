import { addDays, zoneDate } from './procurement/deadline';

/** Awards are past events. A date further ahead than this is a source typo (2107 for 2017), not a real award. */
export const AWARD_DATE_MARGIN_DAYS = 366;
const latestAwardDate = (now: number) => addDays(zoneDate(now), AWARD_DATE_MARGIN_DAYS);
const dated = (value: string) => /^\d{4}-\d{2}-\d{2}/.test(value);

/** False only for a dated value past the limit; undated and free-text values are handled by their own display. */
export function plausibleAwardDate(raw: unknown, now = Date.now()) {
  return !(typeof raw === 'string' && dated(raw.trim()) && raw.trim().slice(0, 10) > latestAwardDate(now));
}
/** The record keeps the source's value; this is how lists show it: "Nov 26, 2026", a date after today flagged, and
 *  one that can't be right replaced. Empty when there is no date. */
export function awardDateText(raw: unknown, now = Date.now()): string {
  if (!plausibleAwardDate(raw, now)) return `Date unknown (source says ${String(raw).trim().slice(0, 10)})`;
  const cell = awardDateCell(raw, now);
  return cell.text === '—' ? '' : cell.future ? `${cell.text} · after today, check source` : cell.text;
}
/** ORDER BY term: 1 for a date that fails `plausibleAwardDate`, so those sort last in both directions. The limit is a formatted date, never input. */
export const implausibleAwardOrder = (value: string, now = Date.now()) => `CASE WHEN ${value} GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]*' AND ${value}>'${latestAwardDate(now)}Z' THEN 1 ELSE 0 END`;

const MONTHS=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
/** "Nov 26, 2026" for a calendar date written YYYY-MM-DD (time ignored); null for anything else. */
export function formatAwardDay(value:string):string|null{
  const match=/^(\d{4})-(\d{2})-(\d{2})/.exec(value.trim()); if(!match)return null;
  const [,year,month,day]=match, date=new Date(`${year}-${month}-${day}T00:00:00Z`);
  if(!Number.isFinite(date.getTime())||date.toISOString().slice(0,10)!==`${year}-${month}-${day}`)return null;
  return `${MONTHS[Number(month)-1]} ${Number(day)}, ${year}`;
}
/**
 * How an award date reads in lists: the formatted day, flagged when it is after today (an award is a past event, so the
 * source needs checking) and replaced when it is past the plausible limit. `title` keeps the source's own text.
 */
export function awardDateCell(raw:unknown,now=Date.now()):{text:string;future:boolean;title?:string}{
  if(typeof raw!=='string'||!raw.trim())return {text:'—',future:false};
  if(!plausibleAwardDate(raw,now))return {text:`Date unknown (source says ${raw.trim().slice(0,10)})`,future:false,title:`Source says ${raw.trim()}`};
  const text=formatAwardDay(raw);
  if(!text)return {text:raw.trim(),future:false};
  const future=raw.trim().slice(0,10)>zoneDate(now);
  return {text,future,title:future?`Award date after today: check the source (${raw.trim()})`:raw.trim()};
}
