import { sql, sourceName } from './display';
import { and, openSql, recordColumns, sourceSql } from '../review-workspace/queue';
import { plainError } from '../error-text';
import { COLLECTION_KEY, connectorCollectionKey } from './source-adapters';
import { readConnectorCollection } from './source-overview';
import { bcCheckpointHealth, bcSourceHealth, type BcBidCollectionRun } from './source-health';
import type { RecentRun } from './source-schedules';
import { DETAIL_CAPTURE_VERSION } from '../../src/detail-policy';

/**
 * Data for the Status page and Home's status card: the document gap of open BC Bid notices and the last successful
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

async function paged(statement: string, parameters: (string | number)[]) {
  const rows: any[] = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    const batch = await sql(`${statement} LIMIT ${PAGE} OFFSET ?`, [...parameters, page * PAGE]);
    rows.push(...batch);
    if (batch.length < PAGE) break;
  }
  return rows;
}

export type LinkState = 'saved' | 'failed' | 'waiting' | 'never';
export interface GapLink { url: string; name: string; state: LinkState; error: string | null }
export interface GapNotice { id: string; title: string; closing: string | null; links: GapLink[] }
export interface DocumentGap {
  /** Notices due for detail capture, split by whether any links are already saved. */
  open: number; withLinks: number; noLinks: number; detailsWithLinks: number; noFiles: number; waitingNotices: number;
  /** When the download browser stopped at a browser check it has not got past since (any notice, open or closed). */
  checkPendingSince?: string | null;
  links: number; saved: number; failed: number; waiting: number; never: number;
  fullySaved: number; missingNotices: number;
  /** Failed files grouped by their plain reason, most common first. */
  reasons: { text: string; count: number }[];
  /** Notices with missing files, soonest closing first (unknown closing last). */
  notices: GapNotice[];
}

const fileKey = (recordId: string, url: string) => `${recordId}\u0000${url}`;
export function linkState(docs: { status: string; error: string | null }[], waiting?: boolean): Pick<GapLink, 'state' | 'error'> {
  if (docs.some(doc => doc.status === 'downloaded')) return { state: 'saved', error: null };
  const failed = docs.find(doc => doc.status === 'failed');
  if (waiting ?? /browser verification|browser check|complete (?:the|any required) (?:browser )?check/i.test(failed?.error ?? ''))
    return { state: 'waiting', error: failed?.error ?? 'BC Bid requires a browser check.' };
  return failed ? { state: 'failed', error: failed.error } : { state: 'never', error: null };
}
const parseLinks = (value: unknown): { url: string; name: string }[] => {
  let list: unknown = value;
  if (typeof value === 'string') { try { list = JSON.parse(value); } catch { return []; } }
  return Array.isArray(list) ? list.filter((item: any) => item && typeof item.url === 'string').map((item: any) => ({ url: item.url, name: typeof item.name === 'string' && item.name ? item.name : item.url })) : [];
};

/** Counts and per-file states from the three result sets (pure, for tests). */
export function computeDocumentGap(counts: any, linkRows: any[], documentRows: any[], waitingRows: { recordId: string; url: string }[] = []): DocumentGap {
  const waiting = new Set(waitingRows.map(row => fileKey(row.recordId, row.url)));
  const docs = new Map<string, { status: string; error: string | null }[]>();
  for (const row of documentRows) {
    const key = fileKey(row.recordId, row.url);
    docs.set(key, [...(docs.get(key) ?? []), { status: String(row.status), error: row.error ?? null }]);
  }
  const notices: GapNotice[] = linkRows.map(row => ({ id: String(row.id), title: String(row.title || row.id), closing: row.closing ?? null,
    links: [...new Map(parseLinks(row.links).map(link => [link.url, link])).values()].map(link => {
      const key = fileKey(row.id, link.url);
      return { ...link, ...linkState(docs.get(key) ?? [], waiting.has(key)) };
    }) }));
  const all = notices.flatMap(notice => notice.links), count = (state: LinkState) => all.filter(link => link.state === state).length;
  const reasons = new Map<string, number>();
  for (const link of all) if (link.state === 'failed' || link.state === 'waiting') { const text = plainError(link.error) || 'No reason recorded.'; reasons.set(text, (reasons.get(text) ?? 0) + 1); }
  const missing = notices.filter(notice => notice.links.some(link => link.state !== 'saved'));
  const n = (value: unknown) => Number(value ?? 0) || 0;
  return {
    open: n(counts?.open), withLinks: n(counts?.withLinks), noLinks: n(counts?.noLinks), detailsWithLinks: n(counts?.detailsWithLinks), noFiles: n(counts?.noFiles),
    waitingNotices: notices.filter(notice => notice.links.some(link => link.state === 'waiting')).length,
    links: all.length, saved: count('saved'), failed: count('failed'), waiting: count('waiting'), never: count('never'),
    fullySaved: notices.length - missing.length, missingNotices: missing.length,
    reasons: [...reasons].map(([text, count]) => ({ text, count })).sort((a, b) => b.count - a.count),
    notices: missing.sort((a, b) => (a.closing ?? '9999').localeCompare(b.closing ?? '9999') || a.id.localeCompare(b.id)),
  };
}

/** The document gap of open BC Bid notices: per attachment link, saved / failed / waiting for you / never tried. */
export async function readDocumentGap(asOf = Date.now(), browserId = ''): Promise<DocumentGap> {
  const scope = openBcBidScope(asOf);
  const [[counts], [check], links] = await Promise.all([
    sql(GAP_COUNTS_SQL(scope.sql), scope.parameters),
    sql(BROWSER_CHECK_SQL, [browserId, browserId]),
    paged(GAP_LINKS_SQL(scope.sql), scope.parameters),
  ]);
  const lastSuccess = typeof check?.lastSuccess === 'string' ? check.lastSuccess : '';
  const checkPendingSince = typeof check?.lastCheck === 'string' && check.lastCheck > lastSuccess ? check.lastCheck : null;
  const waiting = checkPendingSince ? await paged(WAITING_FILES_SQL, [browserId, browserId, lastSuccess]) : [];
  const documents = [];
  for (let start = 0; start < links.length; start += PAGE - 1) {
    // Reuse the selected notices and leave one parameter for the page offset.
    const ids = links.slice(start, start + PAGE - 1).map(row => String(row.id));
    const placeholders = ids.map(() => '?').join(',');
    const statement = `SELECT record_id AS recordId, url, status, error FROM documents WHERE record_id IN (${placeholders}) ORDER BY record_id, url`;
    documents.push(...await paged(statement, ids));
  }
  return { ...computeDocumentGap(counts, links, documents, waiting), checkPendingSince };
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

/** "Nov 12, 2026, 11:50 PM · Current opportunities (full scrape)", "Not recorded", or "Unknown". */
export function lastCollectionText(last: Pick<LastCollection, 'at' | 'scope' | 'known'> | undefined): string {
  if (!last?.known) return 'Unknown';
  if (!last.at) return last.scope ? `Time not recorded · ${last.scope}` : 'Not recorded';
  const time = Number.isFinite(Date.parse(last.at)) ? new Date(last.at).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : last.at;
  return last.scope ? `${time} · ${last.scope}` : time;
}
