import { isPausedForUpdate, PAUSED_FOR_UPDATE } from './model';
export function awardProgress(checkpoint: any): string {
  if (!checkpoint) return '';
  if (checkpoint.version !== 2) return `${checkpoint.count.toLocaleString()} rows processed across ${checkpoint.page.toLocaleString()} pages.`;
  const completed = checkpoint.ranges.filter((r: any) => r.complete).length;
  const active = checkpoint.ranges[checkpoint.active];
  // "9999-12-31" marks an open-ended range in saved checkpoints; it is never shown as a date.
  const day = (value: unknown) => typeof value === 'string' && !/^9999-12-31/.test(value) ? value : null;
  const range = active ? [day(active.from), day(active.to)] : [];
  const current = active && (range[0] || range[1]) ? ` Current range: ${range[0] ?? 'start'} to ${range[1] ?? 'open-ended'}, page ${checkpoint.page.toLocaleString()}.` : '';
  return `${completed.toLocaleString()} of ${checkpoint.ranges.length.toLocaleString()} date ranges checked. ${checkpoint.count.toLocaleString()} rows processed across ${checkpoint.pages.toLocaleString()} pages.${current} Undated awards are not verified.`;
}

/**
 * Award history on the BC Bid page: collect the public award history by date range, resume it, or check recent awards.
 * One primary at a time ("Collect award history" or "Resume award history"); a complete history is stated as text with
 * only the secondary "Refresh recent awards". Never a disabled primary.
 */
export function awardHistoryState(model: { awardCheckpoint: any; awardRecentCheckpoint: any; awardRuns: any[] }, active: any) {
  const checkpoint = model.awardCheckpoint, latest = model.awardRuns[0];
  const complete = checkpoint?.version === 2 && checkpoint.complete === true;
  const primary: 'collect' | 'resume' | null = active || complete ? null : checkpoint?.version === 2 && !checkpoint.complete ? 'resume' : 'collect';
  const isRecent = !!latest && model.awardRecentCheckpoint?.runId === latest.id;
  const status = active ? (active.cancelRequestedAt ? 'Stopping after the current request.' : isPausedForUpdate(active) ? PAUSED_FOR_UPDATE : active.queueReason || 'Collecting award history. You can close this page.')
    : complete ? 'Award history complete.'
    : latest ? (latest.status === 'outcome_unknown' ? 'The last run was interrupted. Saved awards are kept.' : latest.cancelRequestedAt || latest.status === 'cancelled' ? 'The last run was stopped by you. Saved awards are kept.' : latest.status === 'failed' ? 'The last run failed. Saved awards are kept.' : 'Award history is part-way.')
    : 'Award history has not been collected yet.';
  return { complete, primary, status, isRecent, latest };
}

