import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import { compactCheckpoint, scrapeFull, validateCheckpoint } from '../zoer/src/full-scrape';
import { reconciliationSummary } from '../zoer/src/listing-reconciliation';
import { LISTING_URL } from '../zoer/src/scrape';
const fixture = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');
function listing(number: number, last = 9) {
  // Unique identities on every page; initial pager HTML deliberately reports fewer pages.
  const html = fixture('listing/page1.html').replace(/\b(\d{6})\b/g, value => String(Number(value) + number * 100));
  return { url: LISTING_URL, title: 'BC Bid', capturedAt: new Date().toISOString(), html, pagination: { currentPage: number, hasNext: number < last, visiblePages: [1, 2, 3] } };
}
function detail(url: string) {
  return { url, title: 'BC Bid', capturedAt: new Date().toISOString(), html: fixture('detail/with-addenda.html') };
}
describe('full current public crawl', () => {
  it('walks beyond initial pager, persists all listings/details, then marks complete', async () => {
    const saved: any[] = [];
    const result = await scrapeFull({ captureUrl: async (url, number) => url === LISTING_URL ? listing(number!) : detail(url) }, async doc => { saved.push(structuredClone(doc)); return String(saved.length); });
    expect(result).toMatchObject({ totalPages: 9, listingCount: 18, detailCount: 18, limited: false });
    expect(saved.filter(doc => doc.kind === 'detail')).toHaveLength(18);
    expect(saved.at(-1)).toMatchObject({ complete: true, pending: [], failures: [] });
  });
  it('stops repeated pagination without claiming completeness and saves a checkpoint', async () => {
    const saved: any[] = [];
    await expect(scrapeFull({ captureUrl: async (_, number) => ({ ...listing(1), pagination: { currentPage: number!, hasNext: true, visiblePages: [1] } }) }, async doc => { saved.push(structuredClone(doc)); return 'a'; })).rejects.toThrow('repeated');
    expect(saved.at(-1)).toMatchObject({ complete: false, currentPage: 1 });
  });
  it('retains partial detail failures and resumes only pending records', async () => {
    const saved: any[] = [];
    let calls = 0;
    await expect(scrapeFull({ captureUrl: async (url, number) => {
      if (url === LISTING_URL) return listing(number!, 1);
      if (++calls === 1) return detail(url);
      throw new Error('Manual browser check required');
    } }, async doc => { saved.push(structuredClone(doc)); return 'a'; })).rejects.toThrow('Manual');
    const checkpoint = saved.at(-1);
    expect(checkpoint).toMatchObject({ complete: false, detailsCompleted: 1 });
    const urls: string[] = [];
    const result = await scrapeFull({ captureUrl: async url => { urls.push(url); return detail(url); } }, async () => 'b', checkpoint);
    expect(urls).toEqual(checkpoint.pending.map((row: any) => row.detailUrl));
    expect(result.detailCount).toBe(2);
    expect(() => validateCheckpoint({ ...checkpoint, pending: [{ ...checkpoint.pending[0], detailUrl: 'https://evil.example/' }] })).toThrow('Invalid');
  });  it('reports the original failure when the final checkpoint save also fails', async () => {
    await expect(scrapeFull({ captureUrl: async (url, number) => {
      if (url === LISTING_URL) return listing(number!, 1);
      throw new Error('Manual browser check required');
    } }, async doc => { if (doc.kind === 'scrape' && doc.error) throw new Error('Disk full'); return 'a'; })).rejects.toThrow('Manual');
  });
});

/** A source-shaped Open listing page with chosen process IDs, displayed total and countdown text. */
function grid(number: number, ids: number[], { last, total, endsIn = '35 days' }: { last: number; total?: string; endsIn?: string }) {
  const rows = ids.map(id => `<tr><td>Open</td><td>BC-${id}</td><td><a href="/page.aspx/en/bpm/process_manage_extranet/${id}">Opportunity ${id}</a></td><td>Services</td><td>RFP</td><td>Mar 08, 2026</td><td>Apr 15, 2026</td><td>${endsIn}</td><td>0</td><td>Mar 10, 2026</td><td>Ministry of Health</td><td>Ministry of Health</td><td>No</td></tr>`).join('');
  return { url: LISTING_URL, title: 'BC Bid', capturedAt: new Date().toISOString(), pagination: { currentPage: number, hasNext: number < last, visiblePages: [number] },
    html: `<html><body>${total ? `<div class="record-count">${total}</div>` : ''}<table id="body_x_grid_grd"><tbody>${rows}</tbody></table></body></html>` };
}

describe('full crawl listing reconciliation', () => {
  // The 2026-10-19 audit: 724 displayed, 724 rows read, process 164592 at the end of page 45 and the start of page 46.
  const unique = Array.from({ length: 723 }, (_, i) => 163918 + i);
  const appearances = [...unique.slice(0, 675), 164592, ...unique.slice(675)];
  const pages = Array.from({ length: 49 }, (_, i) => appearances.slice(i * 15, i * 15 + 15));
  const page = (number: number) => grid(number, pages[number - 1], { last: 49, total: '724 Record(s)' });

  it('keeps a repeated identity and reports 723 distinct of 724 displayed as short', async () => {
    const saved: any[] = [];
    const result = await scrapeFull({ captureUrl: async (url, number) => url === LISTING_URL ? page(number!) : detail(url) }, async doc => { saved.push(structuredClone(doc)); return String(saved.length); });
    expect(appearances).toHaveLength(724);
    expect(result).toMatchObject({ totalPages: 49, listingCount: 723, detailCount: 723 });
    expect(result.reconciliation).toMatchObject({ status: 'short', difference: -1, identityRule: 'bc-bid-process-id',
      sourceReportedTotal: { value: 724, label: '724 Record(s)', kind: 'exact' }, rawRowsCaptured: 724, uniqueIdentitiesCaptured: 723, pagesCaptured: 49,
      duplicateAppearances: [{ sourceKey: '164592', appearances: [{ page: 45, row: 15 }, { page: 46, row: 1 }] }] });
    // The duplicate row stays in page 46's saved listing; nothing is invented for the missing count.
    const listings = saved.filter(doc => doc.kind === 'listing');
    expect(listings.find(doc => doc.currentPage === 46).records[0].sourceKey).toBe('164592');
    expect(listings.reduce((sum, doc) => sum + doc.records.length, 0)).toBe(724);
    expect(saved.at(-1)).toMatchObject({ complete: true, reconciliation: { status: 'short' } });
    expect(reconciliationSummary(result.reconciliation)).toMatch(/^Listing count short: BC Bid reported 724; 723 distinct opportunities were captured. \(724 rows read, 1 repeated\)$/);
  });

  it('carries listing counts through a compact resume mid-listing', async () => {
    const saved: any[] = [];
    await expect(scrapeFull({ captureUrl: async (url, number) => {
      if (number === 47) throw new Error('Manual browser check required');
      return url === LISTING_URL ? page(number!) : detail(url);
    } }, async doc => { saved.push(structuredClone(doc)); return 'a'; })).rejects.toThrow('Manual');
    const checkpoint = saved.at(-1);
    expect(checkpoint).toMatchObject({ currentPage: 46, reconciliation: { status: 'unknown', rawRowsCaptured: 690, uniqueIdentitiesCaptured: 689 } });
    const result = await scrapeFull({ captureUrl: async (url, number) => url === LISTING_URL ? page(number!) : detail(url) }, async () => 'b', compactCheckpoint(checkpoint));
    expect(result.reconciliation).toMatchObject({ status: 'short', rawRowsCaptured: 724, uniqueIdentitiesCaptured: 723,
      duplicateAppearances: [{ sourceKey: '164592', appearances: [{ page: 45, row: 15 }, { page: 46, row: 1 }] }] });
  });

  it('matches an exact total as complete and treats "More than" as a lower bound, not an expected count', async () => {
    const crawl = async (total: string) => scrapeFull({ captureUrl: async (url, number) => url === LISTING_URL ? grid(number!, [200001, 200002, 200003], { last: 1, total }) : detail(url) }, async () => 'a');
    expect((await crawl('3 Record(s)')).reconciliation).toMatchObject({ status: 'complete', difference: 0 });
    const above = (await crawl('More than <strong>2</strong> Record(s)')).reconciliation;
    expect(above).toMatchObject({ status: 'unknown', difference: null, uniqueIdentitiesCaptured: 3, sourceReportedTotal: { value: 2, kind: 'lower-bound' } });
    expect(above.reason).toMatch(/lower bound .*cannot be confirmed complete/);
    expect((await crawl('More than 150 Record(s)')).reconciliation).toMatchObject({ status: 'short', sourceReportedTotal: { value: 150, kind: 'lower-bound' } });
    expect((await crawl('')).reconciliation).toMatchObject({ status: 'unknown', sourceReportedTotal: { kind: 'unavailable' } });
  });

  it('rechecks a page whose pager advanced before its rows, ignoring countdown changes', async () => {
    const saved: any[] = [];
    const calls: number[] = [];
    const result = await scrapeFull({ captureUrl: async (url, number) => {
      if (url !== LISTING_URL) return detail(url);
      calls.push(number!);
      // First read of page 2: new page number, page 1's rows with a ticking countdown.
      if (number === 2 && calls.filter(n => n === 2).length === 1) return grid(2, [300001, 300002], { last: 2, total: '4 Record(s)', endsIn: '34 days 23 hours' });
      return grid(number!, number === 1 ? [300001, 300002] : [300003, 300004], { last: 2, total: '4 Record(s)' });
    } }, async doc => { saved.push(structuredClone(doc)); return 'a'; });
    expect(calls).toEqual([1, 2, 2]);
    expect(saved.filter(doc => doc.kind === 'listing').map(doc => [doc.currentPage, doc.records.map((row: any) => row.sourceKey)]))
      .toEqual([[1, ['300001', '300002']], [2, ['300003', '300004']]]);
    expect(result.reconciliation).toMatchObject({ status: 'complete', rawRowsCaptured: 4, duplicateAppearances: [] });
  });

  it('stops without saving a page whose rows never updated', async () => {
    const saved: any[] = [];
    await expect(scrapeFull({ captureUrl: async (_, number) => grid(number!, [300001, 300002], { last: 3, endsIn: `${number} days` }) },
      async doc => { saved.push(structuredClone(doc)); return 'a'; })).rejects.toThrow('Page 2 was not saved');
    expect(saved.filter(doc => doc.kind === 'listing').map(doc => doc.currentPage)).toEqual([1]);
    expect(saved.at(-1)).toMatchObject({ complete: false, currentPage: 1, reconciliation: { status: 'unknown', rawRowsCaptured: 2 } });
    expect(() => validateCheckpoint(saved.at(-1))).not.toThrow();
  });
});

it('parses sanitized public read-only fields without proprietary DOM attributes', async () => {
  const { parseCapture } = await import('../zoer/src/capture');
  const doc = parseCapture({ url: 'https://bcbid.gov.bc.ca/page.aspx/en/bpm/process_manage_extranet/123456', title: '', capturedAt: new Date().toISOString(), html: `<div class="field readonly"><label><span class="label-field">Contact email</span><span class="tooltip-field">Help text</span></label><div class="control-wrapper"><span>contact@example.org</span></div></div><div class="field readonly"><label><span class="label-field">Summary Details</span></label><div class="control-wrapper"><p>Public opportunity description.</p></div></div>` }, 'detail').document;
  expect(doc.record!.descriptionText).toBe('Public opportunity description.');
  expect(doc.record!.detailFields).toContainEqual({ label: 'Contact email', value: 'contact@example.org' });
});

it('keeps a maximum-size resume below the host approval limit and expands IDs safely', async () => {
  const { compactCheckpoint } = await import('../zoer/src/full-scrape');
  const ids = Array.from({ length: 3000 }, (_, i) => String(1234567000 + i));
  const compact = compactCheckpoint({ version: 1, kind: 'scrape', scope: 'all-current-public-opportunities', limited: false, complete: false,
    phase: 'detail', currentPage: 200, totalPages: 200, startedAt: '', capturedAt: '', listingCount: 3000, detailsCompleted: 2999,
    knownKeys: ids, pending: [{ sourceKey: ids[0], processId: ids[0], detailUrl: 'unused' }], failures: [] });
  expect(JSON.stringify(compact).length).toBeLessThan(64000);
  const result = await scrapeFull({ captureUrl: async url => detail(url) }, async () => 'saved', compact);
  expect(result.detailCount).toBe(3000);
});

it('keeps earlier run history unchanged when later runs enrich the same opportunity', async () => {
  const { buildModel } = await import('../zoer/dashboard/model');
  const documents = [
    { record: { id: 'one', runId: 'old', createdAt: '2026-09-05T00:00:00Z' }, document: { version: 1, kind: 'listing', records: [{ sourceKey: '123456', processId: '123456', description: 'Listing' }] } },
    { record: { id: 'two', runId: 'old', createdAt: '2026-09-05T00:01:00Z' }, document: { version: 1, kind: 'scrape', scope: 'all-current-public-opportunities', knownKeys: ['123456'], listingCount: 1, detailsCompleted: 0 } },
    { record: { id: 'three', runId: 'new', createdAt: '2026-09-05T00:02:00Z' }, document: { version: 1, kind: 'detail', record: { processId: '123456', detailFields: [{ label: 'Contact', value: 'Published contact' }] } } },
  ];
  const model = buildModel({ runs: [{ id: 'old', actionId: 'scrape.full', status: 'failed', createdAt: '2026-09-05T00:00:00Z' }], artifacts: [] }, documents);
  expect(model.opportunities[0].detailFields).toHaveLength(1);
  expect(model.history.get('old')!.get('123456').detailFields).toHaveLength(0);
});
