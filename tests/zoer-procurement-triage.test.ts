// @vitest-environment jsdom
/**
 * Quick triage: hidden-notice state (contract, worker update, verified client), the "Closed · deadline passed" status,
 * company-profile quick filters (draft fields, value range, keyword SQL through the host bridge rules, preflight gate)
 * and Home queues leaving hidden notices out.
 */
import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
const { host } = vi.hoisted(() => ({ host: vi.fn() }));
vi.mock('../zoer/dashboard/bridge', () => ({ host }));
import { validateCatalogSelect } from '../../zoer/backend/src/catalog-reader';
import { updateProcurementState, hiddenKey } from '../zoer/src/procurement-state';
import { MAX_HIDDEN_BATCH, readProcurementItems, validateProcurementFilters, validateProcurementStateInput } from '../zoer/dashboard/procurement/state-contract';
import { setHiddenNotices } from '../zoer/dashboard/procurement/state-client';
import { noticeStatus } from '../zoer/dashboard/procurement/display';
import { cleanDraft, emptyDraft, normalizeDraft, validateDraft } from '../zoer/dashboard/review-workspace/profile-types';
import { VALUE_FACTS_SQL, filterReason, hasProfileFilters, keywordHitsSql, profileFilterRules, profileGate, readProfileFilterHits, readProfileRules, valueHit } from '../zoer/dashboard/review-workspace/profile-filter';
import { readDeadlines, readQueue } from '../zoer/dashboard/review-workspace/home-data';

afterEach(() => { host.mockReset(); });
const filters = { source: '', kind: 'all', search: '', region: '', category: '', classification: '', buyer: '', supplier: '', deadline: 'all', shortlist: false };

describe('saved-search exclude words', () => {
  it('reads older searches as no exclusions and bounds new ones', () => {
    expect(validateProcurementFilters(filters).exclude).toBe('');
    expect(validateProcurementFilters({ ...filters, exclude: 'golf, janitorial' }).exclude).toBe('golf, janitorial');
    expect(() => validateProcurementFilters({ ...filters, exclude: Array.from({ length: 16 }, (_, i) => `w${i}`).join(',') })).toThrow('at most 15');
    expect(() => validateProcurementFilters({ ...filters, exclude: 'x'.repeat(2001) })).toThrow('exclude');
    expect(() => validateProcurementFilters({ ...filters, exclude: 3 })).toThrow('exclude');
    expect(readProcurementItems({ schemaVersion: 1, items: [{ id: 'old', name: 'Old', filters, archived: false, version: 1, updatedAt: '2026-09-22T00:00:00Z', lastRunId: 'r' }] }, 'searches')).toHaveLength(1);
  });
});

describe('hidden notices state', () => {
  it('validates a bounded, de-duplicated set without an item version', () => {
    expect(validateProcurementStateInput({ operation: 'hidden.set', recordIds: ['opportunity:1', 'opportunity:1', 'award:2'], hidden: true })).toEqual({ operation: 'hidden.set', recordIds: ['opportunity:1', 'award:2'], hidden: true });
    for (const bad of [{ recordIds: [], hidden: true }, { recordIds: Array.from({ length: MAX_HIDDEN_BATCH + 1 }, (_, i) => `opportunity:${i}`), hidden: true }, { recordIds: ['opportunity:1'], hidden: 'yes' }, { recordIds: ['scrape-state:1'], hidden: true }, { recordIds: ['opportunity:1'], hidden: true, expectedVersion: 0 }])
      expect(() => validateProcurementStateInput({ operation: 'hidden.set', ...bad })).toThrow();
  });

  function database(records = ['opportunity:1', 'award:2']) {
    let revision = 3; const entries = new Map<string, any>(), commits: any[] = [];
    const call = async (method: string, input: any): Promise<any> => {
      if (method === 'catalog.read') return { primary: true, revision, records: records.filter(id => input.ids.includes(id)).map(id => ({ id, kind: id.split(':')[0], data: {} })) };
      if (method === 'catalog.commit') { if (input.revision !== revision) throw Error('Catalog changed; reload the snapshot.'); commits.push(input); for (const e of input.entries) entries.set(e.key, e.value); return { revision: ++revision }; }
      throw Error(`Unexpected ${method}`);
    };
    return { call, entries, commits, bump: () => revision++ };
  }
  it('writes one digest-keyed entry per record, touches nothing else, and undo writes hidden=false', async () => {
    const db = database();
    const result = await updateProcurementState(db.call, { operation: 'hidden.set', recordIds: ['opportunity:1', 'award:2'], hidden: true }, 'run-1');
    expect(result).toMatchObject({ recordIds: ['opportunity:1', 'award:2'], hidden: true });
    const key = 'procurement:hidden:' + createHash('sha256').update('opportunity:1').digest('hex');
    expect(hiddenKey('opportunity:1')).toBe(key);
    expect(db.entries.get(key)).toMatchObject({ schemaVersion: 1, recordId: 'opportunity:1', hidden: true, lastRunId: 'run-1' });
    expect(db.commits[0].records).toBeUndefined();
    await updateProcurementState(db.call, { operation: 'hidden.set', recordIds: ['opportunity:1'], hidden: false }, 'run-2');
    expect(db.entries.get(key)).toMatchObject({ hidden: false, lastRunId: 'run-2' });
  });
  it('refuses to hide a record that is gone, but lets one be shown again', async () => {
    const db = database([]);
    await expect(updateProcurementState(db.call, { operation: 'hidden.set', recordIds: ['opportunity:9'], hidden: true }, 'r')).rejects.toThrow('no longer exists');
    await expect(updateProcurementState(db.call, { operation: 'hidden.set', recordIds: ['opportunity:9'], hidden: false }, 'r')).resolves.toMatchObject({ hidden: false });
  });
  it('retries unrelated catalog revision changes', async () => {
    const db = database(); let bumped = false;
    const call = async (method: string, input: any) => { if (method === 'catalog.commit' && !bumped) { bumped = true; db.bump(); } return db.call(method, input); };
    await updateProcurementState(call, { operation: 'hidden.set', recordIds: ['opportunity:1'], hidden: true }, 'r');
    expect(db.commits).toHaveLength(1);
  });
  it('client reports success only when every record carries this run’s receipt', async () => {
    const rows = (runId: string, hidden: number) => [{ recordId: 'opportunity:1', hidden, runId }];
    let readBack = rows('run-1', 1);
    host.mockImplementation(async (method: string, input: any) => {
      if (method === 'action') { expect(input).toEqual({ actionId: 'procurement.state', input: { operation: 'hidden.set', recordIds: ['opportunity:1'], hidden: true } }); return { run: { id: 'run-1' } }; }
      if (method === 'state') return { runs: [{ id: 'run-1', status: 'succeeded' }] };
      if (method === 'catalog.query') { validateCatalogSelect(input.statement, input.parameters); return { rows: readBack }; }
      throw Error(method);
    });
    await expect(setHiddenNotices(['opportunity:1'], true)).resolves.toEqual(['opportunity:1']);
    readBack = rows('other-run', 1);
    await expect(setHiddenNotices(['opportunity:1'], true)).rejects.toThrow('could not be verified');
  });
});

describe('closed after the deadline', () => {
  const now = Date.parse('2026-10-03T19:00:00Z');
  it('reads Closed · deadline passed when the source still says Open, without hiding the source text', () => {
    expect(noticeStatus('Open', '2026-10-01', 'opportunity', now)).toMatchObject({ text: 'Closed · deadline passed', key: 'closed', title: expect.stringContaining('still says “Open”') });
    expect(noticeStatus('', '2026-10-01T10:00:00-07:00', 'opportunity', now)).toMatchObject({ key: 'closed' });
    expect(noticeStatus('Open', '2026-10-03', 'opportunity', now)).toEqual({ text: 'Open', key: 'open' }); // today, time unverified
    expect(noticeStatus('Open', null, 'opportunity', now)).toEqual({ text: 'Open', key: 'open' });        // unknown never closes
    expect(noticeStatus('Awarded', '2026-01-01', 'opportunity', now)).toEqual({ text: 'Awarded', key: 'awarded' });
    expect(noticeStatus('Open', '2020-01-01', 'award', now)).toEqual({ text: 'Open', key: 'open' });
    expect(noticeStatus(null, null, 'opportunity', now)).toBeNull();
  });
});

describe('company profile quick filters', () => {
  it('stores excluded keywords as applied and checks the value range', () => {
    const draft = { ...emptyDraft(), excludedKeywords: [' Golf ', 'golf', 'snow removal, fertiliz*', ''], commercial: { ...emptyDraft().commercial, minContractValue: 50_000, maxContractValue: 10_000 } };
    expect(cleanDraft(draft).excludedKeywords).toEqual(['golf', 'snow removal', 'fertiliz*']);
    expect(validateDraft('P', draft).map(issue => issue.path)).toContain('commercial.maxContractValue');
    expect(validateDraft('P', { ...draft, excludedKeywords: Array.from({ length: 16 }, (_, i) => `w${i}`) }).map(issue => issue.path)).toContain('excludedKeywords');
    expect(validateDraft('P', { ...draft, commercial: { ...draft.commercial, currency: null, minContractValue: null } }).map(issue => issue.path)).toContain('commercial.currency');
    expect(normalizeDraft({}).excludedKeywords).toEqual([]);
    expect(normalizeDraft({ commercial: { maxContractValue: 5 } }).commercial.maxContractValue).toBe(5);
  });
  it('filters by value only when every comparable stated amount is outside the range; unknown and other currencies pass', () => {
    const rules = { min: 25_000, max: 500_000, currency: 'CAD' };
    expect(valueHit([], rules)).toBeNull();
    expect(valueHit([{ lower: null, upper: null }], rules)).toBeNull();
    expect(valueHit([{ lower: 900_000, upper: 1_200_000, currency: 'CAD' }], rules)).toMatchObject({ kind: 'above_max', amount: 900_000 });
    expect(valueHit([{ upper: 10_000 }], rules)).toMatchObject({ kind: 'below_min', amount: 10_000 });
    expect(valueHit([{ lower: 900_000, currency: 'USD' }], rules)).toBeNull();
    expect(valueHit([{ lower: 900_000 }, { upper: 300_000 }], rules)).toBeNull();
    expect(valueHit([{ lower: 900_000 }], { min: null, max: null, currency: 'CAD' })).toBeNull();
    expect(filterReason([{ kind: 'above_max', amount: 900_000, limit: 500_000, currency: 'CAD' }, { kind: 'keyword', term: 'golf' }])).toBe('Filtered by profile: value above max (stated CAD 900,000; max CAD 500,000); excluded keyword “golf”');
    expect(hasProfileFilters(profileFilterRules({}))).toBe(false);
  });
  it('preflight skips filtered notices unless included', () => {
    const hits = new Map([['b', [{ kind: 'keyword' as const, term: 'golf' }]], ['c', [{ kind: 'above_max' as const, amount: 2, limit: 1, currency: null }]]]);
    expect(profileGate(['a', 'b', 'c'], hits, false)).toEqual({ run: ['a'], filtered: ['b', 'c'], kinds: { keyword: 1, value: 1 } });
    expect(profileGate(['a', 'b', 'c'], hits, true).run).toEqual(['a', 'b', 'c']);
  });
  it('reads keyword and value hits with statements the host bridge accepts', async () => {
    const db = new DatabaseSync(':memory:');
    db.exec(`CREATE TABLE records(id TEXT PRIMARY KEY,kind TEXT,title TEXT,data TEXT); CREATE TABLE procurement_profile_versions(id TEXT PRIMARY KEY,data TEXT);
      CREATE TABLE procurement_stage_runs(id TEXT PRIMARY KEY,record_id TEXT,stage TEXT,is_current INTEGER); CREATE TABLE procurement_facts(id TEXT PRIMARY KEY,record_id TEXT,stage_run_id TEXT,semantic_type TEXT,status TEXT,value TEXT);
      CREATE TABLE procurement_review_state(target_type TEXT,target_id TEXT,state TEXT,value TEXT)`);
    const add = (id: string, title: string, data: object = {}) => db.prepare('INSERT INTO records VALUES(?,?,?,?)').run(id, 'opportunity', title, JSON.stringify({ issuedBy: 'City', ...data }));
    add('o1', 'Golf course mowing'); add('o2', 'Roof', { descriptionText: 'Includes fertilizer.' }); add('o3', 'Bridge'); add('o4', 'Paving'); add('o5', 'Seawall');
    db.prepare('INSERT INTO procurement_profile_versions VALUES(?,?)').run('pv', JSON.stringify({ excludedKeywords: ['golf', 'fertiliz*'], commercial: { currency: 'CAD', minContractValue: 25000, maxContractValue: 500000 } }));
    db.exec("INSERT INTO procurement_stage_runs VALUES('s3','o3','extract',1),('s4','o4','extract',1),('s4old','o4','extract',0),('s5','o5','extract',1)");
    const fact = (id: string, record: string, run: string, value: object, type = 'money:buyer_estimated_value') => db.prepare("INSERT INTO procurement_facts VALUES(?,?,?,?, 'stated', ?)").run(id, record, run, type, JSON.stringify(value));
    fact('f3', 'o3', 's3', { lower: 2_000_000, currency: 'CAD' });           // above max
    fact('f4old', 'o4', 's4old', { upper: 1_000 });                            // not current: ignored
    fact('f4', 'o4', 's4', { upper: 100_000 });                                // in range
    fact('f4i', 'o4', 's4', { lower: 5_000_000 }, 'money:insurance_limit');    // insurance never counts
    fact('f5', 'o5', 's5', { upper: 10_000 });                                 // rejected by reviewer
    db.exec("INSERT INTO procurement_review_state VALUES('fact','f5','rejected',NULL)");
    const statements: string[] = [];
    const read = async (statement: string, parameters: (string | number)[] = []) => { validateCatalogSelect(statement, parameters); statements.push(statement); return db.prepare(statement).all(...parameters) as any[]; };
    const rules = await readProfileRules('pv', read);
    const hits = await readProfileFilterHits(['o1', 'o2', 'o3', 'o4', 'o5'], rules, read);
    expect(Object.fromEntries([...hits].map(([id, list]) => [id, list.map(h => h.kind === 'keyword' ? h.term : h.kind)]))).toEqual({ o1: ['golf'], o2: ['fertiliz*'], o3: ['above_max'] });
    expect(await readProfileRules(null, read)).toBeNull();
    const many = keywordHitsSql(Array.from({ length: 15 }, (_, i) => `w${i}`), 150);
    expect(() => validateCatalogSelect(many.sql, [...many.parameters, ...Array.from({ length: 150 }, () => 'id')])).not.toThrow();
    expect(() => validateCatalogSelect(VALUE_FACTS_SQL(150), Array.from({ length: 150 }, () => 'id'))).not.toThrow();
  });
});

describe('Home leaves hidden notices out of open work', () => {
  it('queue and deadline statements exclude hidden ids and pass the bridge rules', async () => {
    const seen: string[] = [];
    host.mockImplementation(async (method: string, input: any) => { if (method !== 'catalog.query') throw Error(method); validateCatalogSelect(input.statement, input.parameters); seen.push(input.statement); return { rows: [] }; });
    await readQueue('decide', 'pv1', 'bc-bid', Date.now());
    await readDeadlines('', Date.now());
    expect(seen).toHaveLength(2);
    for (const statement of seen) expect(statement).toContain("NOT IN (SELECT json_extract(data,'$.recordId') FROM workspace_state WHERE key LIKE 'procurement:hidden:%'");
  });
});
