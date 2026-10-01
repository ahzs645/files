/**
 * One open/closed judgement for source deadlines, shared by every list, card and count.
 *
 * - A timestamp with an explicit offset (`Z`, `-07:00`) is an instant: closed once it passes.
 * - A date-only value, or a timestamp without a timezone, is judged by its calendar date in the source zone
 *   (America/Vancouver via Intl, never a hard-coded offset): earlier days are closed, later days open, and the
 *   current day is `closing_today_time_unverified`, never silently closed at midnight nor silently open.
 * - Missing or unparseable values are `unknown`.
 */
export type DeadlineState = 'open' | 'closing_today_time_unverified' | 'closed' | 'unknown';
export const DEADLINE_ZONE = 'America/Vancouver';
export const CLOSING_TODAY_TEXT = 'closing date today; time unverified';

const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const STAMP = /^(\d{4}-\d{2}-\d{2})[Tt ]([01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d+)?)?([Zz]|[+-](?:[01]\d|2[0-3]):[0-5]\d)?$/;

export function validDate(value: string): boolean {
  const m = DATE.exec(value);
  if (!m) return false;
  const [year, month, day] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (!year || month < 1 || month > 12 || day < 1) return false;
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  return day <= [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
}

const formatters = new Map<string, Intl.DateTimeFormat>();
const partsIn = (at: number, zone: string) => {
  let f = formatters.get(zone);
  if (!f) formatters.set(zone, f = new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }));
  return Object.fromEntries(f.formatToParts(at).filter(p => p.type !== 'literal').map(p => [p.type, p.value]));
};
/** The calendar date (YYYY-MM-DD) at `at` in `zone`. */
export function zoneDate(at: number | Date = Date.now(), zone = DEADLINE_ZONE): string {
  const p = partsIn(Number(at), zone);
  return `${p.year}-${p.month}-${p.day}`;
}
/** `date` plus `days` calendar days. */
export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}
/** The last instant of a calendar date in `zone`; the zone offset comes from Intl, so daylight saving is handled. */
export function endOfZoneDay(date: string, zone = DEADLINE_ZONE): number {
  const [y, m, d] = date.split('-').map(Number);
  const guess = Date.UTC(y, m - 1, d, 23, 59, 59);
  const p = partsIn(guess, zone);
  const offset = Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour), Number(p.minute), Number(p.second)) - guess;
  return guess - offset;
}

export type ParsedDeadline = { precision: 'instant'; time: number; date: string } | { precision: 'date'; date: string; zoned: false } | null;
/** Instant when an offset is stated; otherwise only the calendar date is trusted. */
export function parseDeadline(raw: unknown): ParsedDeadline {
  if (typeof raw !== 'string' || !raw.trim()) return null;
  const value = raw.trim();
  if (DATE.test(value)) return validDate(value) ? { precision: 'date', date: value, zoned: false } : null;
  const m = STAMP.exec(value);
  if (!m || !validDate(m[1])) return null;
  if (!m[3]) return { precision: 'date', date: m[1], zoned: false };
  const time = Date.parse(value);
  return Number.isFinite(time) ? { precision: 'instant', time, date: m[1] } : null;
}

export function deadlineState(raw: unknown, asOf: number | Date = Date.now(), zone = DEADLINE_ZONE): DeadlineState {
  const parsed = parseDeadline(raw);
  if (!parsed) return 'unknown';
  if (parsed.precision === 'instant') return parsed.time < Number(asOf) ? 'closed' : 'open';
  const today = zoneDate(asOf, zone);
  return parsed.date < today ? 'closed' : parsed.date === today ? 'closing_today_time_unverified' : 'open';
}

/** Not closed: open, closing today with an unverified time, or unknown. Unknown dates are never dropped as closed. */
export const notClosed = (raw: unknown, asOf: number | Date = Date.now()) => deadlineState(raw, asOf) !== 'closed';

/** A sortable time: the instant, or the end of the stated day in the source zone. */
export function deadlineSortTime(raw: unknown, zone = DEADLINE_ZONE): number | null {
  const parsed = parseDeadline(raw);
  return !parsed ? null : parsed.precision === 'instant' ? parsed.time : endOfZoneDay(parsed.date, zone);
}

/** True when the deadline is not closed and falls within `days` (instants by time, dates by calendar day). */
export function closesWithin(raw: unknown, days: number, asOf: number | Date = Date.now(), zone = DEADLINE_ZONE): boolean {
  const parsed = parseDeadline(raw), state = deadlineState(raw, asOf, zone);
  if (!parsed || state === 'closed' || state === 'unknown') return false;
  return parsed.precision === 'instant' ? parsed.time <= Number(asOf) + days * 86_400_000 : parsed.date <= addDays(zoneDate(asOf, zone), days);
}
