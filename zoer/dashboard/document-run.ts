const terminal = new Set(['succeeded', 'failed', 'cancelled', 'outcome_unknown']);
/** Include queued workflow runs before the research batch is created. */
export function documentDownloadActive(runs: {id:string;status:string}[] = [], submitted?: string) {
  return runs.some(run => !terminal.has(run.status)) || Boolean(submitted && !runs.some(run => run.id === submitted));
}
