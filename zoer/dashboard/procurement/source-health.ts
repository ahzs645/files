import { isLive, runState, type RecentRun, type RunTone } from './source-schedules';
import { canonicalNoticeSql } from './canonical';
import { NO_TEXT_SQL } from '../document-processing';
import { acquireParts } from '../review-workspace/queue';
import { isActiveRun, runStateText } from '../format';
import { documentFileKey, requiresBrowserVerification } from './document-identity';

/** A checkpoint records progress; only an explicitly completed scope can establish success. */
export function bcCheckpointHealth(key: string, checkpoint: any) {
  const error = typeof checkpoint?.error === 'string' ? checkpoint.error : '';
  const failures = Array.isArray(checkpoint?.failures) ? checkpoint.failures : [];
  const completed = checkpoint?.complete === true && !error && !failures.length && (key === 'checkpoint:full'
    ? checkpoint.phase === 'complete' && Array.isArray(checkpoint.pending) && checkpoint.pending.length === 0
    : checkpoint.scope === 'dated-public-awards' && Array.isArray(checkpoint.ranges) && checkpoint.ranges.length > 0 && checkpoint.ranges.every((range: any) => range.complete === true));
  const timestamp = (value: unknown) => typeof value === 'string' && Number.isFinite(Date.parse(value)) ? value : 'Not recorded';
  const ranges = Array.isArray(checkpoint?.ranges) ? checkpoint.ranges : [];
  // "9999-12-31" marks an open-ended range; it is never shown as a date.
  const dated = (value: any) => typeof value === 'string' && !/^9999-12-31/.test(value);
  const from = ranges.map((range: any) => range.from).filter(dated).sort()[0];
  const to = ranges.map((range: any) => range.to).filter(dated).sort().at(-1);
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
  if (latest?.status === 'failed') return summary('warn', 'Needs attention · last collection failed');
  if (latest?.status === 'outcome_unknown') return summary('warn', 'Last outcome unknown');
  if (checkpointIssue) return summary('warn', 'Needs attention');
  if (latest?.status === 'cancelled') return summary('idle', 'Stopped');
  if (!runs) return summary('idle', 'Status unknown');
  if (latest?.status === 'succeeded') return summary('good', 'Collected');
  if (current?.completed) return summary('good', 'Collected');
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

export interface BatchRow { id: string; kind: string; status: string; completed: number | string; failed: number | string; total: number | string; error: string | null; updated_at: string; queueScope?: string | null }
/**
 * A batch's kind as people know it: Zoer files text-extraction runs (`input.extractOnly`) as `download` batches, so
 * they are told apart here. Every reader of `batches` selects `kind` through this.
 */
export const batchKindSql = (alias = '') => { const c = (name: string) => alias ? `${alias}.${name}` : name; return `CASE WHEN ${c('kind')}='download' AND coalesce(json_extract(${c('input')},'$.extractOnly'),0)=1 THEN 'extract' ELSE ${c('kind')} END`; };
/** Newest 200 batches (Sources › Downloads and reviews), kind classified, with the queue scope of "Keep documents current" runs. */
export const BATCH_SQL = `SELECT id, ${batchKindSql()} AS kind, status, completed, failed, total, error, updated_at, json_extract(input,'$.queueScope') AS queueScope FROM batches ORDER BY updated_at DESC LIMIT 200`;
/** Batches marked running whose workflow run is still active in `runs` (the host's run list; batch id = run id). */
export const activeBatches = <T extends { id: string }>(rows: readonly T[], runs: readonly { id: string; status: string }[]) => rows.filter(row => isActiveRun(runs.find(run => run.id === row.id)?.status));
/**
 * A batch's status in the shared vocabulary (format.ts). A batch marked running whose workflow run has ended (or is
 * no longer listed) is shown with the run's real outcome, never as running; without a run list it reads as recorded.
 */
export function batchStatusText(status: string, run?: { status: string } | null, runsKnown = false) {
  if (status === 'running' && runsKnown && !isActiveRun(run?.status)) return run ? String(runStateText(run.status)) : 'Ended; outcome not recorded';
  return status === 'waiting_for_user' ? 'Waiting for you (browser check)' : String(runStateText(status));
}
/**
 * Latest attempt and latest success per batch kind. A failed, partial, stopped or waiting run is reported with
 * its own status and counts; it never reads as zero results, and it never hides the last successful run.
 */
/** Plain names for batch kinds (the run-list vocabulary); anything unlisted shows its stored kind. Shared by Home and Sources. */
export function batchHealth(rows: BatchRow[], runs?: readonly { id: string; status: string }[] | null) {
  const kinds = [...new Set(rows.map(row => row.kind))].sort();
  return kinds.map(kind => {
    const list = rows.filter(row => row.kind === kind).sort((a, b) => b.updated_at.localeCompare(a.updated_at));
    const attempt = list[0], success = list.find(row => row.status === 'succeeded') ?? null;
    const n = (value: number | string) => (Number(value) || 0).toLocaleString();
    // "Keep documents current" batches record notices whose every file is saved, not items this run processed.
    const outcome = attempt.queueScope ? `${n(attempt.completed)} of ${n(attempt.total)} notices complete (every file saved)` : `${n(attempt.completed)} of ${n(attempt.total)} items done${Number(attempt.failed) ? `, ${n(attempt.failed)} failed` : ''}`;
    const run = runs?.find(item => item.id === attempt.id) ?? null, stale = attempt.status === 'running' && !!runs && !isActiveRun(run?.status);
    return { kind, attempt: { ...attempt, statusText: batchStatusText(attempt.status, run, !!runs), outcome, problem: stale || !['succeeded', 'running', 'paused'].includes(attempt.status) }, success,
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

/**
 * Failure queue, current state only (never a window of the task log): every saved document row of the notices that
 * have a failed row, any source, open or closed (paged), and the latest non-download task per notice and kind that
 * failed or waits for the person.
 */
export const FAILED_FILES_SQL = "SELECT d.record_id AS recordId, r.title AS title, d.url, d.name, d.status, d.error, d.updated_at AS updatedAt FROM documents d LEFT JOIN records r ON r.id=d.record_id WHERE d.record_id IN (SELECT record_id FROM documents WHERE status='failed') ORDER BY d.record_id, d.url";
export const FAILED_TASKS_SQL = "SELECT t.record_id, r.title, t.kind, t.status, t.error, t.updated_at, json_extract(t.result,'$.name') AS name, json_extract(t.result,'$.phase') AS phase FROM research_tasks t LEFT JOIN records r ON r.id=t.record_id WHERE t.kind<>'attachment' AND t.status IN ('failed','waiting_for_user') AND t.updated_at=(SELECT max(x.updated_at) FROM research_tasks x WHERE x.record_id=t.record_id AND x.kind=t.kind) ORDER BY t.updated_at DESC";
/**
 * Files whose latest download attempt failed and that are not saved under another spelling of the same file
 * (document-identity.ts), one task per file. A file held by a browser check (the host's rule) reads as waiting.
 */
export function failedFiles(rows: { recordId: string; title?: string | null; url: string; name?: string | null; status: string; error?: string | null; updatedAt?: string | null }[]): FailureTask[] {
  const saved = new Set<string>(), failed = new Map<string, FailureTask>();
  for (const row of rows) if (row.status === 'downloaded') saved.add(`${row.recordId}\u0000${documentFileKey(row.url)}`);
  for (const row of rows) {
    const key = `${row.recordId}\u0000${documentFileKey(row.url)}`;
    if (row.status !== 'failed' || saved.has(key)) continue;
    const prior = failed.get(key), at = String(row.updatedAt ?? '');
    if (prior && prior.updated_at >= at) continue;
    const waiting = requiresBrowserVerification(row.error) && !/^Document download did not start\b/i.test(row.error ?? '');
    failed.set(key, { record_id: row.recordId, title: row.title ?? null, kind: 'attachment', status: waiting ? 'waiting_for_user' : 'failed', error: row.error ?? null, updated_at: at, name: row.name ?? null, phase: null });
  }
  return [...failed.values()];
}
/** The one-line count Sources shows: files and notices, with the population named. */
export function failureSummary(tasks: FailureTask[]) {
  const files = tasks.filter(task => task.kind === 'attachment'), other = tasks.filter(task => task.kind !== 'attachment');
  return { files: files.length, fileNotices: new Set(files.map(task => task.record_id)).size, waitingFiles: files.filter(task => task.status === 'waiting_for_user').length,
    otherNotices: new Set(other.map(task => task.record_id)).size };
}

/**
 * Attachment discovery per source, one row per notice (canonical.ts, each source keeps its own copies). "Not checked"
 * is the Acquire queue's own predicate (queue.ts `acquireParts.unchecked`), so Sources, Home and the queue agree.
 */
const SOURCE_SQL = "CASE WHEN json_extract(r.data,'$.sourceId') IS NULL OR json_extract(r.data,'$.sourceId')='' THEN 'bc-bid' ELSE json_extract(r.data,'$.sourceId') END";
export const ATTACHMENT_SQL = (() => { const unchecked = acquireParts('r').unchecked; return `SELECT ${SOURCE_SQL} AS sourceId, count(*) AS total,
  sum(${unchecked}) AS notChecked,
  sum(json_extract(r.data,'$.attachments[0]') IS NULL AND CASE WHEN ${unchecked} THEN 0 ELSE 1 END=1) AS checkedNoLinks,
  sum(json_extract(r.data,'$.attachments[0]') IS NOT NULL) AS withLinks,
  sum((SELECT count(*) FROM documents d WHERE d.record_id=r.id AND d.status='downloaded')>0) AS withFiles,
  sum((SELECT count(*) FROM documents d WHERE d.record_id=r.id AND ${NO_TEXT_SQL})>0) AS noText
  FROM records r WHERE r.kind='opportunity' AND ${canonicalNoticeSql('r', { crossSource: 'include' })} GROUP BY sourceId`; })();

/** Attachment discovery states, as notice counts (saved opportunities, not portal totals or files). */
export function attachmentStates(row: { notChecked?: unknown; checkedNoLinks?: unknown; withLinks?: unknown; withFiles?: unknown; noText?: unknown } | undefined) {
  const n = (value: unknown) => Number(value) || 0;
  if (!row) return [];
  return [
    { key: 'not_checked', text: 'Attachment discovery not checked', count: n(row.notChecked) },
    { key: 'no_links', text: 'Notices with no attachment links saved', count: n(row.checkedNoLinks) },
    { key: 'links', text: 'Notices with links', count: n(row.withLinks) },
    { key: 'files', text: 'Notices with saved files', count: n(row.withFiles) },
    { key: 'no_text', text: 'Notices with saved files but no usable text', count: n(row.noText) },
  ];
}
