import type { ScheduleBrowsers } from './procurement/schedule-state';
import { requiresBrowserVerification } from './procurement/document-identity';
import { shortError } from './error-text';

const terminal = new Set(['succeeded', 'failed', 'cancelled', 'outcome_unknown']);
const captureActions = new Set(['listing.capture','detail.capture','scrape.sample','scrape.historical','scrape.full','scrape.details','scrape.targeted','awards.history','procurement.collect.browser']);
export const isSourceCaptureRun = (run: {actionId:string}) => captureActions.has(run.actionId);
/** Raw statuses cover queued and paused captures, before any receipt exists. */
export function sourceCaptureActive(runs: {actionId:string;status:string}[] = []) {
  return runs.some(run=>isSourceCaptureRun(run)&&!terminal.has(run.status));
}
/** Where an active capture's progress shows: the historical import's card on the BC Bid page, else BC Bid runs. */
export function sourceCaptureProgressPath(runs: {actionId:string;status:string}[] = []) {
  return runs.some(run => run.actionId === 'scrape.historical' && !terminal.has(run.status)) ? '/scraper' : '/scraper/history';
}
/** Zoer serializes work on the actual browser bound to each run. Older hosts may omit the browser choices. */
export function separateDocumentBrowser(browsers?: ScheduleBrowsers) {
  const { collection, downloads } = browsers ?? {};
  return !!collection?.id && !!downloads?.id && !collection.missing && !downloads.missing &&
    !browsers?.downloadsUseCollection && collection.id !== downloads.id;
}

/** Recheck the current selections at submission. The host also checks pinned resources from older runs. */
export async function assertDocumentBrowserIdle(host:(method:string,input?:unknown)=>Promise<any>, purpose: 'download' | 'capture' = 'download') {
  const { runs } = await host('state', { summary: true });
  const capturing = sourceCaptureActive(runs);
  const downloading = documentDownloadActive(runs.filter((run: {actionId: string}) =>
    ['documents.download', 'documents.download.all', 'documents.download.missing','documents.download.queue'].includes(run.actionId)));
  if (!capturing && !downloading) return;

  if ((purpose === 'download' && !downloading) || (purpose === 'capture' && !capturing)) {
    const schedules = await host('schedules.read').catch(() => undefined);
    if (separateDocumentBrowser(schedules?.browsers)) return;
  }
  if (capturing && (purpose === 'capture' || !downloading)) throw Error('Wait for the active source capture to finish before starting another browser task.');
  throw Error('Wait for the active attachment download to finish.');
}
/** Include queued workflow runs before the research batch is created. */
export function documentDownloadActive(runs: {id:string;status:string}[] = [], submitted?: string) {
  return runs.some(run => !terminal.has(run.status)) || Boolean(submitted && !runs.some(run => run.id === submitted));
}

type WorkflowRun = { id: string; status: string; createdAt?: string; error?: string | null; cancelRequestedAt?: unknown; resumable?: { nextStepAt?: string | null } | null };
type Batch = { id: string; status: string; error?: string | null; updated_at?: string | null };
const scheduledRetry = (text?: string | null) => text?.match(/scheduled for (\d{4}-\d{2}-\d{2}T[\d:.]+Z)/)?.[1] ?? null;
const retryAt = (run?: WorkflowRun, batchError?: string | null) => run?.resumable?.nextStepAt ?? scheduledRetry(run?.error) ?? scheduledRetry(batchError);
/** `1:18 AM` for a scheduled retry that is still ahead; empty when the time is unknown or has passed. */
export const retryTimeText = (at?: string | null, now = Date.now()) => at && Date.parse(at) > now ? new Date(at).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }) : '';

export type ActiveDownload = { id: string; waiting: boolean; retryAt: string | null };
/**
 * The download run that blocks a new one. `waiting` means nothing is transferring: Zoer parked the run
 * for a scheduled automatic retry (BC Bid browser recovery waits 30 minutes), which can be stopped.
 */
export function activeDocumentDownload(runs: WorkflowRun[] = []): ActiveDownload | null {
  const run = runs.find(entry => !terminal.has(entry.status));
  return run ? { id: run.id, waiting: run.status === 'retry_scheduled', retryAt: retryAt(run) } : null;
}

/**
 * What a `paused` batch is waiting for. Zoer writes `paused` for an update pause (resumes by itself)
 * and for a scheduled automatic retry, and does not correct the batch after its run has ended.
 *
 * `runs` is the dashboard's copy of the workspace run list; omit it while it loads. The host returns
 * every active run, but the copy is polled less often than the batch list, so a run missing from it
 * has ended only when the copy is newer than the batch: it holds a run created after the batch was
 * last written. Otherwise the batch's own message decides and the batch is never called ended.
 */
export function batchPause(batch: Batch, runs?: WorkflowRun[]):
  { state: 'update' | 'retry' | 'ended'; retryAt: string | null; error: string | null } | null {
  if (batch.status !== 'paused') return null;
  const run = runs?.find(entry => entry.id === batch.id);
  if (run && terminal.has(run.status)) return { state: 'ended', retryAt: null, error: run.error ?? null };
  const written = Date.parse(batch.updated_at ?? '');
  if (runs && !run && runs.some(entry => Date.parse(entry.createdAt ?? '') > written)) return { state: 'ended', retryAt: null, error: null };
  const at = retryAt(run, batch.error);
  return run?.status === 'retry_scheduled' || at ? { state: 'retry', retryAt: at, error: batch.error ?? null } : { state: 'update', retryAt: null, error: batch.error ?? null };
}
/** The download batch that is running or paused with a run that may still be active: stoppable before the run list has caught up. */
export function activeDownloadBatch(batches: Batch[] = [], runs?: WorkflowRun[]): ActiveDownload | null {
  for (const batch of batches) {
    if (batch.status === 'running') return { id: batch.id, waiting: false, retryAt: null };
    const pause = batchPause(batch, runs);
    if (pause && pause.state !== 'ended') return { id: batch.id, waiting: pause.state === 'retry', retryAt: pause.retryAt };
  }
  return null;
}

// ---------------------------------------------------------------------------------------------
// Download runs as people read them: what a run downloaded, its real end state, and its pace.
// ---------------------------------------------------------------------------------------------

/** One download run's file attempts (`research_tasks`, kind `attachment`): saved files, browser checks and their times. */
export interface RunFileStats {
  runId: string; saved: number; checks: number; firstAt: string | null; lastAt: string | null; lastSavedAt: string | null;
  /** Browser checks after the run's last saved file (or since it started): BC Bid kept asking and nothing saved. */
  checksSinceSave?: number;
}
/** Per-run file attempts for up to 200 runs; the host keeps one task row per attempt. */
export const RUN_FILE_STATS_SQL = (count: number) => `SELECT run_id AS runId, sum(status='succeeded') AS saved, sum(status='waiting_for_user') AS checks, min(updated_at) AS firstAt, max(updated_at) AS lastAt, max(CASE WHEN status='succeeded' THEN updated_at END) AS lastSavedAt FROM research_tasks WHERE kind='attachment' AND run_id IN (${Array(count).fill('?').join(',')}) GROUP BY run_id`;
/** Browser checks of one run after a time (its last saved file). */
export const RUN_CHECKS_SINCE_SQL = "SELECT count(*) AS checks FROM research_tasks WHERE kind='attachment' AND run_id=? AND status='waiting_for_user' AND updated_at>?";
/** Two checks in a row with no file saved between them: the run is held by a browser check, not downloading. */
export const HELD_BY_CHECK = 2;
const MINUTE = 60_000, HOUR = 3_600_000;

/** "42 min", "5 h 6 min", "3 days". */
export function durationText(ms: number): string {
  const minutes = Math.max(0, Math.round(ms / MINUTE));
  if (minutes < 60) return `${minutes} min`;
  if (minutes < 48 * 60) { const h = Math.floor(minutes / 60), m = minutes % 60; return m ? `${h} h ${m} min` : `${h} h`; }
  return `${Math.round(minutes / 1440)} days`;
}
/** "about 6 hours", "about 10 days" for an estimate. */
export function aboutText(ms: number): string {
  const hours = ms / HOUR;
  if (hours < 1) return 'under an hour';
  if (hours < 48) { const h = Math.round(hours); return `about ${h} ${h === 1 ? 'hour' : 'hours'}`; }
  return `about ${Math.round(hours / 24)} days`;
}
/** "4.1 files per hour"; whole numbers from 10 up. */
export const rateText = (perHour: number) => `${perHour < 10 ? perHour.toFixed(1) : Math.round(perHour).toLocaleString()} files per hour`;

export interface Throughput {
  saved: number;
  /** Files saved per hour since the run started; null until it has run 15 minutes. */
  perHour: number | null;
  /** How long no file has been saved, once that passes 5 minutes; null before. */
  quietMs: number | null;
  /** BC Bid asked for a browser check at least twice in a row since the last saved file. */
  heldByCheck: boolean; checksInRow: number;
  /** Time for `remaining` files at the measured rate; null without a measured rate or with fewer than 3 files saved. */
  etaMs: number | null;
}
/**
 * The pace of an active download run from its own file attempts: nothing here is estimated from the host's pacing
 * settings, so a run held by a browser check shows its real rate (and how long nothing has been saved).
 */
export function downloadThroughput(stats: RunFileStats | undefined, startedAt: string | null | undefined, now: number, remaining = 0): Throughput {
  const saved = stats?.saved ?? 0, checksInRow = stats?.checksSinceSave ?? 0;
  const started = Date.parse(startedAt ?? stats?.firstAt ?? ''), elapsed = now - started;
  const known = Number.isFinite(started) && elapsed >= 0;
  const perHour = known && elapsed >= 15 * MINUTE ? saved / (elapsed / HOUR) : null;
  const lastSaved = Date.parse(stats?.lastSavedAt ?? ''), since = Number.isFinite(lastSaved) ? now - lastSaved : known ? elapsed : NaN;
  return {
    saved, perHour, quietMs: Number.isFinite(since) && since > 5 * MINUTE ? since : null,
    heldByCheck: checksInRow >= HELD_BY_CHECK, checksInRow,
    etaMs: perHour && saved >= 3 && remaining > 0 ? remaining / perHour * HOUR : null,
  };
}

type RunInput = { queueScope?: string; recordIds?: unknown[]; documentId?: string; portalQueue?: boolean; extractOnly?: boolean; pendingOnly?: boolean; verifyDocumentIds?: unknown[] };
export const runInput = (batch: { input?: string | null }): RunInput => { try { const value = JSON.parse(batch.input || '{}'); return value && typeof value === 'object' ? value : {}; } catch { return {}; } };
/** What a download run set out to download: "Missing files · open opportunities", "3 chosen opportunities", "Portal documents". */
export function downloadRunTitle(batch: { input?: string | null }, actionId?: string): string {
  const input = runInput(batch), ids = Array.isArray(input.recordIds) ? input.recordIds.length : 0;
  if (input.queueScope) return `Missing files · ${input.queueScope === 'all' ? 'all' : 'open'} opportunities`;
  if (input.portalQueue || actionId === 'documents.download.portals') return 'Portal documents';
  if (actionId === 'documents.download.missing') return 'Keep documents current';
  if (input.documentId) return 'One file again';
  return ids ? `${ids.toLocaleString()} chosen ${ids === 1 ? 'opportunity' : 'opportunities'}` : 'Download';
}
/** Runs of the same scope supersede each other: only the newest of each can be retried. */
export function runScopeKey(batch: { kind?: string; input?: string | null }, actionId?: string): string {
  const input = runInput(batch);
  if (input.extractOnly) return input.pendingOnly ? 'extract:pending' : `extract:${JSON.stringify([...(input.recordIds ?? [])].map(String).sort())}`;
  if (input.queueScope) return `queue:${input.queueScope}`;
  if (input.portalQueue || actionId === 'documents.download.portals') return 'portals';
  if (actionId === 'documents.download.missing') return 'missing';
  return `${batch.kind ?? 'download'}:${input.documentId ?? ''}:${JSON.stringify([...(input.recordIds ?? [])].map(String).sort())}`;
}

export type RunTone = 'success' | 'running' | 'warning' | 'error' | 'info' | 'neutral';
export interface DownloadRunState {
  /** The shared vocabulary (format.ts), plus the two words for an active run's pause: "Waiting to retry" and "Paused for update". */
  state: 'Running' | 'Queued' | 'Done' | 'Partly failed' | 'Failed' | 'Stopped' | 'Interrupted' | 'Waiting for you' | 'Waiting to retry' | 'Paused for update';
  tone: RunTone;
  /** One plain line under the run, or empty. */
  detail: string;
  /** The run is still active (Stop applies). */
  active: boolean;
  /** Retry or resume would continue it (only offered on the newest run of its scope). */
  resumable: boolean;
}
const STOPPED_BY_PERSON = /stopped from plugin dashboard/i;
type RunRef = WorkflowRun & { actionId?: string };
/**
 * A download (or text extraction) run's state in the shared vocabulary. "Stopped" is a person's Stop (neutral, never an
 * error), "Interrupted" a run that ended without finishing and can resume, "Waiting for you" a browser check. A batch Zoer
 * left marked running after its run ended reads as the run's outcome.
 */
export function downloadRunState(batch: Batch & { completed?: unknown; failed?: unknown; total?: unknown }, options: { run?: RunRef | null; runs?: WorkflowRun[]; stats?: RunFileStats; now?: number; downloads?: boolean } = {}): DownloadRunState {
  const { run, stats, now = Date.now(), downloads = true } = options;
  const pause = batchPause(batch, options.runs ?? (run ? [run] : undefined));
  const ended = !!run && terminal.has(run.status);
  const held = (stats?.checksSinceSave ?? 0) >= HELD_BY_CHECK;
  const quiet = (() => { const at = Date.parse(stats?.lastSavedAt ?? stats?.firstAt ?? ''), end = Date.parse(stats?.lastAt ?? ''); return Number.isFinite(at) && Number.isFinite(end) && end > at ? durationText(end - at) : ''; })();
  const heldText = held ? `${stats!.checksSinceSave!.toLocaleString()} browser checks in a row${quiet ? `, no file saved for ${quiet}` : ''}` : '';
  const byPerson = STOPPED_BY_PERSON.test(run?.error ?? '') || STOPPED_BY_PERSON.test(batch.error ?? '');
  const stopped = (): DownloadRunState => ({ state: 'Stopped', tone: 'neutral', active: false, resumable: true,
    detail: byPerson || held ? `${byPerson ? 'Stopped by you' : 'Stopped'}${held ? ` while BC Bid was asking for a browser check (${heldText})` : ''}.` : '' });
  const interrupted = (detail = 'Ended before it finished; a retry continues it and keeps the saved files.'): DownloadRunState => ({ state: 'Interrupted', tone: 'warning', active: false, resumable: true, detail });
  const failed = (): DownloadRunState => requiresBrowserVerification(batch.error)
    ? { state: 'Waiting for you', tone: 'warning', active: false, resumable: true, detail: 'BC Bid asked for a browser check. Complete it in the download browser, then retry.' }
    : { state: 'Failed', tone: 'error', active: false, resumable: true, detail: shortError(batch.error ?? '') };
  // Ended runs read as their outcome, also when the batch still says running or paused.
  if (pause?.state === 'ended' || (ended && ['running', 'paused', 'waiting_for_user'].includes(batch.status))) {
    if (run?.status === 'cancelled' || run?.cancelRequestedAt) return stopped();
    if (run?.status === 'succeeded') return { state: 'Done', tone: 'success', active: false, resumable: false, detail: '' };
    if (run?.status === 'failed' && run.error && !/interrupted/i.test(run.error)) return { ...failed(), detail: shortError(run.error) };
    return interrupted();
  }
  if (pause?.state === 'retry') return { state: 'Waiting to retry', tone: 'warning', active: true, resumable: false,
    detail: `Nothing is ${downloads ? 'downloading' : 'running'}. Zoer retries automatically${retryTimeText(pause.retryAt, now) ? ` at ${retryTimeText(pause.retryAt, now)}` : ''}; Stop ends the wait and keeps what is saved.` };
  if (pause?.state === 'update') return { state: 'Paused for update', tone: 'info', active: true, resumable: false, detail: 'It continues by itself after the Zoer update.' };
  // Zoer corrects a waiting batch once its run ends, so one still waiting has a live run (Stop applies).
  if (batch.status === 'running' || batch.status === 'waiting_for_user' && !ended) {
    if (held || batch.status === 'waiting_for_user') return { state: 'Waiting for you', tone: 'warning', active: true, resumable: false, detail: `BC Bid is asking for a browser check${heldText ? ` (${heldText})` : ''}.` };
    return { state: 'Running', tone: 'running', active: true, resumable: false, detail: '' };
  }
  switch (batch.status) {
    case 'stopped': case 'cancelled': return stopped();
    case 'succeeded': return { state: 'Done', tone: 'success', active: false, resumable: false, detail: '' };
    case 'partial': return { state: 'Partly failed', tone: 'warning', active: false, resumable: true, detail: shortError(batch.error ?? '') };
    case 'queued': return { state: 'Queued', tone: 'neutral', active: true, resumable: false, detail: '' };
    case 'interrupted': return interrupted();
    case 'failed': return run?.status === 'outcome_unknown' || /run was interrupted/i.test(batch.error ?? '') ? interrupted() : failed();
    default: return { state: 'Failed', tone: 'error', active: false, resumable: true, detail: `Unrecognized status: ${batch.status}` };
  }
}
/** The ids of runs that may offer Retry: per scope, the newest run, when it ended resumable and nothing of that scope is active. */
export function retryableRuns<T extends { id: string }>(rows: readonly T[], scope: (row: T) => string, state: (row: T) => DownloadRunState): Set<string> {
  const seen = new Set<string>(), ids = new Set<string>();
  for (const row of rows) {
    const key = scope(row);
    if (seen.has(key)) continue;
    seen.add(key);
    const current = state(row);
    if (!current.active && current.resumable) ids.add(row.id);
  }
  return ids;
}
