// BC Bid publishes closing dates in Pacific time and the parsers store them date-only (YYYY-MM-DD).
// `Date.parse` reads such a value as UTC midnight, i.e. 4–5 pm the previous day in BC, so compare
// calendar dates in America/Vancouver instead.
const pacific = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Vancouver', year: 'numeric', month: '2-digit', day: '2-digit' });
const dateOnly = /^\d{4}-\d{2}-\d{2}$/;

/** The calendar date in BC at `time`, as YYYY-MM-DD. */
export function bcDate(time = Date.now(), addDays = 0) {
  const part = (type: string) => pacific.formatToParts(time).find(p => p.type === type)!.value;
  const date = new Date(`${part('year')}-${part('month')}-${part('day')}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + addDays);
  return date.toISOString().slice(0, 10);
}

/** Whether a saved closing date has not passed yet; a date-only value stays open through its whole BC day. `null` when unreadable. */
export function closingNotPassed(value: string | undefined | null, now = Date.now()): boolean | null {
  const text = value?.trim() ?? '';
  if (dateOnly.test(text)) return text >= bcDate(now);
  const time = Date.parse(text);
  return Number.isFinite(time) ? time >= now : null;
}

/** Whether a saved closing date falls between now and the end of the BC day `days` from today. */
export function closesWithin(value: string | undefined | null, days: number, now = Date.now()) {
  const text = value?.trim() ?? '';
  if (dateOnly.test(text)) return text >= bcDate(now) && text <= bcDate(now, days);
  const time = Date.parse(text);
  return Number.isFinite(time) && time >= now && time <= now + days * 86400000;
}
