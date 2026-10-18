import { calendarDateInZone, deadlineState, isValidTimeZone, parseDeadline } from '@bcbid/procurement-core';
import type { DeadlineState } from '@bcbid/procurement-core';

/**
 * A deadline as people read it: "Tue, Oct 20 · 2 days left", "Today, 2:00 PM", "Tomorrow". Precision caveats
 * ("date only; time unverified", an assumed time zone) and the raw source text go in `detail`, shown as a tooltip,
 * so rows stay one short line. Days count calendar dates in the deadline's own zone (Pacific unless the source says
 * otherwise); instants with only an offset count in the reader's zone.
 */
export type DeadlineDisplay = { text: string; detail: string; state: DeadlineState; tone: '' | 'soon' | 'passed' };

const localZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
const dayNumber = (date: string) => { const [y, m, d] = date.split('-').map(Number); return Date.UTC(y, m - 1, d) / 86_400_000; };
const noonUtc = (date: string) => dayNumber(date) * 86_400_000 + 43_200_000;
const ZONE_NAMES: Record<string, string> = { 'America/Vancouver': 'Pacific time', 'America/Edmonton': 'Mountain time', 'America/Winnipeg': 'Central time', 'America/Toronto': 'Eastern time', 'America/Halifax': 'Atlantic time', 'America/St_Johns': 'Newfoundland time' };
const plural = (count: number, one: string) => `${count} ${count === 1 ? one : one + 's'}`;

/** "Today", "Tomorrow", "Yesterday", else "Tue, Oct 20" (with the year when it is not this year). */
export function dayLabel(date: string, today: string) {
  const days = dayNumber(date) - dayNumber(today);
  if (days === 0) return 'Today';
  if (days === 1) return 'Tomorrow';
  if (days === -1) return 'Yesterday';
  return new Date(noonUtc(date)).toLocaleDateString('en-US', { timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric', ...(date.slice(0, 4) !== today.slice(0, 4) ? { year: 'numeric' } : {}) });
}

type Parts = { state: DeadlineState; detail: string; tone: DeadlineDisplay['tone']; known: false; source: string } | { state: DeadlineState; detail: string; tone: DeadlineDisplay['tone']; known: true; source: string; date: string; today: string; days: number; time: string };
function deadlineParts(raw: unknown, asOf: number): Parts {
  const source = typeof raw === 'string' ? raw.trim() : '';
  const value = parseDeadline(source || null), state = deadlineState(value, asOf);
  if (!source) return { state, detail: '', tone: '', known: false, source };
  if (value.precision === 'unknown' || !value.date) return { state, detail: `The source gives “${source}”, which is not a recognized date.`, tone: '', known: false, source };
  const instant = value.precision === 'instant' && value.iso ? Date.parse(value.iso) : null;
  // Named zones (stated or the Pacific default) are shown as such; UTC and bare offsets convert to the reader's zone.
  const named = isValidTimeZone(value.zone) && value.zone !== 'UTC', zone = named ? value.zone! : localZone();
  const date = instant === null ? value.date : calendarDateInZone(instant, zone), today = calendarDateInZone(asOf, zone);
  const days = dayNumber(date) - dayNumber(today);
  const time = instant === null ? '' : new Date(instant).toLocaleTimeString('en-US', { timeZone: zone, hour: 'numeric', minute: '2-digit' });
  const zoneText = ZONE_NAMES[zone] ?? zone;
  const detail = value.precision === 'date' ? `${source} · date only; closing time not verified`
    : value.precision === 'range' ? `${source} · date range; closing time not verified`
    : value.zoneBasis === 'default' ? `${source} · no time zone stated; ${zoneText} assumed`
    : named ? `${source} · ${zoneText}` : `${source} · shown in your time zone`;
  const tone = state === 'closed' ? 'passed' : state === 'closing_today_time_unverified' || (state === 'open' && days <= 3) ? 'soon' : '';
  return { state, detail, tone, known: true, source, date, today, days, time };
}

export function friendlyDeadline(raw: unknown, asOf: number): DeadlineDisplay {
  const p = deadlineParts(raw, asOf);
  if (!p.known) return { text: p.source || 'No deadline given', detail: p.detail, state: p.state, tone: p.tone };
  const day = dayLabel(p.date, p.today), when = p.time ? `${day}, ${p.time}` : day;
  const left = p.state === 'closed' ? 'closed' : p.days >= 2 ? `${plural(p.days, 'day')} left` : '';
  return { text: left ? `${when} · ${left}` : when, detail: p.detail, state: p.state, tone: p.tone };
}

/** "Nov 1" (with the year when it is not this year). */
const monthDay = (date: string, today: string) => new Date(noonUtc(date)).toLocaleDateString('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric', ...(date.slice(0, 4) !== today.slice(0, 4) ? { year: 'numeric' } : {}) });

/**
 * The date part of a result card's meta line: "Closes Nov 1", "Closes today", "Closes tomorrow, 2:00 PM",
 * "Closed Oct 12", "Awarded Sep 3". The friendly line and every caveat go in `detail` for the tooltip.
 */
export function cardDeadline(raw: unknown, kind: string, asOf: number): DeadlineDisplay {
  const source = typeof raw === 'string' ? raw.trim() : '';
  if (kind === 'award') {
    const date = /^\d{4}-\d{2}-\d{2}/.test(source) ? source.slice(0, 10) : '';
    const today = calendarDateInZone(asOf, localZone());
    return { text: !source ? 'Award date not given' : date ? `Awarded ${monthDay(date, today)}` : `Awarded ${source}`, detail: source, state: 'unknown', tone: '' };
  }
  const p = deadlineParts(raw, asOf), friendly = friendlyDeadline(raw, asOf);
  if (!p.known) return { text: p.source ? `Closes ${p.source}` : 'No closing date', detail: p.detail, state: p.state, tone: p.tone };
  const near = p.days === 0 ? 'today' : p.days === 1 ? 'tomorrow' : '';
  const text = p.state === 'closed' ? `Closed ${monthDay(p.date, p.today)}` : near ? `Closes ${near}${p.time ? `, ${p.time}` : ''}` : `Closes ${monthDay(p.date, p.today)}`;
  return { text, detail: `${friendly.text} — ${p.detail}`, state: p.state, tone: p.tone };
}
