import { friendlyDeadline, type DeadlineDisplay } from './review-workspace/deadline-text';

/**
 * Small pure formatters every page should use for counts, money, times, deadlines and run/schedule states, so one
 * number or state reads the same everywhere (BRIEF vocabulary). Nothing here reads data; unknown input never prints
 * `null`, `NaN` or a raw float.
 */

const finite = (value: unknown): number | null => {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string' && value.trim() !== '' && value.trim().toLowerCase() !== 'null') { const n = Number(value.replace(/[,$\s]/g, '')); return Number.isFinite(n) ? n : null; }
  return null;
};

/** "1,234"; unknown or non-numeric input reads "—" (never 0). */
export function count(value: unknown): string {
  const n = finite(value);
  return n === null ? '—' : Math.round(n).toLocaleString();
}

/** "1 file", "1,234 files"; pass `many` for irregular plurals ("1 notice needs", "2 notices need" style wording is the caller's). */
export function plural(value: number, one: string, many = one + 's'): string {
  return `${count(value)} ${value === 1 ? one : many}`;
}

/** "$1,250", "$1,250.50"; missing, `null`, blank or non-numeric values read "—". Currency defaults to CAD, shown as "$". */
export function money(value: unknown, currency = 'CAD'): string {
  const n = finite(value);
  if (n === null) return '—';
  const cents = Math.abs(n % 1) > 1e-9;
  try { return new Intl.NumberFormat(undefined, { style: 'currency', currency, currencyDisplay: 'narrowSymbol', minimumFractionDigits: cents ? 2 : 0, maximumFractionDigits: 2 }).format(n); }
  catch { return `${n.toLocaleString(undefined, { maximumFractionDigits: 2 })} ${currency}`; }
}

const DAY_MS = 86_400_000;
const dayOffset = (date: Date, now: Date) => Math.round((Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) - Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())) / DAY_MS);
const parse = (value: unknown): Date | null => {
  const date = value instanceof Date ? value : typeof value === 'number' ? new Date(value) : typeof value === 'string' && value.trim() ? new Date(value) : null;
  return date && Number.isFinite(date.getTime()) ? date : null;
};

/**
 * One timestamp format, the same as Zoer's `formatWhen`: "Today 6:58 PM", "Yesterday 2:00 AM", "Mon 6:58 PM",
 * "Oct 3, 6:58 PM", "Oct 3, 2025, 6:58 PM". Unreadable values read `fallback`.
 */
export function when(value: unknown, now: Date | number = new Date(), fallback = 'Not recorded'): string {
  const date = parse(value), today = parse(now) ?? new Date();
  if (!date) return fallback;
  const offset = dayOffset(date, today);
  const day = offset === 0 ? 'Today' : offset === -1 ? 'Yesterday' : offset === 1 ? 'Tomorrow'
    : Math.abs(offset) < 7 ? date.toLocaleDateString(undefined, { weekday: 'short' })
    : date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', ...(date.getFullYear() === today.getFullYear() ? {} : { year: 'numeric' }) });
  const time = date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  return `${day}${/\d/.test(day) ? ', ' : ' '}${time}`;
}

/** One deadline format (review-workspace/deadline-text): "Tue, Oct 20 · 2 days left", with precision caveats in `detail`. */
export function deadline(raw: unknown, asOf: number = Date.now()): DeadlineDisplay {
  return friendlyDeadline(raw, asOf);
}

/** "Mon, Nov 30" for the last day of a "closing within N days" window (Vancouver calendar; today + N). */
export function windowEnd(days: number, asOf: number = Date.now()): string {
  const today = new Date(asOf).toLocaleDateString('en-CA', { timeZone: 'America/Vancouver' });
  const [y, m, d] = today.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + days, 12)).toLocaleDateString(undefined, { timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric' });
}

// ---------------------------------------------------------------------------------------------
// Run and schedule states: one vocabulary (BRIEF): Running, Done, Partly failed, Failed, Stopped, Interrupted, Waiting
// for you; schedules On, Off, Needs review. "Queued" is the one extra word, for runs that have not started.
// ---------------------------------------------------------------------------------------------

export type RunStateText = 'Running' | 'Queued' | 'Done' | 'Partly failed' | 'Failed' | 'Stopped' | 'Interrupted' | 'Waiting for you';
/** Workflow statuses that end a run (the plugin's other checks use the same four). */
export const TERMINAL_RUN_STATUSES: readonly string[] = ['succeeded', 'failed', 'cancelled', 'outcome_unknown'];
export const isActiveRun = (status: unknown) => typeof status === 'string' && !!status && !TERMINAL_RUN_STATUSES.includes(status);

const RUN_STATES: Record<string, RunStateText> = {
  running: 'Running', stopping: 'Running', retry_scheduled: 'Interrupted', waiting_for_event: 'Interrupted', paused: 'Interrupted', interrupted: 'Interrupted',
  queued: 'Queued', pending: 'Queued',
  succeeded: 'Done', completed: 'Done', partial: 'Partly failed', failed: 'Failed',
  cancelled: 'Stopped', canceled: 'Stopped', stopped: 'Stopped', outcome_unknown: 'Interrupted',
  waiting_for_user: 'Waiting for you',
};
/** A raw workflow run or plugin batch status in the shared vocabulary; an unknown status is named, not guessed. */
export function runStateText(status: unknown): RunStateText | string {
  return typeof status === 'string' && RUN_STATES[status] ? RUN_STATES[status] : `Unrecognized status: ${String(status ?? 'none')}`;
}

export type ScheduleStateText = 'On' | 'Off' | 'Needs review';
/**
 * A schedule in the shared vocabulary: "Off" when the person turned it off, "Needs review" when Zoer turned it off
 * (always show its reason next to it). Retrying and waiting schedules are still "On". Accepts `scheduleKind` values.
 */
export function scheduleStateText(kind: 'on' | 'paused' | 'stopped' | 'retrying' | 'waiting' | string): ScheduleStateText {
  return kind === 'stopped' ? 'Needs review' : kind === 'paused' || kind === 'off' ? 'Off' : 'On';
}
