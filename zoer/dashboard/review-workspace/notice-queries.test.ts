import { validateCatalogSelect, runCatalogSelect } from '../../../../zoer/backend/src/catalog-reader';
import { test, expect, mock, afterAll } from 'bun:test';
import { Database } from 'bun:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

// Every notice-detail statement goes through the host's validator and its real read-only runner (plugin document view),
// against the CONTRACT §2 tables in a temp catalog.
const dir = mkdtempSync(join(tmpdir(), 'review-notice-')), path = join(dir, 'catalog.sqlite');
afterAll(() => rmSync(dir, { recursive: true, force: true }));
const statements: string[] = [];
mock.module('../procurement/display', () => ({
  INVENTORY_SQL: '', sourceName: (id: string) => id,
  sql: async (statement: string, parameters: (string | number)[] = []) => { validateCatalogSelect(statement, parameters); statements.push(statement); return (await runCatalogSelect(path, statement, parameters, true)).rows; },
}));
const core = await import('../../../packages/procurement-core/src/index');
mock.module('@bcbid/procurement-core', () => core);
const q = await import('./notice-queries');

const db = new Database(path);
db.exec(`CREATE TABLE records(id TEXT PRIMARY KEY,kind TEXT NOT NULL,title TEXT NOT NULL,data TEXT NOT NULL,hash TEXT NOT NULL,updated_at TEXT NOT NULL);
CREATE TABLE documents(id TEXT PRIMARY KEY,record_id TEXT NOT NULL,url TEXT NOT NULL,name TEXT NOT NULL,media_type TEXT,sha256 TEXT,content BLOB,text TEXT,status TEXT NOT NULL,error TEXT,updated_at TEXT NOT NULL,byte_length INTEGER NOT NULL DEFAULT 0,UNIQUE(record_id,url));
CREATE TABLE reviews(id TEXT PRIMARY KEY,run_id TEXT NOT NULL,record_id TEXT NOT NULL,prompt_id TEXT NOT NULL,prompt_version INTEGER NOT NULL,fingerprint TEXT NOT NULL,model TEXT NOT NULL,status TEXT NOT NULL,result TEXT,error TEXT,created_at TEXT NOT NULL);
CREATE TABLE record_history(run_id TEXT NOT NULL,record_id TEXT NOT NULL,data TEXT NOT NULL,PRIMARY KEY(run_id,record_id));
CREATE TABLE procurement_extractions(id TEXT PRIMARY KEY,record_id TEXT NOT NULL,document_id TEXT,source_kind TEXT NOT NULL,sha256 TEXT NOT NULL,name TEXT NOT NULL,extractor_version TEXT NOT NULL,text TEXT NOT NULL,text_sha256 TEXT NOT NULL,code_points INTEGER NOT NULL,status TEXT NOT NULL,blocks TEXT NOT NULL DEFAULT '[]',limitations TEXT NOT NULL DEFAULT '[]',created_at TEXT NOT NULL,UNIQUE(record_id,source_kind,sha256,extractor_version));
CREATE TABLE procurement_bundles(id TEXT PRIMARY KEY,record_id TEXT NOT NULL,purpose TEXT NOT NULL,manifest TEXT NOT NULL,coverage TEXT NOT NULL,created_at TEXT NOT NULL);
CREATE TABLE procurement_stage_runs(id TEXT PRIMARY KEY,run_id TEXT NOT NULL,record_id TEXT NOT NULL,stage TEXT NOT NULL,stage_key TEXT NOT NULL,bundle_id TEXT,template_id TEXT NOT NULL,template_version INTEGER NOT NULL,model TEXT,status TEXT NOT NULL,quality TEXT,is_current INTEGER NOT NULL DEFAULT 0,summary TEXT,output TEXT,coverage TEXT,usage TEXT,issues TEXT NOT NULL DEFAULT '[]',rejected_raw TEXT,error TEXT,started_at TEXT NOT NULL,finished_at TEXT);
CREATE TABLE procurement_requirements(id TEXT PRIMARY KEY,record_id TEXT NOT NULL,lot_id TEXT,stage_run_id TEXT NOT NULL,ordinal INTEGER NOT NULL,text TEXT NOT NULL,strength TEXT NOT NULL,category TEXT NOT NULL,actor TEXT,required_by TEXT,condition_text TEXT,grounding TEXT NOT NULL,supersedes TEXT NOT NULL DEFAULT '[]',conflicts TEXT NOT NULL DEFAULT '[]',created_at TEXT NOT NULL);
CREATE TABLE procurement_facts(id TEXT PRIMARY KEY,record_id TEXT NOT NULL,lot_id TEXT,stage_run_id TEXT NOT NULL,field_key TEXT NOT NULL,semantic_type TEXT NOT NULL,status TEXT NOT NULL,value TEXT,grounding TEXT NOT NULL,created_at TEXT NOT NULL);
CREATE TABLE procurement_spans(id TEXT PRIMARY KEY,record_id TEXT NOT NULL,target_type TEXT NOT NULL,target_id TEXT NOT NULL,extraction_id TEXT NOT NULL,text_sha256 TEXT NOT NULL,start_cp INTEGER,end_cp INTEGER,quote TEXT NOT NULL,page INTEGER,heading TEXT,alignment TEXT NOT NULL);
CREATE TABLE procurement_review_events(id TEXT PRIMARY KEY,record_id TEXT NOT NULL,target_type TEXT NOT NULL,target_id TEXT NOT NULL,event TEXT NOT NULL,reason TEXT NOT NULL,correction TEXT,reviewer TEXT NOT NULL,revision INTEGER NOT NULL,occurred_at TEXT NOT NULL);
CREATE TABLE procurement_review_state(target_type TEXT NOT NULL,target_id TEXT NOT NULL,record_id TEXT NOT NULL,state TEXT NOT NULL,value TEXT,revision INTEGER NOT NULL,updated_at TEXT NOT NULL,PRIMARY KEY(target_type,target_id));
CREATE TABLE procurement_profiles(id TEXT PRIMARY KEY,name TEXT NOT NULL,draft TEXT NOT NULL,draft_version INTEGER NOT NULL,updated_at TEXT NOT NULL);
CREATE TABLE procurement_profile_versions(id TEXT PRIMARY KEY,profile_id TEXT NOT NULL,version INTEGER NOT NULL,data TEXT NOT NULL,published_at TEXT NOT NULL,published_by TEXT NOT NULL,UNIQUE(profile_id,version));
CREATE TABLE procurement_matches(requirement_id TEXT NOT NULL,profile_version_id TEXT NOT NULL,record_id TEXT NOT NULL,status TEXT NOT NULL,origin TEXT NOT NULL,company_evidence TEXT NOT NULL DEFAULT '[]',rationale TEXT NOT NULL,remediable INTEGER,reviewed INTEGER NOT NULL DEFAULT 1,reviewer TEXT NOT NULL,revision INTEGER NOT NULL,updated_at TEXT NOT NULL,PRIMARY KEY(requirement_id,profile_version_id));
CREATE TABLE procurement_assessments(id TEXT PRIMARY KEY,record_id TEXT NOT NULL,lot_id TEXT,bundle_id TEXT,profile_version_id TEXT,policy_version TEXT NOT NULL,as_of TEXT NOT NULL,freshness TEXT NOT NULL,relevance TEXT NOT NULL,eligibility TEXT NOT NULL,delivery TEXT NOT NULL,response TEXT NOT NULL,commercial TEXT NOT NULL,suggested_action TEXT NOT NULL,gates TEXT NOT NULL,critical_unknowns TEXT NOT NULL,reasons TEXT NOT NULL,is_current INTEGER NOT NULL DEFAULT 1,created_at TEXT NOT NULL);
CREATE TABLE procurement_decisions(id TEXT PRIMARY KEY,record_id TEXT NOT NULL,assessment_id TEXT,decision TEXT NOT NULL,note TEXT NOT NULL,actor TEXT NOT NULL,needs_reconfirmation INTEGER NOT NULL DEFAULT 0,stale_reason TEXT,created_at TEXT NOT NULL);
CREATE TABLE procurement_tasks(id TEXT PRIMARY KEY,record_id TEXT NOT NULL,title TEXT NOT NULL,kind TEXT NOT NULL,linked_type TEXT,linked_id TEXT,owner TEXT,due_at TEXT,status TEXT NOT NULL,completion_note TEXT,version INTEGER NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
CREATE TABLE procurement_changes(id TEXT PRIMARY KEY,record_id TEXT NOT NULL,kind TEXT NOT NULL,detail TEXT NOT NULL,detected_at TEXT NOT NULL,acknowledged_at TEXT,acknowledged_by TEXT);
CREATE TABLE procurement_judgements(record_id TEXT NOT NULL,profile_version_id TEXT NOT NULL,dimension TEXT NOT NULL,value TEXT NOT NULL,note TEXT NOT NULL,reviewer TEXT NOT NULL,revision INTEGER NOT NULL,updated_at TEXT NOT NULL,PRIMARY KEY(record_id,profile_version_id,dimension));`);
const T = '2026-09-20T00:00:00Z', R = 'opportunity:1';
db.query('INSERT INTO records VALUES(?,?,?,?,?,?)').run(R, 'opportunity', 'Roof replacement', JSON.stringify({ closingDate: '2026-10-02' }), 'h', T);
db.query("INSERT INTO record_history VALUES('run1',?,'{}'),('run2',?,'{}')").run(R, R);
db.query("INSERT INTO reviews VALUES('rv1','run',?,'procurement:summary',1,'f','model-a','succeeded','{}',NULL,?)").run(R, T);
db.query("INSERT INTO documents(id,record_id,url,name,sha256,text,status,updated_at,byte_length) VALUES('d1',?,'u1','Scope.pdf','file-v2','Scope text','downloaded',?,10)").run(R, T);
const text = 'Section 2 🧾 Requirements\nBidders must hold WCB 🎉 coverage.\nInsurance: CAD 5,000,000 per occurrence.';
const sha = createHash('sha256').update(text).digest('hex');
db.query("INSERT INTO procurement_extractions(id,record_id,document_id,source_kind,sha256,name,extractor_version,text,text_sha256,code_points,status,limitations,created_at) VALUES('e1',?,'d1','document','file-v1','Scope.pdf','pdf-v1',?,?,?,'readable','[\"Drawings not read\"]',?)").run(R, text, sha, Array.from(text).length, T);
const run = (id: string, stage: string, current: number, status = 'succeeded', summary: string | null = null, started = T) => db.query("INSERT INTO procurement_stage_runs(id,run_id,record_id,stage,stage_key,template_id,template_version,model,status,quality,is_current,summary,output,coverage,usage,started_at,finished_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)")
  .run(id, 'run', R, stage, id, `procurement.${stage}`, 1, 'model-a', status, status === 'succeeded' ? 'valid' : null, current, summary, stage === 'triage' ? JSON.stringify({ classification: 'potentially_relevant', relevance: 'possible', reasons: [], missingInformation: ['Insurance limit'], summary: 'Roofing work' }) : null, JSON.stringify({ discovered: null, downloaded: 1, usableText: 1, processed: 1, missing: [{ name: 'Drawings.dwg', reason: 'unsupported' }], limitations: [], sourceCompleteness: 'unknown' }), JSON.stringify({ known: false }), started, started);
run('x1', 'extract', 1); run('t1', 'triage', 1); run('x2', 'extract', 0, 'failed', null, '2026-09-25T00:00:00Z'); run('x3', 'extract', 0, 'succeeded', 'Test run: sample', '2026-09-26T00:00:00Z');
// More than two bridge pages of requirements: none may be dropped.
const insertReq = db.prepare('INSERT INTO procurement_requirements(id,record_id,stage_run_id,ordinal,text,strength,category,grounding,conflicts,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)');
for (let i = 1; i <= 450; i++) insertReq.run(`q${i}`, R, 'x1', i, `Requirement ${i}`, i <= 12 ? 'mandatory' : 'preferred', 'other', i === 450 ? 'unverified' : 'exact', i === 2 ? '["q3"]' : '[]', T);
insertReq.run('old', R, 'x3', 1, 'Test run item', 'mandatory', 'other', 'exact', '[]', T);
const align = core.alignQuote(text, 'Bidders must hold WCB 🎉 coverage.');
db.query("INSERT INTO procurement_spans VALUES('s1',?,'requirement','q1','e1',?,?,?,?,4,'Requirements','exact')").run(R, sha, align.start, align.end, align.quote);
db.query("INSERT INTO procurement_spans VALUES('s2',?,'requirement','q450','e1',?,NULL,NULL,'Bidders shall be bonded',NULL,NULL,'unverified')").run(R, sha);
db.query("INSERT INTO procurement_facts VALUES('f1',?,NULL,'x1','insurance_limit','money:insurance_limit','stated',?,'exact',?),('f2',?,NULL,'x1','budget','money:buyer_budget','not_found_in_reviewed_material',NULL,'unverified',?),('f3',?,NULL,'x1','closing_date','date','conflicting',?,'exact',?)")
  .run(R, JSON.stringify({ lower: 5_000_000, upper: 5_000_000, currency: 'CAD', basis: 'unknown', taxBasis: 'unknown', raw: 'CAD 5,000,000' }), T, R, T, R, JSON.stringify({ raw: '2026-10-02', precision: 'date' }), T);
db.query("INSERT INTO procurement_review_state VALUES('requirement','q1',?,'accepted',NULL,2,?)").run(R, T);
db.query("INSERT INTO procurement_review_events VALUES('ev1',?,'requirement','q1','request_clarification','Which WCB?',NULL,'me',1,'2026-09-21T00:00:00Z'),('ev2',?,'requirement','q1','accept','Checked',NULL,'me',2,'2026-09-22T00:00:00Z')").run(R, R);
db.query("INSERT INTO procurement_profiles VALUES('p1','Acme','{}',1,?)").run(T);
db.query("INSERT INTO procurement_profile_versions VALUES('pv1','p1',1,?,?,'me')").run(JSON.stringify({ evidence: [{ id: 'ev-wcb', capability: 'WCB clearance', kind: 'credential', holder: 'Acme', verification: 'reviewed', expiresAt: '2027-01-01' }, { bad: true }] }), T);
db.query("INSERT INTO procurement_matches VALUES('q1','pv1',?,'supported','buyer_mandatory','[\"ev-wcb\"]','Clearance letter',NULL,1,'me',3,?),('q2','pv9',?,'unmet','buyer_mandatory','[]','Other profile',0,1,'me',1,?)").run(R, T, R, T);
db.query("INSERT INTO procurement_assessments VALUES('a1',?,NULL,NULL,'pv1','procurement-policy-v1',?,'stale','strong','unresolved','unknown','unknown','not_assessed','needs_information','[]','[\"Insurance\"]','[\"r\"]',1,?)").run(R, T, T);
db.query("INSERT INTO procurement_decisions VALUES('dc1',?,'a1','pursue','Go','me',1,'document_added','2026-09-23T00:00:00Z'),('dc0',?,NULL,'monitor','Watch','me',0,NULL,'2026-09-01T00:00:00Z')").run(R, R);
db.query("INSERT INTO procurement_tasks VALUES('k1',?,'Get addendum','acquire_evidence','requirement','q1','Sam','2026-10-01','open',NULL,1,?,?)").run(R, T, T);
db.query("INSERT INTO procurement_changes VALUES('c1',?,'document_modified',?,?,NULL,NULL)").run(R, JSON.stringify({ name: 'Scope.pdf', before: { sha256: 'file-v1' }, after: { sha256: 'file-v2' } }), T);
db.query("INSERT INTO procurement_judgements VALUES(?,'pv1','delivery','conditional','Crew busy in October','me',1,?)").run(R, T);
db.close();

test('stage runs, triage output and stage status read through the host reader', async () => {
  const runs = await q.readStageRuns(R);
  expect(runs.map(r => r.id)).toEqual(['x3', 'x2', 't1', 'x1']);
  expect(runs.find(r => r.id === 'x3')!.dryRun).toBe(true);
  expect(runs.find(r => r.id === 'x1')!.usage).toEqual({ known: false });
  const status = q.stageStatus(runs, 'extract');
  expect(status.current!.id).toBe('x1');
  expect(status.note).toMatch(/^Review failed validation; earlier result retained with its date/);
  expect(q.scopeText(status.current!.coverage, 'extract')).toMatch(/^1 file downloaded \(discovered total unknown\)/);
  expect(await q.readTriageOutput(R)).toMatchObject({ classification: 'potentially_relevant' });
});

test('every requirement of the current run is read across pages, with state and one profile\'s match', async () => {
  const rows = await q.readRequirements(R, 'x1', 'pv1');
  expect(rows).toHaveLength(450);
  expect(q.requirementCounts(rows).text).toBe('450 requirements; 12 mandatory; 1 ungrounded');
  const first = rows[0];
  expect(first).toMatchObject({ id: 'q1', reviewState: 'accepted', revision: 2, spanCount: 1, sourceName: 'Scope.pdf', page: 4, heading: 'Requirements', matchRevision: 3, match: { status: 'supported', companyEvidence: ['ev-wcb'], remediable: null } });
  expect(rows[1]).toMatchObject({ id: 'q2', match: null, conflicts: ['q3'] }); // pv9's match is never shown for pv1
  expect(rows[449]).toMatchObject({ grounding: 'unverified', sourceName: 'Scope.pdf', page: null });
  expect((await q.readRequirements(R, 'x1', null))[0].match).toBeNull();
  expect(await q.readConflicts(R, 'x1')).toBe(2);
});

test('facts keep statuses distinct and header money never uses the insurance limit', async () => {
  const facts = await q.readFacts(R, 'x1');
  expect(facts.map(f => f.status).sort()).toEqual(['conflicting', 'not_found_in_reviewed_material', 'stated']);
  expect(q.headerMoney(facts, true).text).toBe('Budget not found; insurance limit listed separately');
});

test('inspector reads item, spans, events and the immutable text; the span highlights by code point', async () => {
  const item = await q.readInspectorItem(R, { type: 'requirement', id: 'q1' });
  expect(item).toMatchObject({ reviewState: 'accepted', revision: 2, run: { isCurrent: true, templateId: 'procurement.extract' } });
  expect(await q.readInspectorItem('another-record', { type: 'requirement', id: 'q1' })).toBeNull();
  expect((await q.readInspectorItem(R, { type: 'fact', id: 'f1' }))!.fact).toMatchObject({ semanticType: 'money:insurance_limit' });
  const spans = await q.readSpans('requirement', 'q1');
  const extraction = await q.readExtraction(R, spans[0].extractionId);
  expect(extraction!.text).toBe(text);
  expect(await q.sha256Hex(extraction!.text!)).toBe(extraction!.textSha256);
  expect(q.spanProblem(spans[0], extraction, R)).toBeNull();
  expect(q.passageParts(extraction!.text!, spans[0].startCp, spans[0].endCp)!.match).toBe('Bidders must hold WCB 🎉 coverage.');
  expect(q.spanProblem((await q.readSpans('requirement', 'q450'))[0], extraction, R)).toBe('Quote not found in source; candidate kept as ungrounded.');
  expect((await q.readReviewEvents('requirement', 'q1')).map(e => e.revision)).toEqual([2, 1]);
  expect(await q.readExtractions(R)).toMatchObject([{ id: 'e1', spans: 2, limitations: ['Drawings not read'], codePoints: Array.from(text).length }]);
  expect((await q.readExtractionSpans('e1')).map(s => s.targetId)).toEqual(['q450', 'q1']);
  expect(await q.readDocumentVersion('d1')).toMatchObject({ sha256: 'file-v2' });
});

test('decisions, tasks, changes, assessments, activity sources, profile evidence and judgements', async () => {
  expect((await q.readDecisions(R)).map(d => [d.id, d.needsReconfirmation])).toEqual([['dc1', true], ['dc0', false]]);
  expect(await q.readTasks(R)).toMatchObject([{ id: 'k1', version: 1, linkedType: 'requirement' }]);
  expect(await q.readChanges(R)).toMatchObject([{ id: 'c1', detail: { name: 'Scope.pdf' }, acknowledgedAt: null }]);
  expect(await q.readAssessmentHistory(R)).toMatchObject([{ id: 'a1', isCurrent: true, criticalUnknowns: ['Insurance'] }]);
  const events = await q.readRecordEvents(R);
  expect(events).toMatchObject({ captures: 2, updatedAt: T });
  expect(events.reviews).toHaveLength(1);
  expect(events.events.map((e: any) => e.targetText)).toEqual(['Requirement 1', 'Requirement 1']);
  expect(events.matches.map((m: any) => m.requirementText).sort()).toEqual(['Requirement 1', 'Requirement 2']);
  expect(await q.readProfileEvidence('pv1')).toEqual([{ id: 'ev-wcb', capability: 'WCB clearance', kind: 'credential', holder: 'Acme', verification: 'reviewed', expiresAt: '2027-01-01' }]);
  expect(await q.readJudgements(R, 'pv1')).toMatchObject([{ dimension: 'delivery', value: 'conditional', revision: 1 }]);
  expect(statements.length).toBeGreaterThan(20);
}, 30_000);
