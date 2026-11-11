import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { historicalRanges, splitHistoricalRange, verifyHistoricalFilters, historicalDetailMetadata, historicalSlice, HISTORICAL_KEY, HISTORICAL_SCOPE, validateHistoricalCheckpoint } from '../zoer/src/historical-scrape';
import { parseCapture } from '../zoer/src/capture';
import { saveCatalogDocument } from '../zoer/src/catalog';
import { classifyCatalogRecords } from '../zoer/src/taxonomy';
import { activeTargetFilters } from '../zoer/src/targeted-scrape';
import { LISTING_URL } from '../zoer/src/scrape';
const fixture = (name: string) => readFileSync(new URL('./fixtures/historical/' + name, import.meta.url), 'utf8');
const range = { from: '2015-04-01', to: '2015-12-31' };
const summary = (from = range.from, to = range.to) => `<div class="tag-label">Status :</div><ul><li class="tag-text">Closed</li><li class="tag-text">Open</li></ul><div class="tag-label">Issue Date (min) :</div><ul><li class="tag-text">${from}</li></ul><div class="tag-label">Issue Date (max) :</div><ul><li class="tag-text">${to}</li></ul>`;
const sourcePage = (html = fixture('listing-2015.html')) => ({ url: LISTING_URL, html: html.replace('>2015-12-31<', '>2016-01-01<'), title: 'BC Bid', capturedAt: '2026-10-10T17:50:00Z', pagination: { currentPage: 1, hasNext: false, visiblePages: [1] } });
function database() {
  const records = new Map<string, any>(), entries = new Map<string, any>(); let revision = 0;
  const host = async (method: string, input: any): Promise<any> => {
    if (method === 'catalog.read') {
      const rows = [...records.values()].filter(r => input.ids ? input.ids.includes(r.id) : input.match ?
        r.kind === input.match.kind && r.data[input.match.field] === input.match.value :
        r.kind === input.kind && r.id > (input.after ?? '')).sort((a,b) => a.id.localeCompare(b.id)).slice(0, input.limit ?? 200);
      return { primary: true, revision, records: structuredClone(rows), next: input.kind ? rows.at(-1)?.id : null };
    }
    if (method === 'catalog.workspace') return { revision, entries: input.keys.filter((k: string) => entries.has(k)).map((k: string) => ({ key: k, value: structuredClone(entries.get(k)) })) };
    if (method === 'catalog.commit') {
      if (input.revision !== revision) return { conflict: true };
      expect((input.records || []).length).toBeLessThanOrEqual(200);
      for (const r of input.records || []) records.set(r.id, JSON.parse(JSON.stringify(r)));
      for (const e of input.entries || []) entries.set(e.key, structuredClone(e.value));
      return { revision: ++revision };
    }
    throw Error(method);
  };
  return { records, entries, host, save: (doc: any) => saveCatalogDocument(host, doc, 'r') };
}
const resumeRequest = (checkpoint: any = null) => ({ step: 1, checkpoint, attempt: 0, deadlineAt: new Date(Date.now() + 600000).toISOString() });
const cp = () => ({ version: 1, scope: HISTORICAL_SCOPE, dateFilter: 'exclusive-upper-bound', runId: 'r', startedAt: '2026-10-10T00:00:00Z', capturedAt: '2026-10-10T00:00:00Z', ranges: [range], page: 1, rangeCount: 0, rangeExpected: null, lastSignature: null, pending: [], listingsCaptured: 0, detailsCompleted: 0, rangesCompleted: 0, complete: false, status: 'running' });
const run = (db: ReturnType<typeof database>, capture: any, checkpoint: any = null) => historicalSlice(db.host, capture, db.save, { scope: HISTORICAL_SCOPE }, 'r', resumeRequest(checkpoint), { delaySeconds: 0 });
describe('public BC Bid historical archive', () => {
  it('covers exactly the official dates, with split ranges retaining every inclusive day once', () => {
    const ranges = historicalRanges(); expect(ranges[0].from).toBe('2015-04-01'); expect(ranges.at(-1)?.to).toBe('2022-12-15');
    for (let i = 1; i < ranges.length; i++) expect(Date.parse(ranges[i].from) - Date.parse(ranges[i - 1].to)).toBe(86400000);
    const split = splitHistoricalRange(range); expect(split[0].from).toBe(range.from); expect(split[1].to).toBe(range.to); expect(Date.parse(split[1].from) - Date.parse(split[0].to)).toBe(86400000);
    expect(() => splitHistoricalRange({ from: range.from, to: range.from })).toThrow('single historical day');
  });
  it('requires exact dates and Closed, rejects extra filters, and protects the current crawl from archive cookies', () => {
    verifyHistoricalFilters(summary(), range);
    expect(() => verifyHistoricalFilters(summary('2015-03-31'), range)).toThrow('bounds');
    expect(() => verifyHistoricalFilters(summary() + '<div class="tag-label">Opportunity Type on Historical Records :</div><ul><li class="tag-text">Invitation to Bid</li></ul>', range)).toThrow('extra filter');
    expect(activeTargetFilters(summary()).map(t => t.label)).toEqual(['Status', 'Issue Date (min)', 'Issue Date (max)']);
  });
  it('parses the real historical detail, shares ITB and GSIN references without guessing a hierarchy', () => {
    const page = { ...sourcePage(fixture('detail-60536.html')), url: 'https://bcbid.gov.bc.ca/page.aspx/en/bpm/process_manage_extranet/60536' };
    const doc = parseCapture(page, 'detail').document;
    const info = historicalDetailMetadata(page, doc.record);
    expect(info.metadata).toMatchObject({ historicalTypeCode: 'ITB', historicalNoticeType: 'Invitation to Bid', commodityScheme: 'GSIN', gsinCommodities: [{ code: '62', title: 'Lighting Fixtures and Lamps' }, { code: 'BA15', title: 'Lighting Services - Buildings' }] });
    expect(info.references).toHaveLength(2); expect(info.references.every(r => r.data.parentId === null && r.data.hierarchyStatus === 'not-provided-by-source')).toBe(true);
  });
  it('splits a lower-bound count rather than treating “More than 150” as a complete count', async () => {
    const db = database(); db.entries.set(HISTORICAL_KEY, cp()); let options: any;
    const output: any = await run(db, async (o: any) => { options = o; return sourcePage(); });
    expect(output.resumable).toBe('continue'); expect(output.checkpoint.ranges).toEqual(splitHistoricalRange(range)); expect(db.records.size).toBe(0);
    expect(options.pickFields).toEqual([{ selector: '#body_x_selSrfxCode_search', value: 'Closed' }]); expect(options.applySearch).toBe(true);
    expect(options.searchFields.map((field: any) => field.value)).toEqual(['2015-04-01', '2016-01-01']);
  });
  it('retains pending details and reopens only the proved earlier range ends', async () => {
    const db = database();
    const current = { from: '2015-04-10', to: '2015-04-14' };
    const earlier = { from: range.from, to: '2015-04-09' };
    const pending = [{ sourceKey: '2', processId: '2', detailUrl: 'https://bcbid.gov.bc.ca/page.aspx/en/bpm/process_manage_extranet/2' }];
    const old = { ...cp(), dateFilter: undefined, ranges: [current], page: 2,
      pending, listingsCaptured: 11, detailsCompleted: 10, rangeCount: 2, rangesCompleted: 1 };
    db.entries.set(HISTORICAL_KEY, old);
    db.records.set('opportunity:1', { id: 'opportunity:1', kind: 'opportunity', data: {
      commodityScheme: 'GSIN', historical: { from: range.from, to: '2022-12-15', capturedRange: earlier },
    } });
    await run(db, async () => { throw Error('Repair planning should not contact BC Bid'); });
    expect(db.entries.get(HISTORICAL_KEY)).toMatchObject({
      dateFilter: 'exclusive-upper-bound', dateRepair: { mode: 'range-ends', previousRanges: 1, repairRanges: 1 },
      ranges: [{ from: earlier.to, to: earlier.to }, current], page: 1, rangeCount: 0, rangesCompleted: 0,
      pending, listingsCaptured: 11, detailsCompleted: 10,
    });
  });
  it('replays the earlier interval if the saved range ends cannot prove a complete partition', async () => {
    const db = database();
    const current = { from: '2015-04-10', to: '2015-04-14' };
    db.entries.set(HISTORICAL_KEY, { ...cp(), dateFilter: undefined, ranges: [current], rangesCompleted: 1 });
    await run(db, async () => { throw Error('Repair planning should not contact BC Bid'); });
    expect(db.entries.get(HISTORICAL_KEY)).toMatchObject({
      dateRepair: { mode: 'earlier-interval', previousRanges: 1, repairRanges: 1 },
      ranges: [{ from: '2015-04-01', to: '2015-04-09' }, current],
    });
  });
  it('accepts the last Pacific issue date, skips upper-bound rows and reuses the saved detail', async () => {
    const db = database();
    const html = fixture('listing-2015.html').replace('More than 150 Record(s)', '15 Record(s)')
      .replace('2015-12-30 1:14:00 PM', '2015-12-31 5:01:00 PM')
      .replace('2015-12-30 10:43:00 AM', '2016-01-01 12:00:00 AM');
    const listing = sourcePage(html);
    const parsed = parseCapture(listing, 'listing').document.records!;
    const reused = parsed[1];
    const id = 'opportunity:' + reused.sourceKey;
    const retained = { id, kind: 'opportunity', data: { ...reused, commodityScheme: 'GSIN',
      historical: { from: range.from, to: '2022-12-15' }, detailFields: [{ label: 'Source detail', value: 'Keep' }] } };
    db.records.set(id, retained);
    db.entries.set(HISTORICAL_KEY, { ...cp(), listingsCaptured: 1, detailsCompleted: 1 });
    await run(db, async () => listing);
    const saved = db.entries.get(HISTORICAL_KEY);
    expect(saved).toMatchObject({ listingsCaptured: 14, detailsCompleted: 1, rangeCount: 15 });
    expect(saved.pending).toHaveLength(13);
    expect(saved.pending.some((item: any) => item.sourceKey === reused.sourceKey)).toBe(false);
    expect(db.records.has('opportunity:' + parsed[2].sourceKey)).toBe(false);
    expect(db.records.get(id)).toEqual(retained);
    expect(db.records.get('opportunity:' + saved.pending[0].sourceKey).data.issueDate).toBe('2015-12-31');
  });
  it('saves a page and its pending detail queue atomically, then uses catalog progress when the host replays a stale checkpoint', async () => {
    const db = database(); db.entries.set(HISTORICAL_KEY, cp());
    const html = fixture('listing-2015.html').replace('More than 150 Record(s)', '15 Record(s)');
    await run(db, async () => sourcePage(html));
    const stored = db.entries.get(HISTORICAL_KEY); expect(stored.pending).toHaveLength(15); expect(stored.page).toBe(0); expect(stored.listingsCaptured).toBe(15);
    const first = stored.pending[0]; let captures = 0;
    db.records.set('opportunity:other-portal', { id: 'opportunity:other-portal', kind: 'opportunity', title: 'Other source', data: { processId: first.processId, sourceKey: 'other-portal', keep: true } });
    await run(db, async (o: any) => { captures++; return { ...sourcePage(fixture('detail-60536.html')), url: o.url }; }, cp());
    expect(captures).toBe(2); expect(db.entries.get(HISTORICAL_KEY).detailsCompleted).toBe(2); expect(db.entries.get(HISTORICAL_KEY).pending).toHaveLength(13);
    const row = db.records.get('opportunity:' + first.sourceKey); expect(row.data).toMatchObject({ historicalTypeCode: 'ITB', commodityScheme: 'GSIN' });
    expect(db.records.get('opportunity:other-portal').data.keep).toBe(true);
    expect(row.data.classificationLinkSet).toBeUndefined(); expect([...db.records.values()].filter(r => r.kind === 'reference-term' && r.data.scheme === 'GSIN')).toHaveLength(2);
    expect(db.entries.has('checkpoint:full')).toBe(false);
  });
  it('keeps a failed unsaved page pending and returns needs-user on browser verification', async () => {
    const db = database(); db.entries.set(HISTORICAL_KEY, cp());
    const check: any = await run(db, async () => { throw Error('BC Bid requires a browser check'); }); expect(check.resumable).toBe('needs-user'); expect(check.checkpoint.page).toBe(1);
    await expect(run(db, async () => sourcePage(fixture('listing-2015.html').replace(/2015-12-30/g, '2026-12-30').replace('More than 150 Record(s)', '15 Record(s)')))).rejects.toThrow('outside');
    expect(db.entries.get(HISTORICAL_KEY).listingsCaptured).toBe(0); expect(db.records.size).toBe(0);
  });
  it('proves zero results before completing an empty range, and refuses reported count mismatch', async () => {
    const db = database(); db.entries.set(HISTORICAL_KEY, cp());
    const result: any = await run(db, async () => sourcePage(summary() + '<div>0 Record(s)</div>')); expect(result.resumable).toBe('done'); expect(result.output.complete).toBe(true);
    const other = database(); other.entries.set(HISTORICAL_KEY, cp());
    await run(other, async () => sourcePage(fixture('listing-2015.html').replace('More than 150 Record(s)', '16 Record(s)')));
    const state = other.entries.get(HISTORICAL_KEY); state.pending = []; other.entries.set(HISTORICAL_KEY, state);
    await expect(run(other, async () => { throw Error('should not capture'); })).rejects.toThrow('reported total');
  });
  it('retries only a native public-search readiness failure from the committed cursor', async () => {
    const db = database(); db.entries.set(HISTORICAL_KEY, cp());
    const result: any = await run(db, async () => { throw Error('Native browser waitFor failed (400).'); });
    expect(result.resumable).toBe('retry'); expect(result.error.code).toBe('historical_search_not_ready');
    expect(result.checkpoint).toEqual(cp()); expect(db.records.size).toBe(0);
    const typed: any = await run(db, async () => { throw Error('Native browser waitFor failed (400). [timeout; TimeoutError]'); });
    expect(typed.resumable).toBe('retry'); expect(typed.error.code).toBe('historical_search_not_ready');
    expect(typed.checkpoint).toEqual(cp()); expect(db.records.size).toBe(0);
    await expect(run(db, async () => { throw Error('Native browser waitFor failed (400). [protocol-error; Error]'); })).rejects.toThrow('protocol-error');
    await expect(run(db, async () => { throw Error('Native browser fill failed (400).'); })).rejects.toThrow('fill failed');
  });
  it('never derives UNSPSC links from historical GSIN, and retires any previous generated link fingerprint', async () => {
    const row = { kind: 'opportunity', id: 'opportunity:old', data: { historical: {}, commodityScheme: 'GSIN', detailUrl: 'https://bcbid.gov.bc.ca/page.aspx/en/bpm/process_manage_extranet/1', commodities: ['Personal computer'], taxonomyReleaseId: 'taxonomy-release:UNSPSC:UNv260801', classificationLinkSet: 'old', classificationCodes: ['43211508'] } };
    const output = await classifyCatalogRecords(async () => { throw Error('Must not load UNSPSC'); }, [row]); expect(output.links).toEqual([]); expect(output.records[0].data).not.toHaveProperty('classificationLinkSet');
  });
  it('budgets the maximum absolute page together with its verified archive search', async () => {
    const manifest = JSON.parse(readFileSync(new URL('../zoer/manifest.json', import.meta.url), 'utf8'));
    const action = manifest.integration.actions.find((a: any) => a.id === 'scrape.historical');
    const db = database(); db.entries.set(HISTORICAL_KEY, { ...cp(), page: 20, rangeExpected: 300, rangeCount: 285, listingsCaptured: 285, detailsCompleted: 285 });
    let request: any;
    await run(db, async (o: any) => {
      request = o;
      return { ...sourcePage(fixture('listing-2015.html').replace('More than 150 Record(s)', '300 Record(s)')), pagination: { currentPage: 20, hasNext: false, visiblePages: [20] } };
    });
    expect(request).toMatchObject({ pageNumber: 20, applySearch: true });
    const cost = Math.min(request.pageNumber,20) + 1 + 2 + request.pickFields.length;
    expect(cost).toBeLessThanOrEqual(action.resourceLimits.maxBrowserPages);
    expect(db.entries.get(HISTORICAL_KEY)).toMatchObject({ page: 0, listingsCaptured: 300 });
  });
  it('rejects oversized, overlapping and inconsistent checkpoints', () => {
    expect(() => validateHistoricalCheckpoint({ ...cp(), ranges: [range, range] })).toThrow('Invalid');
    expect(() => validateHistoricalCheckpoint({ ...cp(), complete: true })).toThrow('Invalid');
  });
});

it('replays an exact native navigation timeout with backoff while browser checks still need the user',async()=>{
 const db=database();db.entries.set(HISTORICAL_KEY,cp());
 const result:any=await run(db,async()=>{throw Error('Native browser goto failed (400). [timeout; TimeoutError]');});
 expect(result).toMatchObject({resumable:'retry',retryAfterMs:60000,error:{code:'historical_navigation_timeout'}});
 expect(result.checkpoint).toEqual(cp());expect(db.records.size).toBe(0);
 expect((await run(db,async()=>{throw Error('Complete the browser check manually');}) as any).resumable).toBe('needs-user');
 await expect(run(db,async()=>{throw Error('Native browser goto failed (400). [unknown; Error]');})).rejects.toThrow('unknown');
});

it.each(['listing', 'detail'])('preserves the committed %s cursor on a typed native network error', async phase => {
 const db=database();
 const pending = phase === 'detail' ? [{sourceKey:'60536',processId:'60536',detailUrl:'https://bcbid.gov.bc.ca/page.aspx/en/bpm/process_manage_extranet/60536'}] : [];
 const before={...cp(),...(pending.length ? {pending,page:0,rangeCount:1,rangeExpected:1,listingsCaptured:1,lastSignature:'a'.repeat(64)} : {})};
 db.entries.set(HISTORICAL_KEY,before);
 const result:any=await run(db,async()=>{throw Error('Native browser goto failed (400). [network-error; Error]');},before);
 expect(result).toMatchObject({resumable:'retry',retryAfterMs:60000,error:{code:'historical_navigation_network'}});
 expect(result.checkpoint).toEqual(before);
 expect(db.entries.get(HISTORICAL_KEY)).toEqual(before);
 expect(db.records.size).toBe(0);
});

it('does not retry an unrelated typed navigation/control error', async () => {
 const db=database();db.entries.set(HISTORICAL_KEY,cp());
 await expect(run(db,async()=>{throw Error('Native browser goto failed (400). [permission-denied; Error]');})).rejects.toThrow('permission-denied');
});
