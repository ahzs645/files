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
/** Recheck on a click: a cached snapshot must not start competing browser work. */
export async function assertDocumentBrowserIdle(host:(method:string,input?:unknown)=>Promise<any>) {
  const state=await host('state',{summary:true});
  if(sourceCaptureActive(state.runs))throw Error('Wait for the active source capture to finish before starting another browser task.');
  if(documentDownloadActive(state.runs.filter((run:any)=>['documents.download','documents.download.all'].includes(run.actionId))))throw Error('Wait for the active attachment download to finish.');
}
/** Include queued workflow runs before the research batch is created. */
export function documentDownloadActive(runs: {id:string;status:string}[] = [], submitted?: string) {
  return runs.some(run => !terminal.has(run.status)) || Boolean(submitted && !runs.some(run => run.id === submitted));
}
