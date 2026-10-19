import * as cheerio from 'cheerio';
import { createHash } from 'node:crypto';
import reference from '../data/bc-bid-historical-types.json';
import { parseCapture, type PageCapture } from './capture';
import { parseTargetedListing, readFilterTags, type CaptureOptions } from './targeted-scrape';
import { LISTING_URL } from './scrape';
import { isPauseError, paused, ZoerPausedError } from './pause';
import { transientFailure } from './connectors/errors';
import type { ResumableRequest } from './collection-run';
import { BC_BID_DETAIL_TABS, DETAIL_CAPTURE_VERSION } from './detail-policy';
export const HISTORICAL_KEY = 'checkpoint:historical';
export const HISTORICAL_SCOPE = 'all-public-2015-2022';
export const HISTORICAL_DATE_FIELDS = { from: '#body_x_txtRfpBeginDate', to: '#body_x_txtRfpBeginDatemax' };
export interface HistoricalRange { from: string; to: string }
interface Pending { sourceKey: string; processId: string; detailUrl: string }
export interface HistoricalCheckpoint {
  version: 1; scope: typeof HISTORICAL_SCOPE; startedAt: string; capturedAt: string; runId: string;
  ranges: HistoricalRange[]; page: number; rangeCount: number; rangeExpected: number | null; lastSignature: string | null;
  pending: Pending[]; listingsCaptured: number; detailsCompleted: number; rangesCompleted: number; complete: boolean; status: string; error?: string; lastCaptureFinishedAt?: string;
}
type Host = (method: string, input: any) => Promise<any>;
const iso = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) && new Date(value + 'T00:00:00Z').toISOString().slice(0, 10) === value;
export function historicalRanges(): HistoricalRange[] {
  return Array.from({ length: 8 }, (_, i) => ({ from: i === 0 ? reference.from : `${2015 + i}-01-01`, to: i === 7 ? reference.to : `${2015 + i}-12-31` }));
}
export function splitHistoricalRange(range: HistoricalRange): HistoricalRange[] {
  const from = Date.parse(range.from + 'T00:00:00Z'), to = Date.parse(range.to + 'T00:00:00Z');
  if (from >= to) throw Error('A single historical day exceeds the safe paging range; coverage remains incomplete.');
  const mid = from + Math.floor((to - from) / 86400000 / 2) * 86400000;
  return [{ from: range.from, to: new Date(mid).toISOString().slice(0, 10) }, { from: new Date(mid + 86400000).toISOString().slice(0, 10), to: range.to }];
}
export function validateHistoricalCheckpoint(value: any): HistoricalCheckpoint {
  if (value?.version !== 1 || value.scope !== HISTORICAL_SCOPE || !Array.isArray(value.ranges) || value.ranges.length > 512 ||
    !value.ranges.every((r: any) => typeof r.from === 'string' && typeof r.to === 'string' && iso(r.from) && iso(r.to) && r.from >= reference.from && r.to <= reference.to && r.from <= r.to) ||
    value.ranges.some((r: any, i: number) => i && r.from <= value.ranges[i - 1].to) ||
    !Array.isArray(value.pending) || value.pending.length > 200 || !value.pending.every((r: any) => typeof r.sourceKey === 'string' && r.sourceKey.length < 1000 && /^\d+$/.test(r.processId) && /^https:\/\/bcbid\.gov\.bc\.ca\/page\.aspx\/en\/(rfp|bpm)\/process_manage_extranet\/\d+$/.test(r.detailUrl)) ||
    new Set(value.pending.map((r: any) => r.sourceKey)).size !== value.pending.length ||
    !['page', 'rangeCount', 'listingsCaptured', 'detailsCompleted', 'rangesCompleted'].every(k => Number.isInteger(value[k]) && value[k] >= 0) || value.page > 21 ||
    (value.rangeExpected !== null && (!Number.isInteger(value.rangeExpected) || value.rangeExpected < 0)) ||
    typeof value.runId !== 'string' || typeof value.startedAt !== 'string' || typeof value.status !== 'string' || typeof value.complete !== 'boolean' ||
    (value.lastSignature !== null && !/^[a-f0-9]{64}$/.test(value.lastSignature)) ||
    value.complete !== (!value.ranges.length && !value.pending.length) || Buffer.byteLength(JSON.stringify(value)) > 60000) throw Error('Invalid historical checkpoint. Saved coverage must be inspected before continuing.');
  return structuredClone(value);
}
/** Public portal scope: dates + Closed, with no type filter that could omit records lacking a notice type. */
export function verifyHistoricalFilters(html: string, range: HistoricalRange) {
  const tags = readFilterTags(html).filter(t => t.values.length);
  const one = (name: string, value: string) => tags.filter(t => t.label === name).length === 1 && tags.find(t => t.label === name)!.values.length === 1 && tags.find(t => t.label === name)!.values[0] === value;
  if (!one('Issue Date (min)', range.from) || !one('Issue Date (max)', range.to)) throw Error('BC Bid did not confirm both historical issue-date bounds. Nothing from this page was saved.');
  const status = tags.filter(t => t.label === 'Status');
  if (status.length !== 1 || !status[0].values.includes('Closed') || status[0].values.some(v => !['Closed', 'Open'].includes(v)) ||
    tags.some(t => !['Status', 'Issue Date (min)', 'Issue Date (max)'].includes(t.label))) throw Error('BC Bid historical search has an unconfirmed or extra filter. Coverage remains incomplete.');
}
export function historicalReferenceRecords() {
  return [{ id: reference.id, kind: 'reference-release', title: 'BC Bid historical opportunity types', data: reference }, ...reference.types.map(t => ({
    id: `reference-term:BCBID:historical-type:${t.code}`, kind: 'reference-term', title: t.title,
    data: { schemaVersion: 1, scheme: 'BCBID-historical-type', releaseId: reference.id, ...t, from: reference.from, to: reference.to, sourceUrl: reference.sourceUrl, capturedAt: reference.capturedAt },
  }))];
}
/** Exact source codes, without inventing a GSIN hierarchy or mapping old types onto modern ones. */
export function historicalDetailMetadata(page: PageCapture, record: any) {
  const type = record.detailFields.find((f: any) => f.label === 'Notice Type')?.value?.trim() || null;
  const known = reference.types.filter(t => t.title === type);
  const $ = cheerio.load(page.html), raw = $('[id$="_txtBpmNeed"]').first().text().trim();
  const gsin = raw.split(/\r?\n/).filter(Boolean).map(line => {
    const match = line.trim().match(/^([A-Za-z0-9]{2,12})\s*-\s*(.+)$/);
    return { rawLabel: line.trim(), code: match?.[1] ?? null, title: match?.[2] ?? null };
  });
  const references: { id: string; kind: string; title: string; data: Record<string, unknown> }[] = gsin.flatMap(item => item.code && item.title ? [{
    id: `reference-term:GSIN:observed:${item.code}:${createHash('sha256').update(item.title).digest('hex').slice(0, 16)}`,
    kind: 'reference-term', title: item.title,
    data: { schemaVersion: 1, scheme: 'GSIN', code: item.code, title: item.title, parentId: null, hierarchyStatus: 'not-provided-by-source', coverage: 'observed-public-label', sourceUrl: reference.sourceUrl },
  }] : []);
  const typeId = known.length === 1 ? `reference-term:BCBID:historical-type:${known[0].code}` : type ? `reference-term:BCBID:historical-type:observed:${createHash('sha256').update(type).digest('hex').slice(0, 16)}` : null;
  if (type && !known.length) references.push({ id: typeId!, kind: 'reference-term', title: type, data: { schemaVersion: 1, scheme: 'BCBID-historical-type', code: null, title: type, parentId: null, hierarchyStatus: 'not-provided-by-source', coverage: 'observed-public-label', sourceUrl: reference.sourceUrl } });
  return { metadata: { commodityScheme: 'GSIN', historicalNoticeType: type, historicalTypeCode: known.length === 1 ? known[0].code : null,
    historicalTypeReferenceId: typeId,
    historicalTypeResolution: known.length === 1 ? 'exact-source-title' : type ? 'unlisted-source-title' : 'not-published',
    gsinRaw: raw, gsinCommodities: gsin, gsinTermIds: references.map(t => t.id) }, references };
}
const digest = (records: any[]) => createHash('sha256').update(records.map(r => r.sourceKey).join('|')).digest('hex');
async function commitProgress(host: Host, cp: HistoricalCheckpoint, records: any[] = []) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const head = await host('catalog.read', { ids: [] });
    if (!head.primary) throw Error('Use the existing primary procurement database before importing history.');
    const committed = await host('catalog.commit', { revision: head.revision, records, entries: [{ key: HISTORICAL_KEY, value: cp }] });
    if (!committed.conflict) return;
  }
  throw Error('Historical checkpoint changed concurrently; retry safely.');
}
/** Each slice saves one listing page or at most two details. Catalog progress wins over replayed host checkpoints. */
export async function historicalSlice(host: Host, capture: (options: CaptureOptions) => Promise<PageCapture>, save: (doc: any) => Promise<string>, input: any, runId: string, resumable: ResumableRequest, options: { delaySeconds?: number; paused?: () => boolean } = {}) {
  if (input?.scope !== HISTORICAL_SCOPE || Object.keys(input).some(k => k !== 'scope')) throw Error('Choose the complete public historical scope.');
  const saved = (await host('catalog.workspace', { keys: [HISTORICAL_KEY] })).entries.find((e: any) => e.key === HISTORICAL_KEY)?.value;
  const now = () => new Date().toISOString();
  const cp: HistoricalCheckpoint = saved ? validateHistoricalCheckpoint(saved) : resumable.checkpoint ? validateHistoricalCheckpoint(resumable.checkpoint) : {
    version: 1, scope: HISTORICAL_SCOPE, startedAt: now(), capturedAt: now(), runId, ranges: historicalRanges(), page: 1, rangeCount: 0, rangeExpected: null,
    lastSignature: null, pending: [], listingsCaptured: 0, detailsCompleted: 0, rangesCompleted: 0, complete: false, status: 'running',
  };
  cp.runId = runId; cp.status = cp.complete ? 'complete' : 'running'; delete cp.error;
  const before = structuredClone(cp);
  // Preserve the operator's pacing across fresh workers, as well as within each slice.
  let firstCapture = true;
  const pacedCapture = async (request: CaptureOptions) => {
    if (firstCapture && cp.lastCaptureFinishedAt) {
      const until = Date.parse(cp.lastCaptureFinishedAt) + (options.delaySeconds ?? 30) * 1000;
      while (Date.now() < until) {
        if (options.paused?.()) throw new ZoerPausedError();
        await new Promise(resolve => setTimeout(resolve, Math.min(1000, until - Date.now())));
      }
    }
    firstCapture = false;
    const result = await capture(request); cp.lastCaptureFinishedAt = now(); return result;
  };
  const progress = () => ({ phase: cp.pending.length ? 'Historical details' : 'Historical listings', done: cp.detailsCompleted, unit: 'rows' as const,
    message: `${cp.listingsCaptured} listings · ${cp.detailsCompleted} details · ${cp.rangesCompleted} ranges complete · ${cp.ranges.length} remaining` });
  const finishRange = () => {
    if (cp.rangeExpected !== null && cp.rangeCount !== cp.rangeExpected) throw Error('Historical pager count does not match BC Bid’s reported total. Coverage remains incomplete.');
    cp.ranges.shift(); cp.rangesCompleted++; cp.rangeCount = 0; cp.rangeExpected = null; cp.page = 1; cp.lastSignature = null;
    cp.complete = !cp.ranges.length; cp.status = cp.complete ? 'complete' : 'running';
  };
  const flush = async () => { cp.capturedAt = now(); validateHistoricalCheckpoint(cp); await commitProgress(host, cp); };
  try {
    if (resumable.cancelling) { cp.status = 'paused'; await flush(); return { resumable: 'done', output: { status: 'cancelled', listingsCaptured: cp.listingsCaptured, detailsCompleted: cp.detailsCompleted } }; }
    if (!saved) await commitProgress(host, cp, historicalReferenceRecords());
    if (cp.complete) return { resumable: 'done', output: cp, progress: progress() };
    if (cp.pending.length) {
      for (let i = 0; i < 2 && cp.pending.length; i++) {
        const row = cp.pending[0], page = await pacedCapture({ url: row.detailUrl, readTabs: BC_BID_DETAIL_TABS });
        const doc = parseCapture(page, 'detail').document;
        if (doc.record!.processId !== row.processId) throw Error('BC Bid returned a different historical opportunity.');
        const type = doc.record!.detailFields.find((f: any) => f.label === 'Opportunity Type')?.value;
        if (!/^Historic Record/i.test(type || '')) throw Error('The requested historical detail is not identified as a historic record.');
        const info = historicalDetailMetadata(page, doc.record);
        cp.pending.shift(); cp.detailsCompleted++; cp.capturedAt = now();
        await save({ ...doc, scope: 'bcbid-historical', sourceKey: row.sourceKey, detailCaptureVersion: DETAIL_CAPTURE_VERSION, record: { ...doc.record, ...info.metadata }, historicalReferences: info.references, historicalCheckpoint: cp });
      }
      // page=0 denotes a verified final listing page waiting for its detail queue.
      if (!cp.pending.length && cp.page === 0) { finishRange(); await flush(); }
    } else {
      if (cp.page === 0) { finishRange(); await flush(); }
      else {
        const range = cp.ranges[0];
        if (cp.page > 20) throw Error('Historical page safety limit reached; coverage remains incomplete.');
        const page = await pacedCapture({ url: LISTING_URL, pageNumber: cp.page, applySearch: true,
          searchFields: [{ selector: HISTORICAL_DATE_FIELDS.from, value: range.from }, { selector: HISTORICAL_DATE_FIELDS.to, value: range.to }],
          pickFields: [{ selector: '#body_x_selSrfxCode_search', value: 'Closed' }] });
        verifyHistoricalFilters(page.html, range);
        const parsed = parseTargetedListing(page), rows = parsed.records;
        const expected = /More than\s*[\d,]+\s*Record\(s\)/i.test(page.html) ? null : parsed.totalReported;
        if (cp.page === 1 && range.from < range.to && (expected === null || expected > 300)) {
          cp.ranges.splice(0, 1, ...splitHistoricalRange(range)); cp.rangeCount = 0; cp.rangeExpected = null; cp.lastSignature = null; await flush();
        } else {
          if (rows.length && (!page.pagination || page.pagination.currentPage !== cp.page)) throw Error('Historical listing pager returned the wrong page.');
          if (!rows.length && (expected !== 0 || cp.page !== 1 || page.pagination?.hasNext)) throw Error('An expected historical page was empty.');
          if (cp.page === 1) cp.rangeExpected = expected;
          if (cp.rangeExpected !== null && expected !== cp.rangeExpected) throw Error('Historical source total changed mid-range; resume after inspecting coverage.');
          if (rows.some(r => r.status !== 'Closed' || !/^Historic Record/i.test(r.type || '') || !r.issueDate || r.issueDate.slice(0, 10) < range.from || r.issueDate.slice(0, 10) > range.to || !r.processId || !r.detailUrl)) throw Error('A historical row falls outside the confirmed archive scope. Nothing from this page was saved.');
          const signature = digest(rows);
          if (rows.length && signature === cp.lastSignature) throw Error('Historical listing repeated the previous page.');
          if (page.pagination?.hasNext && cp.page === 20) throw Error('Historical range exceeds safe paging; coverage remains incomplete.');
          const number = cp.page;
          cp.lastSignature = signature; cp.rangeCount += rows.length; cp.listingsCaptured += rows.length;
          cp.pending = rows.map(r => ({ sourceKey: r.sourceKey, processId: r.processId!, detailUrl: r.detailUrl! }));
          cp.page = page.pagination?.hasNext ? number + 1 : 0; cp.capturedAt = now();
          if (!rows.length) finishRange();
          validateHistoricalCheckpoint(cp);
          await save({ version: 1, kind: 'listing', scope: 'bcbid-historical', sourceUrl: page.url, capturedAt: page.capturedAt, currentPage: number,
            records: rows.map(r => ({ ...r, commodityScheme: 'GSIN', historical: { from: reference.from, to: reference.to, capturedRange: range, referenceReleaseId: reference.id } })), historicalCheckpoint: cp });
        }
      }
    }
    return cp.complete ? { resumable: 'done', output: cp, progress: progress() } : { resumable: 'continue', checkpoint: cp, progress: progress() };
  } catch (error) {
    if (isPauseError(error)) return paused(before);
    const message = error instanceof Error ? error.message : String(error);
    if (/browser check|manual control|manual mode|verification|captcha/i.test(message)) return { resumable: 'needs-user', checkpoint: before, reason: message.slice(0, 500) };
    // The native transport redacts locator timeout details. A public search
    // readiness failure can replay from the committed cursor under the host's
    // bounded retry policy; other control/schema failures still stop the run.
    if (!before.pending.length && /^Native browser waitFor failed \(400\)\.$/.test(message)) return {
      resumable: 'retry', checkpoint: before,
      error: { code: 'historical_search_not_ready', message: 'The public historical search control did not become ready. Saved progress is preserved.' },
    };
    const transient = transientFailure(error);
    if (transient) return { resumable: 'retry', checkpoint: before, error: { code: transient.code, message: transient.message }, ...(transient.retryAfterMs !== undefined ? { retryAfterMs: transient.retryAfterMs } : {}) };
    // Persist status only from the latest committed cursor, never an unsaved mutated page.
    const latest = (await host('catalog.workspace', { keys: [HISTORICAL_KEY] })).entries.find((e: any) => e.key === HISTORICAL_KEY)?.value;
    if (latest) await commitProgress(host, { ...validateHistoricalCheckpoint(latest), status: 'failed', error: message, capturedAt: now() });
    throw error;
  }
}
