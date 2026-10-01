/**
 * Deadline parsing and time-aware open state. Raw text is always kept; precision is explicit; zone
 * math uses `Intl` with an IANA zone (never hard-coded seasonal offsets). A date-only deadline on the
 * as-of date is "closing today; time unverified", never closed at midnight.
 */
import type { DateValue, DeadlineState } from './contracts';

export const DEFAULT_DEADLINE_ZONE = 'America/Vancouver';

export interface ParseDeadlineOptions {
  /** IANA zone applied when the source states none. Default `America/Vancouver` (BC Bid publishes Pacific Time). */
  defaultZone?: string;
}

const MONTHS: Record<string, number> = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4, may: 5, jun: 6, june: 6,
  jul: 7, july: 7, aug: 8, august: 8, sep: 9, sept: 9, september: 9, oct: 10, october: 10, nov: 11, november: 11, dec: 12, december: 12,
};

/** Named North American zone phrases → IANA zones (DST handled by Intl, not by the abbreviation). */
const ZONE_WORDS: Array<[RegExp, string]> = [
  [/\bpacific(\s+(standard|daylight))?(\s+time)?\b/i, 'America/Vancouver'], [/\bP[SD]?T\b/, 'America/Vancouver'],
  [/\bmountain(\s+(standard|daylight))?(\s+time)?\b/i, 'America/Edmonton'], [/\bM[SD]T\b/, 'America/Edmonton'],
  [/\bcentral(\s+(standard|daylight))?(\s+time)?\b/i, 'America/Winnipeg'], [/\bC[SD]T\b/, 'America/Winnipeg'],
  [/\beastern(\s+(standard|daylight))?(\s+time)?\b/i, 'America/Toronto'], [/\bE[SD]?T\b/, 'America/Toronto'],
  [/\batlantic(\s+(standard|daylight))?(\s+time)?\b/i, 'America/Halifax'], [/\bA[SD]T\b/, 'America/Halifax'],
  [/\bnewfoundland(\s+(standard|daylight))?(\s+time)?\b/i, 'America/St_Johns'], [/\bN[SD]T\b/, 'America/St_Johns'],
  [/\b(utc|gmt|coordinated universal time)\b/i, 'UTC'],
];
const IANA = /\b([A-Z][A-Za-z_]+\/[A-Z][A-Za-z_]+(?:\/[A-Z][A-Za-z_]+)?)\b/;

const formatters = new Map<string, Intl.DateTimeFormat>();
function formatter(zone: string): Intl.DateTimeFormat {
  let f = formatters.get(zone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', { timeZone: zone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
    formatters.set(zone, f);
  }
  return f;
}

export function isValidTimeZone(zone: unknown): zone is string {
  if (typeof zone !== 'string' || !zone) return false;
  try { formatter(zone); return true; } catch { return false; }
}

function zonedParts(ms: number, zone: string): { year: number; month: number; day: number; hour: number; minute: number; second: number } {
  const parts: Record<string, number> = {};
  for (const part of formatter(zone).formatToParts(new Date(ms))) if (part.type !== 'literal') parts[part.type] = Number(part.value);
  return { year: parts.year!, month: parts.month!, day: parts.day!, hour: parts.hour === 24 ? 0 : parts.hour!, minute: parts.minute!, second: parts.second! };
}

function offsetAt(ms: number, zone: string): number {
  const p = zonedParts(ms, zone);
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(ms / 1000) * 1000;
}

/** UTC epoch milliseconds for a wall-clock time in an IANA zone. */
export function zonedTimeToUtc(year: number, month: number, day: number, hour: number, minute: number, second: number, zone: string): number {
  const guess = Date.UTC(year, month - 1, day, hour, minute, second);
  const first = offsetAt(guess, zone);
  const candidate = guess - first;
  const second_ = offsetAt(candidate, zone);
  return second_ === first ? candidate : guess - second_;
}

const pad = (n: number, width = 2) => String(n).padStart(width, '0');

/** Calendar date (YYYY-MM-DD) of an instant in an IANA zone. */
export function calendarDateInZone(instant: number | Date | string, zone: string = DEFAULT_DEADLINE_ZONE): string {
  const ms = toEpoch(instant);
  const p = zonedParts(ms, zone);
  return `${pad(p.year, 4)}-${pad(p.month)}-${pad(p.day)}`;
}

function toEpoch(value: number | Date | string): number {
  const ms = value instanceof Date ? value.getTime() : typeof value === 'number' ? value : typeof value === 'string' ? Date.parse(value) : NaN;
  if (!Number.isFinite(ms)) throw new TypeError(`Invalid as-of instant: ${String(value)}`);
  return ms;
}

function validDate(year: number, month: number, day: number): boolean {
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day) || year < 1000 || year > 9999) return false;
  const d = new Date(Date.UTC(year, month - 1, day));
  return d.getUTCFullYear() === year && d.getUTCMonth() === month - 1 && d.getUTCDate() === day;
}

interface ParsedDate { year: number; month: number; day: number; rest: string }

function findDate(text: string): ParsedDate | null {
  let m = /\b(\d{4})[-/](\d{1,2})[-/](\d{1,2})\b/.exec(text);
  if (m) return { year: +m[1]!, month: +m[2]!, day: +m[3]!, rest: text.replace(m[0], ' ') };
  m = /\b([A-Za-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})\b/.exec(text);
  if (m && MONTHS[m[1]!.toLowerCase()]) return { year: +m[3]!, month: MONTHS[m[1]!.toLowerCase()]!, day: +m[2]!, rest: text.replace(m[0], ' ') };
  m = /\b(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]{3,9})\.?,?\s+(\d{4})\b/.exec(text);
  if (m && MONTHS[m[2]!.toLowerCase()]) return { year: +m[3]!, month: MONTHS[m[2]!.toLowerCase()]!, day: +m[1]!, rest: text.replace(m[0], ' ') };
  return null;
}

interface ParsedTime { hour: number; minute: number; second: number; rest: string }

function findTime(text: string): ParsedTime | null | 'invalid' {
  let m = /\b(\d{1,2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?\s*(a\.?\s?m\.?|p\.?\s?m\.?)?(?![\w])/i.exec(text);
  let hour: number, minute: number, second: number, meridiem: string | undefined;
  if (m) { hour = +m[1]!; minute = +m[2]!; second = m[3] ? +m[3] : 0; meridiem = m[4]; }
  else {
    m = /\b(\d{1,2})\s*(a\.?\s?m\.?|p\.?\s?m\.?)(?![\w])/i.exec(text);
    if (!m) return /\bnoon\b/i.test(text) ? { hour: 12, minute: 0, second: 0, rest: text.replace(/\bnoon\b/i, ' ') } : null;
    hour = +m[1]!; minute = 0; second = 0; meridiem = m[2];
  }
  if (meridiem) {
    if (hour < 1 || hour > 12) return 'invalid';
    const pm = /^p/i.test(meridiem);
    hour = (hour % 12) + (pm ? 12 : 0);
  }
  if (hour > 23 || minute > 59 || second > 59) return 'invalid';
  return { hour, minute, second, rest: text.replace(m[0], ' ') };
}

function findZone(text: string): string | null {
  const iana = IANA.exec(text);
  if (iana && isValidTimeZone(iana[1])) return iana[1]!;
  for (const [pattern, zone] of ZONE_WORDS) if (pattern.test(text)) return zone;
  return null;
}

const unknownValue = (raw: string): DateValue => ({ raw, precision: 'unknown', iso: null, date: null, zone: null, zoneBasis: null });

function parseSingle(raw: string, defaultZone: string): DateValue {
  const text = raw.replace(/\s+/g, ' ').trim();
  const isoOffset = /^(\d{4})-(\d{2})-(\d{2})[Tt ](\d{2}):(\d{2})(?::(\d{2})(\.\d+)?)?\s*([Zz]|[+-]\d{2}:?\d{2})$/.exec(text);
  if (isoOffset) {
    const [, y, mo, d, h, mi, s, frac, offset] = isoOffset;
    if (!validDate(+y!, +mo!, +d!) || +h! > 23 || +mi! > 59 || +(s ?? 0) > 59) return unknownValue(raw);
    const zoneText = /^z$/i.test(offset!) ? 'Z' : offset!.length === 5 ? `${offset!.slice(0, 3)}:${offset!.slice(3)}` : offset!;
    const ms = Date.parse(`${y}-${mo}-${d}T${h}:${mi}:${s ?? '00'}${frac ?? ''}${zoneText}`);
    if (!Number.isFinite(ms)) return unknownValue(raw);
    return { raw, precision: 'instant', iso: new Date(ms).toISOString(), date: `${y}-${mo}-${d}`, zone: zoneText === 'Z' ? 'UTC' : zoneText, zoneBasis: 'stated' };
  }
  const date = findDate(text);
  if (!date || !validDate(date.year, date.month, date.day)) return unknownValue(raw);
  const stated = findZone(date.rest.replace(/\b(\d{1,2}(:\d{2})*)\s*(a\.?\s?m\.?|p\.?\s?m\.?)(?![\w])/gi, ' '));
  const zone = stated ?? defaultZone;
  const dateText = `${pad(date.year, 4)}-${pad(date.month)}-${pad(date.day)}`;
  const time = findTime(date.rest);
  if (time === 'invalid') return unknownValue(raw);
  if (!time) return { raw, precision: 'date', iso: null, date: dateText, zone, zoneBasis: stated ? 'stated' : 'default' };
  const ms = zonedTimeToUtc(date.year, date.month, date.day, time.hour, time.minute, time.second, zone);
  return { raw, precision: 'instant', iso: new Date(ms).toISOString(), date: dateText, zone, zoneBasis: stated ? 'stated' : 'default' };
}

/**
 * Parse a raw deadline. Recognizes ISO instants with offsets, `YYYY-MM-DD h:mm:ss AM/PM [zone words]`
 * (BC Bid), `Mon D, YYYY [time]`, `D Mon YYYY [time]`, date-only values and two-date ranges.
 * Anything else is `unknown` with the raw text preserved. Never falls back to loose `new Date(raw)`.
 */
export function parseDeadline(raw: string | null | undefined, options: ParseDeadlineOptions = {}): DateValue {
  const defaultZone = options.defaultZone ?? DEFAULT_DEADLINE_ZONE;
  if (!isValidTimeZone(defaultZone)) throw new RangeError(`Unknown IANA time zone: ${defaultZone}`);
  const text = typeof raw === 'string' ? raw : '';
  if (!text.trim()) return unknownValue(text);
  const single = parseSingle(text, defaultZone);
  if (single.precision !== 'unknown') {
    // A second date (e.g. "2026-10-01 to 2026-10-05") makes it a range, not the first date.
    const parts = text.split(/\s+(?:to|through|until|and|–|—|-)\s+/i);
    if (parts.length === 2) {
      const a = parseSingle(parts[0]!, defaultZone);
      const b = parseSingle(parts[1]!, defaultZone);
      if (a.precision !== 'unknown' && b.precision !== 'unknown' && a.date && b.date) {
        const last = a.date > b.date ? a : b;
        return { raw: text, precision: 'range', iso: null, date: last.date, zone: last.zone, zoneBasis: last.zoneBasis ?? null };
      }
    }
  }
  return single;
}

/**
 * Open state at a frozen as-of point. Instants compare exactly (a deadline at or before as-of is
 * closed). Date-only and range values compare calendar dates in their zone: same day →
 * `closing_today_time_unverified`, later day → `closed`.
 */
export function deadlineState(value: DateValue | null | undefined, asOf: string | number | Date): DeadlineState {
  const now = toEpoch(asOf);
  if (!value || value.precision === 'unknown') return 'unknown';
  if (value.precision === 'instant') {
    const at = value.iso ? Date.parse(value.iso) : NaN;
    if (!Number.isFinite(at)) return 'unknown';
    return at <= now ? 'closed' : 'open';
  }
  if (!value.date || !/^\d{4}-\d{2}-\d{2}$/.test(value.date)) return 'unknown';
  const zone = isValidTimeZone(value.zone) ? value.zone : DEFAULT_DEADLINE_ZONE;
  const today = calendarDateInZone(now, zone);
  if (value.date === today) return 'closing_today_time_unverified';
  return value.date < today ? 'closed' : 'open';
}
