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

export const DOCUMENT_STATS_SQL = `SELECT count(*) files,sum(status='downloaded') downloaded,sum(status='failed') failed,sum(length(text)>0) readable,sum(${pendingSql()}) pending,sum(${extractionFailedSql()}) extractFailed,sum(${noTextSql()}) unreadable,sum(bytes) bytes FROM documents`;
/** What a text extraction run can pick up: pending files of notices that still exist (the host counts the same way). */
export const PENDING_COUNT_SQL = `SELECT count(*) files,count(DISTINCT record_id) notices FROM documents WHERE ${pendingSql()} AND record_id IN (SELECT id FROM records)`;
/** Failed extractions of notices that still exist: what Retry failed files queues again (the host counts the same way). */
export const EXTRACTION_FAILED_COUNT_SQL = `SELECT count(*) files,count(DISTINCT record_id) notices FROM documents WHERE ${extractionFailedSql()} AND record_id IN (SELECT id FROM records)`;
/** Pending files per notice, for a preflight of `count` notice ids. */
export const PREFLIGHT_PENDING_SQL = (count: number) => `SELECT record_id AS id, count(*) AS pending FROM documents WHERE ${pendingSql()} AND record_id IN (${Array(count).fill('?').join(',')}) GROUP BY record_id`;

export type FileFilter = 'all' | 'failed' | 'pending' | 'extractFailed' | 'unreadable' | 'warnings';
export const FILE_FILTERS: [FileFilter, string][] = [['all', 'All files'], ['failed', 'Failed'], ['pending', 'Text pending'], ['extractFailed', 'Extraction failed'], ['unreadable', 'No text'], ['warnings', 'With warnings']];
/** The Files list condition for a filter (documents aliased `d`). A pending file matches `pending` only. */
export function fileFilterSql(filter: string): string {
  if (filter === 'failed') return "d.status='failed'";
  if (filter === 'pending') return pendingSql('d');
  if (filter === 'extractFailed') return extractionFailedSql('d');
  if (filter === 'unreadable') return NO_TEXT_SQL;
  if (filter === 'warnings') return `d.status='downloaded' AND d.error IS NOT NULL AND d.error<>'${PENDING_EXTRACTION}'`;
  return '1=1';
}

type FileRow = { status?: unknown; error?: unknown; chars?: unknown; text_length?: unknown; textLength?: unknown };
const chars = (row: FileRow) => Number(row.chars ?? row.text_length ?? row.textLength ?? 0);
export const isTextPending = (row: FileRow | null | undefined) => !!row && row.status === 'downloaded' && row.error === PENDING_EXTRACTION && !chars(row);
export const isExtractionFailed = (row: FileRow | null | undefined) => !!row && row.status === 'downloaded' && !chars(row) && String(row.error ?? '').startsWith(EXTRACTION_FAILED);
/** [tone, label] of a file in the Files list. */
export function fileState(row: FileRow): [string, string] {
  if (row.status === 'failed') return ['bad', 'Failed'];
  if (chars(row) > 0) return ['good', 'Readable'];
  if (isExtractionFailed(row)) return ['bad', 'Extraction failed'];
  return isTextPending(row) ? ['info', 'Text pending'] : ['warn', 'No text'];
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
