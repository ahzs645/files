import { validateCatalogSelect, runCatalogSelect } from '../../../../zoer/backend/src/catalog-reader';
import { test, expect, mock, afterAll } from 'bun:test';
import { Database } from 'bun:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Every Home/Insights statement goes through the host's validator and its real read-only runner (plugin document view).
const dir = mkdtempSync(join(tmpdir(), 'review-queue-')), path = join(dir, 'catalog.sqlite');
afterAll(() => rmSync(dir, { recursive: true, force: true }));
const statements: string[] = [];
mock.module('../procurement/display', () => ({
  INVENTORY_SQL: '', sourceName: (id: string) => id,
  sql: async (statement: string, parameters: (string | number)[] = []) => { validateCatalogSelect(statement, parameters); statements.push(statement); return (await runCatalogSelect(path, statement, parameters, true)).rows; },
}));
const { QUEUES, reviewPredicate } = await import('./queue');
const data = await import('./home-data');

const db = new Database(path);
db.exec(`CREATE TABLE records(id TEXT PRIMARY KEY,kind TEXT NOT NULL,title TEXT NOT NULL,data TEXT NOT NULL,hash TEXT NOT NULL,updated_at TEXT NOT NULL);
CREATE TABLE documents(id TEXT PRIMARY KEY,record_id TEXT NOT NULL,url TEXT NOT NULL,name TEXT NOT NULL,media_type TEXT,sha256 TEXT,content BLOB,text TEXT,status TEXT NOT NULL,error TEXT,updated_at TEXT NOT NULL,byte_length INTEGER NOT NULL DEFAULT 0,UNIQUE(record_id,url));
CREATE TABLE batches(id TEXT PRIMARY KEY,kind TEXT NOT NULL,status TEXT NOT NULL,input TEXT NOT NULL,completed INTEGER NOT NULL DEFAULT 0,failed INTEGER NOT NULL DEFAULT 0,total INTEGER NOT NULL,error TEXT,updated_at TEXT NOT NULL);
CREATE TABLE procurement_stage_runs(id TEXT PRIMARY KEY,run_id TEXT NOT NULL,record_id TEXT NOT NULL,stage TEXT NOT NULL,stage_key TEXT NOT NULL,bundle_id TEXT,template_id TEXT NOT NULL,template_version INTEGER NOT NULL,model TEXT,status TEXT NOT NULL,quality TEXT,is_current INTEGER NOT NULL DEFAULT 0,summary TEXT,output TEXT,coverage TEXT,usage TEXT,issues TEXT NOT NULL DEFAULT '[]',rejected_raw TEXT,error TEXT,started_at TEXT NOT NULL,finished_at TEXT);
CREATE TABLE procurement_requirements(id TEXT PRIMARY KEY,record_id TEXT NOT NULL,lot_id TEXT,stage_run_id TEXT NOT NULL,ordinal INTEGER NOT NULL,text TEXT NOT NULL,strength TEXT NOT NULL,category TEXT NOT NULL,actor TEXT,required_by TEXT,condition_text TEXT,grounding TEXT NOT NULL,supersedes TEXT NOT NULL DEFAULT '[]',conflicts TEXT NOT NULL DEFAULT '[]',created_at TEXT NOT NULL);
CREATE TABLE procurement_review_state(target_type TEXT NOT NULL,target_id TEXT NOT NULL,record_id TEXT NOT NULL,state TEXT NOT NULL,value TEXT,revision INTEGER NOT NULL,updated_at TEXT NOT NULL,PRIMARY KEY(target_type,target_id));
CREATE TABLE procurement_matches(requirement_id TEXT NOT NULL,profile_version_id TEXT NOT NULL,record_id TEXT NOT NULL,status TEXT NOT NULL,origin TEXT NOT NULL,company_evidence TEXT NOT NULL DEFAULT '[]',rationale TEXT NOT NULL,remediable INTEGER,reviewed INTEGER NOT NULL DEFAULT 1,reviewer TEXT NOT NULL,revision INTEGER NOT NULL,updated_at TEXT NOT NULL,PRIMARY KEY(requirement_id,profile_version_id));
CREATE TABLE procurement_assessments(id TEXT PRIMARY KEY,record_id TEXT NOT NULL,lot_id TEXT,bundle_id TEXT,profile_version_id TEXT,policy_version TEXT NOT NULL,as_of TEXT NOT NULL,freshness TEXT NOT NULL,relevance TEXT NOT NULL,eligibility TEXT NOT NULL,delivery TEXT NOT NULL,response TEXT NOT NULL,commercial TEXT NOT NULL,suggested_action TEXT NOT NULL,gates TEXT NOT NULL,critical_unknowns TEXT NOT NULL,reasons TEXT NOT NULL,is_current INTEGER NOT NULL DEFAULT 1,created_at TEXT NOT NULL);
CREATE TABLE procurement_decisions(id TEXT PRIMARY KEY,record_id TEXT NOT NULL,assessment_id TEXT,decision TEXT NOT NULL,note TEXT NOT NULL,actor TEXT NOT NULL,needs_reconfirmation INTEGER NOT NULL DEFAULT 0,stale_reason TEXT,created_at TEXT NOT NULL);
CREATE TABLE procurement_tasks(id TEXT PRIMARY KEY,record_id TEXT NOT NULL,title TEXT NOT NULL,kind TEXT NOT NULL,linked_type TEXT,linked_id TEXT,owner TEXT,due_at TEXT,status TEXT NOT NULL,completion_note TEXT,version INTEGER NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
CREATE TABLE procurement_changes(id TEXT PRIMARY KEY,record_id TEXT NOT NULL,kind TEXT NOT NULL,detail TEXT NOT NULL,detected_at TEXT NOT NULL,acknowledged_at TEXT,acknowledged_by TEXT);`);
const T = '2026-09-20T00:00:00Z';
const record = (id: string, fields: Record<string, unknown>, kind = 'opportunity') => db.query('INSERT INTO records VALUES(?,?,?,?,?,?)').run(id, kind, id, JSON.stringify({ description: `Notice ${id}`, issuedBy: 'Buyer', status: 'Open', ...fields }), 'h', T);
record('o1', { closingDate: '2026-10-02' });                                              // discovery not checked
record('o2', { closingAt: '2026-10-01T14:00:00-07:00', attachments: [{ url: 'a' }] });     // links not downloaded
record('o3', { closingDate: '2026-09-27', attachments: [{ url: 'b' }] });                  // closing today (time unverified); saved without text
record('o4', { closingDate: '2026-09-20' });                                              // passed date
record('o5', { closingDate: '2026-12-01', attachments: [{ url: 'c' }] });                  // text, extracted, assessed
record('o6', { sourceId: 'canadabuys', closingDate: '2026-11-01', attachments: [] });      // ready for decision
record('o7', { attachments: [] });                                                        // unknown deadline, stale
record('o8', { status: 'Closed', closingDate: '2026-12-01', attachments: [] });            // closed status
record('o9', { closingDate: '2026-11-15', attachments: [] });                              // assessed only under pv2
record('o10', { closingAt: '2026-09-27T10:00:00-07:00' });                                 // instant that passed this morning
record('a1', { awardDate: '2026-01-01' }, 'award');
const doc = (id: string, recordId: string, text: string | null, status = 'downloaded') => db.query('INSERT INTO documents(id,record_id,url,name,text,status,updated_at,byte_length) VALUES(?,?,?,?,?,?,?,?)').run(id, recordId, id, id, text, status, T, 10);
doc('d3', 'o3', ''); doc('d5', 'o5', 'Some usable text');
const run = (id: string, recordId: string, stage: string, current: number, status = 'succeeded', summary: string | null = null) => db.query("INSERT INTO procurement_stage_runs(id,run_id,record_id,stage,stage_key,template_id,template_version,status,is_current,summary,started_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)").run(id, 'run', recordId, stage, id, 't', 1, status, current, summary, T);
run('x5', 'o5', 'extract', 1); run('t5', 'o5', 'triage', 1); run('t6', 'o6', 'triage', 1); run('x1f', 'o1', 'extract', 0, 'failed'); run('x9t', 'o9', 'extract', 0, 'failed', 'Test run: sample');
const requirement = (id: string, category: string, grounding: string) => db.query('INSERT INTO procurement_requirements(id,record_id,stage_run_id,ordinal,text,strength,category,grounding,created_at) VALUES(?,?,?,?,?,?,?,?,?)').run(id, 'o5', 'x5', 1, id, 'mandatory', category, grounding, T);
requirement('q1', 'insurance', 'exact'); requirement('q2', 'experience', 'unverified');
db.query("INSERT INTO procurement_review_state VALUES('requirement','q2','o5','accepted',NULL,1,?)").run(T);
db.query("INSERT INTO procurement_matches(requirement_id,profile_version_id,record_id,status,origin,rationale,reviewer,revision,updated_at) VALUES('q1','pv1','o5','unknown','buyer_mandatory','r','me',1,?)").run(T);
const assess = (id: string, recordId: string, profile: string | null, relevance: string, eligibility: string, action: string, freshness = 'current', current = 1) => db.query("INSERT INTO procurement_assessments VALUES(?,?,NULL,NULL,?,'procurement-policy-v1',?,?,?,?,'unknown','unknown','not_assessed',?,'[]','[]','[]',?,?)").run(id, recordId, profile, T, freshness, relevance, eligibility, action, current, T);
assess('a5', 'o5', 'pv1', 'strong', 'unresolved', 'needs_information'); assess('a5old', 'o5', 'pv1', 'weak', 'blocker', 'decline', 'current', 0);
assess('a6', 'o6', 'pv1', 'possible', 'supported_for_reviewed_requirements', 'ready_for_human_decision'); assess('a6n', 'o6', null, 'possible', 'not_assessed', 'needs_information');
assess('a7', 'o7', 'pv1', 'unknown', 'unresolved', 'archive_or_monitor', 'stale'); assess('a9', 'o9', 'pv2', 'strong', 'unresolved', 'investigate');
db.query("INSERT INTO procurement_decisions VALUES('d7a','o7','a7','monitor','old','me',0,NULL,'2026-09-01T00:00:00Z'),('d7b','o7','a7','pursue','go','me',1,'Addendum changed scope','2026-09-10T00:00:00Z')").run();
db.query("INSERT INTO procurement_changes VALUES('c5','o5','document_added','{}',?,NULL,NULL)").run(T);
db.query("INSERT INTO procurement_tasks VALUES('k1','o1','Get files','acquire_evidence',NULL,NULL,NULL,NULL,'open',NULL,1,?,?)").run(T, T);
db.query("INSERT INTO batches VALUES('b1','download','succeeded','{}',3,0,3,NULL,'2026-09-25T00:00:00Z'),('b2','download','failed','{}',0,2,2,'Portal timed out','2026-09-26T00:00:00Z'),('b3','review','partial','{}',4,1,5,NULL,'2026-09-24T00:00:00Z')").run();
db.close();
const asOf = Date.parse('2026-09-27T19:00:00Z'); // noon in Vancouver

const ids = async (where: { sql: string; parameters: (string | number)[] }) => (await (await import('../procurement/display')).sql(`SELECT id FROM records WHERE ${where.sql} ORDER BY id`, where.parameters)).map((row: any) => row.id);

test('Home queue counts match the drill-down predicate exactly', async () => {
  const expected: Record<string, string[]> = { acquire: ['o1', 'o2', 'o3'], requirements: ['o5'], eligibility: ['o5', 'o7'], changes: ['o5', 'o7'], decide: ['o6'] };
  for (const queue of QUEUES) {
    const result = await data.readQueue(queue, 'pv1', '', asOf), drill = await ids(reviewPredicate({ queue }, { profileVersionId: 'pv1', asOf }));
    expect([queue, drill]).toEqual([queue, expected[queue]]);
    expect([queue, result.total]).toEqual([queue, drill.length]);
    expect(result.items.map(item => item.id).sort()).toEqual(drill);
  }
  const acquire = await data.readQueue('acquire', 'pv1', '', asOf);
  expect(Object.fromEntries(acquire.items.map(item => [item.id, item.reason]))).toEqual({ o1: 'unchecked', o2: 'notDownloaded', o3: 'noText' });
  expect((await data.readQueue('decide', 'pv1', 'bc-bid', asOf)).total).toBe(0);
  expect((await data.readQueue('decide', 'pv1', 'canadabuys', asOf)).total).toBe(1);
  // Another profile version's assessment is never reused.
  expect((await data.readQueue('decide', 'pv2', '', asOf)).total).toBe(0);
  expect(await ids(reviewPredicate({ queue: 'eligibility' }, { profileVersionId: null, asOf }))).toEqual([]);
});

test('coverage stages, policies, deadlines, decisions and source health', async () => {
  expect(await data.readCoverage('')).toEqual({ saved: 10, unchecked: 3, linked: 3, withFiles: 2, withText: 1, files: 2, usable: 1, noText: 1 });
  expect((await data.readCoverage('canadabuys')).saved).toBe(1);
  expect(await data.readReviewCoverage('', 'pv1')).toEqual({ triaged: 2, extracted: 1, assessed: 3 });
  expect(await data.readReviewCoverage('', null)).toEqual({ triaged: 2, extracted: 1, assessed: 1 });
  expect(await data.readPolicies('pv1')).toEqual([{ policy: 'procurement-policy-v1', count: 3 }]);
  const deadlines = await data.readDeadlines('', asOf);
  expect(deadlines.total).toBe(3);
  expect(deadlines.rows.map(row => row.id)).toEqual(['o3', 'o2', 'o1']);
  const decisions = await data.readRecentDecisions('');
  expect(decisions.map(row => row.id)).toEqual(['d7b', 'd7a']);
  expect(decisions[0].title).toBe('Notice o7');
  expect(await data.readRecentDecisions('canadabuys')).toEqual([]);
  const health = await data.readSourceHealth();
  const download = health.find(row => row.kind === 'download')!;
  expect(download.succeeded).toBe('2026-09-25T00:00:00Z');
  expect(download.failed.error).toBe('Portal timed out');
  expect(health.find(row => row.kind === 'review')!.partial).toMatchObject({ completed: 4, failed: 1, total: 5 });
});

test('Insights matrix, gaps, review coverage, bottlenecks and stale decisions', async () => {
  const scope = data.insightScope('', true, asOf);
  const matrix = await data.readMatrix(scope, 'pv1');
  expect([matrix.count('strong', 'conditions'), matrix.count('possible', 'ready'), matrix.count('unknown', 'unknown'), matrix.count('weak', 'blocker')]).toEqual([1, 1, 1, 0]);
  expect(matrix.notAssessed).toBe(4); // o1, o2, o3, o9
  expect(matrix.others.sort((a, b) => String(a.profile).localeCompare(String(b.profile)))).toEqual([{ profile: null, count: 1 }, { profile: 'pv2', count: 1 }]);
  // Each cell drills into exactly the counted notices.
  expect(await ids(reviewPredicate({ open: true, relevance: 'strong', readiness: 'conditions' }, { profileVersionId: 'pv1', asOf }))).toEqual(['o5']);
  expect(await ids(reviewPredicate({ open: true, relevance: 'unknown', readiness: 'unknown' }, { profileVersionId: 'pv1', asOf }))).toEqual(['o7']);
  expect(await ids(reviewPredicate({ open: true, assessed: 'none' }, { profileVersionId: 'pv1', asOf }))).toEqual(['o1', 'o2', 'o3', 'o9']);
  expect(await ids(reviewPredicate({ assessed: 'none' }, { profileVersionId: 'pv1', asOf }))).toHaveLength(7); // awards excluded, closed included
  expect(await data.readGaps(scope, 'pv1')).toEqual([{ category: 'experience', status: 'none', count: 1 }, { category: 'insurance', status: 'unknown', count: 1 }]);
  expect(await ids(reviewPredicate({ reqCategory: 'insurance', match: 'unknown' }, { profileVersionId: 'pv1', asOf }))).toEqual(['o5']);
  expect(await data.readGaps(scope, null)).toEqual([{ category: 'experience', status: 'none', count: 1 }, { category: 'insurance', status: 'none', count: 1 }]);
  expect(await data.readRequirementCoverage(scope)).toEqual({ states: { accepted: 1, proposed: 1 }, total: 7, extracted: 1 });
  const bottlenecks = await data.readBottlenecks('', 'pv1', asOf);
  expect(Object.fromEntries(bottlenecks.queues)).toEqual({ acquire: 3, requirements: 1, eligibility: 2, changes: 2, decide: 1 });
  expect(bottlenecks.runs).toEqual([{ stage: 'extract', status: 'failed', count: 1 }]);
  expect(bottlenecks.tasks).toEqual([{ kind: 'acquire_evidence', count: 1 }]);
  expect(Object.fromEntries((await data.readBottlenecks('', null, asOf)).queues).eligibility).toBeNull();
  const stale = await data.readStale(scope, 'pv1');
  expect(stale.decisions.map(row => row.id)).toEqual(['d7b']);
  expect(stale.staleAssessments).toBe(1);
  expect(statements.every(statement => statement.length <= 10_000)).toBe(true);
});
