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
