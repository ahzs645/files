import { sql, sourceName } from './display';
import { and, openSql, recordColumns, sourceSql } from '../review-workspace/queue';
import { plainError } from '../error-text';
import { when } from '../format';
import { COLLECTION_KEY, connectorCollectionKey } from './source-adapters';
import { readConnectorCollection } from './source-overview';
import { bcCheckpointHealth, bcSourceHealth, type BcBidCollectionRun } from './source-health';
import type { RecentRun } from './source-schedules';
import { DETAIL_CAPTURE_VERSION } from '../../src/detail-policy';
import { distinctFiles, documentFileKey, matchDocuments } from './document-identity';
import type { DocumentQueueCoverage } from '../document-queue';

/**
 * Data for Operations › Overview and Home's operations line: the document gap of open BC Bid opportunities and the last successful
 * collection per source. Read-only catalog SQL only (the host validator: no `FROM (`, no keyword before `(`, at most
 * 200 rows per statement, so link and document lists are read in pages).
 */

const r = recordColumns();
const PAGE = 200, MAX_PAGES = 40;
/** Open BC Bid opportunities (same open rule as the review table). */
export const openBcBidScope = (asOf: number) => and(sourceSql('bc-bid'), openSql(asOf, '', { crossSource: 'exclude', source: 'bc-bid' }));

// Match the worker's detail eligibility, including partial captures that already have page-one links.
const NEEDS_DETAIL = `CASE WHEN ${r.field('tabCoverage.complete')}=0 OR ${r.field('detailNeedsRefresh')}=1
  OR ${r.field('detailFields[0]')} IS NULL OR coalesce(${r.field('detailCaptureVersion')},1)<${DETAIL_CAPTURE_VERSION}
  OR coalesce(${r.field('attachments')},'') NOT LIKE '[%' THEN 1 ELSE 0 END`;
const HAS_LINKS = `${r.field('attachments[0]')} IS NOT NULL`;
const GAP_COUNTS_SQL = (scope: string) => `SELECT count(*) AS open, sum(${HAS_LINKS}) AS withLinks,
  sum(${r.field('attachments')}='[]' AND ${NEEDS_DETAIL}=0) AS noFiles,
  sum(${HAS_LINKS} AND ${NEEDS_DETAIL}=1) AS detailsWithLinks,
  sum(${r.field('attachments[0]')} IS NULL AND ${NEEDS_DETAIL}=1) AS noLinks
  FROM records WHERE ${scope}`;

// Older task rows have no browser ID. Require a real BC Bid file and a download batch for those
// rows so portal downloads, text extraction and verification cannot clear the check.
const BROWSER_ID = "json_extract(t.result,'$.bcBidDownloadBrowserId')";
const BROWSER_TASKS = `FROM research_tasks t JOIN documents d ON d.id=t.source_id
  LEFT JOIN batches b ON b.id=t.run_id WHERE t.kind='attachment'
  AND lower(d.url) LIKE 'https://bcbid.gov.bc.ca/%/fil/download_public/%'
  AND CASE WHEN ${BROWSER_ID} IS NOT NULL THEN CASE WHEN ?='' OR ${BROWSER_ID}=? THEN 1 ELSE 0 END
    WHEN t.status='waiting_for_user' THEN 1
    WHEN b.kind='download' AND coalesce(json_extract(b.input,'$.extractOnly'),0)=0 THEN 1
    ELSE 0 END=1`;
const BROWSER_CHECK_SQL = `SELECT max(CASE WHEN t.status='waiting_for_user' THEN t.updated_at END) AS lastCheck,
  max(CASE WHEN t.status='succeeded' THEN t.updated_at END) AS lastSuccess ${BROWSER_TASKS}`;
const WAITING_FILES_SQL = `SELECT DISTINCT t.record_id AS recordId, d.url ${BROWSER_TASKS}
  AND t.status='waiting_for_user' AND t.updated_at>? ORDER BY recordId, d.url`;
const GAP_LINKS_SQL = (scope: string) => `SELECT id, ${r.title} AS title, ${r.closing} AS closing, ${r.field('attachments')} AS links FROM records WHERE ${scope} AND ${r.field('attachments[0]')} IS NOT NULL ORDER BY id`;

export async function paged(statement: string, parameters: (string | number)[]) {
  const rows: any[] = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    const batch = await sql(`${statement} LIMIT ${PAGE} OFFSET ?`, [...parameters, page * PAGE]);
    rows.push(...batch);
    if (batch.length < PAGE) break;
  }
  return rows;
}

export type LinkState = 'saved' | 'failed' | 'waiting' | 'never';
export interface GapLink { url: string; name: string; key?: string; state: LinkState; error: string | null }
export interface GapNotice { id: string; title: string; closing: string | null; links: GapLink[] }
export interface DocumentGap {
  /** Notices due for detail capture, split by whether any links are already saved. */
  open: number; withLinks: number; noLinks: number; detailsWithLinks: number; noFiles: number; waitingNotices: number;
  /** When the download browser stopped at a browser check it has not got past since (any notice, open or closed). */
  checkPendingSince?: string | null;
  /** Linked files (one per file identity, see document-identity.ts) and their states. */
  links: number; saved: number; failed: number; waiting: number; never: number;
  fullySaved: number; missingNotices: number;
  /** The host downloader's own buckets when this Zoer reports them (Documents › Download shows the same); else null. */
  queue: DocumentQueueCoverage | null;
  /** Failed files grouped by their plain reason, most common first. */
  reasons: { text: string; count: number }[];
  /** Notices with missing files, soonest closing first (unknown closing last). */
  notices: GapNotice[];
}

const BROWSER_CHECK_REASON = plainError('Manual browser verification required.');
const fileKey = (recordId: string, url: string, key?: unknown) => `${recordId}\u0000${documentFileKey(url, key)}`;
export function linkState(docs: { status: string; error?: string | null }[], waiting?: boolean): Pick<GapLink, 'state' | 'error'> {
  if (docs.some(doc => doc.status === 'downloaded')) return { state: 'saved', error: null };
  const failed = docs.find(doc => doc.status === 'failed');
  if (waiting ?? /browser verification|browser check|complete (?:the|any required) (?:browser )?check/i.test(failed?.error ?? ''))
    return { state: 'waiting', error: failed?.error ?? 'BC Bid requires a browser check.' };
  return failed ? { state: 'failed', error: failed.error ?? null } : { state: 'never', error: null };
}
const parseLinks = (value: unknown): { url: string; name: string; key?: string }[] => {
  let list: unknown = value;
  if (typeof value === 'string') { try { list = JSON.parse(value); } catch { return []; } }
  return Array.isArray(list) ? list.filter((item: any) => item && typeof item.url === 'string').map((item: any) => ({ url: item.url, name: typeof item.name === 'string' && item.name ? item.name : item.url, ...(typeof item.key === 'string' ? { key: item.key } : {}) })) : [];
};

/**
 * Counts and per-file states from the three result sets (pure, for tests). Files are matched to saved rows with the
 * downloader's own identity (document-identity.ts: BC Bid file GUID or `bcbid:file:` key first, URL as fallback), so
 * "complete", "missing" and "never tried" equal Documents › Download. With the host's `queue` coverage, the file
 * counts and the missing-file buckets are the host's own; the per-notice list below stays local.
 */
export function computeDocumentGap(counts: any, linkRows: any[], documentRows: any[], waitingRows: { recordId: string; url: string }[] = [], queue: DocumentQueueCoverage | null = null): DocumentGap {
  const waiting = new Set(waitingRows.map(row => fileKey(row.recordId, row.url)));
  const docs = new Map<string, { url: string; status: string; error: string | null; updated_at?: string | null }[]>();
  for (const row of documentRows) {
    const id = String(row.recordId);
    docs.set(id, [...(docs.get(id) ?? []), { url: String(row.url), status: String(row.status), error: row.error ?? null, updated_at: row.updatedAt ?? row.updated_at ?? null }]);
  }
  const notices: GapNotice[] = linkRows.map(row => {
    const id = String(row.id), links = distinctFiles(parseLinks(row.links)), matches = matchDocuments(links, docs.get(id) ?? []);
    return { id, title: String(row.title || row.id), closing: row.closing ?? null, links: links.map(link => {
      const match = matches.get(link.url)?.document;
      return { ...link, ...linkState(match ? [match] : [], waiting.has(fileKey(id, link.url, link.key))) };
    }) };
  });
  const all = notices.flatMap(notice => notice.links), count = (state: LinkState) => all.filter(link => link.state === state).length;
  const reasons = new Map<string, number>();
  // Waiting files keep their last error text ("did not finish"); they are listed under the browser check that holds them.
  for (const link of all) if (link.state === 'failed' || link.state === 'waiting') { const text = link.state === 'waiting' ? BROWSER_CHECK_REASON : plainError(link.error) || 'No reason recorded.'; reasons.set(text, (reasons.get(text) ?? 0) + 1); }
  const missing = notices.filter(notice => notice.links.some(link => link.state !== 'saved'));
  const n = (value: unknown) => Number(value ?? 0) || 0;
  const local = { links: all.length, saved: count('saved'), failed: count('failed'), waiting: count('waiting'), never: count('never'), fullySaved: notices.length - missing.length, missingNotices: missing.length };
  const host = queue ? { links: queue.files, saved: queue.saved, never: queue.neverTried, waiting: queue.waitingForBrowser,
    failed: Math.max(0, queue.files - queue.saved - queue.neverTried - queue.waitingForBrowser), fullySaved: queue.fullySaved, missingNotices: Math.max(0, queue.withLinks - queue.fullySaved) } : null;
  return {
    open: n(counts?.open), withLinks: queue ? queue.withLinks : n(counts?.withLinks), noLinks: n(counts?.noLinks), detailsWithLinks: n(counts?.detailsWithLinks), noFiles: n(counts?.noFiles),
    waitingNotices: notices.filter(notice => notice.links.some(link => link.state === 'waiting')).length,
    ...(host ?? local), queue,
    reasons: [...reasons].map(([text, count]) => ({ text, count })).sort((a, b) => b.count - a.count),
    notices: missing.sort((a, b) => (a.closing ?? '9999').localeCompare(b.closing ?? '9999') || a.id.localeCompare(b.id)),
  };
}

/**
 * The document gap of open BC Bid opportunities: per attachment file, saved / failed / waiting for you / never tried.
 * `readQueue` reads the host downloader's plan (`readDocumentQueue` in document-queue.ts); it resolves null when this
 * Zoer cannot answer, and the plugin's own count (same matching rule) stands in.
 */
export async function readDocumentGap(asOf = Date.now(), browserId = '', readQueue: () => Promise<DocumentQueueCoverage | null> = async () => null): Promise<DocumentGap> {
  const scope = openBcBidScope(asOf);
  const [[counts], [check], links, queue] = await Promise.all([
    sql(GAP_COUNTS_SQL(scope.sql), scope.parameters),
    sql(BROWSER_CHECK_SQL, [browserId, browserId]),
    paged(GAP_LINKS_SQL(scope.sql), scope.parameters),
    readQueue().catch(() => null),
  ]);
  const lastSuccess = typeof check?.lastSuccess === 'string' ? check.lastSuccess : '';
  const checkPendingSince = typeof check?.lastCheck === 'string' && check.lastCheck > lastSuccess ? check.lastCheck : null;
  const waiting = checkPendingSince ? await paged(WAITING_FILES_SQL, [browserId, browserId, lastSuccess]) : [];
  const documents = [];
  for (let start = 0; start < links.length; start += PAGE - 1) {
    // Reuse the selected opportunities and leave one parameter for the page offset.
    const ids = links.slice(start, start + PAGE - 1).map(row => String(row.id));
    const placeholders = ids.map(() => '?').join(',');
    const statement = `SELECT record_id AS recordId, url, status, error, updated_at AS updatedAt FROM documents WHERE record_id IN (${placeholders}) ORDER BY record_id, url`;
    documents.push(...await paged(statement, ids));
  }
  return { ...computeDocumentGap(counts, links, documents, waiting, queue), checkPendingSince };
}
export const DOCUMENT_GAP_KEY = ['catalog', 'procurement-status', 'document-gap'] as const;

// ---------------------------------------------------------------------------------------------
// Last successful collection per source: the one answer Sources, Status, Home and BC Bid's overview show.
// ---------------------------------------------------------------------------------------------

export const STATUS_SOURCES = ['bc-bid', 'canadabuys', 'bidsandtenders', 'municipal-sites', 'browser-sites'] as const;
/** catalog.workspace keys the helper reads. */
export const LAST_COLLECTION_KEYS = ['checkpoint:full', COLLECTION_KEY, ...STATUS_SOURCES.filter(id => id !== 'bc-bid' && id !== 'canadabuys').map(connectorCollectionKey)];
export interface LastCollection { id: string; name: string; at: string | null; scope: string | null; known: boolean }

/** BC Bid's last success from the plugin's run history (both lists merged, newest first) and the full-scrape checkpoint. */
export function bcLastCollection(runs: readonly RecentRun[] | undefined, captureRuns: readonly BcBidCollectionRun[] | undefined, checkpoint?: unknown) {
  if (!runs && !captureRuns) return null;
  const seen = new Set<string>(), merged: BcBidCollectionRun[] = [];
  for (const run of [...(runs ?? []), ...(captureRuns ?? [])] as BcBidCollectionRun[]) {
    const id = run.runId ?? run.id ?? `${run.actionId}:${run.createdAt}`;
    if (seen.has(id)) continue; seen.add(id); merged.push(run);
  }
  return bcSourceHealth(merged, checkpoint === undefined ? undefined : bcCheckpointHealth('checkpoint:full', checkpoint)).lastSuccess;
}

/**
 * Last successful collection per source. `entries`: catalog.workspace values for LAST_COLLECTION_KEYS (undefined while
 * unread); a source whose state cannot be read is `known: false`, never "never".
 */
export function lastCollections(entries: { key: string; value: unknown }[] | undefined, runs: readonly RecentRun[] | undefined, captureRuns: readonly BcBidCollectionRun[] | undefined): LastCollection[] {
  const value = (key: string) => entries?.find(entry => entry.key === key)?.value;
  return STATUS_SOURCES.map(id => {
    const name = sourceName(id);
    if (id === 'bc-bid') {
      const known = !!(runs || captureRuns), last = known ? bcLastCollection(runs, captureRuns, entries ? value('checkpoint:full') : undefined) : null;
      return { id, name, at: last?.at ?? null, scope: last?.scope ?? null, known };
    }
    if (!entries) return { id, name, at: null, scope: null, known: false };
    if (id === 'canadabuys') { const state = value(COLLECTION_KEY) as any; return { id, name, at: typeof state?.lastSuccessAt === 'string' ? state.lastSuccessAt : null, scope: null, known: true }; }
    try { const state = readConnectorCollection(value(connectorCollectionKey(id)), id); return { id, name, at: state?.lastSuccessAt ?? null, scope: null, known: true }; }
    catch { return { id, name, at: null, scope: null, known: false }; }
  });
}

/** "Nov 12, 11:50 PM · Current opportunities (full scrape)" (format.ts `when`), "Not recorded", or "Unknown". */
export function lastCollectionText(last: Pick<LastCollection, 'at' | 'scope' | 'known'> | undefined): string {
  if (!last?.known) return 'Unknown';
  if (!last.at) return last.scope ? `Time not recorded · ${last.scope}` : 'Not recorded';
  const time = when(last.at, Date.now(), last.at);
  return last.scope ? `${time} · ${last.scope}` : time;
}
