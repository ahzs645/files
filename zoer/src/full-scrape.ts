import { expandCheckpoint } from './checkpoint';
export { compactCheckpoint } from './checkpoint';
import { parseCapture, type PageCapture } from './capture';
import { LISTING_URL } from './scrape';

interface PendingDetail { sourceKey: string; processId: string; detailUrl: string }
export interface Checkpoint {
  version: 1; kind: 'scrape'; scope: 'all-current-public-opportunities'; limited: false;
  capturedAt: string; startedAt: string; phase: 'listing' | 'detail' | 'complete';
  currentPage: number; totalPages: number | null; listingCount: number; detailsCompleted: number;
  knownKeys: string[]; pending: PendingDetail[]; failures: { sourceKey: string; message: string }[];
  complete: boolean; error?: string;
}
const key = (value: unknown) => typeof value === 'string' && value.length > 0 && value.length < 1000;
export function validateCheckpoint(value: any): Checkpoint {
  if (value?.version !== 1 || value?.kind !== 'scrape' || value?.scope !== 'all-current-public-opportunities' || value.complete ||
    !['listing', 'detail'].includes(value.phase) || !Number.isInteger(value.currentPage) || value.currentPage < 0 || value.currentPage > 200 ||
    !Number.isInteger(value.detailsCompleted) || value.detailsCompleted < 0 || !Array.isArray(value.knownKeys) || value.knownKeys.length > 3000 ||
    !value.knownKeys.every(key) || new Set(value.knownKeys).size !== value.knownKeys.length || !Array.isArray(value.pending) || value.pending.length > 3000 ||
    !value.pending.every((row: any) => key(row.sourceKey) && key(row.processId) && /^https:\/\/bcbid\.gov\.bc\.ca\/page\.aspx\/en\/(rfp|bpm)\/process_manage_extranet\/\d+$/.test(row.detailUrl)) ||
    new Set(value.pending.map((row: any) => row.sourceKey)).size !== value.pending.length ||
    !value.pending.every((row: any) => value.knownKeys.includes(row.sourceKey)) || value.detailsCompleted + value.pending.length !== value.knownKeys.length) {
    throw new Error('Invalid full-scrape checkpoint. Start a new scrape.');
  }
  return structuredClone(value);
}
/** Immutable listing/detail deltas keep data durable; compact checkpoints resume without re-fetching completed details. */
export async function scrapeFull(browser: { captureUrl(url: string, pageNumber?: number): Promise<PageCapture> }, save: (document: any) => Promise<string>, resume?: unknown) {
  const now = () => new Date().toISOString();
  const state: Checkpoint = resume ? validateCheckpoint(expandCheckpoint(resume)) : { version: 1, kind: 'scrape', scope: 'all-current-public-opportunities', limited: false,
    capturedAt: now(), startedAt: now(), phase: 'listing', currentPage: 0, totalPages: null, listingCount: 0, detailsCompleted: 0,
    knownKeys: [], pending: [], failures: [], complete: false };
  state.failures = []; delete state.error;
  const known = new Set(state.knownKeys);
  let artifactId = '';
  const checkpoint = async () => { state.capturedAt = now(); state.listingCount = known.size; artifactId = await save(state); };
  const capture = async (url: string, pageNumber?: number) => {
    let failure: unknown;
    for (let attempt = 0; attempt < 2; attempt++) {
      try { return await browser.captureUrl(url, pageNumber); }
      catch (error) {
        failure = error;
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
      const page = await capture(LISTING_URL, number);
      const records = parseCapture(page, 'listing').document.records!;
      if (!page.pagination || page.pagination.currentPage !== number) throw new Error('The listing pager returned the wrong page.');
      if (!records.length && (number > 1 || page.pagination.hasNext)) throw new Error('An expected listing page was empty.');
      const additions = records.filter(row => !known.has(row.sourceKey));
      if (records.length && !additions.length) throw new Error('Listing pagination repeated an already captured page.');
      if (known.size + additions.length > 3000) throw new Error('Opportunity safety limit reached; crawl remains incomplete.');
      for (const row of additions) {
        if (!row.detailUrl || !row.processId) throw new Error('A listing has no detail address; crawl remains incomplete.');
      }
      await save({ version: 1, kind: 'listing', sourceUrl: page.url, capturedAt: page.capturedAt, currentPage: number, records });
      for (const row of additions) {
        known.add(row.sourceKey); state.knownKeys.push(row.sourceKey);
        state.pending.push({ sourceKey: row.sourceKey, processId: row.processId!, detailUrl: row.detailUrl! });
      }
      state.currentPage = number;
      if (!page.pagination.hasNext) { state.totalPages = number; state.phase = 'detail'; }
      await checkpoint();
    }
    const work = [...state.pending];
    for (const row of work) {
      try {
        const page = await capture(row.detailUrl);
        const doc = parseCapture(page, 'detail').document;
        if (doc.record!.processId !== row.processId) throw new Error('BC Bid returned a different opportunity than requested.');
        await save({ ...doc, sourceKey: row.sourceKey });
        state.pending = state.pending.filter(item => item.sourceKey !== row.sourceKey);
        state.detailsCompleted++;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        state.failures.push({ sourceKey: row.sourceKey, message });
        if (/manual|browser check|cancel|unavailable|budget|invalid.ticket/i.test(message)) throw error;
      }
      if (state.detailsCompleted % 10 === 0 || state.failures.length) await checkpoint();
      if (state.failures.length >= 5) throw new Error('Five detail pages failed. Saved progress; resume after checking the browser.');
    }
    if (state.pending.length) throw new Error(`${state.pending.length} detail pages remain incomplete. Resume to retry them.`);
    state.phase = 'complete'; state.complete = true;
    await checkpoint();
    return { artifactId, listingCount: known.size, detailCount: state.detailsCompleted, pageCount: state.currentPage + state.detailsCompleted,
      scope: state.scope, limited: false, totalPages: state.totalPages! };
  } catch (error) {
    state.error = error instanceof Error ? error.message : String(error);
    await checkpoint();
    throw error;
  }
}
