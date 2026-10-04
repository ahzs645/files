import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { collectConnectorSource, collectProcurementSource } from '../zoer/src/connector-collection';
import { bidsAndTenders } from '../zoer/src/connectors/bidsandtenders';
import { connectorCollectionKey, CANADABUYS_DATASET_URL } from '../zoer/dashboard/procurement/source-adapters';
import manifest from '../zoer/manifest.json';

const fixture = (name: string) => readFileSync(new URL(`./fixtures/bidsandtenders/${name}`, import.meta.url), 'utf8');
const KEY = connectorCollectionKey('bidsandtenders');
const NANAIMO_4318 = 'opportunity:bidsandtenders:nanaimo:3d527422-9423-47e4-86a2-38c8fe7f94b7';
const LISTINGS: Record<string, string> = Object.fromEntries(['nanaimo', 'burnaby', 'richmond', 'metrovancouver', 'princegeorge', 'surrey', 'islandhealthfdc'].map(id => [id, fixture(`${id}-Open.json`)]));
const EMPTY = '{"success":true,"total":0,"data":[]}';
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
    host: async (method: string, input: any): Promise<any> => {
      if (method === 'network.fetch') {
        requests.push(input); mock.onFetch?.(input.url);
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
      expect(Object.keys(request.headers).every(name => ['accept', 'content-type', 'user-agent'].includes(name))).toBe(true);
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

  it('stops starting portals near the action timeout and leaves the rest for resume', async () => {
    const db = stack();
    let current = Date.parse(t0);
    db.onFetch = url => { if (url.includes('burnaby')) current = Date.parse(t0) + 8 * 60_000; };
    const result = await collectConnectorSource(db.host, { sourceId: 'bidsandtenders', portals: ['nanaimo', 'burnaby', 'princegeorge'] }, 'run-1', () => new Date(current).toISOString());
    expect(result).toMatchObject({ status: 'incomplete', error: { code: 'time_budget' }, attempt: { open: true }, portals: { burnaby: { status: 'complete' }, nanaimo: { status: 'not-run' }, princegeorge: { status: 'not-run' } } });
    db.requests.length = 0; db.onFetch = undefined;
    const resumed = await collectConnectorSource(db.host, { sourceId: 'bidsandtenders', portals: ['nanaimo', 'burnaby', 'princegeorge'] }, 'run-2', clock('2026-10-03T19:00:00Z'));
    expect(resumed.status).toBe('complete');
    expect(db.requests.some(request => request.url.includes('burnaby'))).toBe(false);
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

  it('collects all 25 portals by default within the manifest request budget', async () => {
    const db = stack();
    const result = await collectConnectorSource(db.host, { sourceId: 'bidsandtenders' }, 'run-1', clock());
    expect(Object.keys(result.portals)).toHaveLength(25);
    expect(result.status).toBe('complete');
    const action = (manifest as any).integration.actions.find((item: any) => item.id === 'procurement.collect');
    expect(db.requests.length).toBeLessThanOrEqual(action.resourceLimits.maxNetworkRequests);
    expect(db.requests.length).toBeLessThanOrEqual(25 * bidsAndTenders.requestsPerPortal);
  });

  it('routes CanadaBuys to its own checksummed path', async () => {
    const db = stack();
    await expect(collectProcurementSource(db.host, { sourceId: 'canadabuys' }, 'run-1')).rejects.toThrow();
    expect(db.requests[0].url).toBe(CANADABUYS_DATASET_URL);
    expect(db.states.has(KEY)).toBe(false);
  });
});
