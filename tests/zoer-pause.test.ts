import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import { scrapeFull, fullScrapeResume, compactCheckpoint } from '../zoer/src/full-scrape';
import { saveCatalogDocument } from '../zoer/src/catalog';
import { scrapeAwardRanges, newAwardRanges } from '../zoer/src/award-ranges';
import { createHostChannel, isPauseError, ZoerPausedError, PAUSE_CODE } from '../zoer/src/pause';
import { buildModel, queryModel } from '../zoer/dashboard/model';
import { LISTING_URL } from '../zoer/src/scrape';
import { AWARDS_URL } from '../zoer/src/award-history';

const fixture = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');
// Two opportunities per listing page; identities are unique per page.
function listing(number: number, last: number) {
  const html = fixture('listing/page1.html').replace(/\b(\d{6})\b/g, value => String(Number(value) + number * 100));
  return { url: LISTING_URL, title: 'BC Bid', capturedAt: new Date().toISOString(), html, pagination: { currentPage: number, hasNext: number < last, visiblePages: [1, 2, 3] } };
}
const detail = (url: string) => ({ url, title: 'BC Bid', capturedAt: new Date().toISOString(), html: fixture('detail/with-addenda.html') });
const browserCheck = () => ({ url: 'https://bcbid.gov.bc.ca/page.aspx/en/browser_check', title: 'Check', capturedAt: new Date().toISOString(), html: '<html></html>' });
const pausedByHost = () => new ZoerPausedError('Paused for Zoer update');

/** In-memory Zoer catalog with optimistic revisions, the subset the worker uses. */
function memoryCatalog() {
  const records = new Map<string, any>(), entries = new Map<string, any>();
  let revision = 1;
  const host = async (method: string, input: any): Promise<any> => {
    if (method === 'catalog.read') {
      if (input.match) return { primary: true, revision, records: [...records.values()].filter(row => row.kind === input.match.kind && row.data?.[input.match.field] === input.match.value).slice(0, input.limit) };
      return { primary: true, revision, records: (input.ids ?? []).map((id: string) => records.get(id)).filter(Boolean).map((row: any) => structuredClone(row)) };
    }
    if (method === 'catalog.workspace') return { revision, entries: input.keys.filter((key: string) => entries.has(key)).map((key: string) => ({ key, value: structuredClone(entries.get(key)) })) };
    if (method === 'catalog.commit') {
      if (input.revision !== revision) return { conflict: true };
      for (const row of input.records ?? []) records.set(row.id, structuredClone(row));
      for (const entry of input.entries ?? []) entries.set(entry.key, structuredClone(entry.value));
      return { revision: ++revision };
    }
    throw new Error(`Unexpected host method ${method}`);
  };
  return { host, entries, records, save: (runId: string) => (doc: any) => saveCatalogDocument(host, doc, runId) };
}

describe('full scrape pause for Zoer update', () => {
  it('stops at a ZOER_PAUSED capture, saves progress, and returns a compact checkpoint', async () => {
    const catalog = memoryCatalog();
    const urls: string[] = [];
    let details = 0;
    const result: any = await scrapeFull({ captureUrl: async (url, number) => {
      if (url === LISTING_URL) return listing(number!, 2);
      if (++details === 3) throw pausedByHost();
      urls.push(url); return detail(url);
    } }, catalog.save('run-1'), undefined, { runId: 'run-1' });
    expect(result).toMatchObject({ paused: true, checkpoint: { version: 2, phase: 'detail', currentPage: 2, totalPages: 2 } });
    expect(result.checkpoint.completedIds).toHaveLength(2);
    expect(result.checkpoint.pendingIds).toHaveLength(2);
    const saved = catalog.entries.get('checkpoint:full');
    expect(saved).toMatchObject({ runId: 'run-1', complete: false, phase: 'detail', currentPage: 2, detailsCompleted: 2, failures: [] });
    expect(saved.error).toBeUndefined();
    expect(saved.pending.map((row: any) => row.sourceKey)).toEqual(result.checkpoint.pendingIds);
    expect(urls.map(url => url.split('/').at(-1))).toEqual(result.checkpoint.completedIds);
  });

  it('pauses mid-listing without losing the captured pages', async () => {
    const catalog = memoryCatalog();
    const result: any = await scrapeFull({ captureUrl: async (url, number) => {
      if (number === 2) throw Object.assign(new Error('Zoer is draining.'), { code: PAUSE_CODE });
      return url === LISTING_URL ? listing(number!, 3) : detail(url);
    } }, catalog.save('run-1'), undefined, { runId: 'run-1' });
    expect(result).toMatchObject({ paused: true, checkpoint: { phase: 'listing', currentPage: 1, completedIds: [] } });
    expect(result.checkpoint.pendingIds).toHaveLength(2);
    const pages: number[] = [], fetched: string[] = [];
    const resumed: any = await scrapeFull({ captureUrl: async (url, number) => { if (url === LISTING_URL) { pages.push(number!); return listing(number!, 3); } fetched.push(url); return detail(url); } }, catalog.save('run-1'), result.checkpoint, { runId: 'run-1' });
    expect(pages).toEqual([2, 3]);
    expect(resumed).toMatchObject({ listingCount: 6, detailCount: 6, totalPages: 3 });
    expect(fetched).toHaveLength(6);
  });

  it('resumes from the returned checkpoint without refetching completed details', async () => {
    const catalog = memoryCatalog();
    let details = 0;
    const first: any = await scrapeFull({ captureUrl: async (url, number) => {
      if (url === LISTING_URL) return listing(number!, 2);
      if (++details === 3) throw pausedByHost();
      return detail(url);
    } }, catalog.save('run-1'), undefined, { runId: 'run-1' });
    const resume = await fullScrapeResume({ run: { id: 'run-1' }, input: {}, resumeCheckpoint: first.checkpoint }, async () => { throw new Error('not read'); });
    const urls: string[] = [];
    const result: any = await scrapeFull({ captureUrl: async url => { if (url === LISTING_URL) throw new Error('listing refetched'); urls.push(url); return detail(url); } }, catalog.save('run-1'), resume, { runId: 'run-1' });
    expect(urls.map(url => url.split('/').at(-1))).toEqual(first.checkpoint.pendingIds);
    expect(result).toMatchObject({ detailCount: 4, listingCount: 4 });
    expect(catalog.entries.get('checkpoint:full')).toMatchObject({ complete: true, pending: [] });
  });

  it('continues saved catalog progress when Zoer resumes a hard-stopped run with a null checkpoint', async () => {
    const catalog = memoryCatalog();
    let details = 0;
    await scrapeFull({ captureUrl: async (url, number) => {
      if (url === LISTING_URL) return listing(number!, 2);
      if (++details === 2) throw pausedByHost();
      return detail(url);
    } }, catalog.save('run-1'), undefined, { runId: 'run-1' });
    const pending = catalog.entries.get('checkpoint:full').pending.map((row: any) => row.detailUrl);
    expect(pending).toHaveLength(3);
    const load = async () => catalog.entries.get('checkpoint:full');
    // Same input as the original fresh run ({}); the host marks the resume with resumeCheckpoint: null.
    const resume = await fullScrapeResume({ run: { id: 'run-1' }, input: {}, resumeCheckpoint: null }, load);
    expect(resume).toMatchObject({ phase: 'detail', detailsCompleted: 1 });
    const urls: string[] = [];
    const result: any = await scrapeFull({ captureUrl: async url => { if (url === LISTING_URL) throw new Error('listing refetched'); urls.push(url); return detail(url); } }, catalog.save('run-1'), resume, { runId: 'run-1' });
    expect(urls).toEqual(pending);
    expect(result.detailCount).toBe(4);
    // A re-run of the same run continues its own progress even without the resume marker.
    expect(await fullScrapeResume({ run: { id: 'run-1' }, input: {} }, async () => ({ ...(await load()), complete: false, phase: 'detail' }))).toBeTruthy();
  });

  it('keeps a genuine fresh scrape fresh', async () => {
    const catalog = memoryCatalog();
    let details = 0;
    await scrapeFull({ captureUrl: async (url, number) => {
      if (url === LISTING_URL) return listing(number!, 2);
      if (++details === 2) throw pausedByHost();
      return detail(url);
    } }, catalog.save('old-run'), undefined, { runId: 'old-run' });
    const load = async () => catalog.entries.get('checkpoint:full');
    expect(await fullScrapeResume({ run: { id: 'new-run' }, input: {} }, load)).toBeUndefined();
    // ZOER_RESUMED_FROM_PAUSE=1 marks a resume even when the request omits resumeCheckpoint.
    expect(await fullScrapeResume({ run: { id: 'new-run' }, input: {} }, load, true)).toMatchObject({ runId: 'old-run', complete: false });
    expect(await fullScrapeResume({ run: { id: 'new-run' }, input: {}, resumeCheckpoint: null }, async () => ({ ...(await load()), complete: true }))).toBeUndefined();
    const pages: number[] = [];
    const result: any = await scrapeFull({ captureUrl: async (url, number) => { if (url === LISTING_URL) { pages.push(number!); return listing(number!, 2); } return detail(url); } }, catalog.save('new-run'), undefined, { runId: 'new-run' });
    expect(pages).toEqual([1, 2]);
    expect(result).toMatchObject({ listingCount: 4, detailCount: 4, totalPages: 2 });
    expect(catalog.entries.get('checkpoint:full')).toMatchObject({ runId: 'new-run', complete: true });
  });

  it('saves the checkpoint before failing on a browser check, so Continue scrape resumes', async () => {
    const catalog = memoryCatalog();
    let details = 0;
    await expect(scrapeFull({ captureUrl: async (url, number) => {
      if (url === LISTING_URL) return listing(number!, 2);
      return ++details === 2 ? browserCheck() : detail(url);
    } }, catalog.save('run-1'), undefined, { runId: 'run-1' })).rejects.toThrow(/browser check/);
    const saved = catalog.entries.get('checkpoint:full');
    expect(saved).toMatchObject({ complete: false, phase: 'detail', detailsCompleted: 1, error: expect.stringMatching(/browser check/) });
    expect(saved.pending).toHaveLength(3);
    const urls: string[] = [];
    const result: any = await scrapeFull({ captureUrl: async url => { urls.push(url); return detail(url); } }, catalog.save('run-2'), compactCheckpoint(saved), { runId: 'run-2' });
    expect(urls).toHaveLength(3);
    expect(result.detailCount).toBe(4);
  });
});

describe('worker host channel', () => {
  it.each([
    ['a pause field on the host response', false],
    ['a standalone pause line', true],
  ])('honours %s and refuses new browser work while catalog saves continue', async (_, standalone) => {
    const inbox: any[] = [], sent: any[] = [];
    const channel = createHostChannel(async () => inbox.shift(), value => {
      sent.push(value);
      const call = value as any;
      // Zoer requests a pause while a capture is in flight; that capture still completes.
      const pause = call.method === 'browser.capture-url' ? { reason: 'maintenance', graceSeconds: 60, drainId: 'd1' } : undefined;
      if (pause && standalone) inbox.push({ type: 'pause', ...pause });
      inbox.push({ protocolVersion: '1', kind: 'host-response', requestId: call.requestId, ok: true, result: call.method, ...(pause && !standalone ? { pause } : {}) });
    });
    expect(await channel.request('browser.capture-url', {})).toMatchObject({ ok: true, result: 'browser.capture-url' });
    expect(channel.pauseRequested()).toBe(true);
    await expect(channel.request('browser.capture-url', {})).rejects.toThrow(ZoerPausedError);
    await expect(channel.request('network.fetch', {})).rejects.toThrow(ZoerPausedError);
    expect(await channel.request('catalog.commit', {})).toMatchObject({ ok: true });
    expect(sent.map(call => call.method)).toEqual(['browser.capture-url', 'catalog.commit']);
  });
  it('turns a ZOER_PAUSED host error into a pause, never a failure', () => {
    const channel = createHostChannel(async () => null, () => undefined);
    expect(isPauseError(channel.failure({ ok: false, error: { code: 'ZOER_PAUSED', message: 'Paused for Zoer update' } }))).toBe(true);
    expect(isPauseError(channel.failure({ ok: false, error: { code: 'host_error', message: 'Paused for Zoer update' } }))).toBe(true);
    expect(isPauseError(channel.failure({ ok: false, error: { code: 'browser_failed', message: 'Browser unavailable' } }))).toBe(false);
  });
});

describe('award history pause for Zoer update', () => {
  const AWARDS = AWARDS_URL;
  const page = (number: number, hasNext: boolean, date: string) => ({ url: AWARDS, title: 'Awards', capturedAt: '2026-09-06T00:00:00Z',
    html: `<table id="body_x_grid_grd"><thead><tr>${['Opportunity ID', 'Opportunity Description', 'Successful Supplier', 'Award Date', 'Contract Value'].map(h => `<th>${h}</th>`).join('')}</tr></thead><tbody><tr><td>${date}-${number}</td><td>Award ${number}</td><td>Supplier</td><td>${date}</td><td>1.00</td></tr></tbody></table>`,
    pagination: { currentPage: number, hasNext, visiblePages: [1, 2] } });
  it('returns the last saved range checkpoint and resumes only the unfinished range', async () => {
    const start = newAwardRanges('2024-01-01', '2025-12-31', new Date('2025-06-01T00:00:00Z'));
    const saved: any[] = [];
    const save = async (doc: any) => { saved.push(structuredClone(doc)); return 'a'; };
    let calls = 0;
    const first: any = await scrapeAwardRanges(async request => {
      if (++calls === 2) throw pausedByHost();
      return page(request.page, false, request.range.from);
    }, save, start);
    expect(first).toMatchObject({ paused: true, checkpoint: { complete: false, active: 1 } });
    expect(first.checkpoint).toEqual(saved.at(-1).checkpoint);
    const ranges: string[] = [];
    const result: any = await scrapeAwardRanges(async request => { ranges.push(request.range.from); return page(request.page, false, request.range.from); }, save, first.checkpoint);
    expect(ranges).toEqual(['2024-01-01']);
    expect(result).toMatchObject({ complete: true, count: 2 });
  });
});

describe('dashboard shows a paused run as paused for update', () => {
  const doc = { record: { id: 'c', runId: 'r1', createdAt: '2026-10-01T00:05:00Z' }, document: { version: 1, kind: 'scrape', scope: 'all-current-public-opportunities', phase: 'detail', currentPage: 3, totalPages: 3, listingCount: 6, detailsCompleted: 2, pending: Array(4).fill({}), knownKeys: ['1', '2', '3', '4', '5', '6'], error: 'old error' } };
  it.each([
    { status: 'waiting_for_event', queueReason: null },
    { status: 'waiting_for_event', queueReason: 'Paused for update' },
    { status: 'pending', queueReason: 'Paused for Zoer update' },
  ])('$status / $queueReason', run => {
    const model = buildModel({ runs: [{ id: 'r1', actionId: 'scrape.full', createdAt: '2026-10-01T00:00:00Z', error: null, ...run }], artifacts: [] }, [doc]);
    expect(model.runs[0]).toMatchObject({ status: 'running', paused: true, errorCode: null, errorMessage: null, progress: { phase: 'paused' } });
    expect(model.runs[0].progress.message).toMatch(/^Paused for update\..*no action needed/);
    expect(model.runs[0].progress.message).toContain('4 remaining');
    // Still active: no duplicate start or manual Continue while Zoer resumes it.
    expect(queryModel(model, 'scrapeRuns.active')?._id).toBe('r1');
  });
  it('does not mark ordinary running or interrupted runs as paused', () => {
    const model = buildModel({ runs: [{ id: 'r1', actionId: 'scrape.full', status: 'running', createdAt: '2026-10-01T00:00:00Z' }, { id: 'r2', actionId: 'scrape.full', status: 'outcome_unknown', createdAt: '2026-09-01T00:00:00Z' }], artifacts: [] }, []);
    expect(model.runs.map(run => run.paused)).toEqual([false, false]);
    expect(model.runs[1].errorCode).toBe('scrape_interrupted');
  });
});
