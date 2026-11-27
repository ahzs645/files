import { scheduleKind, scheduleSummary, stopReason, type ScheduleRow } from './schedule-state';
import { lastCollected, type ConnectorCollection, type PortalRow, type Tone } from './source-overview';
import type { BrowserSiteRow } from './browser-source-overview';
import { formatAwardDay } from '../award-dates';
import { plainError } from '../error-text';
import { count, plural, when } from '../format';

/**
 * Operations › Sources card model (pure): every source card has the same slots in the same order (name and kind, status,
 * saved opportunities, last collected, next run, one action), and these helpers fill them in the shared words.
 */

/** Source tone as the host StatusBadge tone. */
export const BADGE_TONE: Record<Tone, 'success' | 'running' | 'warning' | 'neutral'> = { good: 'success', busy: 'running', warn: 'warning', idle: 'neutral' };

const firstSentence = (text: string) => /^.*?[.!?](?=\s|$)/.exec(text)?.[0] ?? text;

export interface ScheduleSlot { text: string; tone: Tone; badge: boolean; reason: string | null; detail: string | null }
/**
 * The "Next run" slot: "On · next run Today 9:00 AM", "Off" (the person turned it off), "Needs review" (Zoer turned it
 * off; `reason` is the real cause in one sentence, `detail` the full explanation and Zoer's own message).
 */
export function scheduleSlot(row: ScheduleRow | undefined, now = Date.now()): ScheduleSlot {
  if (!row) return { text: 'Not scheduled', tone: 'idle', badge: false, reason: null, detail: null };
  const kind = scheduleKind(row, now);
  if (kind === 'stopped') {
    const reason = stopReason(row.error ?? '');
    return { text: 'Needs review', tone: 'warn', badge: true, reason: firstSentence(reason), detail: row.error ? `${reason} Zoer’s message: ${row.error}` : reason };
  }
  if (kind === 'paused') return { text: 'Off', tone: 'idle', badge: false, reason: null, detail: null };
  if (kind === 'waiting') return { text: 'On · waiting for you', tone: 'warn', badge: false, reason: 'A scheduled run is waiting for a browser check.', detail: null };
  if (kind === 'retrying') return { text: row.retryAt ? `On · retrying ${when(row.retryAt, now)}` : 'On · retrying', tone: 'warn', badge: false, reason: row.error ? plainError(row.error) : null, detail: row.error ?? null };
  if (row.lastStatus === 'pending' || row.state === 'running') return { text: 'On · running now', tone: 'busy', badge: false, reason: null, detail: null };
  const due = row.nextRunAt ? Date.parse(row.nextRunAt) : NaN;
  if (!Number.isFinite(due)) return { text: 'On · next run not recorded', tone: 'good', badge: false, reason: null, detail: null };
  return { text: due <= now ? 'On · due now' : `On · next run ${when(row.nextRunAt, now)}`, tone: 'good', badge: false, reason: null, detail: due <= now ? 'Starts when no other run of this plugin is active.' : null };
}

/** The "Last collected" slot of a portal source: newest success, with how many portals the last run reached when not all. */
export function lastCollectedSlot(state: ConnectorCollection | null | undefined, noun: 'portal' | 'site', now = Date.now()): { text: string; note: string | null } {
  const last = lastCollected(state);
  if (!last.known) return { text: 'Unknown', note: null };
  if (!last.at) return { text: state ? 'Not recorded' : 'Never', note: null };
  const notes = [last.collected !== null ? `${count(last.collected)} of ${plural(last.total, noun)} in the last run` : '', last.allAt ? `all ${count(last.total)} last ${when(last.allAt, now)}` : ''].filter(Boolean);
  return { text: when(last.at, now), note: notes.length ? notes.join('; ') : null };
}

/** The "Last collected" slot from a plain time (BC Bid's scope, CanadaBuys' file). */
export function lastCollectedText(at: string | null | undefined, known: boolean, now = Date.now()): string {
  if (!known) return 'Unknown';
  return at ? when(at, now, 'Not recorded') : 'Not recorded';
}

// ---------------------------------------------------------------------------------------------
// Portal tables (bids&tenders portals, local-government sites, browser sites): one row shape, collapsed by default.
// ---------------------------------------------------------------------------------------------

export interface TableRow {
  id: string; label: string; place: string; url: string; statusText: string; tone: Tone; problem: boolean;
  /** Plain message (shown under the status) and raw detail (tooltip). */
  message?: string; detail?: string;
  lastCollected: string; lastRun: string; saved: number | null;
}
export function connectorTableRows(rows: PortalRow[], now = Date.now()): TableRow[] {
  return rows.map(row => ({ id: row.id, label: row.label, place: row.place, url: row.url, statusText: row.statusText, tone: row.tone, problem: row.problem, message: row.errorText, detail: row.error,
    lastCollected: row.status === 'unknown' ? 'Unknown' : when(row.lastSuccessAt, now, 'Never'), lastRun: row.counts, saved: row.saved }));
}
export function browserTableRows(rows: BrowserSiteRow[], now = Date.now()): TableRow[] {
  return rows.map(row => ({ id: row.site.id, label: row.site.label, url: row.site.url, statusText: row.statusText, tone: row.tone, problem: row.status === 'waiting' || row.status === 'failed',
    place: row.site.aggregator ? 'Many BC local governments' : [row.site.place.municipality, row.site.place.regionalDistrict].filter(Boolean).join(' · ') || 'British Columbia',
    message: row.message, detail: row.detail, lastCollected: row.status === 'unknown' ? 'Unknown' : when(row.lastSuccessAt, now, 'Never'),
    lastRun: row.status === 'unknown' ? 'Unknown' : row.listed === null ? 'Not collected yet' : `${count(row.listed)} listed`, saved: row.saved }));
}

/**
 * The portal list's disclosure: "33 portals · 0 problems", collapsed unless a portal has a problem (then it opens by
 * itself so the problem is seen). Unknown state never claims "0 problems".
 */
export function portalDisclosure(rows: TableRow[], noun: 'portal' | 'site', known = true): { summary: string; open: boolean; problems: number } {
  const problems = rows.filter(row => row.problem).length;
  if (!known) return { summary: `${plural(rows.length, noun)} · status unknown`, open: false, problems: 0 };
  return { summary: `${plural(rows.length, noun)} · ${plural(problems, 'problem')}`, open: problems > 0, problems };
}

// ---------------------------------------------------------------------------------------------
// BC Bid and CanadaBuys details
// ---------------------------------------------------------------------------------------------

/** "Current opportunities · saved Today 12:39 AM", "Historical awards · all dates to Nov 26, 2026": no scope ids, no sentinel dates. */
export function checkpointText(item: { label: string; range: string; checkpointTime: string }, now = Date.now()): string {
  const match = /^(\S+) to (\S+)$/.exec(item.range), from = match?.[1] ?? '', to = match?.[2] ?? '';
  const toText = to ? formatAwardDay(to) : null, fromText = from && !/^1[0-8]\d\d|^1900/.test(from) ? formatAwardDay(from) : null;
  const range = toText ? (fromText ? `${fromText} to ${toText}` : `all dates to ${toText}`) : '';
  const saved = item.checkpointTime !== 'Not recorded' ? `saved ${when(item.checkpointTime, now)}` : '';
  return [item.label, range, saved].filter(Boolean).join(' · ');
}
/** The checkpoint's state in the shared words. */
export function checkpointStatus(status: string): { text: string; tone: Tone } {
  if (status === 'Completed recorded scope') return { text: 'Done', tone: 'good' };
  if (/^Needs attention/.test(status)) return { text: 'Needs attention', tone: 'warn' };
  if (status === 'Partial checkpoint') return { text: 'Part-way', tone: 'idle' };
  return { text: status, tone: 'idle' };
}

/**
 * A collection error in plain words. BC Bid's browser check during a scrape is completed in the collection browser, not
 * the download browser that the shared sentence names (that sentence serves downloads).
 */
export function collectionErrorText(error: string): string {
  const text = plainError(error);
  return /^BC Bid asked for a browser check/.test(text)
    ? 'BC Bid asked for a browser check. Open the collection browser in Zoer, complete the check there, then hand control back; the collection continues from where it stopped.'
    : text;
}

const bytes = (value: unknown) => { const n = Number(value); return Number.isFinite(n) && n >= 0 ? n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MiB` : n >= 1024 ? `${(n / 1024).toFixed(1)} KiB` : `${count(n)} bytes` : '—'; };
/** CanadaBuys' last file receipt with plain labels (the checksum stays out of the list; the page shows it on demand). */
export function canadaBuysReceipt(receipt: Record<string, unknown> | null | undefined, now = Date.now()): [string, string][] {
  if (!receipt) return [];
  return [['Downloaded', when(receipt.retrievedAt, now)], ['Imported', when(receipt.importedAt, now)], ['Rows in file', count(receipt.totalSourceRecords)],
    ['Opportunities read', count(receipt.totalRecords)], ['Excluded', count(receipt.excludedCount)], ['File size', bytes(receipt.byteCount)]];
}

// ---------------------------------------------------------------------------------------------
// The page's one line about operations (the rest is on Operations › Overview)
// ---------------------------------------------------------------------------------------------

export interface OpsLinePart { text: string; to?: string }
/**
 * "11 of 13 schedules need review · 988 files missing on open BC Bid opportunities · 1,092 failed downloads". Only parts
 * with something to say; empty when nothing needs the person. Counts come from the shared definitions (schedule summary,
 * document gap, failure queue).
 */
export function operationsLine({ schedules, missingFiles, failedFiles }: { schedules?: ScheduleRow[]; missingFiles?: number; failedFiles?: number }): OpsLinePart[] {
  const summary = scheduleSummary(schedules), parts: OpsLinePart[] = [];
  if (summary.stopped) parts.push({ text: `${count(summary.stopped)} of ${plural(summary.total, 'schedule')} need${summary.stopped === 1 ? 's' : ''} review` });
  if (missingFiles) parts.push({ text: `${plural(missingFiles, 'file')} missing on open BC Bid opportunities` });
  if (failedFiles) parts.push({ text: `${plural(failedFiles, 'failed download')}`, to: '/files?fileStatus=failed' });
  return parts;
}
