import { validateCatalogSelect, runCatalogSelect } from '../../../../zoer/backend/src/catalog-reader';
import { test, expect, mock, afterAll } from 'bun:test';
import { Database } from 'bun:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Every Opportunities / Evidence grid statement runs through the host's validator and its real read-only runner
// (plugin document view) against CONTRACT §2 tables, so the bridge is proven to accept it.
const dir = mkdtempSync(join(tmpdir(), 'review-opportunities-')), path = join(dir, 'catalog.sqlite');
afterAll(() => rmSync(dir, { recursive: true, force: true }));
const statements: string[] = [];
const read = async (statement: string, parameters: (string | number)[] = []) => { validateCatalogSelect(statement, parameters); statements.push(statement); return (await runCatalogSelect(path, statement, parameters, true)).rows as any[]; };
// Bun does not read the base tsconfig's path alias here; point it at the same core sources Vite uses.
const core = await import('../../../packages/procurement-core/src/index.ts');
mock.module('@bcbid/procurement-core', () => core);
mock.module('../procurement/display', () => ({ INVENTORY_SQL: '', sourceName: (id: string) => id, sql: read }));
const { buildProcurementQuery } = await import('../procurement/catalog');
const q = await import('./opportunity-queries');
const sel = await import('./selection');
const ev = await import('./evidence-queries');

const db = new Database(path);
db.exec(`CREATE TABLE records(id TEXT PRIMARY KEY,kind TEXT NOT NULL,title TEXT NOT NULL,data TEXT NOT NULL,hash TEXT NOT NULL,updated_at TEXT NOT NULL);
CREATE TABLE documents(id TEXT PRIMARY KEY,record_id TEXT NOT NULL,url TEXT NOT NULL,name TEXT NOT NULL,media_type TEXT,sha256 TEXT,content BLOB,text TEXT,status TEXT NOT NULL,error TEXT,updated_at TEXT NOT NULL,byte_length INTEGER NOT NULL DEFAULT 0,UNIQUE(record_id,url));
CREATE TABLE reviews(id TEXT PRIMARY KEY,record_id TEXT NOT NULL,prompt_id TEXT NOT NULL,status TEXT NOT NULL,result TEXT);
CREATE TABLE procurement_extractions(id TEXT PRIMARY KEY,record_id TEXT NOT NULL,document_id TEXT,source_kind TEXT NOT NULL,sha256 TEXT NOT NULL,name TEXT NOT NULL,extractor_version TEXT NOT NULL,text TEXT NOT NULL,text_sha256 TEXT NOT NULL,code_points INTEGER NOT NULL,status TEXT NOT NULL,blocks TEXT NOT NULL DEFAULT '[]',limitations TEXT NOT NULL DEFAULT '[]',created_at TEXT NOT NULL,UNIQUE(record_id,source_kind,sha256,extractor_version));
CREATE TABLE procurement_bundles(id TEXT PRIMARY KEY,record_id TEXT NOT NULL,purpose TEXT NOT NULL,manifest TEXT NOT NULL,coverage TEXT NOT NULL,created_at TEXT NOT NULL);
CREATE TABLE procurement_stage_runs(id TEXT PRIMARY KEY,run_id TEXT NOT NULL,record_id TEXT NOT NULL,stage TEXT NOT NULL,stage_key TEXT NOT NULL,bundle_id TEXT,template_id TEXT NOT NULL,template_version INTEGER NOT NULL,model TEXT,status TEXT NOT NULL,quality TEXT,is_current INTEGER NOT NULL DEFAULT 0,summary TEXT,output TEXT,coverage TEXT,usage TEXT,issues TEXT NOT NULL DEFAULT '[]',rejected_raw TEXT,error TEXT,started_at TEXT NOT NULL,finished_at TEXT);
CREATE TABLE procurement_requirements(id TEXT PRIMARY KEY,record_id TEXT NOT NULL,lot_id TEXT,stage_run_id TEXT NOT NULL,ordinal INTEGER NOT NULL,text TEXT NOT NULL,strength TEXT NOT NULL,category TEXT NOT NULL,actor TEXT,required_by TEXT,condition_text TEXT,grounding TEXT NOT NULL,supersedes TEXT NOT NULL DEFAULT '[]',conflicts TEXT NOT NULL DEFAULT '[]',created_at TEXT NOT NULL);
CREATE TABLE procurement_facts(id TEXT PRIMARY KEY,record_id TEXT NOT NULL,lot_id TEXT,stage_run_id TEXT NOT NULL,field_key TEXT NOT NULL,semantic_type TEXT NOT NULL,status TEXT NOT NULL,value TEXT,grounding TEXT NOT NULL,created_at TEXT NOT NULL);
CREATE TABLE procurement_review_state(target_type TEXT NOT NULL,target_id TEXT NOT NULL,record_id TEXT NOT NULL,state TEXT NOT NULL,value TEXT,revision INTEGER NOT NULL,updated_at TEXT NOT NULL,PRIMARY KEY(target_type,target_id));
CREATE TABLE procurement_matches(requirement_id TEXT NOT NULL,profile_version_id TEXT NOT NULL,record_id TEXT NOT NULL,status TEXT NOT NULL,origin TEXT NOT NULL,company_evidence TEXT NOT NULL DEFAULT '[]',rationale TEXT NOT NULL,remediable INTEGER,reviewed INTEGER NOT NULL DEFAULT 1,reviewer TEXT NOT NULL,revision INTEGER NOT NULL,updated_at TEXT NOT NULL,PRIMARY KEY(requirement_id,profile_version_id));
CREATE TABLE procurement_assessments(id TEXT PRIMARY KEY,record_id TEXT NOT NULL,lot_id TEXT,bundle_id TEXT,profile_version_id TEXT,policy_version TEXT NOT NULL,as_of TEXT NOT NULL,freshness TEXT NOT NULL,relevance TEXT NOT NULL,eligibility TEXT NOT NULL,delivery TEXT NOT NULL,response TEXT NOT NULL,commercial TEXT NOT NULL,suggested_action TEXT NOT NULL,gates TEXT NOT NULL,critical_unknowns TEXT NOT NULL,reasons TEXT NOT NULL,is_current INTEGER NOT NULL DEFAULT 1,created_at TEXT NOT NULL);
CREATE TABLE procurement_decisions(id TEXT PRIMARY KEY,record_id TEXT NOT NULL,assessment_id TEXT,decision TEXT NOT NULL,note TEXT NOT NULL,actor TEXT NOT NULL,needs_reconfirmation INTEGER NOT NULL DEFAULT 0,stale_reason TEXT,created_at TEXT NOT NULL);
CREATE TABLE procurement_changes(id TEXT PRIMARY KEY,record_id TEXT NOT NULL,kind TEXT NOT NULL,detail TEXT NOT NULL,detected_at TEXT NOT NULL,acknowledged_at TEXT,acknowledged_by TEXT);`);
const T = '2026-09-20T00:00:00Z', asOf = Date.parse('2026-09-27T19:00:00Z');
const record = (id: string, fields: Record<string, unknown>, kind = 'opportunity', updated = T) => db.query('INSERT INTO records VALUES(?,?,?,?,?,?)').run(id, kind, id, JSON.stringify({ description: `Notice ${id}`, issuedBy: 'Buyer', status: 'Open', closingDate: '2026-12-01', attachments: [], ...fields }), 'h', updated);
record('o01', { attachments: undefined });                       // discovery not checked
record('o02', { attachments: [{ url: 'a' }] });                  // links not downloaded
record('o03', { attachments: [{ url: 'b' }] });                  // saved without text
record('o04', { attachments: [{ url: 'c' }], description: "Bridge 100% repair's" }, 'opportunity', '2026-09-26T00:00:00Z');
for (const id of ['o05', 'o06', 'o07', 'o08', 'o09', 'o10', 'o11']) record(id, {});
record('o12', { sourceId: 'canadabuys', closingDate: '2026-09-27' });   // closing today, time unverified
record('a1', { awardDate: '2026-01-01', attachments: undefined }, 'award');
const doc = (id: string, recordId: string, text: string | null) => db.query('INSERT INTO documents(id,record_id,url,name,sha256,text,status,updated_at,byte_length) VALUES(?,?,?,?,?,?,?,?,?)').run(id, recordId, id, id, 'sha-' + id, text, 'downloaded', T, 10);
const extracted = (docId: string, recordId: string) => db.query("INSERT INTO procurement_extractions(id,record_id,document_id,source_kind,sha256,name,extractor_version,text,text_sha256,code_points,status,created_at) VALUES(?,?,?,'document',?,?,'host-text-v1','x','x',1,'readable','2026-09-01T00:00:00Z')").run('e-' + docId, recordId, docId, 'sha-' + docId, docId);
doc('d3', 'o03', ''); doc('d4a', 'o04', 'x'.repeat(30_000)); doc('d4b', 'o04', 'é'.repeat(500)); doc('d5', 'o05', 'y'.repeat(12_000));
extracted('d4a', 'o04'); extracted('d4b', 'o04');
doc('d10', 'o10', 'Addendum text that arrived after the extraction.');   // readable file with no extraction → outdated
db.query("INSERT INTO procurement_bundles VALUES('b4','o04','extract','{}',?,?)").run(JSON.stringify({ processed: 2, usableText: 2 }), T);
const run = (id: string, recordId: string, stage: string, current: number, extra: { quality?: string; output?: unknown; bundle?: string } = {}) => db.query("INSERT INTO procurement_stage_runs(id,run_id,record_id,stage,stage_key,bundle_id,template_id,template_version,status,quality,is_current,output,started_at,finished_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)").run(id, 'run', recordId, stage, id, extra.bundle ?? null, 't', 1, 'succeeded', extra.quality ?? 'valid', current, extra.output === undefined ? null : JSON.stringify(extra.output), T, T);
run('t4', 'o04', 'triage', 1, { output: { route: 'Open competition' } }); run('x4', 'o04', 'extract', 1, { bundle: 'b4' }); run('x4old', 'o04', 'extract', 0);
run('t5', 'o05', 'triage', 1); run('x9', 'o09', 'extract', 1); run('x10', 'o10', 'extract', 1);
const assess = (id: string, recordId: string, profile: string | null, relevance: string, eligibility: string, action: string, lot: string | null = null) => db.query("INSERT INTO procurement_assessments VALUES(?,?,?,NULL,?,'procurement-policy-v1',?,'current',?,?,'feasible','sufficient','assessable',?,'[]','[]','[]',1,?)").run(id, recordId, lot, profile, T, relevance, eligibility, action, T);
assess('a4', 'o04', 'pv1', 'strong', 'supported_for_reviewed_requirements', 'ready_for_human_decision'); assess('a5', 'o05', 'pv1', 'possible', 'unresolved', 'needs_information');
assess('a6', 'o06', 'pv1', 'weak', 'blocker', 'decline'); assess('a7', 'o07', 'pv1', 'unknown', 'unresolved', 'archive_or_monitor'); assess('a8', 'o08', null, 'strong', 'not_assessed', 'investigate');
assess('a9a', 'o09', 'pv1', 'strong', 'supported_for_reviewed_requirements', 'ready_for_human_decision', 'L1'); assess('a9b', 'o09', 'pv1', 'possible', 'unresolved', 'needs_information', 'L2');
db.query("INSERT INTO procurement_assessments VALUES('a6old','o06',NULL,NULL,'pv1','p',?,'current','strong','x','x','x','x','ready_for_human_decision','[]','[]','[]',0,?)").run(T, T);
db.query("INSERT INTO procurement_decisions VALUES('d4','o04','a4','pursue','go','me',0,NULL,'2026-09-21T00:00:00Z'),('d6a','o06','a6','pursue','old','me',0,NULL,'2026-09-01T00:00:00Z'),('d6b','o06','a6','no_bid','blocker','me',0,NULL,'2026-09-10T00:00:00Z')").run();
const requirement = (id: string, recordId: string, stageRun: string, strength: string, grounding = 'exact') => db.query('INSERT INTO procurement_requirements(id,record_id,stage_run_id,ordinal,text,strength,category,grounding,created_at) VALUES(?,?,?,?,?,?,?,?,?)').run(id, recordId, stageRun, 1, id, strength, 'insurance', grounding, T);
requirement('q1', 'o04', 'x4', 'mandatory'); requirement('q2', 'o04', 'x4', 'mandatory', 'unverified'); requirement('q3', 'o04', 'x4', 'mandatory'); requirement('q4', 'o04', 'x4', 'preferred');
requirement('q5', 'o04', 'x4', 'mandatory'); requirement('qold', 'o04', 'x4old', 'mandatory'); requirement('q9', 'o09', 'x9', 'mandatory');
db.query("INSERT INTO procurement_review_state VALUES('requirement','q1','o04','accepted',NULL,1,?),('requirement','q5','o04','rejected',NULL,1,?)").run(T, T);
db.query("INSERT INTO procurement_matches(requirement_id,profile_version_id,record_id,status,origin,rationale,reviewer,revision,updated_at) VALUES('q1','pv1','o04','supported','buyer_mandatory','r','me',1,?),('q2','pv1','o04','unknown','buyer_mandatory','r','me',1,?)").run(T, T);
const money = (lower: number, currency = 'CAD') => ({ lower, upper: lower, currency, basis: 'total_contract', taxBasis: 'unknown', raw: `${currency} ${lower}` });
const fact = (id: string, recordId: string, stageRun: string, field: string, semantic: string, status: string, value: unknown, grounding = 'exact', lot: string | null = null) => db.query('INSERT INTO procurement_facts VALUES(?,?,?,?,?,?,?,?,?,?)').run(id, recordId, lot, stageRun, field, semantic, status, value === null ? null : JSON.stringify(value), grounding, T);
const reviewFact = (id: string, recordId: string, state: string, value: unknown = null) => db.query("INSERT INTO procurement_review_state VALUES('fact',?,?,?,?,1,?)").run(id, recordId, state, value === null ? null : JSON.stringify(value), T);
fact('f4b', 'o04', 'x4', 'budget', 'money:buyer_budget', 'stated', money(75000)); reviewFact('f4b', 'o04', 'accepted');
fact('f4i', 'o04', 'x4', 'insurance_limit', 'money:insurance_limit', 'stated', money(5_000_000));
fact('f4c', 'o04', 'x4', 'closing_date', 'date', 'stated', { raw: '2026-12-01', precision: 'date' }, 'unverified');
fact('f4e1', 'o04', 'x4', 'estimated_value', 'money:buyer_estimated_value', 'stated', money(90000)); fact('f4e2', 'o04', 'x4', 'estimated_value', 'money:buyer_estimated_value', 'stated', money(95000));
fact('f4s', 'o04', 'x4', 'bid_security', 'money:bid_security', 'explicitly_absent', { raw: 'No bid bond' }); reviewFact('f4s', 'o04', 'rejected');
fact('f4d', 'o04', 'x4', 'contract_duration', 'duration', 'not_reviewed', null);
fact('f4q', 'o04', 'x4', 'questions_deadline', 'date', 'not_found_in_reviewed_material', null);
fact('f4old', 'o04', 'x4old', 'site_visit', 'text', 'conflicting', null);
for (const [i, field] of ev.GRID_FIELDS.entries()) { fact(`f9_${i}`, 'o09', 'x9', field, field === 'budget' ? 'money:buyer_budget' : 'text', 'stated', field === 'budget' ? money(1000) : `value ${i}`, 'exact', field === 'budget' ? 'L1' : null); reviewFact(`f9_${i}`, 'o09', field === 'site_visit' ? 'needs_clarification' : 'accepted'); }
fact('f9_b2', 'o09', 'x9', 'budget', 'money:buyer_budget', 'stated', money(2000), 'exact', 'L2'); reviewFact('f9_b2', 'o09', 'accepted');
fact('f10', 'o10', 'x10', 'budget', 'money:buyer_budget', 'stated', money(10)); reviewFact('f10', 'o10', 'corrected', money(12));
db.close();

/** The Opportunities page's own composition: URL → queue.ts scope + table filters → buildProcurementQuery. */
function tableQuery(query: string, active: string | null = 'pv1', sort: 'updated' | 'date-asc' | 'fit' = 'updated') {
  const params = new URLSearchParams(query), { scope, filters } = q.readOpportunityFilters(params);
  const where = q.opportunityPredicate(scope, filters, { profileVersionId: active, asOf, workspace: true });
  return buildProcurementQuery({ kind: (params.get('kind') as any) ?? 'all', search: params.get('search') ?? '', source: params.get('source') ?? '', deadline: params.get('deadline') === 'week' ? 'week' : 'all', asOf, where, sort: sort === 'fit' ? 'updated' : sort, order: sort === 'fit' ? q.fitOrderSql(q.effectiveProfile(scope, active)) : undefined, limit: 50 });
}
const ids = async (query: string, active: string | null = 'pv1', sort: 'updated' | 'date-asc' | 'fit' = 'updated') => { const s = tableQuery(query, active, sort); return (await read(s.statement, s.parameters)).map(row => row.id); };
const count = async (query: string, active: string | null = 'pv1') => { const s = tableQuery(query, active); return Number((await read(s.countStatement, s.countParameters))[0].total); };
const sorted = (list: string[]) => [...list].sort();

test('review filters apply in SQL to the whole catalog through the host reader', async () => {
  expect(sorted(await ids('kind=opportunity&gap=unchecked'))).toEqual(['o01']);
  expect(await ids('gap=notdownloaded')).toEqual(['o02']);
  expect(await ids('gap=notext')).toEqual(['o03']);
  expect(sorted(await ids('kind=opportunity&gap=triage'))).not.toContain('o04');
  expect(sorted(await ids('kind=opportunity&gap=extract'))).toEqual(['o01', 'o02', 'o03', 'o05', 'o06', 'o07', 'o08', 'o11', 'o12']);
  expect(await ids('eligibility=blocker')).toEqual(['o06']);
  expect(sorted(await ids('action=needs_information'))).toEqual(['o05', 'o09']);
  expect(await ids('decision=no_bid')).toEqual(['o06']);
  expect(await ids('decision=pursue')).toEqual(['o04']);   // o06's earlier "pursue" is not its latest decision
  expect(sorted(await ids('kind=opportunity&decision=none'))).not.toContain('o06');
  expect(sorted(await ids('assessed=yes'))).toEqual(['o04', 'o05', 'o06', 'o07', 'o09']);
  expect(sorted(await ids('kind=opportunity&assessed=none'))).toEqual(['o01', 'o02', 'o03', 'o08', 'o10', 'o11', 'o12']);
  expect(sorted(await ids('relevance=strong'))).toEqual(['o04', 'o09']);
  expect(await ids('profile=none&relevance=strong')).toEqual(['o08']);     // the link's profile wins over the active one
  expect(await ids('relevance=strong', null)).toEqual(['o08']);
  expect(sorted(await ids('readiness=unknown'))).toEqual(['o07']);
  expect(await ids('search=100%25 repair\'s')).toEqual(['o04']);
  expect(await ids('queue=decide')).toEqual(['o09']);                        // ready, no decision; o04 already decided
  expect(await count('relevance=strong&readiness=ready&decision=pursue&gap=extract')).toBe(0);
});

test('every sort, including work fit and the P0 deadline filters, passes the bridge', async () => {
  const fit = await ids('kind=opportunity', 'pv1', 'fit');
  expect(fit.slice(0, 2).sort()).toEqual(['o04', 'o09']);
  expect(fit.slice(2, 5)).toEqual(['o05', 'o06', 'o07']);
  expect(await ids('kind=opportunity&deadline=week', 'pv1', 'date-asc')).toBeArray();
  expect((await ids('', 'pv1', 'date-asc')).length).toBe(13);
  const everything = tableQuery('queue=eligibility&relevance=possible&readiness=conditions&gap=extract&eligibility=unresolved&action=investigate&decision=monitor&reqCategory=insurance&match=unknown&search=x&deadline=week', 'pv1', 'fit');
  await read(everything.statement, everything.parameters); await read(everything.countStatement, everything.countParameters);
});

test('fit matrix counts equal the table rows each cell drills into', async () => {
  const params = new URLSearchParams('view=matrix&kind=opportunity'), base = tableQuery('kind=opportunity');
  const statement = q.matrixCountsSql({ sql: base.where, parameters: base.countParameters }, 'pv1', true);
  const [counts] = await read(statement.sql, statement.parameters);
  expect(counts).toMatchObject({ total: 12, ready_strong: 2, conditions_possible: 2, blocker_weak: 1, relevance_unknown: 1, readiness_unknown: 1, not_assessed: 7, ready_strong_decided: 1, blocker_weak_decided: 1 });
  for (const cell of q.MATRIX_CELLS) {
    const href = q.matrixCellHref(params, cell);
    expect(await count(href.split('?')[1])).toBe(Number(counts[cell.key]));
  }
});

test('snapshots, preflight, row columns, compare and exports read through the bridge', async () => {
  const base = tableQuery('kind=opportunity');
  const meta = { description: ['Type: Opportunities'], filters: { kind: 'opportunity' }, profileVersionId: 'pv1', profileText: 'Acme · v1' };
  const all = await sel.captureSnapshot({ sql: base.where, parameters: base.countParameters }, meta, { read });
  expect(all).toMatchObject({ matching: 12, truncated: false });
  expect(all.ids).toEqual(['o01', 'o02', 'o03', 'o04', 'o05', 'o06', 'o07', 'o08', 'o09', 'o10', 'o11', 'o12']);
  const capped = await sel.captureSnapshot({ sql: base.where, parameters: base.countParameters }, meta, { read, limit: 5 });
  expect(capped).toMatchObject({ truncated: true, matching: 12 }); expect(capped.ids).toHaveLength(5);

  const preflight = await sel.readPreflight(['o03', 'o04', 'o05'], 'extract', read);
  expect(preflight).toEqual([{ id: 'o03', readableDocs: 0, calls: 0, current: false }, { id: 'o04', readableDocs: 2, calls: sel.callsForText(30_000) + sel.callsForText(500), current: true }, { id: 'o05', readableDocs: 1, calls: 1, current: false }]);
  expect(sel.summarizePreflight('extract', preflight, false)).toMatchObject({ estimatedCalls: 1 + 2, reused: 1, withText: 2, noticeOnly: 1 });
  expect((await sel.readPreflight(['o04', 'o05'], 'triage', read)).map(r => r.current)).toEqual([true, true]);

  const rows = await q.readRowReview(['o01', 'o03', 'o04', 'o06', 'o08'], 'pv1', true);
  expect(q.evidenceScopeOf(rows.get('o01')!.evidence).detail).toBe('Attachment discovery not checked');
  expect(q.evidenceScopeOf(rows.get('o03')!.evidence).detail).toBe('Saved; no usable text extracted');
  expect(rows.get('o04')!.evidence).toMatchObject({ triaged: true, extracted: true, processed: 2, downloaded: 2, usable: 2, route: 'Open competition' });
  expect(rows.get('o04')!.assessment?.relevance).toBe('strong');
  expect(rows.get('o06')!.decision?.decision).toBe('no_bid');
  expect(rows.get('o08')!.assessment).toBeNull();     // assessed only without a profile: not assessed for pv1

  const extras = await q.readCompareExtras(['o04', 'o09'], 'pv1');
  expect(extras.get('o04')).toMatchObject({ mandatory: 3, unresolved: 2, extracted: true });   // q5 rejected, qold not current
  expect(extras.get('o04')!.budgets.map(b => b.kind)).toEqual(['buyer_budget', 'buyer_estimated_value', 'buyer_estimated_value']);   // never insurance
  expect((await q.readCompareExtras(['o04'], null)).get('o04')!.unresolved).toBeNull();

  const exported = await sel.readExportRows(all, true, asOf);
  expect(exported).toHaveLength(12);
  expect(exported.find(row => row.id === 'o12')).toMatchObject({ deadlineState: 'closing_today_time_unverified', workFit: 'Not assessed for this profile', humanDecision: 'No human decision recorded' });
  expect(exported.find(row => row.id === 'o04')).toMatchObject({ workFit: 'Strong', humanDecision: 'Pursue', evidenceScope: 'Extracted from notice + 2 documents' });
});

test('evidence grid problem filters in SQL match the cell derivation on every notice', async () => {
  const everything = await ev.readGridPage({}, {}, 200, read);
  expect(everything.rows.map(row => row.id)).toEqual(['o04', 'o09', 'o10']);
  const o4 = everything.rows[0], state = (field: string) => o4.cells.find(cell => cell.field === field)!.state;
  expect([state('budget'), state('insurance_limit'), state('closing_date'), state('estimated_value'), state('bid_security'), state('contract_duration'), state('questions_deadline'), state('site_visit')])
    .toEqual(['accepted', 'proposed', 'ungrounded', 'conflicting', 'rejected', 'not_reviewed', 'not_found', 'not_found']);   // the old run's conflict is ignored
  expect(o4).toMatchObject({ mandatory: 3, unreviewed: 2, ungrounded: 1 });   // rejected q5 and the old run's requirement excluded
  expect(everything.rows[1].cells.find(cell => cell.field === 'budget')!.state).toBe('accepted');   // different lots never conflict
  expect(everything.rows[2].cells.find(cell => cell.field === 'budget')).toMatchObject({ state: 'outdated', value: 'CAD 12 · total contract' });
  for (const field of [undefined, ...ev.GRID_FIELDS]) {
    const [counts] = await read(ev.problemCountsSql(field));
    for (const problem of ev.PROBLEMS) {
      const expected = everything.rows.filter(row => row.cells.some(cell => (!field || cell.field === field) && cell.problems.has(problem))).map(row => row.id);
      const page = await ev.readGridPage({ problem, field }, {}, 200, read);
      expect({ field, problem, ids: page.rows.map(row => row.id) }).toEqual({ field, problem, ids: expected });
      expect(Number(counts[problem])).toBe(expected.length);
    }
  }
});

test('evidence grid pages by record id with stable next/previous cursors', async () => {
  const first = await ev.readGridPage({}, {}, 2, read);
  expect(first).toMatchObject({ hasNext: true, hasPrevious: false }); expect(first.rows.map(r => r.id)).toEqual(['o04', 'o09']);
  const second = await ev.readGridPage({}, { after: 'o09' }, 2, read);
  expect(second).toMatchObject({ hasNext: false, hasPrevious: true }); expect(second.rows.map(r => r.id)).toEqual(['o10']);
  const back = await ev.readGridPage({}, { before: 'o10' }, 2, read);
  expect(back.rows.map(r => r.id)).toEqual(['o04', 'o09']); expect(back).toMatchObject({ hasNext: true, hasPrevious: false });
  const middle = await ev.readGridPage({}, { before: 'o10' }, 1, read);
  expect(middle.rows.map(r => r.id)).toEqual(['o09']); expect(middle).toMatchObject({ hasNext: true, hasPrevious: true });
  expect(statements.every(statement => !/\bcontent\b/i.test(statement))).toBe(true);
});
