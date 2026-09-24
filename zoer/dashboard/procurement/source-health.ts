/** A checkpoint records progress; only an explicitly completed scope can establish success. */
export function bcCheckpointHealth(key: string, checkpoint: any) {
  const error = typeof checkpoint?.error === 'string' ? checkpoint.error : '';
  const failures = Array.isArray(checkpoint?.failures) ? checkpoint.failures : [];
  const completed = checkpoint?.complete === true && !error && !failures.length && (key === 'checkpoint:full'
    ? checkpoint.phase === 'complete' && Array.isArray(checkpoint.pending) && checkpoint.pending.length === 0
    : checkpoint.scope === 'dated-public-awards' && Array.isArray(checkpoint.ranges) && checkpoint.ranges.length > 0 && checkpoint.ranges.every((range: any) => range.complete === true));
  const timestamp = (value: unknown) => typeof value === 'string' && Number.isFinite(Date.parse(value)) ? value : 'Not recorded';
  const ranges = Array.isArray(checkpoint?.ranges) ? checkpoint.ranges : [];
  const from = ranges.map((range: any) => range.from).filter((value: any) => typeof value === 'string').sort()[0];
  const to = ranges.map((range: any) => range.to).filter((value: any) => typeof value === 'string').sort().at(-1);
  return {
    status: !checkpoint ? 'Not recorded' : error || failures.length ? 'Needs attention · incomplete' : completed ? 'Completed recorded scope' : 'Partial checkpoint',
    scope: checkpoint?.scope || 'Not recorded', range: from && to ? `${from} to ${to}` : '',
    checkpointTime: timestamp(checkpoint?.capturedAt),
    successfulAt: completed ? timestamp(checkpoint?.completedAt ?? checkpoint?.capturedAt) : 'Not recorded',
    error: error || failures.map((failure: any) => failure.message).filter(Boolean).join('; '),
    undated: checkpoint?.undated === 'not-verified', runId: checkpoint?.runId,
  };
}
