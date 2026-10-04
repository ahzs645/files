import * as cheerio from 'cheerio';
import { parseCapture, type PageCapture } from './capture';
import { isPauseError, paused } from './pause';
import { LISTING_URL } from './scrape';

/**
 * BC Bid targeted refresh: one buyer, region or keyword search instead of a full crawl.
 *
 * Selectors come from the old sbcontest scraper and this repo's earlier Playwright scraper (BC Bid's
 * Ivalua form). They were not re-observed for this change: BC Bid's browser check blocked a plain
 * Playwright probe on 2026-10-03. Every result page is therefore checked against BC Bid's own filter
 * summary, and anything unconfirmed aborts before saving.
 */
export const TARGETED_SCOPE = 'bcbid-targeted';
export const TARGETED_RECEIPT_KEY = 'checkpoint:targeted';
export const TARGETED_MAX_PAGES = 20;
/** Details are the expensive part (one capture plus three tabs each); a buyer refresh stays small. */
export const TARGETED_MAX_DETAILS = 40;
export const TARGET_FIELDS = {
  keyword: '#body_x_txtQuery',
  // Tag pickers: type into the search box, choose the matching suggestion. Needs Zoer `pickFields` (see report).
  organization: '#body_x_selBpmIdOrgaLevelOrgaNode_search',
  region: '#body_x_selRfpIdAreaLevelAreaNode_search',
} as const;
const DETAIL_TABS = ['Opportunity Details', 'Addenda', 'Interested Supplier List'];
const STOP = /manual|browser check|cancel|unavailable|budget|invalid.ticket/i;

export type FilterKind = 'organization' | 'region' | 'keyword';
export interface TargetedFilters { organization?: string; region?: string; keyword?: string }
export interface TargetedOptions extends TargetedFilters { maxPages: number; details: boolean }
export interface CaptureOptions {
  url: string; pageNumber?: number; continuePage?: number; applySearch?: boolean; readTabs?: string[];
  searchFields?: { selector: string; value: string }[];
  /** Proposed Zoer option; hosts that predate it ignore it and the filter check then fails closed. */
  pickFields?: { selector: string; value: string }[];
}
interface PendingDetail { sourceKey: string; processId: string; detailUrl: string }
export interface TargetedCheckpoint {
  version: 1; kind: 'targeted'; filters: TargetedFilters; phase: 'listing' | 'detail'; startedAt: string; runId?: string;
  pages: number; totalPages: number | null; totalReported: number | null; truncated: boolean;
  listingCount: number; newCount: number; changedCount: number; detailsCompleted: number; detailsSkipped: number;
  pending: PendingDetail[]; failures: { sourceKey: string; message: string }[]; confirmed: Partial<Record<FilterKind, string>>;
}
export interface TargetedReceipt {
  version: 1; status: 'complete' | 'failed'; runId?: string; filters: TargetedFilters; confirmed: Partial<Record<FilterKind, string>>;
  pages: number; totalPages: number | null; totalReported: number | null; truncated: boolean;
  listingCount: number; newCount: number; changedCount: number; detailsCompleted: number; detailsSkipped: number; detailFailures: number;
  filtersCleared: boolean | null; startedAt: string; finishedAt: string; error?: string;
}

const LABELS: Record<FilterKind, string> = { organization: 'buyer', region: 'region', keyword: 'keyword' };
// Filter summary labels BC Bid may use. Unknown labels are not guessed into a kind.
const LABEL_KIND: [FilterKind, RegExp][] = [
  ['organization', /organi[sz]ation|issued by|buyer/i],
  ['region', /\bregion|\barea\b|location/i],
  ['keyword', /keyword|search text/i],
];
const clean = (value: string) => value.replace(/\s+/g, ' ').trim();
/** Case- and spacing-insensitive comparison; BC Bid names are otherwise matched exactly. */
export const sameName = (a: string, b: string) => clean(a).toLowerCase() === clean(b).toLowerCase();

export function validateTargetedInput(input: any): TargetedOptions {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Choose a buyer, region or keyword.');
  const out: TargetedOptions = { maxPages: 5, details: true };
  for (const kind of ['organization', 'region', 'keyword'] as const) {
    const value = input[kind];
    if (value === undefined || value === null || value === '') continue;
    if (typeof value !== 'string' || value.length > 200 || /[\u0000-\u001f\u007f]/.test(value) || !clean(value)) throw new Error(`Invalid ${LABELS[kind]}.`);
    out[kind] = clean(value);
  }
  if (!out.organization && !out.region && !out.keyword) throw new Error('Choose a buyer, region or keyword.');
  if (input.maxPages !== undefined) {
    if (!Number.isInteger(input.maxPages) || input.maxPages < 1 || input.maxPages > TARGETED_MAX_PAGES) throw new Error(`Pages must be 1-${TARGETED_MAX_PAGES}.`);
    out.maxPages = input.maxPages;
  }
  if (input.details !== undefined) {
    if (typeof input.details !== 'boolean') throw new Error('Invalid details option.');
    out.details = input.details;
  }
  return out;
}
const filtersOf = (options: TargetedFilters): TargetedFilters => Object.fromEntries((['organization', 'region', 'keyword'] as const).filter(kind => options[kind]).map(kind => [kind, options[kind]]));

/** Active filters from BC Bid's summary (`.tag-label` followed by a list of `.tag-text` values). */
export function readFilterTags(html: string) {
  const $ = cheerio.load(html);
  return $('.tag-label').toArray().map(node => {
    const label = clean($(node).text()).replace(/\s*:$/, '');
    let list = $(node).next('ul');
    if (!list.length) list = $(node).next().find('ul').first();
    const text = list.find('.tag-text').toArray().map(item => clean($(item).text()));
    const values = (text.length ? text : list.find('li.tag-value').toArray().map(item => clean($(item).text()))).filter(Boolean);
    return { label, values, kind: LABEL_KIND.find(([, pattern]) => pattern.test(label))?.[0] };
  });
}
/** Buyer, region or keyword filters still active on a listing page. A full crawl must not run under them. */
export function activeTargetFilters(html: string) {
  return readFilterTags(html).filter(tag => tag.kind && tag.values.length);
}

/**
 * Proves BC Bid applied exactly the requested filters, as the old scraper did with its summary tags.
 * A filter we did not ask for (left from an earlier search) is also a failure: results would be narrower than stated.
 * A keyword BC Bid does not echo as a tag is accepted on Zoer's own check that the keyword box kept the value.
 */
export function verifyTargetedFilters(html: string, filters: TargetedFilters) {
  const tags = readFilterTags(html);
  const confirmed: Partial<Record<FilterKind, string>> = {};
  for (const kind of ['organization', 'region', 'keyword'] as const) {
    const values = tags.filter(tag => tag.kind === kind).flatMap(tag => tag.values);
    const wanted = filters[kind];
    if (!wanted) {
      if (values.length) throw new Error(`BC Bid still has a ${LABELS[kind]} filter (${values.join(', ')}) that was not requested. Nothing was saved from this search.`);
      continue;
    }
    if (!values.length && kind === 'keyword') { confirmed.keyword = wanted; continue; }
    if (!values.length) throw new Error(`BC Bid did not confirm the ${LABELS[kind]} filter "${wanted}". Nothing was saved from this search. This Zoer version may not support choosing a BC Bid ${LABELS[kind]} yet.`);
    if (values.length !== 1 || !sameName(values[0]!, wanted)) throw new Error(`BC Bid shows the ${LABELS[kind]} filter as "${values.join(', ')}", not "${wanted}". Nothing was saved from this search; choose the name exactly as BC Bid lists it.`);
    confirmed[kind] = values[0];
  }
  return confirmed;
}

/** Listing rows, allowing BC Bid's "0 Record(s)" page that has no grid table at all. */
export function parseTargetedListing(page: PageCapture) {
  const totalReported = Number(page.html.match(/(\d[\d,]*)\s*Record\(s\)/)?.[1]?.replace(/,/g, '') ?? NaN);
  try {
    return { records: parseCapture(page, 'listing').document.records!, totalReported: Number.isFinite(totalReported) ? totalReported : null };
  } catch (error) {
    if (totalReported === 0 && /grid is not loaded/.test(String(error))) return { records: [], totalReported: 0 };
    throw error;
  }
}

/** A detail is fetched for a new notice, one never detailed, or one whose listing shows a change. */
export function needsDetail(saved: any, row: any) {
  if (!saved) return 'new';
  if (!saved.detailFields?.length) return 'changed';
  return ['amendments', 'lastUpdated', 'closingDate', 'description'].some(key => (saved[key] ?? null) !== (row[key] ?? null)) ? 'changed' : null;
}

export function validateTargetedCheckpoint(value: any, filters: TargetedFilters): TargetedCheckpoint | undefined {
  const key = (item: unknown) => typeof item === 'string' && item.length > 0 && item.length < 1000;
  if (value?.version !== 1 || value?.kind !== 'targeted' || value.phase !== 'detail' || !Array.isArray(value.pending) || value.pending.length > TARGETED_MAX_DETAILS
    || !value.pending.every((row: any) => key(row.sourceKey) && key(row.processId) && /^https:\/\/bcbid\.gov\.bc\.ca\/page\.aspx\/en\/(rfp|bpm)\/process_manage_extranet\/\d+$/.test(row.detailUrl))
    || JSON.stringify(filtersOf(value.filters ?? {})) !== JSON.stringify(filtersOf(filters))) return undefined;
  return structuredClone(value);
}

export interface TargetedStore {
  save(document: any): Promise<string>;
  /** Saved opportunity data by sourceKey, read before this run's listing merge. */
  existing(sourceKeys: string[]): Promise<Map<string, any>>;
  receipt(value: TargetedReceipt): Promise<void>;
}

/**
 * Applies the search on page 1, then follows BC Bid's persisted pager. BC Bid keeps the search in the browser
 * session, so the run clears it at the end; otherwise a later full crawl would silently see only this buyer.
 */
export async function scrapeTargeted(browser: { capture(options: CaptureOptions): Promise<PageCapture> }, store: TargetedStore, input: unknown,
  options: { runId?: string; resume?: unknown } = {}) {
  const settings = validateTargetedInput(input);
  const filters = filtersOf(settings);
  const now = () => new Date().toISOString();
  const resumed = options.resume ? validateTargetedCheckpoint(options.resume, filters) : undefined;
  const state: TargetedCheckpoint = resumed ?? { version: 1, kind: 'targeted', filters, phase: 'listing', startedAt: now(), pages: 0, totalPages: null,
    totalReported: null, truncated: false, listingCount: 0, newCount: 0, changedCount: 0, detailsCompleted: 0, detailsSkipped: 0, pending: [], failures: [], confirmed: {} };
  if (options.runId) state.runId = options.runId;
  const searchFields = [{ selector: TARGET_FIELDS.keyword, value: filters.keyword ?? '' }];
  const pickFields = (['organization', 'region'] as const).filter(kind => filters[kind]).map(kind => ({ selector: TARGET_FIELDS[kind], value: filters[kind]! }));
  const capture = async (request: CaptureOptions) => {
    let failure: unknown;
    for (let attempt = 0; attempt < 2; attempt++) {
      try { return await browser.capture(request); }
      catch (error) { failure = error; if (isPauseError(error) || STOP.test(String(error))) throw error; }
    }
    throw failure;
  };
  let filtersCleared: boolean | null = null;
  const clearSearch = async () => {
    // Reset plus an empty keyword search restores BC Bid's default listing for later crawls.
    const page = await capture({ url: LISTING_URL, pageNumber: 1, applySearch: true, searchFields: [{ selector: TARGET_FIELDS.keyword, value: '' }] });
    parseTargetedListing(page);
    filtersCleared = activeTargetFilters(page.html).length === 0;
  };
  const receipt = (status: TargetedReceipt['status'], error?: string): TargetedReceipt => ({ version: 1, status, runId: options.runId, filters, confirmed: state.confirmed,
    pages: state.pages, totalPages: state.totalPages, totalReported: state.totalReported, truncated: state.truncated, listingCount: state.listingCount,
    newCount: state.newCount, changedCount: state.changedCount, detailsCompleted: state.detailsCompleted, detailsSkipped: state.detailsSkipped,
    detailFailures: state.failures.length, filtersCleared, startedAt: state.startedAt, finishedAt: now(), ...(error ? { error } : {}) });
  let artifactId = '';
  try {
    if (!resumed) {
      const known = new Set<string>();
      const wanted: PendingDetail[] = [];
      for (let number = 1; number <= settings.maxPages; number++) {
        const page = await capture(number === 1
          ? { url: LISTING_URL, pageNumber: 1, applySearch: true, searchFields, ...(pickFields.length ? { pickFields } : {}) }
          : { url: LISTING_URL, continuePage: number, searchFields });
        const { records, totalReported } = parseTargetedListing(page);
        // Checked on every page: BC Bid keeps the search in its session and a reset there would widen later pages.
        const confirmed = verifyTargetedFilters(page.html, filters);
        if (number === 1) { state.confirmed = confirmed; state.totalReported = totalReported; }
        if (records.length && (!page.pagination || page.pagination.currentPage !== number)) throw new Error('The listing pager returned the wrong page.');
        if (filters.organization && records.length && !records.some(row => [row.issuedBy, row.issuedFor].some(name => name && sameName(name, filters.organization!)))) {
          throw new Error(`None of BC Bid's results name "${filters.organization}" as the buyer, so the filter is not trusted. Nothing was saved from this page.`);
        }
        const additions = records.filter(row => !known.has(row.sourceKey));
        if (records.length && !additions.length) throw new Error('Listing pagination repeated an already captured page.');
        const saved = additions.length ? await store.existing(additions.map(row => row.sourceKey)) : new Map();
        if (records.length) artifactId = await store.save({ version: 1, kind: 'listing', scope: TARGETED_SCOPE, filters, sourceUrl: page.url, capturedAt: page.capturedAt, currentPage: number, records });
        for (const row of additions) {
          known.add(row.sourceKey);
          const reason = needsDetail(saved.get(row.sourceKey), row);
          if (reason === 'new') state.newCount++;
          if (reason === 'changed') state.changedCount++;
          if (reason && row.detailUrl && row.processId) wanted.push({ sourceKey: row.sourceKey, processId: row.processId, detailUrl: row.detailUrl });
        }
        state.pages = number; state.listingCount = known.size;
        if (!records.length || !page.pagination?.hasNext) { state.totalPages = number; break; }
        if (number === settings.maxPages) state.truncated = true;
      }
      if (settings.details) { state.pending = wanted.slice(0, TARGETED_MAX_DETAILS); state.detailsSkipped = wanted.length - state.pending.length; }
      else state.detailsSkipped = wanted.length;
      state.phase = 'detail';
    }
    for (const row of [...state.pending]) {
      try {
        const page = await capture({ url: row.detailUrl, readTabs: DETAIL_TABS });
        const doc = parseCapture(page, 'detail').document;
        if (doc.record!.processId !== row.processId) throw new Error('BC Bid returned a different opportunity than requested.');
        artifactId = await store.save({ ...doc, scope: TARGETED_SCOPE, sourceKey: row.sourceKey });
        state.detailsCompleted++;
      } catch (error) {
        if (isPauseError(error)) throw error;
        const message = error instanceof Error ? error.message : String(error);
        state.failures.push({ sourceKey: row.sourceKey, message });
        if (STOP.test(message)) throw error;
        if (state.failures.length >= 3) throw new Error('Three detail pages failed. Listings were saved; run the refresh again after checking the browser.');
      }
      state.pending = state.pending.filter(item => item.sourceKey !== row.sourceKey);
    }
    try { await clearSearch(); } catch (error) { if (isPauseError(error)) throw error; filtersCleared = false; }
    artifactId = await store.save({ version: 1, kind: 'scrape', scope: TARGETED_SCOPE, limited: true, complete: true, filters, records: [], capturedAt: now(),
      currentPage: state.pages, totalPages: state.totalPages, listingCount: state.listingCount, detailsCompleted: state.detailsCompleted, failures: state.failures });
    const done = receipt('complete');
    await store.receipt(done);
    return { artifactId, scope: TARGETED_SCOPE, limited: true, filters, confirmed: state.confirmed, pageCount: state.pages, totalPages: state.totalPages,
      totalReported: state.totalReported, truncated: state.truncated, listingCount: state.listingCount, newCount: state.newCount, changedCount: state.changedCount,
      detailCount: state.detailsCompleted, detailsSkipped: state.detailsSkipped, detailFailures: state.failures.length, filtersCleared: done.filtersCleared };
  } catch (error) {
    // Zoer is updating: browser work is refused, so the search stays in BC Bid until the resumed run clears it.
    // An unfinished listing restarts from page 1 (merges are idempotent); details continue from what is left.
    if (isPauseError(error)) return paused(state.phase === 'detail' ? state : null);
    const message = error instanceof Error ? error.message : String(error);
    if (filtersCleared === null && !STOP.test(message)) { try { await clearSearch(); } catch { filtersCleared = false; } }
    try { await store.receipt(receipt('failed', message)); } catch { /* the run error below is the record */ }
    throw error;
  }
}

/** The receipt is a workspace entry beside `checkpoint:full`, written directly so listing merges stay untouched. */
export async function writeTargetedReceipt(call: (method: string, input: any) => Promise<any>, value: TargetedReceipt) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const head = await call('catalog.read', { ids: [] });
    const committed = await call('catalog.commit', { revision: head.revision, entries: [{ key: TARGETED_RECEIPT_KEY, value }] });
    if (!committed.conflict) return;
  }
  throw new Error('Could not save the targeted refresh receipt.');
}
