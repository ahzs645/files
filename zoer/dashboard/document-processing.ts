import { documentFileKey, requiresBrowserVerification } from './procurement/document-identity';
import { plainError } from './error-text';

/**
 * Text extraction apart from the download.
 *
 * Downloads save each original and leave its text for later (the manifest declares
 * `deferExtraction` with `default: true`). Until `documents.extract.pending` reads it, a file is
 * "Text pending": `status='downloaded'`, `text IS NULL` and this exact `error`. It is not "No text"
 * (a scan, drawing or unsupported file that was read and yielded nothing) and it is not a warning.
 * Every place that counts or lists files without text builds its condition here.
 */
export const PENDING_EXTRACTION = 'Text extraction pending.';
/**
 * Hosts since Zoer 2026-11-18 save a failed extraction as `text=''` with an error starting with this
 * prefix, so it is told apart from "No text" and can be retried from the saved original
 * (`documents.extract.pending` with `retryFailed`). Older failures read as "No text" with a warning.
 */
export const EXTRACTION_FAILED = 'Text extraction failed: ';
const column = (alias: string, name: string) => alias ? `${alias}.${name}` : name;

/** A saved file whose text has not been extracted yet. */
export const pendingSql = (alias = '') => `${column(alias, 'status')}='downloaded' AND ${column(alias, 'text')} IS NULL AND ${column(alias, 'error')}='${PENDING_EXTRACTION}'`;
/** A saved file whose text extraction failed (the host's EXTRACTION_FAILED marker). */
export const extractionFailedSql = (alias = '') => `${column(alias, 'status')}='downloaded' AND coalesce(length(${column(alias, 'text')}),0)=0 AND ${column(alias, 'error')} LIKE '${EXTRACTION_FAILED}%'`;
/** A saved file that was read and has no usable text. Pending files and failed extractions are excluded. */
export const noTextSql = (alias = '') => `${column(alias, 'status')}='downloaded' AND coalesce(length(${column(alias, 'text')}),0)=0 AND coalesce(${column(alias, 'error')},'')<>'${PENDING_EXTRACTION}' AND coalesce(${column(alias, 'error')},'') NOT LIKE '${EXTRACTION_FAILED}%'`;
export const NO_TEXT_SQL = noTextSql('d');

/**
 * Tile counts for Operations › Documents: files of notices that still exist (populations.ts "Files saved (all)"), so they
 * agree with Opportunities › Files. `failed` counts failed rows (diagnostics); the tile counts files (`unsavedFailures`).
 */
export const DOCUMENT_STATS_SQL = `SELECT count(*) files,sum(status='downloaded') downloaded,sum(status='failed') failed,sum(length(text)>0) readable,sum(${pendingSql()}) pending,sum(${extractionFailedSql()}) extractFailed,sum(${noTextSql()}) unreadable,sum(CASE WHEN status='downloaded' THEN bytes ELSE 0 END) bytes FROM documents WHERE record_id IN (SELECT id FROM records)`;
/** What a text extraction run can pick up: pending files of notices that still exist (the host counts the same way). */
export const PENDING_COUNT_SQL = `SELECT count(*) files,count(DISTINCT record_id) notices FROM documents WHERE ${pendingSql()} AND record_id IN (SELECT id FROM records)`;
/** Failed extractions of notices that still exist: what Retry failed files queues again (the host counts the same way). */
export const EXTRACTION_FAILED_COUNT_SQL = `SELECT count(*) files,count(DISTINCT record_id) notices FROM documents WHERE ${extractionFailedSql()} AND record_id IN (SELECT id FROM records)`;
/** Pending files per notice, for a preflight of `count` notice ids. */
export const PREFLIGHT_PENDING_SQL = (count: number) => `SELECT record_id AS id, count(*) AS pending FROM documents WHERE ${pendingSql()} AND record_id IN (${Array(count).fill('?').join(',')}) GROUP BY record_id`;

export type FileFilter = 'all' | 'failed' | 'pending' | 'extractFailed' | 'unreadable' | 'warnings';
export const FILE_FILTERS: [FileFilter, string][] = [['all', 'Saved files'], ['failed', 'Not saved: download failed'], ['pending', 'Text pending'], ['extractFailed', 'Text failed'], ['unreadable', 'No text'], ['warnings', 'Saved with warnings']];
/**
 * The Files list condition for a filter (documents aliased `d`). A pending file matches `pending` only. "All" is the
 * saved-files library; failed downloads are their own list (`unsavedFailures`, one row per file still not saved), and
 * `failed` here is every failed row, kept for diagnostics.
 */
export function fileFilterSql(filter: string): string {
  if (filter === 'failed') return "d.status='failed'";
  if (filter === 'pending') return pendingSql('d');
  if (filter === 'extractFailed') return extractionFailedSql('d');
  if (filter === 'unreadable') return NO_TEXT_SQL;
  if (filter === 'warnings') return `d.status='downloaded' AND d.error IS NOT NULL AND d.error<>'${PENDING_EXTRACTION}'`;
  return "d.status='downloaded'";
}

type FileRow = { status?: unknown; error?: unknown; chars?: unknown; text_length?: unknown; textLength?: unknown };
const chars = (row: FileRow) => Number(row.chars ?? row.text_length ?? row.textLength ?? 0);
export const isTextPending = (row: FileRow | null | undefined) => !!row && row.status === 'downloaded' && row.error === PENDING_EXTRACTION && !chars(row);
export const isExtractionFailed = (row: FileRow | null | undefined) => !!row && row.status === 'downloaded' && !chars(row) && String(row.error ?? '').startsWith(EXTRACTION_FAILED);
/**
 * A failed download held by BC Bid's browser check: waiting for the person, not a failure to retry (the failure queue's
 * rule, procurement/source-health.ts `failedFiles`). "Document download did not start" also matches the host's check
 * test but is a stalled page, so it stays a failure.
 */
export const isWaitingForCheck = (row: FileRow | null | undefined) => !!row && row.status === 'failed'
  && requiresBrowserVerification(row.error) && !/^Document download did not start\b/i.test(String(row.error ?? ''));
/** [tone, label] of a file in the Files list (one word per state, see the audit's status table). */
export function fileState(row: FileRow): [string, string] {
  if (isWaitingForCheck(row)) return ['warn', 'Waiting for you'];
  if (row.status === 'failed') return ['bad', 'Download failed'];
  if (chars(row) > 0) return ['good', 'Readable'];
  if (isExtractionFailed(row)) return ['warn', 'Text failed'];
  return isTextPending(row) ? ['info', 'Text pending'] : ['neutral', 'No text'];
}
/** The warning shown beside a file: its stored error, except the pending marker (the chip already says it). */
export const fileWarning = (row: FileRow) => !row.error || row.error === PENDING_EXTRACTION ? ''
  : isExtractionFailed(row) ? String(row.error).slice(EXTRACTION_FAILED.length) : String(row.error);

type Batch = { id: string; kind: string; status: string; input?: string | null };
const batchInput = (batch: Batch): Record<string, any> => { try { const value = JSON.parse(batch.input || '{}'); return value && typeof value === 'object' ? value : {}; } catch { return {}; } };
/** A text extraction run (pending files, or a per-file Re-extract): a download-kind batch that downloads nothing. */
export const isExtractionBatch = (batch: Batch) => batch.kind === 'download' && batchInput(batch).extractOnly === true;
/** Download batches and extraction batches, apart. Other kinds (AI review) are in neither. */
export function splitDocumentBatches<T extends Batch>(batches: T[] = []) {
  const downloads: T[] = [], processing: T[] = [];
  for (const batch of batches) if (batch.kind === 'download') (isExtractionBatch(batch) ? processing : downloads).push(batch);
  return { downloads, processing };
}
/** Retry of an extraction run: what is still pending, or the same notices for a Re-extract run. */
export function processingRetry(batch: Batch): { actionId: string; input: Record<string, unknown> } {
  const input = batchInput(batch);
  return input.pendingOnly === true ? { actionId: 'documents.extract.pending', input: {} } : { actionId: 'documents.extract', input: { recordIds: input.recordIds } };
}

/** Why each saved file is left out of a document-stage preflight (AI workbench). */
export function workbenchExclusions(docs: Array<{ name: string; status: string; cp: number; pending?: boolean }>): string[] {
  return [
    ...docs.filter(doc => doc.status === 'downloaded' && !doc.cp).map(doc => `${doc.name}: ${doc.pending ? 'Text pending; extracted when this stage runs' : 'Saved; no usable text extracted'}`),
    ...docs.filter(doc => doc.status !== 'downloaded').map(doc => `${doc.name}: download ${doc.status}`),
  ];
}

/**
 * Every document row of the notices that have a failed row (any source, open or closed), read in pages: the failure
 * queue's read (procurement/source-health.ts `FAILED_FILES_SQL`) with the row id and size, so each file can be retried.
 */
export const FAILED_ROWS_SQL = "SELECT d.id, d.record_id AS recordId, r.title AS title, d.url, d.name, d.status, d.error, d.bytes, d.updated_at AS updatedAt FROM documents d LEFT JOIN records r ON r.id=d.record_id WHERE d.record_id IN (SELECT record_id FROM documents WHERE status='failed') ORDER BY d.record_id, d.url";
export interface FailedRow { id: string; recordId: string; title?: string | null; url: string; name?: string | null; status: string; error?: string | null; bytes?: number | null; updatedAt?: string | null }
/**
 * Files not saved after a failed download: per notice and file identity (document-identity.ts) the latest failed row,
 * unless another row of the same file is saved. The failure queue's rule (`failedFiles`), keeping the rows.
 */
export function unsavedFailures<T extends FailedRow>(rows: readonly T[]): T[] {
  const key = (row: T) => `${row.recordId}\u0000${documentFileKey(row.url)}`;
  const saved = new Set(rows.filter(row => row.status === 'downloaded').map(key)), latest = new Map<string, T>();
  for (const row of rows) {
    if (row.status !== 'failed' || saved.has(key(row))) continue;
    const prior = latest.get(key(row));
    if (!prior || String(prior.updatedAt ?? '') < String(row.updatedAt ?? '')) latest.set(key(row), row);
  }
  return [...latest.values()].sort((a, b) => String(b.updatedAt ?? '').localeCompare(String(a.updatedAt ?? '')) || a.id.localeCompare(b.id));
}
/** The browser-check sentence, shown once for every file it holds. */
export const BROWSER_CHECK_REASON = plainError('Manual browser verification required.');
export interface FailureGroup<T> { reason: string; waiting: boolean; rows: T[] }
/** Failed files grouped by their plain reason: files held by a browser check first, then the largest groups. */
export function groupByReason<T extends FailedRow>(rows: readonly T[]): FailureGroup<T>[] {
  const groups = new Map<string, FailureGroup<T>>();
  for (const row of rows) {
    const waiting = isWaitingForCheck({ status: 'failed', error: row.error }), reason = waiting ? BROWSER_CHECK_REASON : plainError(row.error ?? '') || 'No reason recorded.';
    const group = groups.get(reason) ?? { reason, waiting, rows: [] };
    group.rows.push(row); groups.set(reason, group);
  }
  return [...groups.values()].sort((a, b) => Number(b.waiting) - Number(a.waiting) || b.rows.length - a.rows.length);
}
