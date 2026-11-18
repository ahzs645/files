import type { ScheduleBrowsers } from './procurement/schedule-state';

const terminal = new Set(['succeeded', 'failed', 'cancelled', 'outcome_unknown']);
const captureActions = new Set(['listing.capture','detail.capture','scrape.sample','scrape.historical','scrape.full','scrape.details','scrape.targeted','awards.history','procurement.collect.browser']);
export const isSourceCaptureRun = (run: {actionId:string}) => captureActions.has(run.actionId);
/** Raw statuses cover queued and paused captures, before any receipt exists. */
export function sourceCaptureActive(runs: {actionId:string;status:string}[] = []) {
  return runs.some(run=>isSourceCaptureRun(run)&&!terminal.has(run.status));
}
export function sourceCaptureProgressPath(runs: {actionId:string;status:string}[] = []) {
  return runs.some(run => run.actionId === 'scrape.historical' && !terminal.has(run.status)) ? '/taxonomy' : '/scraper/history';
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
    ['documents.download', 'documents.download.all', 'documents.download.missing'].includes(run.actionId)));
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
