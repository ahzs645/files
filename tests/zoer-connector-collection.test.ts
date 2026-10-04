import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { collectConnectorSource } from '../zoer/src/connector-collection';
import { collectAllSources, collectProcurementSource, collectionSlice, PORTAL_RETRIES, type SliceEnvelope } from '../zoer/src/collection-run';
import { bidsAndTenders } from '../zoer/src/connectors/bidsandtenders';
import { CONNECTORS } from '../zoer/src/connectors';
import { SITE_PORTALS } from '../zoer/dashboard/procurement/site-portals';
import { connectorCollectionKey, CANADABUYS_DATASET_URL, COLLECTION_KEY } from '../zoer/dashboard/procurement/source-adapters';
import manifest from '../zoer/manifest.json';

const fixture = (name: string) => readFileSync(new URL(`./fixtures/bidsandtenders/${name}`, import.meta.url), 'utf8');
const KEY = connectorCollectionKey('bidsandtenders');
const NANAIMO_4318 = 'opportunity:bidsandtenders:nanaimo:3d527422-9423-47e4-86a2-38c8fe7f94b7';
const LISTINGS: Record<string, string> = Object.fromEntries(['nanaimo', 'burnaby', 'richmond', 'metrovancouver', 'princegeorge', 'surrey', 'islandhealthfdc'].map(id => [id, fixture(`${id}-Open.json`)]));
const EMPTY = '{"success":true,"total":0,"data":[]}';
/** municipal-sites listing pages (saved fixtures); their notice pages answer 404, which the connector keeps as warnings. */
const SITE_LISTING_FILE: Record<string, string> = { srd: 'srd-listing-open.html', surrey: 'surrey-listing-1.html' };
const SITE_LISTINGS = new Map(SITE_PORTALS.flatMap(site => site.listUrls.map(url => [url, readFileSync(new URL(`./fixtures/municipal-sites/${SITE_LISTING_FILE[site.id] ?? `${site.id}-listing.html`}`, import.meta.url), 'utf8')] as const)));
const b64 = (text: string) => Buffer.from(text).toString('base64');

/** Catalog + bids&tenders site behind one host function, like tests/zoer-procurement-collection.test.ts. */
function stack(options: { prior?: any; clock?: () => string } = {}) {
  let revision = 1;
  const states = new Map<string, any>(options.prior ? [[KEY, structuredClone(options.prior)]] : []);
  const records = new Map<string, any>([['opportunity:0', { id: 'opportunity:0', kind: 'opportunity', title: 'BC Bid existing', data: { sourceKey: '0', description: 'BC Bid existing', starred: true } }]]);
  const requests: any[] = [], commits: any[] = [];
  const home = fixture('nanaimo-home.html'), token = /name="__RequestVerificationToken" type="hidden" value="([^"]+)"/.exec(home.slice(home.indexOf('bidDetailAntiForgery')))![1];
  const mock = {
    records, states, requests, commits, conflicts: 0,
    /** Per portal search override: a status, an Error to throw, or a JSON body. */
    search: {} as Record<string, number | Error | string>,
    beforeRecordsCommit: undefined as (() => void) | undefined,
    onFetch: undefined as ((url: string) => void) | undefined,
    /** The CanadaBuys daily CSV: a status, an Error to throw, or the CSV text. */
    canadabuys: 404 as number | Error | string,
    /** HTTP status for every municipal-sites listing page. */
    sites: undefined as number | undefined,
    host: async (method: string, input: any): Promise<any> => {
      if (method === 'network.fetch') {
        requests.push(input); mock.onFetch?.(input.url);
        if (input.url === CANADABUYS_DATASET_URL) {
          if (mock.canadabuys instanceof Error) throw mock.canadabuys;
          return typeof mock.canadabuys === 'number' ? { status: mock.canadabuys, headers: {}, bodyBase64: '' } : { status: 200, headers: {}, bodyBase64: b64(mock.canadabuys) };
        }
        if (SITE_LISTINGS.has(input.url)) return { status: mock.sites ?? 200, headers: {}, bodyBase64: b64(SITE_LISTINGS.get(input.url)!) };
        if (!input.url.includes('.bidsandtenders.ca/')) return { status: 404, headers: {}, bodyBase64: b64('Not found') };
        const url = new URL(input.url), portal = url.hostname.split('.')[0];
        if (url.pathname.endsWith('/Home/BidsHomepage')) return { status: 200, headers: {}, bodyBase64: b64(home) };
        if (url.pathname.includes('/Tender/Search/')) {
          expect(input).toMatchObject({ method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' } });
          expect(Buffer.from(input.bodyBase64, 'base64').toString()).toBe(`keywords=&__RequestVerificationToken=${encodeURIComponent(token)}`);
          const override = mock.search[portal];
          if (override instanceof Error) throw override;
          if (typeof override === 'number') return { status: override, headers: {}, bodyBase64: '' };
          return { status: 200, headers: {}, bodyBase64: b64(override ?? LISTINGS[portal] ?? EMPTY) };
        }
        if (url.pathname.endsWith('/Tender/Detail/3d527422-9423-47e4-86a2-38c8fe7f94b7')) return { status: 200, headers: {}, bodyBase64: b64(fixture('nanaimo-detail.html')) };
        return { status: 302, headers: { location: '/Module/Tenders/' }, bodyBase64: '' };
      }
      if (method === 'catalog.read') {
        if (input.revision !== undefined && input.revision !== revision) throw Error('Catalog changed; reload the snapshot.');
        return { primary: true, revision, records: input.ids.map((id: string) => records.get(id)).filter(Boolean).map((row: any) => structuredClone(row)) };
      }
      if (method === 'catalog.workspace') return { revision, entries: [...states].filter(([key]) => input.keys.includes(key)).map(([key, value]) => ({ key, value: structuredClone(value) })) };
      if (method === 'catalog.commit') {
        if (input.records?.length && mock.beforeRecordsCommit) { const change = mock.beforeRecordsCommit; mock.beforeRecordsCommit = undefined; change(); revision++; }
        if (input.revision !== revision) return { conflict: true };
        if (input.records?.length && mock.conflicts > 0) { mock.conflicts--; revision++; return { conflict: true }; }
        for (const row of input.records ?? []) records.set(row.id, structuredClone(row));
        for (const entry of input.entries ?? []) states.set(entry.key, structuredClone(entry.value));
        commits.push(structuredClone(input)); return { revision: ++revision };
      }
      throw Error('Unexpected method ' + method);
    },
  };
  return mock;
}
const t0 = '2026-10-03T18:00:00.000Z';
const clock = (start = t0, stepMs = 1000) => { let at = Date.parse(start); return () => new Date(at += stepMs).toISOString(); };
const saved = (db: ReturnType<typeof stack>, portal: string) => [...db.records.values()].filter(row => row.data.portalId === portal);

describe('connector collection (bids&tenders)', () => {
  it('collects selected portals into the catalog with one state entry per portal and no deletions', async () => {
    const db = stack(), before = structuredClone(db.records.get('opportunity:0'));
    const result = await collectConnectorSource(db.host, { sourceId: 'bidsandtenders', portals: ['nanaimo', 'burnaby', 'surrey'] }, 'run-1', clock());
    expect(result).toMatchObject({ version: 1, sourceId: 'bidsandtenders', status: 'complete', ownerRunId: 'run-1', leaseUntil: null, error: null,
      portals: { nanaimo: { status: 'complete', recordCount: 7, totalReported: 7 }, burnaby: { status: 'complete', recordCount: 9, totalReported: 9 },
        surrey: { status: 'complete', recordCount: 0, totalReported: 0 } } });
    expect(result.lastSuccessAt).toBeDefined(); expect(result.portals.nanaimo.lastSuccessAt).toBeDefined();
    expect(result.portals.nanaimo.warnings).toEqual([expect.stringContaining('Notice pages could not be read for 6 notice(s) (HTTP 302)')]);
    expect(saved(db, 'nanaimo')).toHaveLength(7); expect(saved(db, 'burnaby')).toHaveLength(9);
    expect(db.records.get('opportunity:0')).toEqual(before);
    expect(db.records.get(NANAIMO_4318)).toMatchObject({ kind: 'opportunity', title: '4318 - Self-Contained Breathing Apparatus Filling Station Maintenance Services',
      data: { externalId: '4318', type: 'Request for Proposal', closingAt: '2026-10-07T15:00:00-07:00', starred: false, lastRunId: 'run-1' } });
    // Only GET and form POST; headers within Zoer's allowed set; cookies are the host's business.
    for (const request of db.requests) {
      expect(['GET', 'POST']).toContain(request.method);
      expect(Object.keys(request.headers).every(name => ['accept', 'content-type'].includes(name))).toBe(true);
    }
    expect(db.states.get(KEY)).toEqual(result);
    const recordCommits = db.commits.filter(commit => commit.records?.length);
    expect(recordCommits.map(commit => commit.entries[0].value.portals[commit.records[0].data.portalId].status)).toEqual(['complete', 'complete']);
    // Portals run in the connector's order (burnaby before nanaimo), whatever order the input lists them in.
    expect(recordCommits[0].history[0]).toMatchObject({ runId: 'run-1', id: expect.stringMatching(/^bidsandtenders:burnaby:/) });
  });

  it('saves the other portals when one fails and reports the failure on that portal', async () => {
    const db = stack();
    db.search.burnaby = 500; db.search.richmond = '{"success":true,"data":"changed"}';
    const result = await collectConnectorSource(db.host, { sourceId: 'bidsandtenders', portals: ['burnaby', 'nanaimo', 'richmond', 'princegeorge'] }, 'run-1', clock());
    expect(result).toMatchObject({ status: 'incomplete', error: { code: 'portals_failed', message: expect.stringContaining('2 failed of 4 portal(s)') },
      portals: { burnaby: { status: 'failed', error: { code: 'source_http_error' } }, richmond: { status: 'failed', error: { code: 'source_schema' } },
        nanaimo: { status: 'complete', recordCount: 7 }, princegeorge: { status: 'complete', recordCount: 1 } } });
    expect(result.lastSuccessAt).toBeUndefined();
    expect(saved(db, 'nanaimo')).toHaveLength(7); expect(saved(db, 'burnaby')).toHaveLength(0);
    // A finished attempt is not "resumed": the next run fetches every portal again, and a recovered portal keeps nothing stale.
    delete db.search.burnaby; delete db.search.richmond; db.requests.length = 0;
    const next = await collectConnectorSource(db.host, { sourceId: 'bidsandtenders', portals: ['burnaby', 'nanaimo', 'richmond', 'princegeorge'] }, 'run-2', clock('2026-10-03T19:00:00Z'));
    expect(next).toMatchObject({ status: 'complete', error: null, portals: { burnaby: { status: 'complete', recordCount: 9, error: null } } });
    expect(new Set(db.requests.map(request => new URL(request.url).hostname.split('.')[0]))).toEqual(new Set(['burnaby', 'nanaimo', 'richmond', 'princegeorge']));
  });

  it('keeps a failed portal\'s last success and saved records', async () => {
    const db = stack();
    await collectConnectorSource(db.host, { sourceId: 'bidsandtenders', portals: ['nanaimo'] }, 'run-1', clock());
    const first = structuredClone(db.states.get(KEY).portals.nanaimo), records = structuredClone(saved(db, 'nanaimo'));
    db.search.nanaimo = 403;
    const result = await collectConnectorSource(db.host, { sourceId: 'bidsandtenders', portals: ['nanaimo'] }, 'run-2', clock('2026-10-04T18:00:00Z'));
    expect(result.portals.nanaimo).toMatchObject({ status: 'failed', error: { code: 'source_forbidden' }, lastSuccessAt: first.lastSuccessAt, retrievedAt: first.retrievedAt, recordCount: 7 });
    expect(saved(db, 'nanaimo')).toEqual(records);
  });

  it('preserves stars, files, addenda, detail fields, extracted text and a refined place, including concurrent edits', async () => {
    const db = stack();
    db.records.set(NANAIMO_4318, { id: NANAIMO_4318, kind: 'opportunity', title: 'old', data: { sourceId: 'bidsandtenders', sourceKey: NANAIMO_4318.slice(12), starred: true,
      attachments: [{ id: 'old' }], descriptionText: 'old', sourceDescriptionText: 'old', contacts: [{ name: 'Buyer', source: 'detail-field' }] } });
    db.beforeRecordsCommit = () => db.records.set(NANAIMO_4318, { ...db.records.get(NANAIMO_4318), data: { ...db.records.get(NANAIMO_4318).data, starred: false,
      attachments: [{ id: 'new' }], addenda: [{ id: 'a1' }], detailFields: [{ label: 'Extracted', value: 'x' }], descriptionText: 'Extracted text',
      place: { municipality: 'Nanaimo', regionalDistrict: 'Nanaimo', method: 'description' } } });
    await collectConnectorSource(db.host, { sourceId: 'bidsandtenders', portals: ['nanaimo'] }, 'run-1', clock());
    expect(db.records.get(NANAIMO_4318).data).toMatchObject({ starred: false, attachments: [{ id: 'new' }], addenda: [{ id: 'a1' }], detailFields: [{ label: 'Extracted', value: 'x' }],
      descriptionText: 'Extracted text', place: { method: 'description' }, contacts: [{ name: 'Buyer' }], sourceDescriptionText: expect.stringContaining('SCBA filling stations'), closingDate: 'Wed Oct 7, 2026 3:00 PM (PDT)' });
  });

  it('refreshes unenriched description text from the source', async () => {
    const db = stack();
    db.records.set(NANAIMO_4318, { id: NANAIMO_4318, kind: 'opportunity', title: 'old', data: { sourceId: 'bidsandtenders', descriptionText: 'old source', sourceDescriptionText: 'old source' } });
    await collectConnectorSource(db.host, { sourceId: 'bidsandtenders', portals: ['nanaimo'] }, 'run-1', clock());
    expect(db.records.get(NANAIMO_4318).data.descriptionText).toContain('SCBA filling stations');
  });

  it('stops a portal on a source identity collision and leaves the other record alone', async () => {
    const db = stack(), other = { id: NANAIMO_4318, kind: 'opportunity', title: 'x', data: { sourceId: 'canadabuys' } };
    db.records.set(NANAIMO_4318, structuredClone(other));
    const result = await collectConnectorSource(db.host, { sourceId: 'bidsandtenders', portals: ['nanaimo', 'princegeorge'] }, 'run-1', clock());
    expect(result.portals).toMatchObject({ nanaimo: { status: 'failed', error: { message: expect.stringContaining('identity collision') } }, princegeorge: { status: 'complete' } });
    expect(db.records.get(NANAIMO_4318)).toEqual(other);
  });

  it('splits large portals into bounded batches and marks the portal complete only with its last batch', async () => {
    const rows = Array.from({ length: 150 }, (_, i) => ({ ...JSON.parse(LISTINGS.nanaimo).data[1], Id: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`, Title: `${i} - Notice` }));
    const db = stack(); db.search.nanaimo = JSON.stringify({ success: true, total: 150, data: rows });
    const result = await collectConnectorSource(db.host, { sourceId: 'bidsandtenders', portals: ['nanaimo'] }, 'run-1', clock());
    expect(result.portals.nanaimo).toMatchObject({ status: 'complete', recordCount: 150 });
    const batches = db.commits.filter(commit => commit.records?.length);
    expect(batches.length).toBeGreaterThan(1);
    expect(batches.reduce((sum, commit) => sum + commit.records.length, 0)).toBe(150);
    expect(batches.every(commit => commit.records.length <= 100)).toBe(true);
    expect(batches.slice(0, -1).every(commit => commit.entries[0].value.portals.nanaimo === undefined)).toBe(true);
    expect(batches.at(-1).entries[0].value.portals.nanaimo.status).toBe('complete');
  });

  it('marks a portal incomplete when it lists fewer notices than it reports', async () => {
    const db = stack(); db.search.nanaimo = JSON.stringify({ ...JSON.parse(LISTINGS.nanaimo), total: 400 });
    const result = await collectConnectorSource(db.host, { sourceId: 'bidsandtenders', portals: ['nanaimo'] }, 'run-1', clock());
    expect(result).toMatchObject({ status: 'incomplete', error: { code: 'portals_incomplete' }, portals: { nanaimo: { status: 'incomplete', recordCount: 7, totalReported: 400, error: { code: 'source_incomplete' } } } });
    expect(result.portals.nanaimo.lastSuccessAt).toBeUndefined();
  });

  it('pauses for a Zoer update with committed portals kept, and resume continues only the rest', async () => {
    const db = stack(), pause = Object.assign(new Error('Paused for Zoer update'), { code: 'ZOER_PAUSED' });
    db.search.princegeorge = pause;
    await expect(collectConnectorSource(db.host, { sourceId: 'bidsandtenders', portals: ['nanaimo', 'burnaby', 'princegeorge'] }, 'run-1', clock())).rejects.toBe(pause);
    const pausedState = db.states.get(KEY);
    expect(pausedState).toMatchObject({ status: 'paused', leaseUntil: null, attempt: { open: true }, portals: { burnaby: { status: 'complete' }, nanaimo: { status: 'complete' } } });
    expect(pausedState.portals.princegeorge).toBeUndefined();
    delete db.search.princegeorge; db.requests.length = 0;
    const resumed = await collectConnectorSource(db.host, { sourceId: 'bidsandtenders', portals: ['nanaimo', 'burnaby', 'princegeorge'] }, 'run-1', clock('2026-10-03T18:20:00Z'));
    expect(resumed).toMatchObject({ status: 'complete', attempt: { startedAt: pausedState.attempt.startedAt, open: false } });
    expect(db.requests.some(request => request.url.includes('nanaimo'))).toBe(false);
    // An explicit restart fetches everything again.
    db.requests.length = 0; db.search.burnaby = pause;
    await expect(collectConnectorSource(db.host, { sourceId: 'bidsandtenders', portals: ['nanaimo', 'burnaby', 'princegeorge'] }, 'run-2', clock('2026-10-03T18:30:00Z'))).rejects.toBe(pause);
    delete db.search.burnaby; db.requests.length = 0;
    await collectConnectorSource(db.host, { sourceId: 'bidsandtenders', mode: 'restart', portals: ['nanaimo', 'burnaby', 'princegeorge'] }, 'run-3', clock('2026-10-03T18:40:00Z'));
    expect(db.requests.some(request => request.url.includes('nanaimo'))).toBe(true);
  });

  it('does not continue a stale interrupted attempt or one for different portals', async () => {
    const db = stack(), pause = Object.assign(new Error('Paused for Zoer update'), { code: 'ZOER_PAUSED' });
    db.search.burnaby = pause;
    await expect(collectConnectorSource(db.host, { sourceId: 'bidsandtenders', portals: ['nanaimo', 'burnaby'] }, 'run-1', clock())).rejects.toBe(pause);
    delete db.search.burnaby; db.requests.length = 0;
    await collectConnectorSource(db.host, { sourceId: 'bidsandtenders', portals: ['nanaimo', 'burnaby'] }, 'run-2', clock('2026-10-04T06:00:00Z'));
    expect(db.requests.some(request => request.url.includes('nanaimo'))).toBe(true);
  });

  it('refuses to run beside a live lease, and takes over an expired one', async () => {
    const live = stack({ prior: { status: 'running', ownerRunId: 'other', leaseUntil: '2026-10-03T18:05:00Z', portals: {} } });
    await expect(collectConnectorSource(live.host, { sourceId: 'bidsandtenders', portals: ['nanaimo'] }, 'run-1', clock())).rejects.toThrow('already running');
    expect(live.requests).toHaveLength(0); expect(live.commits).toHaveLength(0);
    const expired = stack({ prior: { status: 'running', ownerRunId: 'other', leaseUntil: '2026-10-03T17:00:00Z', portals: {} } });
    expect((await collectConnectorSource(expired.host, { sourceId: 'bidsandtenders', portals: ['nanaimo'] }, 'run-1', clock())).status).toBe('complete');
  });

  it('stops saving when another run takes the checkpoint, and records commit conflicts honestly', async () => {
    const db = stack(); let taken = false;
    db.beforeRecordsCommit = () => { taken = true; db.states.set(KEY, { ...db.states.get(KEY), ownerRunId: 'intruder' }); };
    await expect(collectConnectorSource(db.host, { sourceId: 'bidsandtenders', portals: ['nanaimo'] }, 'run-1', clock())).rejects.toThrow('Another collection owns');
    expect(taken).toBe(true); expect(saved(db, 'nanaimo')).toHaveLength(0);
    const busy = stack(); busy.conflicts = 4;
    const result = await collectConnectorSource(busy.host, { sourceId: 'bidsandtenders', portals: ['nanaimo', 'princegeorge'] }, 'run-1', clock());
    expect(result.portals).toMatchObject({ nanaimo: { status: 'failed', error: { code: 'catalog_conflict' } }, princegeorge: { status: 'complete' } });
  });

  it('validates requests before touching the source', async () => {
    const db = stack();
    for (const input of [{ sourceId: 'nope' }, { sourceId: 'bidsandtenders', portals: ['atlantis'] }, { sourceId: 'bidsandtenders', portals: ['nanaimo', 'nanaimo'] },
      { sourceId: 'bidsandtenders', portals: [] }, { sourceId: 'bidsandtenders', mode: 'all' }, { sourceId: 'bidsandtenders', maxBatches: 0 }]) {
      await expect(collectConnectorSource(db.host, input as any, 'run-1')).rejects.toThrow('Invalid');
    }
    expect(db.requests).toHaveLength(0); expect(db.commits).toHaveLength(0);
    await expect(collectConnectorSource(async () => ({ primary: false }), { sourceId: 'bidsandtenders' }, 'run-1')).rejects.toThrow('Initialize');
  });

  it('collects all 25 portals by default, each portal within the per-step request budget', async () => {
    const db = stack();
    const result = await collectConnectorSource(db.host, { sourceId: 'bidsandtenders' }, 'run-1', clock());
    expect(Object.keys(result.portals)).toHaveLength(25);
    expect(result.status).toBe('complete');
    const action = (manifest as any).integration.actions.find((item: any) => item.id === 'procurement.collect');
    const perPortal = new Map<string, number>();
    for (const request of db.requests) { const host = new URL(request.url).hostname; perPortal.set(host, (perPortal.get(host) ?? 0) + 1); }
    // One portal is one resumable step, and Zoer's request budget applies per step.
    expect(Math.max(...perPortal.values())).toBeLessThanOrEqual(Math.min(action.resourceLimits.maxNetworkRequests, bidsAndTenders.requestsPerPortal));
  });

  it('routes CanadaBuys to its own checksummed path', async () => {
    const db = stack();
    await expect(collectProcurementSource(db.host, { sourceId: 'canadabuys' }, 'run-1')).rejects.toThrow();
    expect(db.requests[0].url).toBe(CANADABUYS_DATASET_URL);
    expect(db.states.has(KEY)).toBe(false);
  });
});

const CB_HEADERS = 'referenceNumber-numeroReference,title-titre-eng,tenderStatus-appelOffresStatut-eng,tenderClosingDate-appelOffresDateCloture,contractingEntityName-nomEntitContractante-eng';
const cbCsv = (count: number, tag = '') => CB_HEADERS + '\n' + Array.from({ length: count }, (_, i) => `${i},Tender ${i}${tag},Open,2026-10-30T13:00:00,Buyer`).join('\n');
const allPortals = (db: ReturnType<typeof stack>) => bidsAndTenders.portals.map(portal => db.states.get(KEY)?.portals?.[portal.id]?.status);

describe("collect all sources (sourceId: 'all', one schedule)", () => {
  it('collects CanadaBuys and then every connector within the manifest request budget, reporting each source', async () => {
    const db = stack(); db.canadabuys = cbCsv(3);
    const result = await collectProcurementSource(db.host, { sourceId: 'all' }, 'run-1', clock());
    expect(result).toMatchObject({ sourceId: 'all', status: 'complete', summary: { total: 1 + CONNECTORS.length, complete: 1 + CONNECTORS.length, failedSources: 0 },
      sources: [{ sourceId: 'canadabuys', outcome: 'complete' }, { sourceId: 'bidsandtenders', outcome: 'complete', portals: { total: 25, complete: 25, failed: 0 } },
        { sourceId: 'municipal-sites', outcome: 'complete', portals: { total: SITE_PORTALS.length, complete: SITE_PORTALS.length } }] });
    expect(result.sources.map(source => source.sourceId)).toEqual(['canadabuys', ...CONNECTORS.map(connector => connector.id)]);
    expect(db.requests[0].url).toBe(CANADABUYS_DATASET_URL);
    expect(db.states.get(COLLECTION_KEY)).toMatchObject({ status: 'complete', receipt: { offset: 3 } });
    expect(allPortals(db).every(status => status === 'complete')).toBe(true);
    // Zoer turns a schedule off for any step output with a numeric `failed` above zero; counts live under `summary`.
    expect((result as any).failed).toBeUndefined();
    const action = (manifest as any).integration.actions.find((item: any) => item.id === 'procurement.collect');
    expect(action.inputSchema.properties.sourceId.enum).toContain('all');
    // The per-step budget covers the largest step: CanadaBuys' one download, or one portal of any connector.
    expect(action.resourceLimits.maxNetworkRequests).toBeGreaterThanOrEqual(Math.max(1, ...CONNECTORS.map(connector => connector.requestsPerPortal)));
  });

  it('records a failing source and still collects the others without failing the run', async () => {
    const db = stack(); db.canadabuys = 503; db.search.burnaby = 500;
    const result = await collectAllSources(db.host, { sourceId: 'all' }, 'run-1', clock());
    expect(result).toMatchObject({ status: 'incomplete', summary: { complete: 1, partial: 1, failedSources: 1 },
      sources: [{ sourceId: 'canadabuys', outcome: 'failed', error: { code: 'source_http_error' } }, { sourceId: 'bidsandtenders', outcome: 'partial', portals: { failed: 1, complete: 24 } }, { sourceId: 'municipal-sites', outcome: 'complete' }] });
    expect(db.states.get(COLLECTION_KEY)).toMatchObject({ status: 'failed', error: { code: 'source_http_error' } });
    expect(db.states.get(KEY)).toMatchObject({ status: 'incomplete', portals: { burnaby: { status: 'failed' }, nanaimo: { status: 'complete' } } });
  });

  it('fails the run (so Zoer stops the schedule) only when every source failed', async () => {
    const db = stack(); db.canadabuys = 503;
    for (const portal of bidsAndTenders.portals) db.search[portal.id] = 503;
    db.sites = 503;
    await expect(collectAllSources(db.host, { sourceId: 'all' }, 'run-1', clock())).rejects.toThrow('Every source failed: canadabuys (source_http_error), bidsandtenders (portals_failed), municipal-sites (portals_failed)');
    // Each source's own state still says what happened.
    expect(db.states.get(COLLECTION_KEY).status).toBe('failed');
    expect(allPortals(db).every(status => status === 'failed')).toBe(true);
  });

  it('restarts CanadaBuys on a new daily file instead of failing, and continues the same file where it stopped', async () => {
    const db = stack(); db.canadabuys = cbCsv(150);
    const first = await collectAllSources(db.host, { sourceId: 'all', maxBatches: 1 }, 'run-1', clock());
    expect(first.sources[0]).toMatchObject({ sourceId: 'canadabuys', outcome: 'paused', status: 'paused' });
    expect(db.states.get(COLLECTION_KEY).receipt.offset).toBe(100);
    await collectAllSources(db.host, { sourceId: 'all', maxBatches: 1 }, 'run-2', clock('2026-10-03T20:00:00Z'));
    expect(db.states.get(COLLECTION_KEY)).toMatchObject({ status: 'complete', receipt: { offset: 150, totalRecords: 150 } });
    db.canadabuys = cbCsv(2, ' (amended)');
    const changed = await collectAllSources(db.host, { sourceId: 'all' }, 'run-3', clock('2026-10-04T20:00:00Z'));
    expect(changed.sources[0]).toMatchObject({ outcome: 'complete' });
    expect(db.states.get(COLLECTION_KEY).receipt).toMatchObject({ offset: 2, totalRecords: 2 });
    expect(db.records.get('opportunity:canadabuys:tender:1:').title).toBe('Tender 1 (amended)');
  });

  it('imports the whole CanadaBuys file across steps, then every connector: no source is left for a later run', async () => {
    const db = stack(); db.canadabuys = cbCsv(250);
    let current = Date.parse(t0);
    // Each CanadaBuys batch "takes" 3 minutes, so a 4-minute pass imports two batches and hands over.
    const host = async (method: string, input: any) => {
      if (method === 'catalog.commit' && input.records?.length && input.records[0].data.sourceId === 'canadabuys') current += 3 * 60_000;
      return db.host(method, input);
    };
    const result = await collectAllSources(host, { sourceId: 'all' }, 'run-1', () => new Date(current += 1000).toISOString());
    expect(db.states.get(COLLECTION_KEY)).toMatchObject({ status: 'complete', receipt: { offset: 250 } });
    expect(db.requests.filter(request => request.url === CANADABUYS_DATASET_URL)).toHaveLength(2);
    expect(result.sources.map((source: any) => source.outcome)).toEqual(['complete', 'complete', 'complete']);
    expect(result.summary).toMatchObject({ total: 3, complete: 3, notRun: 0, failedSources: 0 });
  });

  it('ends the run on a Zoer pause or a spent request budget, and leaves a busy source to its owner', async () => {
    const pause = Object.assign(new Error('Paused for Zoer update'), { code: 'ZOER_PAUSED' });
    const paused = stack(); paused.canadabuys = cbCsv(1); paused.search.nanaimo = pause;
    await expect(collectAllSources(paused.host, { sourceId: 'all' }, 'run-1', clock())).rejects.toThrow('Paused for Zoer update');
    expect(paused.states.get(KEY).status).toBe('paused');
    const spent = stack(); spent.canadabuys = new Error('Network request budget exhausted.');
    await expect(collectAllSources(spent.host, { sourceId: 'all' }, 'run-1', clock())).rejects.toThrow('budget exhausted');
    expect(spent.requests.some(request => request.url.includes('bidsandtenders'))).toBe(false);
    const portalBudget = stack(); portalBudget.canadabuys = cbCsv(1); portalBudget.search.burnaby = new Error('Network request budget exhausted.');
    await expect(collectAllSources(portalBudget.host, { sourceId: 'all' }, 'run-1', clock())).rejects.toThrow('budget exhausted');
    expect(portalBudget.states.get(KEY)).toMatchObject({ status: 'failed', error: { code: 'network_budget' }, portals: { abbotsford: { status: 'complete' } } });
    const busy = stack({ prior: { status: 'running', ownerRunId: 'manual', leaseUntil: '2026-10-03T18:30:00Z', portals: {} } }); busy.canadabuys = cbCsv(1);
    const result = await collectAllSources(busy.host, { sourceId: 'all' }, 'run-1', clock());
    expect(result).toMatchObject({ status: 'incomplete', sources: [{ outcome: 'complete' }, { sourceId: 'bidsandtenders', outcome: 'busy', error: { code: 'collection_busy' } }, { sourceId: 'municipal-sites', outcome: 'complete' }] });
  });

  it('validates the request before touching any source', async () => {
    const db = stack();
    for (const input of [{ sourceId: 'all', portals: ['nanaimo'] }, { sourceId: 'all', mode: 'auto' }, { sourceId: 'all', maxBatches: 21 }]) {
      await expect(collectProcurementSource(db.host, input, 'run-1')).rejects.toThrow('Invalid');
    }
    expect(db.requests).toHaveLength(0); expect(db.commits).toHaveLength(0);
  });
});

/**
 * Zoer's resumable dispatcher in miniature (S1): runs slices with the last checkpoint, counts consecutive retries in
 * `attempt`, enforces the 64 KiB checkpoint cap and stops at `done`, a pause or `maxSlices`.
 */
async function drive(host: (method: string, input: any) => Promise<any>, input: any, options: { now?: () => string; checkpoint?: unknown; maxSlices?: number; resumedAfter?: string } = {}) {
  const envelopes: SliceEnvelope[] = [];
  let checkpoint: unknown = options.checkpoint ?? null, attempt = 0;
  for (let step = 1; step <= (options.maxSlices ?? 500); step++) {
    const envelope = await collectionSlice(host, 'procurement.collect', input, 'run-r', { step, checkpoint, attempt, deadlineAt: '2026-10-03T19:00:00.000Z', ...(options.resumedAfter && step === 1 ? { resumedAfter: options.resumedAfter } : {}) }, { now: options.now ?? clock() });
    envelopes.push(structuredClone(envelope));
    if ('paused' in envelope) return { envelopes, checkpoint: envelope.checkpoint, output: undefined as any };
    expect(Buffer.byteLength(JSON.stringify((envelope as any).checkpoint ?? null))).toBeLessThanOrEqual(64 * 1024);
    if (envelope.resumable === 'done') return { envelopes, checkpoint, output: envelope.output as any };
    if (envelope.resumable === 'retry') { attempt++; checkpoint = envelope.checkpoint ?? checkpoint; continue; }
    attempt = 0; checkpoint = JSON.parse(JSON.stringify(envelope.checkpoint));
  }
  return { envelopes, checkpoint, output: undefined as any };
}
const kinds = (envelopes: SliceEnvelope[]) => envelopes.map(envelope => 'paused' in envelope ? 'paused' : envelope.resumable);
const refuse = (code: string, message: string) => Object.assign(new Error(message), { code });
/** db.host with per-URL overrides for network.fetch (a response object or an error to throw). */
const withFetch = (db: ReturnType<typeof stack>, override: (url: string, input: any) => any) => async (method: string, input: any) => {
  if (method === 'network.fetch') { const value = override(input.url, input); if (value instanceof Error) { db.requests.push(input); throw value; } if (value) { db.requests.push(input); return value; } }
  return db.host(method, input);
};
const PORTALS3 = { sourceId: 'bidsandtenders', portals: ['nanaimo', 'burnaby', 'princegeorge'] };

describe('resumable collection (one portal per slice, S1)', () => {
  it('collects one portal per slice with a small checkpoint, writes the slice deadline as the lease and returns the final state', async () => {
    const db = stack();
    const run = await drive(db.host, PORTALS3, { now: clock() });
    expect(kinds(run.envelopes)).toEqual(['continue', 'continue', 'done']);
    for (const envelope of run.envelopes) if (envelope.resumable === 'continue') expect(Buffer.byteLength(JSON.stringify(envelope.checkpoint))).toBeLessThan(1024);
    expect(run.envelopes.map(envelope => (envelope as any).progress?.phase)).toEqual(['bids&tenders (BC): City of Burnaby', 'bids&tenders (BC): City of Nanaimo', 'bids&tenders (BC): done']);
    expect(run.envelopes[0]).toMatchObject({ progress: { done: 1, total: 3, unit: 'items' } });
    expect(run.output).toMatchObject({ sourceId: 'bidsandtenders', status: 'complete', leaseUntil: null, ownerRunId: 'run-r' });
    // While the run works, older readers see it running until the slice deadline.
    const leases = db.commits.map(commit => commit.entries?.[0]?.value).filter(value => value?.status === 'running').map(value => value.leaseUntil);
    expect(new Set(leases)).toEqual(new Set(['2026-10-03T19:00:00.000Z']));
  });

  it('retries a portal the site asks to slow down for (429 Retry-After), leaving it untouched, then collects it', async () => {
    const db = stack(); let refusals = 1;
    const host = withFetch(db, url => url.includes('burnaby') && url.includes('/Tender/Search/') && refusals-- > 0 ? { status: 429, headers: {}, bodyBase64: '', retryAfterMs: 30_000 } : undefined);
    const run = await drive(host, PORTALS3);
    expect(kinds(run.envelopes)).toEqual(['retry', 'continue', 'continue', 'done']);
    expect(run.envelopes[0]).toMatchObject({ resumable: 'retry', retryAfterMs: 30_000, error: { code: 'source_rate_limited' }, checkpoint: { portalIndex: 0 } });
    expect(run.output.portals.burnaby).toMatchObject({ status: 'complete' });
    expect(run.output.status).toBe('complete');
  });

  it(`after ${PORTAL_RETRIES} retries a lasting server error fails only that portal; the run carries on and succeeds`, async () => {
    const db = stack();
    const host = withFetch(db, url => url.includes('burnaby') && url.includes('/Tender/Search/') ? { status: 503, headers: {}, bodyBase64: '' } : undefined);
    const run = await drive(host, PORTALS3);
    expect(kinds(run.envelopes)).toEqual([...Array(PORTAL_RETRIES).fill('retry'), 'continue', 'continue', 'done']);
    expect(run.output).toMatchObject({ status: 'incomplete', error: { code: 'portals_failed' }, portals: { burnaby: { status: 'failed', error: { code: 'source_http_error' } }, nanaimo: { status: 'complete' } } });
    // 403 is not temporary: no retry.
    const forbidden = stack();
    const refused = await drive(withFetch(forbidden, url => url.includes('burnaby') && url.includes('/Tender/Search/') ? { status: 403, headers: {}, bodyBase64: '' } : undefined), PORTALS3);
    expect(kinds(refused.envelopes)).toEqual(['continue', 'continue', 'done']);
    expect(refused.output.portals.burnaby).toMatchObject({ status: 'failed', error: { code: 'source_forbidden' } });
  });

  it('maps Zoer crawl refusals: pacing waits retry with the host hint; robots.txt disallowing the search is an honest not-collected state', async () => {
    const db = stack(); let waits = 1;
    const host = withFetch(db, url => {
      if (url.includes('nanaimo') && url.includes('/Tender/Search/')) return refuse('crawl_robots_disallowed', "nanaimo.bidsandtenders.ca's robots.txt does not allow /Module/Tenders/en/Tender/Search/1; nothing was requested.");
      if (url.includes('princegeorge') && waits-- > 0) return refuse('crawl_wait', 'princegeorge.bidsandtenders.ca may be requested again in 12 s (one request per 5 s), longer than this request may wait; nothing was requested. [crawl retryAfterMs=12000]');
      return undefined;
    });
    const run = await drive(host, PORTALS3);
    expect(run.envelopes.find(envelope => !('paused' in envelope) && envelope.resumable === 'retry')).toMatchObject({ retryAfterMs: 12_000, error: { code: 'crawl_wait', message: expect.not.stringContaining('[crawl') } });
    expect(run.output.portals.nanaimo).toMatchObject({ status: 'not-run', error: { code: 'robots_disallowed' } });
    expect(run.output.portals.nanaimo.error.message).toContain("Nanaimo's robots.txt does not allow automated collection");
    expect(run.output).toMatchObject({ status: 'incomplete', error: { code: 'robots_disallowed', message: '1 disallowed by robots.txt of 3 portal(s). Other portals were saved.' } });
    expect(run.output.portals.princegeorge.status).toBe('complete');
    // Unreadable robots.txt is a failure of that portal (Zoer reads it again within the hour).
    const unreadable = stack();
    const second = await drive(withFetch(unreadable, url => url.includes('burnaby') ? refuse('crawl_robots_unreadable', "burnaby.bidsandtenders.ca's robots.txt could not be read.") : undefined), PORTALS3);
    expect(second.output.portals.burnaby).toMatchObject({ status: 'failed', error: { code: 'robots_unreadable' } });
  });

  it('pauses between portals for a deploy or the user and continues from the checkpoint without refetching saved portals', async () => {
    const db = stack(), pause = refuse('ZOER_PAUSED', 'Paused for Zoer update');
    let paused = false;
    const host = withFetch(db, url => url.includes('nanaimo') && !paused ? (paused = true, pause) : undefined);
    const first = await drive(host, PORTALS3);
    expect(kinds(first.envelopes)).toEqual(['continue', 'paused']);
    expect(db.states.get(KEY)).toMatchObject({ status: 'paused', leaseUntil: null, portals: { burnaby: { status: 'complete' } } });
    db.requests.length = 0;
    const resumed = await drive(host, PORTALS3, { checkpoint: first.checkpoint, resumedAfter: 'maintenance' });
    expect(kinds(resumed.envelopes)).toEqual(['continue', 'done']);
    expect(db.requests.some(request => request.url.includes('burnaby'))).toBe(false);
    expect(resumed.output).toMatchObject({ status: 'complete', attempt: { startedAt: db.states.get(KEY).attempt.startedAt } });
  });

  it('is replay-safe: a slice run again after a restart skips what it already saved and saves each notice once', async () => {
    const db = stack();
    const one = await drive(db.host, PORTALS3, { maxSlices: 1 });
    await drive(db.host, PORTALS3, { checkpoint: one.checkpoint, maxSlices: 1 });
    // Zoer restarted after slice 2 committed but before it recorded its envelope: slice 2 runs again from slice 1's
    // checkpoint. Nanaimo is already saved in this attempt (catalog state), so the replay goes straight to the next portal.
    db.requests.length = 0;
    const replay = await drive(db.host, PORTALS3, { checkpoint: one.checkpoint, resumedAfter: 'restart' });
    expect(kinds(replay.envelopes)).toEqual(['done']);
    expect(db.requests.some(request => request.url.includes('nanaimo') || request.url.includes('burnaby'))).toBe(false);
    expect(replay.output.status).toBe('complete');
    expect(saved(db, 'nanaimo')).toHaveLength(7); expect(saved(db, 'burnaby')).toHaveLength(9);
  });

  it('a cancel runs one cleanup slice that marks the source paused with the reason; the next run continues the attempt', async () => {
    const db = stack();
    const one = await drive(db.host, PORTALS3, { maxSlices: 1 });
    const cleanup = await collectionSlice(db.host, 'procurement.collect', PORTALS3, 'run-r', { step: 2, checkpoint: one.checkpoint, attempt: 0, deadlineAt: '2026-10-03T19:00:00.000Z', cancelling: true }, { now: clock() });
    expect(cleanup).toMatchObject({ resumable: 'done', output: { status: 'cancelled' } });
    expect(db.states.get(KEY)).toMatchObject({ status: 'paused', leaseUntil: null, error: { code: 'cancelled' }, attempt: { open: true }, portals: { burnaby: { status: 'complete' } } });
    db.requests.length = 0;
    const next = await collectConnectorSource(db.host, PORTALS3, 'run-2', clock('2026-10-03T18:30:00Z'));
    expect(next.status).toBe('complete');
    expect(db.requests.some(request => request.url.includes('burnaby'))).toBe(false);
  });

  it('refuses a source another run is collecting under a different lock (all beside a single source)', async () => {
    const live = stack({ prior: { status: 'running', ownerRunId: 'other', leaseUntil: '2026-10-03T18:30:00Z', portals: {} } });
    await expect(drive(live.host, PORTALS3)).rejects.toThrow('already running');
    expect(live.requests).toHaveLength(0);
  });

  it('CanadaBuys without maxBatches imports the whole daily file pass by pass; with maxBatches it does exactly that in one slice', async () => {
    const db = stack(); db.canadabuys = cbCsv(250);
    let current = Date.parse(t0);
    const host = async (method: string, input: any) => {
      if (method === 'catalog.commit' && input.records?.length) current += 3 * 60_000;
      return db.host(method, input);
    };
    const run = await drive(host, { sourceId: 'canadabuys' }, { now: () => new Date(current += 1000).toISOString() });
    expect(kinds(run.envelopes)).toEqual(['continue', 'done']);
    expect(run.envelopes[0]).toMatchObject({ progress: { phase: 'CanadaBuys: importing the daily file', done: 200, total: 250, unit: 'rows' } });
    expect(run.output).toMatchObject({ status: 'complete', receipt: { offset: 250 } });
    const bounded = stack(); bounded.canadabuys = cbCsv(250);
    const manual = await drive(bounded.host, { sourceId: 'canadabuys', mode: 'restart', maxBatches: 1 });
    expect(kinds(manual.envelopes)).toEqual(['done']);
    expect(manual.output).toMatchObject({ status: 'paused', receipt: { offset: 100 } });
  });

  it('retries a CanadaBuys server error without marking the source failed, and in `all` records a lasting failure and goes on', async () => {
    const db = stack(); db.canadabuys = 503;
    const run = await drive(db.host, { sourceId: 'all' });
    expect(kinds(run.envelopes).slice(0, PORTAL_RETRIES + 1)).toEqual([...Array(PORTAL_RETRIES).fill('retry'), 'continue']);
    expect(run.output).toMatchObject({ sourceId: 'all', status: 'incomplete', summary: { failedSources: 1, complete: 2 }, sources: [{ sourceId: 'canadabuys', outcome: 'failed', error: { code: 'source_http_error' } }, { outcome: 'complete' }, { outcome: 'complete' }] });
    expect(db.states.get(COLLECTION_KEY).status).toBe('failed');
    expect(run.output).not.toHaveProperty('failed');
  });

  it('keeps the `all` checkpoint far below 64 KiB even with long source errors', async () => {
    const db = stack(); db.canadabuys = 404;
    for (const portal of bidsAndTenders.portals) db.search[portal.id] = new Error('x'.repeat(5000));
    const run = await drive(db.host, { sourceId: 'all' });
    const largest = Math.max(...run.envelopes.map(envelope => Buffer.byteLength(JSON.stringify((envelope as any).checkpoint ?? null))));
    expect(largest).toBeLessThan(4096);
    expect(run.output.sources.map((source: any) => source.outcome)).toEqual(['failed', 'failed', 'complete']);
  });
});
