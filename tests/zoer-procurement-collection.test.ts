import { describe, expect, it } from 'vitest';
import { collectCanadaBuys } from '../zoer/src/procurement-collection';
import { COLLECTION_KEY, CANADABUYS_DATASET_URL, PROCUREMENT_SOURCE_ADAPTERS, canadaBuysClosingAt } from '../zoer/dashboard/procurement/source-adapters';

const headers = 'referenceNumber-numeroReference,title-titre-eng,tenderStatus-appelOffresStatut-eng,tenderClosingDate-appelOffresDateCloture,contractingEntityName-nomEntitContractante-eng';
const csv = (count = 1) => headers + '\n' + Array.from({ length: count }, (_, i) => `${i},Tender ${i},Open,2026-10-01T13:00:00,Buyer`).join('\n');
const timestamp = '2026-09-22T12:00:00Z';
function fixture(body = csv(), prior: any = undefined) {
  let revision = 1;
  const states = new Map<string, any>(prior ? [[COLLECTION_KEY, structuredClone(prior)]] : []);
  const records = new Map<string, any>([['opportunity:0', { id: 'opportunity:0', kind: 'opportunity', title: 'BC Bid existing', data: { sourceKey: '0', description: 'BC Bid existing', starred: true } }],
    ['opportunity:canadabuys:tender:closed:', { id: 'opportunity:canadabuys:tender:closed:', kind: 'opportunity', title: 'Old closed record', data: { sourceId: 'canadabuys', status: 'Closed' } }]]);
  const requests: any[] = [], commits: any[] = [];
  const mock = { response: { status: 200, headers: { 'last-modified': 'Tue, 22 Sep 2026 10:00:00 GMT', etag: 'source-etag' }, bodyBase64: Buffer.from(body).toString('base64') },
    networkError: undefined as Error | undefined, conflicts: 0, beforeRecordsCommit: undefined as (() => void) | undefined,
    records, states, requests, commits,
    host: async (method: string, input: any): Promise<any> => {
      if (method === 'network.fetch') { requests.push(input); if (mock.networkError) throw mock.networkError; return structuredClone(mock.response); }
      if (method === 'catalog.read') {
        if (input.revision !== undefined && input.revision !== revision) throw Error('Catalog changed; reload the snapshot.');
        return { primary: true, revision, records: input.ids.map((id: string) => records.get(id)).filter(Boolean).map((row: any) => structuredClone(row)) };
      }
      if (method === 'catalog.workspace') return { revision, entries: [...states].filter(([key]) => input.keys.includes(key)).map(([key,value]) => ({key,value:structuredClone(value)})) };
      if (method === 'catalog.commit') {
        if (input.records?.length && mock.beforeRecordsCommit) { const change = mock.beforeRecordsCommit; mock.beforeRecordsCommit = undefined; change(); revision++; }
        if (input.revision !== revision) return { conflict: true };
        if (input.records?.length && mock.conflicts > 0) { mock.conflicts--; revision++; return { conflict: true }; }
        for (const row of input.records ?? []) records.set(row.id, structuredClone(row));
        for (const entry of input.entries ?? []) states.set(entry.key, structuredClone(entry.value));
        commits.push(structuredClone(input)); return { revision: ++revision };
      }
      throw Error('Unexpected method ' + method);
    } };
  return mock;
}

describe('CanadaBuys host-mediated collection', () => {
  it('fetches only the declared official source and atomically saves checksummed records/cursor without deleting existing data', async () => {
    const db = fixture(), prior = structuredClone([...db.records]);
    const result = await collectCanadaBuys(db.host, { sourceId: 'canadabuys' }, 'collect-one', () => timestamp);
    expect(db.requests).toEqual([{ url: CANADABUYS_DATASET_URL, method: 'GET', headers: { accept: 'text/csv', 'user-agent': 'ZoerProcurement/0.24' } }]);
    expect(result).toMatchObject({ status: 'complete', lastAttemptedAt: timestamp, lastSuccessAt: timestamp, receipt: { offset: 1, totalRecords: 1, byteCount: Buffer.byteLength(csv()), importedAt: timestamp } });
    expect(result.receipt.sha256).toMatch(/^[a-f0-9]{64}$/);
    for (const [id, value] of prior) expect(db.records.get(id)).toEqual(value);
    expect(db.records.get('opportunity:canadabuys:tender:0:').data).toMatchObject({ externalId: '0', sourceId: 'canadabuys', sourceFileSha256: result.receipt.sha256,
      closingDate: '2026-10-01T13:00:00', closingAt: '2026-10-01T13:00:00-05:00', sourceClosingTimezone: 'UTC-05:00' });
    const batchCommit = db.commits.find(commit => commit.records?.length);
    expect(batchCommit.entries[0].value.receipt.offset).toBe(1);
    expect(batchCommit.history[0].data.sourceFileSha256).toBe(result.receipt.sha256);
  });
  it('pauses at the batch bound and resumes the same snapshot without resetting import provenance', async () => {
    const db = fixture(csv(101));
    const first = await collectCanadaBuys(db.host, { sourceId: 'canadabuys', maxBatches: 1 }, 'one', () => timestamp);
    expect(first).toMatchObject({ status: 'paused', receipt: { offset: 100, totalRecords: 101 } });
    expect(first.lastSuccessAt).toBeUndefined();
    const second = await collectCanadaBuys(db.host, { sourceId: 'canadabuys' }, 'two', () => '2026-09-22T12:01:00Z');
    expect(second).toMatchObject({ status: 'complete', receipt: { offset: 101, importedAt: timestamp } });
    expect(db.records.size).toBe(103);
    expect(db.commits.filter(commit => commit.records?.length).map(commit => commit.records.length)).toEqual([100,1]);
  });
  it('refuses resume against changed bytes and supports an explicit additive restart', async () => {
    const db = fixture(csv(101));
    await collectCanadaBuys(db.host, { sourceId: 'canadabuys' }, 'one', () => timestamp);
    db.response.bodyBase64 = Buffer.from(csv(102)).toString('base64');
    await expect(collectCanadaBuys(db.host, { sourceId: 'canadabuys' }, 'two', () => timestamp)).rejects.toThrow('snapshot changed');
    expect(db.states.get(COLLECTION_KEY)).toMatchObject({ status: 'failed', error: { code: 'source_changed' }, receipt: { offset: 100 } });
    const result = await collectCanadaBuys(db.host, { sourceId: 'canadabuys', mode: 'restart', maxBatches: 2 }, 'three', () => timestamp);
    expect(result).toMatchObject({ status: 'complete', receipt: { offset: 102 } }); expect(db.records.size).toBe(104);
  });
  it('reports HTTP 403 without replacing records or prior successful receipts', async () => {
    const db = fixture(); await collectCanadaBuys(db.host, { sourceId: 'canadabuys' }, 'one', () => timestamp);
    const prior = structuredClone([...db.records]), success = db.states.get(COLLECTION_KEY).lastSuccessReceipt;
    db.response.status = 403;
    await expect(collectCanadaBuys(db.host, { sourceId: 'canadabuys' }, 'two', () => timestamp)).rejects.toThrow('HTTP 403');
    expect([...db.records]).toEqual(prior);
    expect(db.states.get(COLLECTION_KEY)).toMatchObject({ status: 'failed', lastSuccessReceipt: success, error: { code: 'source_forbidden' } });
  });
  it.each(['bad,headers\n1,2', headers + '\n', headers + '\n0,"broken', 'referenceNumber-numeroReference,title-titre-eng\n0,Missing required status'])('records schema failure with no partial row writes', async body => {
    const db = fixture(body), prior = structuredClone([...db.records]);
    await expect(collectCanadaBuys(db.host, { sourceId: 'canadabuys' }, 'one', () => timestamp)).rejects.toThrow(/validation failed|columns changed/);
    expect([...db.records]).toEqual(prior); expect(db.states.get(COLLECTION_KEY).error.code).toBe('source_schema');
  });
  it('retains concurrent star and document changes by rereading after optimistic commit conflicts', async () => {
    const db = fixture(), id = 'opportunity:canadabuys:tender:0:';
    db.records.set(id, { id, kind: 'opportunity', title: 'Previous', data: { sourceId: 'canadabuys', starred: true, attachments: [{ id: 'old' }] } });
    db.beforeRecordsCommit = () => { db.records.set(id, { ...db.records.get(id), data: { sourceId: 'canadabuys', starred: false, attachments: [{ id: 'new' }], detailFields: [{ label: 'Extracted', value: 'Newest' }], descriptionText: 'Newest extracted text' } }); };
    await collectCanadaBuys(db.host, { sourceId: 'canadabuys' }, 'one', () => timestamp);
    expect(db.records.get(id).data).toMatchObject({ starred: false, attachments: [{id:'new'}], descriptionText: 'Newest extracted text', detailFields: [{ label: 'Extracted', value: 'Newest' }] });
  });
  it('never advances cursor after exhausted conflicts and resumes on a later run', async () => {
    const db = fixture(); db.conflicts = 4;
    await expect(collectCanadaBuys(db.host, { sourceId: 'canadabuys' }, 'one', () => timestamp)).rejects.toThrow('Catalog changed repeatedly');
    expect(db.states.get(COLLECTION_KEY)).toMatchObject({ status: 'failed', receipt: { offset: 0 } });
    expect(db.records.size).toBe(2);
    expect(await collectCanadaBuys(db.host, { sourceId: 'canadabuys' }, 'two', () => timestamp)).toMatchObject({status:'complete'});
  });
  it('records exact oversized exclusions and checksum without claiming complete coverage or replacing previous success', async () => {
    const body = headers + ',unknown\n0,Tender,Open,2026-10-01T13:00:00,Buyer,' + 'x'.repeat(250001) + '\n1,Small,Open,2026-10-01T13:00:00,Buyer,ok';
    const db = fixture(body, { lastSuccessAt: 'previous success', lastSuccessReceipt: { sha256: 'previous' } });
    const result = await collectCanadaBuys(db.host, { sourceId: 'canadabuys' }, 'one', () => timestamp);
    expect(result).toMatchObject({ status: 'incomplete', lastSuccessAt: 'previous success', lastSuccessReceipt: { sha256: 'previous' },
      error: { code: 'source_records_excluded' }, receipt: { parserVersion: 2, totalSourceRecords: 2, totalRecords: 1, offset: 1, excludedCount: 1, coverageComplete: false,
        excluded: [{ csvRecord: 2, bytes: expect.any(Number), reason: expect.stringContaining('250 kB') }] } });
    expect(result.receipt.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(db.records.has('opportunity:canadabuys:tender:0:')).toBe(false);
    expect(db.records.has('opportunity:canadabuys:tender:1:')).toBe(true);
    const resumed = await collectCanadaBuys(db.host, { sourceId: 'canadabuys' }, 'two', () => timestamp);
    expect(resumed.status).toBe('incomplete'); expect(resumed.lastSuccessAt).toBe('previous success');
  });
  it('reports an entirely oversized snapshot as incomplete with no record writes', async () => {
    const db = fixture(headers + ',unknown\n0,Tender,Open,2026-10-01T13:00:00,Buyer,' + 'x'.repeat(250001));
    const prior = structuredClone([...db.records]);
    const result = await collectCanadaBuys(db.host, { sourceId: 'canadabuys' }, 'one', () => timestamp);
    expect(result).toMatchObject({ status: 'incomplete', receipt: { totalRecords: 0, totalSourceRecords: 1, excludedCount: 1 } });
    expect(result.lastSuccessAt).toBeUndefined(); expect([...db.records]).toEqual(prior);
  });
  it('requires restart when a previous parser cursor could refer to a different included record set', async () => {
    const db = fixture(csv(101));
    await collectCanadaBuys(db.host, { sourceId: 'canadabuys' }, 'one', () => timestamp);
    delete db.states.get(COLLECTION_KEY).receipt.parserVersion;
    await expect(collectCanadaBuys(db.host, { sourceId: 'canadabuys' }, 'two', () => timestamp)).rejects.toThrow('parser changed');
    expect(db.states.get(COLLECTION_KEY).receipt.offset).toBe(100);
    expect((await collectCanadaBuys(db.host, { sourceId: 'canadabuys', mode: 'restart', maxBatches: 2 }, 'three', () => timestamp)).status).toBe('complete');
  });
  it('does not run concurrently with a live collection lease', async () => {
    const db = fixture(csv(), { ownerRunId: 'other', status: 'running', leaseUntil: '2026-09-22T12:05:00Z' });
    await expect(collectCanadaBuys(db.host, { sourceId: 'canadabuys' }, 'one', () => timestamp)).rejects.toThrow('already running');
    expect(db.requests).toHaveLength(0); expect(db.commits).toHaveLength(0);
  });
  it('reports host network/size failures honestly and rejects unsupported source requests', async () => {
    const db = fixture(); db.networkError = Error('Network response exceeded its size limit.');
    await expect(collectCanadaBuys(db.host, { sourceId:'canadabuys' }, 'one', () => timestamp)).rejects.toThrow('size limit');
    expect(db.states.get(COLLECTION_KEY).error.code).toBe('collection_failed');
    await expect(collectCanadaBuys(db.host, {sourceId:'unimplemented' as any}, 'two')).rejects.toThrow('Invalid');
  });
  it.each(['not valid base64!', 'A'.repeat(Math.ceil(20 * 1024 * 1024 / 3) * 4 + 8)])('rejects malformed or oversized encoded source bodies before parsing', async bodyBase64 => {
    const db = fixture(); db.response.bodyBase64 = bodyBase64;
    await expect(collectCanadaBuys(db.host, { sourceId:'canadabuys' }, 'one', () => timestamp)).rejects.toThrow('malformed or exceeds');
    expect(db.records.size).toBe(2); expect(db.states.get(COLLECTION_KEY).error.code).toBe('source_size');
  });
  it('refuses implicit catalog creation when the existing catalog is not initialized', async () => {
    const calls: string[] = [];
    await expect(collectCanadaBuys(async method => { calls.push(method); return {primary:false}; }, {sourceId:'canadabuys'}, 'one')).rejects.toThrow('Initialize the existing');
    expect(calls).toEqual(['catalog.read']);
  });
});

describe('source capability contract', () => {
  it('does not advertise CanadaBuys attachment downloading or award collection', () => {
    const source = PROCUREMENT_SOURCE_ADAPTERS.find(source => source.id === 'canadabuys')!;
    expect(source.capabilities.attachments.status).toBe('unavailable'); expect(source.capabilities.awards.status).toBe('unavailable');
  });
  it.each(['2026-02-30T12:00:00', '2026-10-01', '2026-10-01T25:00:00', '2026-10-01T12:00:00Z', ''])('does not infer offsets for invalid or differently formatted dates: %s', raw => expect(canadaBuysClosingAt(raw)).toBeUndefined());
});
