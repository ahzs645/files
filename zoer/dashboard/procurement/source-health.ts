import { isLive, runState, type RecentRun, type RunTone } from './source-schedules';

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
    completed,
    status: !checkpoint ? 'Not recorded' : error || failures.length ? 'Needs attention · incomplete' : completed ? 'Completed recorded scope' : 'Partial checkpoint',
    scope: checkpoint?.scope || 'Not recorded', range: from && to ? `${from} to ${to}` : '',
    checkpointTime: timestamp(checkpoint?.capturedAt),
    successfulAt: completed ? timestamp(checkpoint?.completedAt ?? checkpoint?.capturedAt) : 'Not recorded',
    error: error || failures.map((failure: any) => failure.message).filter(Boolean).join('; '),
    undated: checkpoint?.undated === 'not-verified', runId: checkpoint?.runId,
  };
}

/** Raw runs retain the action (scope); the legacy dashboard's display model does not. */
export interface BcBidCollectionRun {
  actionId: string; status: string; createdAt: string; runId?: string; id?: string;
  finishedAt?: string | null; completedAt?: string | null; input?: any; error?: string;
  resumable?: RecentRun['resumable'];
  paused?: boolean; waitKey?: string; queueReason?: string; statusReason?: string; cancelRequestedAt?: unknown;
}
const BC_COLLECTION_SCOPES: Record<string, string> = {
  'scrape.full': 'Current opportunities (full scrape)',
  'scrape.details': 'Selected notice details',
  'scrape.targeted': 'Targeted opportunities',
  'scrape.sample': 'Sample of opportunities',
  'scrape.historical': 'Historical opportunities',
  'listing.capture': 'One listing page',
  'detail.capture': 'One notice page',
  'awards.history': 'Historical awards',
};
const recordedTime = (value: unknown) => typeof value === 'string' && Number.isFinite(Date.parse(value)) ? value : null;
const completedTime = (run: BcBidCollectionRun) => recordedTime(run.finishedAt) ?? recordedTime(run.completedAt);
const collectionScope = (run: BcBidCollectionRun) => run.actionId === 'awards.history' && run.input?.mode === 'recent' ? 'Recent awards' : BC_COLLECTION_SCOPES[run.actionId];

function bcLiveState(run: BcBidCollectionRun): { tone: RunTone; text: string } {
  if (run.cancelRequestedAt || run.status === 'stopping') return { tone: 'busy', text: 'Stopping' };
  // Older hosts expose maintenance pauses on the run, before resumable state was available.
  if (run.paused || run.status === 'waiting_for_event' || /^maintenance:/.test(run.waitKey ?? '') || /paused for (zoer )?update/i.test(`${run.queueReason ?? ''} ${run.statusReason ?? ''}`)) return { tone: 'idle', text: 'Paused for update' };
  if (run.status === 'pending' && !run.resumable?.state) return { tone: 'busy', text: 'Queued' };
  return runState({ ...run, runId: run.runId ?? run.id ?? '', input: run.input ?? {}, finishedAt: completedTime(run) ?? undefined })!;
}

/**
 * A successful run says only that its recorded scope completed at that time, never that a source is current.
 * The full checkpoint is independent: a newer sample, detail, targeted or awards run cannot advance its date.
 * Run history is bounded, so missing history reads "not recorded", not "never scraped". A start time is never
 * substituted for a missing completion time.
 */
export function bcSourceHealth(runs: readonly BcBidCollectionRun[] | undefined, current: ReturnType<typeof bcCheckpointHealth> | undefined, checkpointIssue = false) {
  const list = (runs ?? []).filter(run => BC_COLLECTION_SCOPES[run.actionId]).sort((a, b) =>
    (Date.parse(b.createdAt) || 0) - (Date.parse(a.createdAt) || 0) || (b.runId ?? b.id ?? '').localeCompare(a.runId ?? a.id ?? ''));
  const active = list.find(run => isLive({ ...run, runId: run.runId ?? run.id ?? '', input: run.input ?? {}, finishedAt: run.finishedAt ?? undefined }));
  const latest = active ?? list[0];
  const successes = list.filter(run => run.status === 'succeeded').map(run => ({
    scope: collectionScope(run), at: completedTime(run), order: Date.parse(completedTime(run) ?? run.createdAt) || 0,
  }));
  const currentCompletedAt = current?.completed ? recordedTime(current.successfulAt) : null;
  if (currentCompletedAt) successes.push({ scope: BC_COLLECTION_SCOPES['scrape.full'], at: currentCompletedAt, order: Date.parse(currentCompletedAt) });
  const success = successes.sort((a, b) => b.order - a.order)[0];
  const lastSuccess = success ? { scope: success.scope, at: success.at } : null;
  const scope = latest ? collectionScope(latest) : current?.completed ? BC_COLLECTION_SCOPES['scrape.full'] : null;
  const summary = (tone: RunTone, status: string) => ({ tone, status, scope, lastSuccess, currentCompletedAt });
  if (active) { const state = bcLiveState(active); return summary(state.tone, state.text); }
  if (latest?.status === 'failed') return summary('warn', 'Last collection failed');
  if (latest?.status === 'outcome_unknown') return summary('warn', 'Last outcome unknown');
  if (checkpointIssue) return summary('warn', 'Needs attention');
  if (latest?.status === 'cancelled') return summary('idle', 'Last collection cancelled');
  if (!runs) return summary('idle', 'Status unknown');
  if (latest?.status === 'succeeded') return summary('good', 'Last collection succeeded');
  if (current?.completed) return summary('good', 'Completed scope recorded');
  return summary('idle', 'No recent collection');
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
  'municipal-sites': { status: 'partial', method: 'Addenda a site links on the notice page are saved with the other document links and refreshed while the notice is open; files are not downloaded and some sites post addenda only on BC Bid.' },
  'browser-sites': { status: 'unavailable', method: 'Only the bids page is read, so addenda posted on notice pages are not seen; check the site.' },
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
/** Plain names for batch kinds; anything unlisted shows its stored kind. Shared by Home's source health and Sources. */
export const BATCH_KIND_TEXT: Record<string, string> = { download: 'Document downloads', review: 'AI reviews', 'document-review': 'Document reviews', 'document-synthesis': 'Document synthesis', 'record-review': 'Notice reviews', 'host-action': 'Review pipeline', 'procurement-extract': 'Requirement extraction', 'procurement-triage': 'Notice triage' };

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
