import { plainError } from '../error-text';
import { when } from '../format';

/**
 * Plain-language state for Zoer plugin schedules (host `schedules.read` rows). Zoer schedules are an interval in
 * whole hours (1–720), one row per action and saved preset, turn themselves off after any failed run or when the
 * plugin, the saved input or the preset changes, and wait while another run of this plugin is active.
 */

export interface ScheduleRow {
  actionId: string; enabled: boolean; intervalHours: number; nextRunAt?: string;
  /** Zoer 0.34+ (presets, S6): one schedule per `(actionId, presetId)`; absent on the action's own schedule. */
  presetId?: string;
  body?: { input?: Record<string, unknown>; resources?: { browserSessionId?: string } }; lastRunId?: string; lastStatus?: string; error?: string;
  /** Newer Zoer (self-healing schedules): the bound browser, failures in a row and when a transient failure is retried. */
  browser?: ScheduleBrowser | null; consecutiveFailures?: number; retryAt?: string | null;
  /** Newer Zoer: the host's own state for the row (preferred for counts and labels) and a non-fatal note on the last run. */
  state?: 'off' | 'needs_attention' | 'scheduled' | 'running' | 'retrying' | 'waiting_for_user'; warning?: string;
}
/** A saved Zoer browser as `schedules.read` names it; `native` browsers can download attachments. */
export interface ScheduleBrowser { id: string; name: string; provider?: string; native?: boolean; ready?: boolean; missing?: boolean }
/** `schedules.read` top level on newer Zoer: the plugin's configured collection and download browsers. */
export interface ScheduleBrowsers { collection?: ScheduleBrowser | null; downloads?: ScheduleBrowser | null; downloadsUseCollection?: boolean }

export const SCHEDULE_PRESETS = [[6, '6 hours'], [12, '12 hours'], [24, 'Daily'], [168, 'Weekly']] as const;
export const MIN_INTERVAL = 1, MAX_INTERVAL = 720;

export function intervalText(hours: number): string {
  if (!Number.isInteger(hours) || hours < MIN_INTERVAL) return 'Unknown interval';
  if (hours === 1) return 'Every hour';
  if (hours === 24) return 'Every day';
  if (hours === 168) return 'Every week';
  if (hours % 168 === 0) return `Every ${hours / 168} weeks`;
  if (hours % 24 === 0) return `Every ${hours / 24} days`;
  return `Every ${hours} hours`;
}

/** Whole hours 1–720 only, as the host requires; anything else is null (the form shows why). */
export function parseInterval(text: string): number | null {
  if (!/^\s*\d+\s*$/.test(text)) return null;
  const hours = Number(text);
  return hours >= MIN_INTERVAL && hours <= MAX_INTERVAL ? hours : null;
}

const RUN_STATUS: Record<string, string> = { succeeded: 'succeeded', failed: 'failed', cancelled: 'was cancelled', outcome_unknown: 'ended with an unknown outcome', pending: 'is running', waiting_for_user: 'stopped at a browser check' };

/**
 * Why Zoer turned a schedule off, in words a person can act on. A message this plugin recognises is explained; any
 * other is Zoer's own message (tidied by `plainError`), never a generic guess. `stopMessage` is Zoer's message itself:
 * pages show it next to the explanation only when the two differ (`stopDiffers`).
 */
export function stopReason(error: string): string {
  if (/EAI_AGAIN|ENOTFOUND|getaddrinfo|ECONNRESET|ETIMEDOUT|fetch failed/i.test(error)) return 'Zoer turned this schedule off after the site could not be reached (a network or DNS problem, not your setup). Turn it on again; newer Zoer retries these by itself.';
  if (/worker cleanup|worker is still present|worker failed to start/i.test(error)) return 'Zoer turned this schedule off because the previous run was still being cleaned up when this one was due. Nothing is wrong with the setup; turn it on again.';
  if (/did not match its JSON Schema|additional properties/i.test(error)) return 'Zoer turned this schedule off because the run’s result did not match what this plugin version expects (a plugin bug). Update the plugin, then turn it on again.';
  if (/preset changed or removed/i.test(error)) return 'Zoer turned this schedule off because the saved collection it runs was changed or removed. Turn it on again here to use the current one.';
  if (/scheduled action, permissions or settings changed|plugin or settings changed/i.test(error)) return 'A plugin update changed what this schedule is approved to run, so Zoer turned it off. Check it, then turn it on again.';
  if (/restored from backup/i.test(error)) return 'This schedule was restored from a backup and left off. Check it and turn it on again when you are ready.';
  if (/failed records/i.test(error)) return 'Zoer turned this schedule off because the last scheduled run finished with failed items. Check the failures, then turn it on again.';
  if (/unavailable or disabled/i.test(error)) return 'Zoer turned this schedule off because the plugin was disabled or unavailable when it was due. Turn it on again once the plugin is enabled.';
  if (/previous scheduled run is missing/i.test(error)) return 'Zoer turned this schedule off because it could not find the previous scheduled run. Check run history, then turn it on again.';
  return stopMessage(error);
}
/** Zoer's own stop message, tidied; never empty. */
export const stopMessage = (error: string | null | undefined) => plainError(error) || 'Zoer did not record why.';
/** Whether Zoer's message says something the explanation does not (show it as well). */
export const stopDiffers = (error: string | null | undefined) => !!error && stopReason(error) !== stopMessage(error);

export type ScheduleTone = 'good' | 'busy' | 'warn' | 'idle';
export interface ScheduleState { tone: ScheduleTone; status: string; next: string | null; last: string | null; stopped: string | null; error: string | null; retrying?: string | null }

const plainReason = (error: string | undefined) => error ? plainError(error).replace(/\.$/, '').replace(/^./, c => c.toLowerCase()) : 'no reason recorded';

/**
 * Summary for one schedule row. `undefined` = no schedule saved. A disabled row with an error was stopped by Zoer
 * ("Needs review"), a disabled row without one was turned off by a person ("Off"); the two are never shown alike.
 */
export function scheduleState(row: ScheduleRow | undefined, now = Date.now()): ScheduleState {
  if (!row) return { tone: 'idle', status: 'Not scheduled', next: null, last: null, stopped: null, error: null };
  const last = row.lastStatus ? `Last scheduled run ${RUN_STATUS[row.lastStatus] ?? row.lastStatus}` : null;
  if (!row.enabled) {
    if (row.error) return { tone: 'warn', status: 'Needs review', next: null, last, stopped: stopReason(row.error), error: row.error };
    return { tone: 'idle', status: `Off · was ${intervalText(row.intervalHours).toLowerCase()}`, next: null, last, stopped: null, error: null };
  }
  // Wording mirrors Zoer's own schedule list (scheduleStatusText), so the plugin and Settings say the same thing.
  if (row.state === 'waiting_for_user' || row.lastStatus === 'waiting_for_user') return { tone: 'warn', status: 'On · waiting for you', next: 'Waiting for you to finish a browser check; the waiting run then continues', last: null, stopped: null, error: null };
  const failures = Number(row.consecutiveFailures) || 0, retry = row.retryAt ? Date.parse(row.retryAt) : NaN;
  if (row.state === 'retrying' || (row.state === undefined && failures > 0 && Number.isFinite(retry) && retry > now))
    return { tone: 'warn', status: 'On · retrying', next: Number.isFinite(retry) ? `Retrying ${when(row.retryAt, now)}${failures > 1 ? ` (${failures} failed attempts in a row)` : ''}` : 'Retrying shortly', last, stopped: null, error: row.error ?? null,
      retrying: `The last run did not finish (${plainReason(row.error)}); it tries again by itself.` };
  const due = row.nextRunAt ? Date.parse(row.nextRunAt) : NaN;
  const next = !Number.isFinite(due) ? 'Next run not recorded' : row.lastStatus === 'pending' || row.state === 'running' ? 'Running now' : due <= now ? 'Due now; starts when no other run of this plugin is active' : `Next run ${when(row.nextRunAt, now)}`;
  return { tone: row.lastStatus === 'pending' || row.state === 'running' ? 'busy' : 'good', status: `On · ${intervalText(row.intervalHours).toLowerCase()}`, next, last, stopped: null, error: null };
}

/** The action's own schedule (not one bound to a preset), if any. */
export const findSchedule = (rows: ScheduleRow[] | undefined, actionId: string) => rows?.find(row => row.actionId === actionId && !row.presetId);

/** What each of this plugin's scheduled actions is called on Operations › Overview, Sources and Home. */
const ACTION_LABELS: Record<string, string> = {
  'scrape.full': 'BC Bid · current opportunities', 'awards.history': 'BC Bid · award history', 'scrape.sample': 'BC Bid · sample check',
  'documents.extract.pending': 'Text extraction of saved files',
  'scrape.details': 'BC Bid · capture missing details', 'documents.download.missing': 'BC Bid · keep documents current', 'documents.download.all': 'BC Bid · download documents',
  'documents.download.queue': 'BC Bid · download missing files', 'documents.download.portals': 'Portal documents · keep current',
  'procurement.publisher.sweep': 'Linked publisher checks', 'procurement.publisher.refresh': 'Linked publisher refresh',
  'procurement.alerts': 'Alert checks', 'procurement.collect.browser': 'BC sites (your browser)', 'procurement.collect': 'Collection',
  // Runs started by hand (Operations › Overview › Running now names them too).
  'scrape.targeted': 'BC Bid · targeted collection', 'scrape.historical': 'BC Bid · historical import', 'listing.capture': 'BC Bid · one listing page', 'detail.capture': 'BC Bid · one notice page',
  'documents.download': 'Download selected files', 'documents.extract': 'Text extraction of selected opportunities', 'records.review': 'AI review', 'records.review.cli': 'AI review (installed CLI)',
  'records.evidence': 'Evidence analysis', 'records.evidence.cli': 'Evidence analysis (installed CLI)', 'procurement.pipeline': 'Review pipeline', 'procurement.pipeline.cli': 'Review pipeline (installed CLI)',
  'procurement.enrich': 'Place and contact tagging', 'catalog.normalize': 'Duplicate clean-up', 'opportunities.import': 'Opportunity import', 'awards.import': 'Award import',
};
/** An action's name for run and schedule lists. */
export const actionLabel = (actionId: string) => ACTION_LABELS[actionId] ?? humanAction(actionId);
/** "documents.extract.pending" → "Documents extract pending": a readable name for an action this version has no label for. */
export const humanAction = (actionId: string) => actionId.replace(/[._-]+/g, ' ').trim().replace(/^./, c => c.toUpperCase()) || 'Unnamed schedule';
/** A schedule's name: its preset's name (one per source), the source it collects, or the action; never a raw action id. */
export function scheduleLabel(row: ScheduleRow, presets?: { id: string; name: string; input?: any }[], sourceLabel: (id: string) => string = id => id): string {
  const preset = row.presetId ? presets?.find(item => item.id === row.presetId) : undefined;
  const sourceId = typeof preset?.input?.sourceId === 'string' ? preset.input.sourceId : typeof row.body?.input?.sourceId === 'string' ? row.body.input.sourceId as string : '';
  if (row.actionId === 'procurement.collect') return sourceId === 'all' ? 'All sources (older schedule)' : sourceId ? sourceLabel(sourceId) : preset?.name ?? 'Collection';
  return ACTION_LABELS[row.actionId] ?? preset?.name ?? humanAction(row.actionId);
}

/** Schedules needing attention, split by what the person can do about it. */
export type ScheduleKind = 'on' | 'retrying' | 'waiting' | 'stopped' | 'paused';
export function scheduleKind(row: ScheduleRow, now = Date.now()): ScheduleKind {
  // Newer Zoer states the row's state itself; counts follow it so they match Zoer's Settings › Schedules.
  if (row.state) return row.state === 'off' ? 'paused' : row.state === 'needs_attention' ? 'stopped' : row.state === 'retrying' ? 'retrying' : row.state === 'waiting_for_user' ? 'waiting' : 'on';
  if (!row.enabled) return row.error ? 'stopped' : 'paused';
  if (row.lastStatus === 'waiting_for_user') return 'waiting';
  return (Number(row.consecutiveFailures) || 0) > 0 && row.retryAt && Date.parse(row.retryAt) > now ? 'retrying' : 'on';
}
/**
 * The one schedule count every page shows (banner, Sources header, Home, Status): every row the host lists, so the
 * numbers always agree with Zoer's own schedule list.
 */
export function scheduleSummary(rows: ScheduleRow[] | undefined, now = Date.now()) {
  const list = rows ?? [], kinds = list.map(row => scheduleKind(row, now));
  const count = (kind: ScheduleKind) => kinds.filter(value => value === kind).length;
  const on = list.filter(row => row.enabled).length;
  return { total: list.length, on, off: list.length - on, stopped: count('stopped'), paused: count('paused'), retrying: count('retrying'), waiting: count('waiting'),
    text: !list.length ? 'No schedules saved' : `${on} of ${list.length} schedule${list.length === 1 ? '' : 's'} on` };
}

/** "Clearcote · BC Bid (ready)" for a schedule's or the plugin's browser; null when this Zoer does not report one. */
export function browserText(browser: ScheduleBrowser | null | undefined): string | null {
  if (!browser) return null;
  const provider = browser.provider ? PROVIDERS[browser.provider.toLowerCase()] ?? browser.provider : '';
  return `${browser.name}${provider && !browser.name.toLowerCase().includes(provider.toLowerCase()) ? ` (${provider})` : ''}`;
}
const PROVIDERS: Record<string, string> = { clearcote: 'Clearcote', camoufox: 'Camoufox', patchright: 'Patchright', playwright: 'Playwright', steel: 'Steel', cloak: 'Cloak' };
/** Downloads need a native-transport browser; Steel and Cloak cannot run attachment controls. */
export const NATIVE_PROVIDERS = ['clearcote', 'camoufox', 'patchright', 'playwright'];
export const isNativeBrowser = (browser: ScheduleBrowser | null | undefined) => browser ? browser.native ?? NATIVE_PROVIDERS.includes((browser.provider ?? '').toLowerCase()) : false;
