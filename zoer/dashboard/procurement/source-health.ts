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

// ---------------------------------------------------------------------------------------------
// Source health (INTERFACE-SPEC Sources; BACKLOG P9): capabilities, run outcomes and failure queue.
// ---------------------------------------------------------------------------------------------

export type CapabilityStatus = 'available' | 'partial' | 'unavailable' | 'unknown';
type AdapterCapabilities = Partial<Record<'listing' | 'detail' | 'attachments' | 'awards' | 'auth', { status: 'available' | 'partial' | 'unavailable'; method: string }>>;
/** Addenda are not a separate adapter capability; state what each connector actually does with them. */
const ADDENDA: Record<string, { status: CapabilityStatus; method: string }> = {
  'bc-bid': { status: 'partial', method: 'Addenda published as notice attachments are saved with the other files; a changed file is detected only when it is downloaded again.' },
  canadabuys: { status: 'unavailable', method: 'Amendment numbers are kept as data; addendum files are not downloaded by this connector.' },
  bidsandtenders: { status: 'partial', method: 'The listing\'s addenda count is saved with each notice and refreshed every run; addendum files need a vendor login and are not downloaded.' },
};
/** The four capabilities the Sources page reports, in a fixed order. Missing information reads "unknown", never "unavailable". */
export function capabilityMatrix(sourceId: string, capabilities: AdapterCapabilities | undefined) {
  const pick = (value?: { status: string; method: string }) => value ? { status: value.status as CapabilityStatus, method: value.method } : { status: 'unknown' as const, method: 'Not recorded for this connector.' };
  return [
    { name: 'List', ...pick(capabilities?.listing) },
    { name: 'Details', ...pick(capabilities?.detail) },
    { name: 'Download', ...pick(capabilities?.attachments) },
    { name: 'Addenda', ...(ADDENDA[sourceId] ?? pick(undefined)) },
  ];
}
export const CAPABILITY_TEXT: Record<CapabilityStatus, string> = { available: 'Available', partial: 'Partial', unavailable: 'Not supported', unknown: 'Unknown' };

export interface BatchRow { id: string; kind: string; status: string; completed: number | string; failed: number | string; total: number | string; error: string | null; updated_at: string }
const BATCH_STATUS: Record<string, string> = { running: 'Running', succeeded: 'Succeeded', failed: 'Failed', partial: 'Partly failed', stopped: 'Stopped', waiting_for_user: 'Waiting for you (browser check)', cancelled: 'Cancelled', paused: 'Paused for update' };
export const batchStatusText = (status: string) => BATCH_STATUS[status] ?? `Unrecognized status: ${status}`;
/**
 * Latest attempt and latest success per batch kind. A failed, partial, stopped or waiting run is reported with
 * its own status and counts; it never reads as zero results, and it never hides the last successful run.
 */
export function batchHealth(rows: BatchRow[]) {
  const kinds = [...new Set(rows.map(row => row.kind))].sort();
  return kinds.map(kind => {
    const list = rows.filter(row => row.kind === kind).sort((a, b) => b.updated_at.localeCompare(a.updated_at));
    const attempt = list[0], success = list.find(row => row.status === 'succeeded') ?? null;
    const n = (value: number | string) => Number(value) || 0;
    const outcome = `${n(attempt.completed)} of ${n(attempt.total)} records completed${n(attempt.failed) ? `, ${n(attempt.failed)} failed` : ''}`;
    return { kind, attempt: { ...attempt, statusText: batchStatusText(attempt.status), outcome, problem: !['succeeded', 'running', 'paused'].includes(attempt.status) }, success,
      problems: list.filter(row => ['failed', 'partial', 'stopped', 'waiting_for_user'].includes(row.status)).length };
  });
}

export interface FailureTask { record_id: string; title: string | null; kind: string; status: string; error: string | null; updated_at: string; name: string | null; phase: string | null }
/** Failure queue grouped by notice, newest first. Download tasks can be retried with the existing download action. */
export function groupFailures(tasks: FailureTask[]) {
  const groups = new Map<string, { recordId: string; title: string; tasks: FailureTask[]; waiting: boolean; retryable: boolean; updatedAt: string }>();
  for (const task of tasks) {
    const group = groups.get(task.record_id) ?? { recordId: task.record_id, title: task.title || task.record_id, tasks: [], waiting: false, retryable: false, updatedAt: task.updated_at };
    group.tasks.push(task);
    group.waiting ||= task.status === 'waiting_for_user';
    group.retryable ||= task.kind === 'attachment';
    if (task.updated_at > group.updatedAt) group.updatedAt = task.updated_at;
    groups.set(task.record_id, group);
  }
  return [...groups.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

/** Attachment discovery states with the INTERFACE-SPEC §3 wording. Counts are saved opportunities, not portal totals. */
export function attachmentStates(row: { notChecked?: unknown; checkedNoLinks?: unknown; withLinks?: unknown; withFiles?: unknown; noText?: unknown } | undefined) {
  const n = (value: unknown) => Number(value) || 0;
  if (!row) return [];
  return [
    { key: 'not_checked', text: 'Attachment discovery not checked', count: n(row.notChecked) },
    { key: 'no_links', text: 'No public attachment links found in this check', count: n(row.checkedNoLinks) },
    { key: 'links', text: 'Attachment links saved', count: n(row.withLinks) },
    { key: 'files', text: 'Files downloaded', count: n(row.withFiles) },
    { key: 'no_text', text: 'Saved; no usable text extracted', count: n(row.noText) },
  ];
}
