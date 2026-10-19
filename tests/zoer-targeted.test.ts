import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import { scrapeTargeted, parseTargetedListing, verifyTargetedFilters, validateTargetedInput, activeTargetFilters, writeTargetedReceipt, TARGET_FIELDS, TARGETED_RECEIPT_KEY, type CaptureOptions } from '../zoer/src/targeted-scrape';
import { scrapeFull } from '../zoer/src/full-scrape';
import { saveCatalogDocument } from '../zoer/src/catalog';
import { LISTING_URL } from '../zoer/src/scrape';
import { buildModel } from '../zoer/dashboard/model';
import { receiptSummary } from '../zoer/dashboard/targeted';
import { BC_BID_DETAIL_TABS } from '../zoer/src/detail-policy';

const fixture = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');
// Summary markup as observed on BC Bid's awards form (award-range-capture.ts) and by the old scraper's tag checks.
const summary = (tags: [string, string[]][]) => `<div class="iv-filter-summary">${tags.map(([label, values]) =>
  `<span class="tag-label">${label} :</span><ul class="tag-summary">${values.map(value => `<li class="tag-value"><span class="tag-text">${value}</span></li>`).join('')}</ul>`).join('')}</div>`;
const HEALTH = summary([['Organization', ['Ministry of Health']]]);
function listing(number: number, last: number, tags = HEALTH) {
  const html = tags + fixture('listing/page1.html').replace(/\b(\d{6})\b/g, value => String(Number(value) + number * 100));
  return { url: LISTING_URL, title: 'BC Bid', capturedAt: '2026-10-03T20:00:00Z', html, pagination: { currentPage: number, hasNext: number < last, visiblePages: [1, 2] } };
}
const cleared = () => ({ ...listing(1, 1, summary([['Status', ['Open']]])) });
const detail = (url: string) => ({ url, title: 'BC Bid', capturedAt: '2026-10-03T20:01:00Z', html: fixture('detail/with-addenda.html').replace(/226320/g, url.match(/(\d+)$/)![1]!) });
function harness(pages: (options: CaptureOptions, call: number) => any, saved = new Map<string, any>()) {
  const calls: CaptureOptions[] = [], docs: any[] = [], receipts: any[] = [];
  let listingCalls = 0;
  const browser = { capture: async (options: CaptureOptions) => {
    calls.push(structuredClone(options));
    if (options.url !== LISTING_URL) return detail(options.url);
    return pages(options, ++listingCalls);
  } };
  const store = { save: async (doc: any) => { docs.push(structuredClone(doc)); return 'catalog:run'; }, existing: async (keys: string[]) => new Map(keys.filter(key => saved.has(key)).map(key => [key, saved.get(key)])),
    receipt: async (value: any) => { receipts.push(value); } };
  return { browser, store, calls, docs, receipts };
}

/** Use the real catalog merge across runs: an in-memory `existing` stub that
 * never saves listings would hide stale details becoming falsely unchanged.
 */
function durableHarness(last = 1) {
  const records = new Map<string, any>(), entries = new Map<string, any>();
  let revision = 0;
  for (let number = 1; number <= last; number++) {
    for (const row of parseTargetedListing(listing(number, last)).records) records.set('opportunity:' + row.sourceKey, {
      id: 'opportunity:' + row.sourceKey, kind: 'opportunity', title: row.description,
      data: { ...row, amendments: row.amendments - 1, starred: true,
        detailFields: [{ label: 'Scope', value: 'Previously captured scope' }],
        attachments: [{ url: 'https://bcbid.gov.bc.ca/bare.aspx/en/fil/download_public/previous-file', name: 'Previous file' }],
        addenda: [], annotations: ['Retain review'] },
    });
  }
  const host = async (method: string, input: any): Promise<any> => {
    if (method === 'catalog.read') return { primary: true, revision, records: [...records.values()].filter(row => input.ids
      ? input.ids.includes(row.id) : input.match && row.kind === input.match.kind && row.data[input.match.field] === input.match.value).map(row => structuredClone(row)) };
    if (method === 'catalog.workspace') return { entries: input.keys.filter((key: string) => entries.has(key)).map((key: string) => ({ key, value: structuredClone(entries.get(key)) })) };
    if (method === 'catalog.commit') {
      if (input.revision !== revision) return { conflict: true };
      for (const row of input.records ?? []) records.set(row.id, JSON.parse(JSON.stringify(row)));
      for (const entry of input.entries ?? []) entries.set(entry.key, structuredClone(entry.value));
      return { revision: ++revision };
    }
    throw Error(method);
  };
  const h = harness(options => options.applySearch && !options.pickFields ? cleared() : listing(options.continuePage ?? 1, last));
  h.store.existing = async keys => new Map(keys.filter(key => records.has('opportunity:' + key)).map(key => [key, structuredClone(records.get('opportunity:' + key).data)]));
  h.store.save = async doc => { h.docs.push(structuredClone(doc)); return saveCatalogDocument(host, doc, 'durable-test'); };
  return { ...h, records, notices: () => [...records.values()].filter(row => row.kind === 'opportunity') };
}

describe('targeted BC Bid refresh', () => {
  it('validates bounded input and needs at least one filter', () => {
    expect(validateTargetedInput({ organization: '  Ministry  of Health ' })).toEqual({ organization: 'Ministry of Health', maxPages: 5, details: true });
    expect(() => validateTargetedInput({})).toThrow('Choose a buyer');
    expect(() => validateTargetedInput({ region: 'Capital', maxPages: 71 })).toThrow('1-70');
    expect(() => validateTargetedInput({ keyword: 'a\u0000b' })).toThrow('Invalid keyword');
  });

  it('captures all 70 category pages without exceeding the existing navigation grant', async () => {
    const tags = summary([['Status', ['Open']], ['Industry Category', ['Services']]]);
    const h = harness((o) => o.pickFields?.length || o.continuePage ? listing(o.continuePage ?? 1,70,tags) : cleared());
    const result = await scrapeTargeted(h.browser,h.store,{ industryCategory:'Services', maxPages:70, details:false });
    expect(result).toMatchObject({ pageCount:70, listingCount:140, truncated:false, filtersCleared:true });
    const manifest=JSON.parse(readFileSync(new URL('../zoer/manifest.json',import.meta.url),'utf8'));
    const grant=manifest.integration.actions.find((a:any)=>a.id==='scrape.targeted').resourceLimits.maxBrowserPages;
    const cost=h.calls.reduce((n,r)=>n+Math.min(r.pageNumber??(r.continuePage?2:1),20)+(r.pageNumber===undefined?0:1)+(r.applySearch?2:0)+(r.pickFields?.length??0),0);
    // One initial detail navigation plus every optional public tab is charged
    // even when a particular notice does not publish all those tabs.
    expect(cost + 40 * (1 + BC_BID_DETAIL_TABS.length)).toBeLessThanOrEqual(grant);
  });
  it('distinguishes lower-bound source counts, including markup, from exact totals', () => {
    const page=listing(1,1);
    expect(parseTargetedListing({...page,html:page.html+'<div>More than <strong>150</strong> Record(s)</div>'})).toMatchObject({totalReported:null,reportedLowerBound:150,reportedCountLabel:'More than 150 Record(s)'});
    expect(parseTargetedListing({...page,html:page.html+'<div>386 Record(s)</div>'})).toMatchObject({totalReported:386,reportedLowerBound:null});
  });
  it('confirms only the exact requested filters from the summary tags', () => {
    expect(verifyTargetedFilters(HEALTH, { organization: 'ministry of health' })).toEqual({ organization: 'Ministry of Health' });
    expect(() => verifyTargetedFilters('<div></div>', { organization: 'Ministry of Health' })).toThrow('did not confirm the buyer filter');
    expect(() => verifyTargetedFilters(summary([['Organization', ['Ministry of Health Services']]]), { organization: 'Ministry of Health' })).toThrow('shows the buyer filter as "Ministry of Health Services"');
    // A leftover region narrows results beyond what was asked for.
    expect(() => verifyTargetedFilters(HEALTH + summary([['Region', ['Capital']]]), { organization: 'Ministry of Health' })).toThrow('still has a region filter');
    // A keyword BC Bid does not echo is accepted on Zoer's input check; an echoed one must match.
    expect(verifyTargetedFilters(HEALTH, { organization: 'Ministry of Health', keyword: 'cloud' })).toEqual({ organization: 'Ministry of Health', keyword: 'cloud' });
    expect(() => verifyTargetedFilters(summary([['Keywords', ['roads']]]), { keyword: 'cloud' })).toThrow('keyword');
    expect(activeTargetFilters(summary([['Status', ['Open']]]))).toEqual([]);
  });

  it('applies the search once, follows the persisted pager, details only new or changed notices, clears the search and records a receipt', async () => {
    // 226420 is saved and unchanged (has details, same listing values); 226421 is saved without details.
    const page1 = (await import('../zoer/src/targeted-scrape')).parseTargetedListing(listing(1, 2)).records;
    const saved = new Map<string, any>([
      ['226420', { ...page1[0], detailFields: [{ label: 'Status', value: 'Open' }] }],
      ['226421', { ...page1[1], detailFields: [] }],
    ]);
    const h = harness((options, call) => options.applySearch && !options.pickFields ? cleared() : listing(call, 2), saved);
    const output = await scrapeTargeted(h.browser, h.store, { organization: 'Ministry of Health', maxPages: 5 }, { runId: 'run-t' });
    expect(h.calls[0]).toEqual({ url: LISTING_URL, pageNumber: 1, applySearch: true, searchFields: [{ selector: TARGET_FIELDS.keyword, value: '' }], pickFields: [{ selector: TARGET_FIELDS.organization, value: 'Ministry of Health' }] });
    expect(h.calls[1]).toEqual({ url: LISTING_URL, continuePage: 2, searchFields: [{ selector: TARGET_FIELDS.keyword, value: '' }] });
    expect(h.calls.filter(call => call.url !== LISTING_URL).map(call => call.url)).toEqual([
      'https://bcbid.gov.bc.ca/page.aspx/en/bpm/process_manage_extranet/226421',
      'https://bcbid.gov.bc.ca/page.aspx/en/bpm/process_manage_extranet/226520',
      'https://bcbid.gov.bc.ca/page.aspx/en/bpm/process_manage_extranet/226521']);
    expect(h.calls.filter(call => call.url !== LISTING_URL).every(call =>
      call.readTabs?.includes('Qualified Suppliers') && call.readTabs?.includes('Process Rules') && call.readTabs?.includes('Responses') && call.readTabs?.includes('Pricing'))).toBe(true);
    expect(h.calls.at(-1)).toEqual({ url: LISTING_URL, pageNumber: 1, applySearch: true, searchFields: [{ selector: TARGET_FIELDS.keyword, value: '' }] });
    expect(output).toMatchObject({ listingCount: 4, newCount: 2, changedCount: 1, detailCount: 3, pageCount: 2, totalPages: 2, truncated: false, filtersCleared: true, confirmed: { organization: 'Ministry of Health' } });
    expect(h.docs.filter(doc => doc.kind === 'listing').map(doc => doc.scope)).toEqual(['bcbid-targeted', 'bcbid-targeted']);
    expect(h.docs.filter(doc => doc.kind === 'detail').every(doc => doc.scope === 'bcbid-targeted')).toBe(true);
    expect(h.docs.some(doc => doc.scope === 'all-current-public-opportunities')).toBe(false);
    expect(h.docs.at(-1)).toMatchObject({ kind: 'scrape', scope: 'bcbid-targeted', complete: true, records: [], listingCount: 4, detailsCompleted: 3 });
    expect(h.receipts).toEqual([expect.objectContaining({ status: 'complete', runId: 'run-t', filters: { organization: 'Ministry of Health' }, pages: 2, listingCount: 4, detailsCompleted: 3, filtersCleared: true })]);
    // The scraper page shows the run with its filter, not as a generic bounded capture.
    const model = buildModel({ runs: [{ id: 'run-t', actionId: 'scrape.targeted', status: 'succeeded', createdAt: '2026-10-03T20:00:00Z' }], artifacts: [] },
      [{ record: { id: 'run-t', runId: 'run-t', createdAt: '2026-10-03T20:02:00Z' }, document: h.docs.at(-1) }]);
    expect(model.runs[0].progress.message).toBe('4 listings · 3 details · buyer Ministry of Health');
    expect(receiptSummary(h.receipts[0])).toMatchObject({ counts: '2 pages · 4 notices (2 new, 1 changed) · 3 details', notes: [] });
  });

  it('aborts without saving when BC Bid does not confirm the filter, then still clears the search', async () => {
    // An older Zoer ignores pickFields: the page comes back unfiltered, with no buyer tag.
    const h = harness(() => listing(1, 3, ''));
    await expect(scrapeTargeted(h.browser, h.store, { organization: 'Ministry of Health' })).rejects.toThrow('did not confirm the buyer filter');
    expect(h.docs).toEqual([]);
    expect(h.calls).toHaveLength(2);
    expect(h.calls[1]).toMatchObject({ applySearch: true, searchFields: [{ value: '' }] });
    expect(h.receipts).toEqual([expect.objectContaining({ status: 'failed', pages: 0, listingCount: 0, error: expect.stringContaining('did not confirm') })]);
    expect(receiptSummary(h.receipts[0])!.title).toMatch(/^Last refresh failed: buyer Ministry of Health/);
  });

  it('does not trust a buyer tag when no result names that buyer', async () => {
    const h = harness((options) => options.pickFields ? listing(1, 1, summary([['Organization', ['City of Nanaimo']]])) : cleared());
    await expect(scrapeTargeted(h.browser, h.store, { organization: 'City of Nanaimo' })).rejects.toThrow('not trusted');
    expect(h.docs).toEqual([]);
  });

  it('aborts when a later page loses the filter, keeping only the confirmed pages', async () => {
    const h = harness((options, call) => options.applySearch && !options.pickFields ? cleared() : listing(call, 3, call === 1 ? HEALTH : ''));
    await expect(scrapeTargeted(h.browser, h.store, { organization: 'Ministry of Health' })).rejects.toThrow('did not confirm');
    expect(h.docs.map(doc => [doc.kind, doc.currentPage])).toEqual([['listing', 1]]);
    expect(h.receipts[0]).toMatchObject({ status: 'failed', pages: 1, listingCount: 2, filtersCleared: true });
  });

  it('records an empty confirmed search as complete with zero notices', async () => {
    const empty = { url: LISTING_URL, title: 'BC Bid', capturedAt: '2026-10-03T20:00:00Z', pagination: { currentPage: 1, hasNext: false, visiblePages: [] },
      html: summary([['Region', ['Stikine']]]) + fixture('awards/empty-date-range.html') };
    const h = harness(options => options.pickFields ? empty : cleared());
    const output = await scrapeTargeted(h.browser, h.store, { region: 'Stikine' });
    expect(output).toMatchObject({ listingCount: 0, totalReported: 0, detailCount: 0, filtersCleared: true });
    expect(h.docs).toEqual([expect.objectContaining({ kind: 'scrape', listingCount: 0 })]);
  });

  it('stops at the page limit, reports it, and leaves skipped details visible', async () => {
    const h = harness((options, call) => options.applySearch && !options.pickFields ? cleared() : listing(call, 9));
    const output = await scrapeTargeted(h.browser, h.store, { organization: 'Ministry of Health', maxPages: 2, details: false });
    expect(output).toMatchObject({ pageCount: 2, truncated: true, detailCount: 0, detailsSkipped: 4 });
    expect(h.calls.filter(call => call.url !== LISTING_URL)).toEqual([]);
    expect(receiptSummary(h.receipts[0])!.notes).toEqual(['More result pages remain; raise Pages to include them.', '4 new or changed notices still need details.']);
  });

  it.each([{ label: 'absent', sourceId: undefined }, { label: 'legacy blank', sourceId: '' }])('keeps changed details retryable after a listing-only refresh ($label sourceId)', async ({ sourceId }) => {
    const h = durableHarness();
    for (const row of h.notices()) row.data.sourceId = sourceId;
    const before = h.notices().map(row => structuredClone(row.data));
    const skipped = await scrapeTargeted(h.browser, h.store, { organization: 'Ministry of Health', details: false });
    expect(skipped).toMatchObject({ detailsSkipped: 2, detailCount: 0 });
    expect(h.notices().every(row => row.data.detailNeedsRefresh === true)).toBe(true);
    expect(h.notices().map(row => row.data.detailFields)).toEqual(before.map(row => row.detailFields));
    expect(h.notices().map(row => row.data.attachments)).toEqual(before.map(row => row.attachments));
    // The next listing is unchanged, but both outstanding details still run.
    const retried = await scrapeTargeted(h.browser, h.store, { organization: 'Ministry of Health' });
    expect(retried).toMatchObject({ changedCount: 2, detailCount: 2, detailsSkipped: 0 });
    expect(h.notices().every(row => row.data.detailNeedsRefresh === false && row.data.starred && row.data.annotations[0] === 'Retain review')).toBe(true);
    const unchanged = await scrapeTargeted(h.browser, h.store, { organization: 'Ministry of Health' });
    expect(unchanged).toMatchObject({ changedCount: 0, detailCount: 0 });
  });

  it('retries changed notices beyond the 40-detail cap on the next refresh', async () => {
    const h = durableHarness(21); // 42 changed notices across 21 listing pages.
    const first = await scrapeTargeted(h.browser, h.store, { organization: 'Ministry of Health', maxPages: 21 });
    expect(first).toMatchObject({ listingCount: 42, changedCount: 42, detailCount: 40, detailsSkipped: 2 });
    const pending = h.notices().filter(row => row.data.detailNeedsRefresh).map(row => row.data.detailUrl);
    expect(pending).toHaveLength(2);
    h.calls.length = 0;
    const next = await scrapeTargeted(h.browser, h.store, { organization: 'Ministry of Health', maxPages: 21 });
    expect(next).toMatchObject({ listingCount: 42, changedCount: 2, detailCount: 2, detailsSkipped: 0 });
    expect(h.calls.filter(call => call.url !== LISTING_URL).map(call => call.url)).toEqual(pending);
  });

  it('retains the detail retry marker after failure despite saving the updated listing', async () => {
    const h = durableHarness();
    const failed = h.notices()[0];
    let fail = true;
    const browser = { capture: async (options: CaptureOptions) => {
      if (fail && options.url === failed.data.detailUrl) throw Error('Public detail request failed');
      return h.browser.capture(options);
    } };
    const first = await scrapeTargeted(browser, h.store, { organization: 'Ministry of Health' });
    expect(first).toMatchObject({ detailCount: 1, detailFailures: 1 });
    expect(h.records.get(failed.id).data).toMatchObject({ detailNeedsRefresh: true, detailFields: failed.data.detailFields });
    fail = false; h.calls.length = 0;
    const retry = await scrapeTargeted(browser, h.store, { organization: 'Ministry of Health' });
    expect(retry).toMatchObject({ changedCount: 1, detailCount: 1, detailFailures: 0 });
    expect(h.calls.filter(call => call.url !== LISTING_URL).map(call => call.url)).toEqual([failed.data.detailUrl]);
    expect(h.records.get(failed.id).data.detailNeedsRefresh).toBe(false);
  });

  it('pauses with remaining details and a resumed run fetches only those, then clears the search', async () => {
    let pause = true;
    const h = harness((options, call) => options.applySearch && !options.pickFields ? cleared() : listing(call, 1));
    const browser = { capture: async (options: CaptureOptions) => {
      if (options.url !== LISTING_URL && h.calls.some(call => call.url !== LISTING_URL) && pause) { pause = false; throw Object.assign(new Error('Paused for Zoer update'), { code: 'ZOER_PAUSED' }); }
      return h.browser.capture(options);
    } };
    const result: any = await scrapeTargeted(browser, h.store, { organization: 'Ministry of Health' }, { runId: 'r' });
    expect(result).toMatchObject({ paused: true, checkpoint: { phase: 'detail', detailsCompleted: 1, pending: [expect.objectContaining({ processId: '226421' })] } });
    expect(h.receipts).toEqual([]);
    h.calls.length = 0;
    const resumed = await scrapeTargeted(h.browser, h.store, { organization: 'Ministry of Health' }, { runId: 'r', resume: result.checkpoint });
    expect(h.calls.map(call => call.url)).toEqual(['https://bcbid.gov.bc.ca/page.aspx/en/bpm/process_manage_extranet/226421', LISTING_URL]);
    expect(resumed).toMatchObject({ detailCount: 2, listingCount: 2 });
    // A checkpoint for other filters is ignored, so the listing is searched again.
    h.calls.length = 0;
    await scrapeTargeted(h.browser, h.store, { region: 'Capital' }, { resume: result.checkpoint }).catch(() => {});
    expect(h.calls[0]).toMatchObject({ pickFields: [{ selector: TARGET_FIELDS.region, value: 'Capital' }] });
  });
});

describe('targeted refresh and the full crawl', () => {
  it('a full crawl refuses a listing that is still filtered by an earlier search', async () => {
    const saved: any[] = [];
    await expect(scrapeFull({ captureUrl: async () => listing(1, 1) }, async doc => { saved.push(doc); return 'a'; })).rejects.toThrow('still has a search filter (Organization: Ministry of Health)');
    expect(saved.some(doc => doc.kind === 'listing')).toBe(false);
  });

  it('saving a targeted detail never reads or edits checkpoint:full; the receipt is its own workspace key', async () => {
    const calls: any[] = [];
    const row = { sourceKey: '226320', processId: '226320', description: 'Saved', detailFields: [] };
    const host = async (method: string, input: any) => {
      calls.push({ method, input });
      if (method === 'catalog.read') return input.match ? { records: [{ id: 'opportunity:226320', data: row }] } : { primary: true, revision: 7, records: [] };
      if (method === 'catalog.workspace') return { entries: input.keys.includes('checkpoint:full') ? [{ key: 'checkpoint:full', value: { pending: [{ sourceKey: '226320' }], detailsCompleted: 0 } }] : [] };
      if (method === 'catalog.commit') return { revision: 8 };
      throw new Error(method);
    };
    await saveCatalogDocument(host, { version: 1, kind: 'detail', scope: 'bcbid-targeted', sourceKey: '226320', record: { processId: '226320', detailFields: [{ label: 'Status', value: 'Open' }] } }, 'run-t');
    expect(calls.some(call => call.method === 'catalog.workspace' && call.input.keys.includes('checkpoint:full'))).toBe(false);
    const commit = calls.find(call => call.method === 'catalog.commit').input;
    expect(commit.entries.map((entry: any) => entry.key)).toEqual(['run:run-t']);
    calls.length = 0;
    await writeTargetedReceipt(host, { version: 1, status: 'complete' } as any);
    expect(calls.at(-1)).toEqual({ method: 'catalog.commit', input: { revision: 7, entries: [{ key: TARGETED_RECEIPT_KEY, value: { version: 1, status: 'complete' } }] } });
  });
});
