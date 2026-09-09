import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import { scrapeFull, validateCheckpoint } from '../zoer/src/full-scrape';
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
