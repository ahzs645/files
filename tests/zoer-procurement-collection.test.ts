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
    expect(db.requests).toEqual([{ url: CANADABUYS_DATASET_URL, method: 'GET', headers: { accept: 'text/csv' } }]);
    expect(result).toMatchObject({ status: 'complete', lastAttemptedAt: timestamp, lastSuccessAt: timestamp, receipt: { offset: 1, totalRecords: 1, byteCount: Buffer.byteLength(csv()), importedAt: timestamp } });
    expect(result.receipt.sha256).toMatch(/^[a-f0-9]{64}$/);
    for (const [id, value] of prior) expect(db.records.get(id)).toEqual(value);
    expect(db.records.get('opportunity:canadabuys:tender:0:').data).toMatchObject({ externalId: '0', sourceId: 'canadabuys', sourceFileSha256: result.receipt.sha256,
      closingDate: '2026-10-01T13:00:00', closingAt: '2026-10-01T13:00:00-05:00', sourceClosingTimezone: 'UTC-05:00' });
    const batchCommit = db.commits.find(commit => commit.records?.length);
    expect(batchCommit.entries[0].value.receipt.offset).toBe(1);
    expect(batchCommit.history[0].data.sourceFileSha256).toBe(result.receipt.sha256);
  });
  it('keeps going past maxBatches until stopAt when a time-bounded run sets batchLimit', async () => {
    const db = fixture(csv(2_201));
    const result = await collectCanadaBuys(db.host, { sourceId: 'canadabuys', maxBatches: 20 }, 'all-run', () => timestamp, { stopAt: Date.parse(timestamp) + 60_000, batchLimit: 10_000 });
    expect(result).toMatchObject({ status: 'complete', receipt: { offset: 2_201, totalRecords: 2_201 } });
    const capped = fixture(csv(2_201));
    expect(await collectCanadaBuys(capped.host, { sourceId: 'canadabuys', maxBatches: 20 }, 'capped', () => timestamp)).toMatchObject({ status: 'paused', receipt: { offset: 2_000 } });
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

describe('CanadaBuys amendments, attachments and dates (2026-11-13)', () => {
  const H = 'referenceNumber-numeroReference,amendmentNumber-numeroModification,amendmentDate-dateModification,publicationDate-datePublication,title-titre-eng,tenderStatus-appelOffresStatut-eng,tenderClosingDate-appelOffresDateCloture,contractingEntityName-nomEntitContractante-eng,attachment-piecesJointes-eng';
  const row = (ref: string, amendment: string, title: string, closing = '2026-12-01T14:00:00', attachments = '') => `${ref},${amendment},${amendment === '000' ? '' : '2026-11-01'},2026-10-20,${title},Open,${closing},Buyer,"${attachments}"`;
  const legacy = (ref: string, amendment: string, extra: any = {}) => {
    const id = `opportunity:canadabuys:tender:${ref}:${amendment}`;
    return [id, { id, kind: 'opportunity', title: 'Old', data: { sourceId: 'canadabuys', sourceKey: id.slice(12), externalId: ref, importedAt: '2026-10-04T04:12:59.083Z',
      rawSourceData: { 'amendmentNumber-numeroModification': amendment, 'tenderClosingDate-appelOffresDateCloture': '2026-11-20T14:00:00' }, ...extra } }] as [string, any];
  };
  it('updates the reference\'s earliest saved record with a later amendment and keeps the amendment history; superseded rows are untouched', async () => {
    const db = fixture(H + '\n' + row('PW-1', '004', 'Roof (amended)'));
    const first = legacy('PW-1', '002', { starred: true }), second = legacy('PW-1', '003');
    db.records.set(...first); db.records.set(...second);
    const untouched = structuredClone(second[1]);
    await collectCanadaBuys(db.host, { sourceId: 'canadabuys' }, 'one', () => timestamp);
    expect(db.records.has('opportunity:canadabuys:tender:PW-1:004')).toBe(false);
    expect(db.records.get('opportunity:canadabuys:tender:PW-1:003')).toEqual(untouched);
    const saved = db.records.get('opportunity:canadabuys:tender:PW-1:002').data;
    expect(saved).toMatchObject({ sourceKey: 'canadabuys:tender:PW-1:002', processId: 'canadabuys:tender:PW-1:002', description: 'Roof (amended)', starred: true,
      amendmentNumber: '004', amendments: 4, amendmentDate: '2026-11-01', publishedAt: '2026-10-20', closingAt: '2026-12-01T14:00:00-05:00' });
    expect(saved.amendmentHistory.map((entry: any) => [entry.amendmentNumber, entry.seenAt])).toEqual([['002', '2026-10-04T04:12:59.083Z'], ['003', '2026-10-04T04:12:59.083Z'], ['004', timestamp]]);
    // The next daily file with the same amendment changes nothing in the history.
    db.response.bodyBase64 = Buffer.from(H + '\n' + row('PW-1', '004', 'Roof (amended)') + '\n').toString('base64');
    await collectCanadaBuys(db.host, { sourceId: 'canadabuys', mode: 'restart' }, 'two', () => '2026-09-23T12:00:00Z');
    expect(db.records.get('opportunity:canadabuys:tender:PW-1:002').data.amendmentHistory).toHaveLength(3);
  });
  it('keys a reference never saved before by its own amendment and finds the original notice saved with a blank amendment', async () => {
    const db = fixture(H + '\n' + row('NEW-1', '001', 'New') + '\n' + row('OLD-1', '001', 'Old notice'));
    db.records.set(...legacy('OLD-1', ''));
    await collectCanadaBuys(db.host, { sourceId: 'canadabuys' }, 'one', () => timestamp);
    expect(db.records.get('opportunity:canadabuys:tender:NEW-1:001').data.amendmentHistory).toEqual([expect.objectContaining({ amendmentNumber: '001' })]);
    expect(db.records.get('opportunity:canadabuys:tender:OLD-1:').data).toMatchObject({ description: 'Old notice', amendmentNumber: '001' });
    expect(db.records.has('opportunity:canadabuys:tender:OLD-1:001')).toBe(false);
  });
  it('saves public CanadaBuys files and login-only SSC portal links, keeping saved fields of the same link', async () => {
    const pdf = 'https://canadabuys.canada.ca/sites/default/files/webform/tender_notice/21898/100023064b---rfsa.pdf';
    const ssc = 'https://sscp2pspc.ssc-spc.gc.ca/page.aspx/en/fil/download_public/C39CCF5C-4D17-4299-BE2E-DCC77F8A2677';
    const db = fixture(H + '\n' + row('A-1', '000', 'Files', '2026-12-01T14:00:00', `${pdf},${ssc},javascript:alert(1)`));
    db.records.set(...legacy('A-1', '000', { attachments: [{ name: 'old name', url: pdf, size: 1444706, documentId: 'doc-1' }] }));
    await collectCanadaBuys(db.host, { sourceId: 'canadabuys' }, 'one', () => timestamp);
    const saved = db.records.get('opportunity:canadabuys:tender:A-1:000').data;
    expect(saved.attachments).toEqual([
      { name: '100023064b---rfsa.pdf', url: pdf, size: 1444706, documentId: 'doc-1' },
      { name: 'Document c39ccf5c (sscp2pspc.ssc-spc.gc.ca)', url: ssc, access: 'login' },
    ]);
    expect(saved.attachmentsAccess).toBe('mixed');
  });
  it('turns placeholder closing dates (after 2035) into closingDateRaw and drops a saved closingAt', async () => {
    const db = fixture(H + '\n' + row('SA-1', '000', 'Standing offer', '2074-12-31T14:00:00'));
    db.records.set(...legacy('SA-1', '000', { closingDate: '2074-12-31T14:00:00', closingAt: '2074-12-31T14:00:00-05:00' }));
    await collectCanadaBuys(db.host, { sourceId: 'canadabuys' }, 'one', () => timestamp);
    const saved = JSON.parse(JSON.stringify(db.records.get('opportunity:canadabuys:tender:SA-1:000').data));
    expect(saved).toMatchObject({ closingDate: null, closingDateRaw: '2074-12-31T14:00:00', closingDatePlaceholder: true });
    expect(saved).not.toHaveProperty('closingAt');
    // A real date later replaces the placeholder markers.
    db.response.bodyBase64 = Buffer.from(H + '\n' + row('SA-1', '001', 'Standing offer', '2027-03-31T14:00:00')).toString('base64');
    await collectCanadaBuys(db.host, { sourceId: 'canadabuys', mode: 'restart' }, 'two', () => timestamp);
    const later = JSON.parse(JSON.stringify(db.records.get('opportunity:canadabuys:tender:SA-1:000').data));
    expect(later).toMatchObject({ closingDate: '2027-03-31T14:00:00', closingAt: '2027-03-31T14:00:00-05:00' });
    expect(later).not.toHaveProperty('closingDateRaw'); expect(later).not.toHaveProperty('closingDatePlaceholder');
  });
  it('tries the download again in the same step after a DNS failure, but not after an HTTP answer', async () => {
    const db = fixture(), waits: number[] = [];
    let failures = 2;
    const host = async (method: string, input: any) => {
      if (method === 'network.fetch' && failures > 0) { failures--; db.requests.push(input); throw new Error('getaddrinfo EAI_AGAIN'); }
      return db.host(method, input);
    };
    expect(await collectCanadaBuys(host, { sourceId: 'canadabuys' }, 'one', () => timestamp, { sleep: async ms => { waits.push(ms); } })).toMatchObject({ status: 'complete' });
    expect(waits).toEqual([2000, 8000]); expect(db.requests).toHaveLength(3);
    failures = 5;
    await expect(collectCanadaBuys(host, { sourceId: 'canadabuys' }, 'two', () => timestamp, { sleep: async () => undefined, deferFailure: () => true })).rejects.toThrow('EAI_AGAIN');
    expect(db.states.get(COLLECTION_KEY).status).not.toBe('failed');
  });
});

describe('source capability contract', () => {
  it('does not advertise CanadaBuys attachment downloading or award collection', () => {
    const source = PROCUREMENT_SOURCE_ADAPTERS.find(source => source.id === 'canadabuys')!;
    expect(source.capabilities.attachments.status).toBe('unavailable'); expect(source.capabilities.awards.status).toBe('unavailable');
  });
  it.each(['2026-02-30T12:00:00', '2026-10-01', '2026-10-01T25:00:00', '2026-10-01T12:00:00Z', ''])('does not infer offsets for invalid or differently formatted dates: %s', raw => expect(canadaBuysClosingAt(raw)).toBeUndefined());
});
