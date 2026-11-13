import { parseCapture, type PageCapture } from './capture';
import { isPauseError, ZoerPausedError } from './pause';
import { DETAIL_CAPTURE_VERSION, needsDetail } from './detail-policy';
import { deadlineSortTime, notClosed } from '../dashboard/procurement/deadline';

const RECORD_ID = /^opportunity:\d{1,10}$/;
const detailAddress = (processId: string) => new RegExp('^https://bcbid\\.gov\\.bc\\.ca/page\\.aspx/en/(rfp|bpm)/process_manage_extranet/' + processId + '$');
/** Failures that end the run: the browser needs the user, the run was stopped, or its browser is gone. */
const FATAL = /manual|browser check|verification|cancel|unavailable|budget|invalid.ticket|connect failed/i;
/** One notice's own page problem (its tab menu could not be read), not a lost or blocked browser. */
const NOTICE_PAGE = /Public detail tab inventory is unavailable or exceeds its bound/;
/** Consecutive per-notice failures that end a `missing` run: past this the source or browser is the problem. */
export const MAX_CONSECUTIVE_NOTICE_FAILURES = 3;
const fatal = (error: unknown) => { const message = String((error as Error)?.message ?? error); return !NOTICE_PAGE.test(message) && FATAL.test(message); };
/** No current detail capture, or no saved attachment list (an empty list after a current capture is a saved list). */
export const wantsMissingDetail = (data: any) => needsDetail(data) !== null || !Array.isArray(data?.attachments);

type CatalogPage = { records: any[]; next?: string | null };
/** Saved current (not historical) BC Bid notice with a valid detail address of its own. */
const currentBcBidNotice = (row: any) => {
  const data = row?.data;
  return row?.kind === 'opportunity' && RECORD_ID.test(row.id) && data && !(data.sourceId && data.sourceId !== 'bc-bid') && !data.historical
    && row.id === 'opportunity:' + data.processId && typeof data.detailUrl === 'string' && detailAddress(data.processId).test(data.detailUrl);
};
const isOpenNotice = (data: any, now: number) => /^open$/i.test(String(data.status ?? '').trim()) && notClosed(data.closingDate, now);
/**
 * Open BC Bid notices without a current detail capture or saved attachment list, soonest closing first.
 * With `stale`, closed and past-deadline current notices that need the same refresh (most often details
 * saved before the current full-tab capture version) follow, most recently closed first.
 * Pages the opportunity catalog (workers have no SQL), keeping only ids and deadlines in memory.
 */
export async function selectMissingDetails(readPage: (after: string) => Promise<CatalogPage>, limit: number, now = Date.now(), options: { stale?: boolean } = {}) {
  const open: { id: string; closes: number }[] = [], closed: { id: string; closes: number }[] = [];
  let after = '';
  for (;;) {
    const page = await readPage(after);
    // Only an empty page proves the end: the host also shortens pages by size.
    if (!page.records.length) break;
    for (const row of page.records) {
      if (!currentBcBidNotice(row) || !wantsMissingDetail(row.data)) continue;
      const closes = deadlineSortTime(row.data.closingDate);
      if (isOpenNotice(row.data, now)) open.push({ id: row.id, closes: closes ?? Number.MAX_SAFE_INTEGER });
      else if (options.stale) closed.push({ id: row.id, closes: closes ?? Number.MIN_SAFE_INTEGER });
    }
    const next = String(page.records.at(-1).id);
    if (next <= after) throw new Error('Catalog pagination did not advance. Retry the capture.');
    after = next;
  }
  open.sort((a, b) => a.closes - b.closes || a.id.localeCompare(b.id));
  closed.sort((a, b) => b.closes - a.closes || a.id.localeCompare(b.id));
  return [...open, ...closed].slice(0, limit).map(row => row.id);
}

/**
 * Retry missing or stale saved BC Bid details; each successful capture persists independently.
 * `recordIds` captures a chosen selection and stops at the first failure. `missing` chooses open notices
 * itself (for schedules), and with `stale: true` then closed current notices, most recently closed first.
 * A notice that fails is counted and the next one is tried, so one bad page cannot block the queue; a
 * browser check, cancellation, lost browser or several failures in a row still end the run. A re-capture
 * merges into the saved notice (stars, history and files are kept; see saveCatalogDocument).
 */
export async function captureMissingDetails(input: any, host: {
  read(ids: string[]): Promise<{ records: any[] }>;
  capture(url: string): Promise<PageCapture>;
  save(document: any): Promise<string>;
  /** One page of saved opportunities after `after`, for `missing` mode. */
  list?(after: string): Promise<CatalogPage>;
}, options: { sleep?: (ms: number) => Promise<void>; paused?: () => boolean; now?: number } = {}) {
  const hasIds = input?.recordIds !== undefined, hasMissing = input?.missing !== undefined;
  if (hasIds === hasMissing) throw new Error('Choose saved BC Bid opportunities or a missing-details limit, not both.');
  const missing = hasMissing;
  let ids: string[];
  if (missing) {
    const limit = input.missing?.limit, stale = input.missing?.stale;
    if (!input.missing || typeof input.missing !== 'object' || Object.keys(input.missing).some(key => key !== 'limit' && key !== 'stale')
      || !Number.isInteger(limit) || limit < 1 || limit > 50) throw new Error('Missing details take a limit from 1 to 50.');
    if (stale !== undefined && typeof stale !== 'boolean') throw new Error('Missing details take stale as true or false.');
    if (!host.list) throw new Error('Update Zoer to choose missing details automatically.');
    ids = await selectMissingDetails(host.list, limit, options.now, { stale: stale === true });
  } else {
    if (!Array.isArray(input?.recordIds) || !input.recordIds.length || input.recordIds.length > 50
      || input.recordIds.some((id: unknown) => typeof id !== 'string' || !RECORD_ID.test(id)))
      throw new Error('Select 1–50 saved BC Bid opportunities.');
    ids = [...new Set<string>(input.recordIds)];
  }
  if (!ids.length) return { completed: 0, skipped: 0, total: 0, selected: 0, failed: 0 };
  const rows = (await host.read(ids)).records;
  const records = new Map(rows.map(row => [row.id, row]));
  // Validate the entire selection before opening a page; URLs come only from the existing catalog.
  for (const id of ids) {
    const row = records.get(id), data = row?.data;
    if (row?.kind !== 'opportunity' || !data || data.sourceId && data.sourceId !== 'bc-bid'
      || id !== 'opportunity:' + data.processId
      || !detailAddress(data.processId).test(data.detailUrl))
      throw new Error('A selected notice has no valid saved BC Bid detail address.');
  }
  let completed = 0, skipped = 0, failed = 0, consecutive = 0, firstFailure: unknown;
  const progress = () => host.save({ version: 1, kind: 'scrape', scope: 'bcbid-missing-details', phase: 'detail',
    capturedAt: new Date().toISOString(), detailsCompleted: completed, detailLimit: ids.length, records: [],
    knownKeys: ids.map(id => id.slice('opportunity:'.length)) });
  await progress();
  const captureOne = async (row: any) => {
    let page: PageCapture;
    try { page = await host.capture(row.data.detailUrl); }
    catch (error) {
      // A failed native connect occurs before source navigation. Allow the
      // runtime's 65-second lease to expire, then retry exactly once. Never
      // retry source checks, manual takeover, cancellation or other failures.
      if (isPauseError(error) || !/^Native browser connect failed \(400\)\.$/.test(String((error as Error)?.message ?? error))) throw error;
      const sleep = options.sleep ?? (ms => new Promise<void>(resolve => setTimeout(resolve, ms)));
      for (let elapsed = 0; elapsed < 70000; elapsed += 1000) {
        if (options.paused?.()) throw new ZoerPausedError();
        await sleep(1000);
      }
      if (options.paused?.()) throw new ZoerPausedError();
      page = await host.capture(row.data.detailUrl);
    }
    const { document } = parseCapture(page, 'detail');
    if (document.record?.processId !== row.data.processId) throw new Error('BC Bid returned a different opportunity. Nothing was saved from that page.');
    // The worker requests BC_BID_DETAIL_TABS for these captures.
    await host.save({ ...document, scope: 'bcbid-missing-details', detailCaptureVersion: DETAIL_CAPTURE_VERSION });
  };
  for (const id of ids) {
    const row = records.get(id)!;
    if (!(missing ? wantsMissingDetail(row.data) : needsDetail(row.data))) { skipped++; continue; }
    try { await captureOne(row); }
    catch (error) {
      if (!missing || isPauseError(error) || fatal(error)) throw error;
      failed++; firstFailure ??= error;
      // Several notices in a row failing is not one bad page: stop instead of paging through the queue.
      if (++consecutive >= MAX_CONSECUTIVE_NOTICE_FAILURES) throw error;
      continue;
    }
    consecutive = 0;
    completed++;
    await progress();
  }
  // Nothing captured and every attempt failed: report the cause rather than an empty success.
  if (missing && failed && !completed) throw firstFailure;
  return { completed, skipped, total: ids.length, ...(missing ? { selected: ids.length, failed } : {}) };
}
