import { createHash } from 'node:crypto';
import { compactCheckpoint, expandCheckpoint } from './checkpoint';
import { isPauseError, paused } from './pause';
export { compactCheckpoint } from './checkpoint';
import { parseCapture, type PageCapture } from './capture';
import { LISTING_URL } from './scrape';
import { activeTargetFilters, reportedListingTotal } from './targeted-scrape';
import { DETAIL_CAPTURE_VERSION } from './detail-policy';
import { emptyListingEvidence, firstPositions, MAX_REPEATED_APPEARANCES, reconcileListing, repeatedAppearances, sourceTotal, validListingEvidence,
  type ListingEvidence, type ListingReconciliation, type Position } from './listing-reconciliation';

interface PendingDetail { sourceKey: string; processId: string; detailUrl: string }
export interface Checkpoint {
  version: 1; kind: 'scrape'; scope: 'all-current-public-opportunities'; limited: false;
  capturedAt: string; startedAt: string; phase: 'listing' | 'detail' | 'complete';
  currentPage: number; totalPages: number | null; listingCount: number; detailsCompleted: number;
  knownKeys: string[]; pending: PendingDetail[]; failures: { sourceKey: string; message: string }[];
  complete: boolean; error?: string;
  /** Run that last saved this progress; a re-run of the same run (paused for a Zoer update) continues it. */
  runId?: string;
  /** Listing counts behind `reconciliation`; null when resumed from progress saved before they were recorded. */
  listing?: ListingEvidence | null;
  /** Displayed total vs rows read vs distinct opportunities, recomputed at every checkpoint. */
  reconciliation?: ListingReconciliation;
}
const key = (value: unknown) => typeof value === 'string' && value.length > 0 && value.length < 1000;
export function validateCheckpoint(value: any): Checkpoint {
  if (value?.version !== 1 || value?.kind !== 'scrape' || value?.scope !== 'all-current-public-opportunities' || value.complete ||
    !['listing', 'detail'].includes(value.phase) || !Number.isInteger(value.currentPage) || value.currentPage < 0 || value.currentPage > 200 ||
    !Number.isInteger(value.detailsCompleted) || value.detailsCompleted < 0 || !Array.isArray(value.knownKeys) || value.knownKeys.length > 3000 ||
    !value.knownKeys.every(key) || new Set(value.knownKeys).size !== value.knownKeys.length || !Array.isArray(value.pending) || value.pending.length > 3000 ||
    !value.pending.every((row: any) => key(row.sourceKey) && key(row.processId) && /^https:\/\/bcbid\.gov\.bc\.ca\/page\.aspx\/en\/(rfp|bpm)\/process_manage_extranet\/\d+$/.test(row.detailUrl)) ||
    new Set(value.pending.map((row: any) => row.sourceKey)).size !== value.pending.length ||
    !value.pending.every((row: any) => value.knownKeys.includes(row.sourceKey)) || value.detailsCompleted + value.pending.length !== value.knownKeys.length ||
    (value.listing != null && !validListingEvidence(value.listing, value.currentPage, value.knownKeys))) {
    throw new Error('Invalid full-scrape checkpoint. Start a new scrape.');
  }
  return structuredClone(value);
}
/**
 * Which progress a scrape.full run continues from. Zoer's stored pause checkpoint wins, then an operator
 * resume. With neither, saved catalog progress is continued only when this is a resumed run
 * (`resumeCheckpoint` present but null after a hard stop, or ZOER_RESUMED_FROM_PAUSE=1) or a re-run of the run that saved it. A new run starts fresh.
 */
export async function fullScrapeResume(request: { run?: { id?: string }; input?: any; resumeCheckpoint?: unknown }, loadSaved: () => Promise<any>,
  resumingPausedRun = request.resumeCheckpoint !== undefined) {
  const supplied = request.resumeCheckpoint ?? request.input?.resume;
  if (supplied) return supplied;
  const saved = await loadSaved();
  if (!saved || saved.complete || !(resumingPausedRun || (request.run?.id && saved.runId === request.run.id))) return undefined;
  try { return validateCheckpoint(saved); } catch { return undefined; }
}
const compactOrNull = (state: Checkpoint) => { try { return compactCheckpoint(state); } catch { return null; } };
/** Ordered row identities only: a ticking "ends in" countdown or capture time must not make an old page look new. */
export const listingFingerprint = (records: { sourceKey: string }[]) => createHash('sha256').update(records.map(row => row.sourceKey).join('|')).digest('hex').slice(0, 16);
/** Re-reads of a page whose pager advanced before its rows, before the crawl stops without saving that page. */
const STALE_PAGE_RECHECKS = 2;
/** Immutable listing/detail deltas keep data durable; compact checkpoints resume without re-fetching completed details. */
export async function scrapeFull(browser: { captureUrl(url: string, pageNumber?: number): Promise<PageCapture> }, save: (document: any) => Promise<string>, resume?: unknown, options: { runId?: string } = {}) {
  const now = () => new Date().toISOString();
  const state: Checkpoint = resume ? validateCheckpoint(expandCheckpoint(resume)) : { version: 1, kind: 'scrape', scope: 'all-current-public-opportunities', limited: false,
    capturedAt: now(), startedAt: now(), phase: 'listing', currentPage: 0, totalPages: null, listingCount: 0, detailsCompleted: 0,
    knownKeys: [], pending: [], failures: [], complete: false, listing: emptyListingEvidence() };
  state.failures = []; delete state.error;
  if (options.runId) state.runId = options.runId;
  // Progress from before listing counts were kept stays resumable; its reconciliation is reported unknown.
  state.listing ??= state.currentPage === 0 ? emptyListingEvidence() : null;
  const known = new Set(state.knownKeys);
  const listing = state.listing;
  const firstSeen = listing && state.phase === 'listing' ? firstPositions(listing, state.knownKeys) : new Map<string, Position>();
  let artifactId = '';
  const checkpoint = async () => {
    state.capturedAt = now(); state.listingCount = known.size;
    state.reconciliation = reconcileListing(state.listing ?? null, known.size, state.phase !== 'listing');
    artifactId = await save(state);
  };
  const capture = async (url: string, pageNumber?: number) => {
    let failure: unknown;
    for (let attempt = 0; attempt < 2; attempt++) {
      try { return await browser.captureUrl(url, pageNumber); }
      catch (error) {
        failure = error;
        if (isPauseError(error)) throw error;
        if (/manual|browser check|cancel|unavailable|budget|invalid.ticket/i.test(String(error))) throw error;
      }
    }
    throw failure;
  };
  await checkpoint();
  try {
    while (state.phase === 'listing') {
      const number = state.currentPage + 1;
      if (number > 200) throw new Error('Listing page safety limit reached; crawl remains incomplete.');
      let page: PageCapture, records: ReturnType<typeof parseCapture>['document']['records'] & {}, fingerprint: string;
      for (let recheck = 0; ; recheck++) {
        page = await capture(LISTING_URL, number);
        records = parseCapture(page, 'listing').document.records!;
        if (!page.pagination || page.pagination.currentPage !== number) throw new Error('The listing pager returned the wrong page.');
        // BC Bid keeps a search in the browser session; under one, "all pages" would be one buyer's pages.
        const narrowed = activeTargetFilters(page.html);
        if (narrowed.length) throw new Error(`BC Bid's Opportunities page still has a search filter (${narrowed.map(tag => `${tag.label}: ${tag.values.join(', ')}`).join('; ')}). Press Reset on that page in the Zoer browser, then continue the scrape.`);
        // The pager can show the new page number while the grid still holds the previous page's rows.
        fingerprint = listingFingerprint(records);
        if (!records.length || fingerprint !== listing?.lastPageFingerprint) break;
        if (recheck === STALE_PAGE_RECHECKS) throw new Error(`Listing page ${number} repeated the rows of page ${number - 1}; the grid had not updated. Page ${number} was not saved; resume the scrape to retry it.`);
      }
      if (!records.length && (number > 1 || page.pagination!.hasNext)) throw new Error('An expected listing page was empty.');
      // Every row appearance counts; a repeated identity is recorded with its position, not dropped.
      const additions: typeof records = [], repeats: { sourceKey: string; at: Position }[] = [], adding = new Set<string>();
      records.forEach((row, index) => {
        const at = { page: number, row: index + 1 };
        if (known.has(row.sourceKey) || adding.has(row.sourceKey)) repeats.push({ sourceKey: row.sourceKey, at });
        else { additions.push(row); adding.add(row.sourceKey); }
      });
      if (records.length && !additions.length) throw new Error('Listing pagination repeated an already captured page.');
      if (known.size + additions.length > 3000) throw new Error('Opportunity safety limit reached; crawl remains incomplete.');
      if (listing && repeatedAppearances(listing) + repeats.length > MAX_REPEATED_APPEARANCES) throw new Error('The listing repeated too many opportunities across pages; crawl remains incomplete.');
      for (const row of additions) {
        if (!row.detailUrl || !row.processId) throw new Error('A listing has no detail address; crawl remains incomplete.');
      }
      await save({ version: 1, kind: 'listing', sourceUrl: page.url, capturedAt: page.capturedAt, currentPage: number, records });
      for (const row of additions) {
        known.add(row.sourceKey); state.knownKeys.push(row.sourceKey);
        state.pending.push({ sourceKey: row.sourceKey, processId: row.processId!, detailUrl: row.detailUrl! });
        firstSeen.set(row.sourceKey, { page: number, row: records.indexOf(row) + 1 });
      }
      if (listing) {
        const total = sourceTotal(reportedListingTotal(page.html));
        if (number === 1) listing.sourceReportedTotal = total;
        else if (total.label && listing.sourceReportedTotal?.label && total.label !== listing.sourceReportedTotal.label) listing.totalChangedTo = total.label;
        listing.pageRows.push(records.length);
        listing.lastPageFingerprint = records.length ? fingerprint : null;
        for (const { sourceKey, at } of repeats) {
          const group = listing.duplicateAppearances.find(item => item.sourceKey === sourceKey);
          if (group) group.appearances.push(at);
          else listing.duplicateAppearances.push({ sourceKey, appearances: [firstSeen.get(sourceKey)!, at] });
        }
      }
      state.currentPage = number;
      if (!page.pagination!.hasNext) { state.totalPages = number; state.phase = 'detail'; }
      await checkpoint();
    }
    const work = [...state.pending];
    for (const row of work) {
      const failuresBefore = state.failures.length;
      try {
        const page = await capture(row.detailUrl);
        const doc = parseCapture(page, 'detail').document;
        if (doc.record!.processId !== row.processId) throw new Error('BC Bid returned a different opportunity than requested.');
        // The worker requests BC_BID_DETAIL_TABS for every full-crawl detail.
        await save({ ...doc, sourceKey: row.sourceKey, detailCaptureVersion: DETAIL_CAPTURE_VERSION });
        state.pending = state.pending.filter(item => item.sourceKey !== row.sourceKey);
        state.detailsCompleted++;
      } catch (error) {
        if (isPauseError(error)) throw error;
        const message = error instanceof Error ? error.message : String(error);
        state.failures.push({ sourceKey: row.sourceKey, message });
        if (/manual|browser check|cancel|unavailable|budget|invalid.ticket/i.test(message)) throw error;
      }
      if (state.detailsCompleted % 10 === 0 || state.failures.length > failuresBefore) await checkpoint();
      if (state.failures.length >= 5) throw new Error('Five detail pages failed. Saved progress; resume after checking the browser.');
    }
    if (state.pending.length) throw new Error(`${state.pending.length} detail pages remain incomplete. Resume to retry them.`);
    state.phase = 'complete'; state.complete = true;
    await checkpoint();
    return { artifactId, listingCount: known.size, detailCount: state.detailsCompleted, pageCount: state.currentPage + state.detailsCompleted,
      scope: state.scope, limited: false, totalPages: state.totalPages!, reconciliation: state.reconciliation! };
  } catch (error) {
    if (isPauseError(error)) {
      // Zoer is updating: nothing new starts, progress is flushed, and the run resumes on the new backend.
      // A failed flush still returns the in-memory checkpoint; per-detail saves already updated the catalog.
      try { await checkpoint(); } catch { /* resumeCheckpoint carries the same progress */ }
      return paused(compactOrNull(state));
    }
    state.error = error instanceof Error ? error.message : String(error);
    // Report the original failure (browser check, cancellation…) even if saving the checkpoint also fails.
    await checkpoint().catch(() => undefined);
    throw error;
  }
}
