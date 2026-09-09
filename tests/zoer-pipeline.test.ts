import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import { scrapeSample, LISTING_URL } from '../zoer/src/scrape';
import { buildModel, queryModel } from '../zoer/dashboard/model';
import { normalizeContractAwardImportRecord } from '../packages/shared/src/contractAwards';
const fixture = (path: string) => readFileSync(new URL(`./fixtures/${path}`, import.meta.url), 'utf8');
const page = (html: string, url = LISTING_URL) => ({ html, url, title: 'BC Bid', capturedAt: '2026-09-05T22:00:00Z' });
const run = (status = 'succeeded') => ({ id: 'run-1', actionId: 'scrape.sample', createdAt: '2026-09-05T22:00:00Z', completedAt: '2026-09-05T22:01:00Z', status });
const wrap = (document: any, i = 0) => ({ record: { id: `artifact-${i}`, runId: 'run-1', createdAt: `2026-09-05T22:00:0${i}Z` }, document });

describe('Zoer scraping pipeline and source dashboard model', () => {
  it('captures a listing page and details, checkpoints each result, and fills dashboard/detail/history queries', async () => {
    const saved: any[] = [], urls: string[] = [];
    const output = await scrapeSample({ captureUrl: async url => {
      urls.push(url); return page(fixture(url === LISTING_URL ? 'listing/page1.html' : 'detail/with-addenda.html'), url);
    } }, async doc => { saved.push(structuredClone(doc)); return `artifact-${saved.length}`; }, 1);
    expect(urls).toHaveLength(2);
    expect(saved[0].complete).toBe(false);
    expect(saved.at(-1).complete).toBe(true);
    expect(output).toMatchObject({ listingCount: 2, detailCount: 1, limited: true });
    const model = buildModel({ runs: [run()], artifacts: [] }, saved.map(wrap));
    expect(queryModel(model, 'dashboard.summary').total).toBe(2);
    const list = queryModel(model, 'opportunities.list', { limit: 1 });
    expect(list.nextCursor).toBe('1');
    const detail = queryModel(model, 'opportunities.getByProcessId', { processId: saved[0].records[0].processId });
    expect(detail.addenda.length).toBeGreaterThan(0);
    expect(queryModel(model, 'opportunities.listByRunId', { runId: 'run-1' })).toHaveLength(2);
    expect(model.runs[0].counts.detailCount).toBe(1);
  });
  it('fails browser checks before writing success and retains listing checkpoints when a detail is blocked', async () => {
    const saved: any[] = [];
    const blocked = page(fixture('browser-check/browser-check.html'), 'https://bcbid.gov.bc.ca/page.aspx/en/bas/browser_check');
    await expect(scrapeSample({ captureUrl: async () => blocked }, async doc => { saved.push(doc); return 'a'; })).rejects.toThrow('manually');
    expect(saved).toEqual([]);
    await expect(scrapeSample({ captureUrl: async url => url === LISTING_URL ? page(fixture('listing/page1.html')) : blocked }, async doc => { saved.push(structuredClone(doc)); return 'a'; })).rejects.toThrow('manually');
    const model = buildModel({ runs: [{ ...run('failed'), error: 'Manual browser check required' }], artifacts: [] }, saved.map(wrap));
    expect(model.opportunities).toHaveLength(2);
    expect(model.runs[0].status).toBe('failed');
    expect(model.runs[0].counts.detailCount).toBe(0);
    expect(saved[0].complete).toBe(false);
  });
  it('rejects an unrelated opportunity detail and invalid limits', async () => {
    await expect(scrapeSample({ captureUrl: async url => page(fixture(url === LISTING_URL ? 'listing/page1.html' : 'detail/with-addenda.html'), url === LISTING_URL ? url : 'https://bcbid.gov.bc.ca/page.aspx/en/rfp/process_manage_extranet/999999') }, async () => 'a', 1)).rejects.toThrow('different opportunity');
    await expect(scrapeSample({ captureUrl: async () => { throw new Error('must not navigate'); } }, async () => 'a', 4)).rejects.toThrow('0-3');
  });
  it('deduplicates re-imported awards and reuses the source analysis and profile calculations', () => {
    const row = normalizeContractAwardImportRecord({ opportunityDescription: 'Published services', successfulSupplier: 'Example supplier', issuingOrganization: 'Example organization', contractValueText: '1,250.00', awardDate: '2025-01-01' } as any);
    const doc = { version: 1, kind: 'awards', fileName: 'test.json', records: [row, row] };
    const model = buildModel({ runs: [], artifacts: [] }, [wrap(doc), wrap(doc, 1)]);
    expect(queryModel(model, 'contractAwards.summary').total).toBe(1);
    const overview = queryModel(model, 'contractAwardsAnalysis.overview', { datePreset: 'all' });
    expect(overview.summary.totalAwardValue).toBe(1250);
    expect(overview.summary.totalAwards).toBe(1);
    const options = queryModel(model, 'contractAwardsAnalysis.entityOptions', { kind: 'supplier' });
    expect(options).toHaveLength(1);
    const profile = queryModel(model, 'contractAwardsAnalysis.supplierProfile', { supplierKey: options[0].key, filters: {} });
    expect(profile.summary.totalAwards).toBe(1);
  });
});
