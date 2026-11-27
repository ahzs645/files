import { validateCatalogSelect, runCatalogSelect } from '../../../../zoer/backend/src/catalog-reader';
import { test, expect, mock, afterAll } from 'bun:test';
import { Database } from 'bun:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Sources' attachment, batch and failure-queue statements through the host's validator and read-only runner.
const dir = mkdtempSync(join(tmpdir(), 'source-health-')), path = join(dir, 'catalog.sqlite');
afterAll(() => rmSync(dir, { recursive: true, force: true }));
const sql = async (statement: string, parameters: (string | number)[] = []) => { validateCatalogSelect(statement, parameters); return (await runCatalogSelect(path, statement, parameters, true)).rows; };
mock.module('../procurement/display', () => ({ INVENTORY_SQL: '', sourceName: (id: string) => id, sql }));
const { ATTACHMENT_SQL, BATCH_SQL, FAILED_FILES_SQL, FAILED_TASKS_SQL, batchHealth, failedFiles, failureSummary, groupFailures } = await import('../procurement/source-health');
const { paged } = await import('../procurement/status-data');

const db = new Database(path);
db.exec(`CREATE TABLE records(id TEXT PRIMARY KEY,kind TEXT NOT NULL,title TEXT NOT NULL,data TEXT NOT NULL,hash TEXT NOT NULL,updated_at TEXT NOT NULL);
CREATE TABLE documents(id TEXT PRIMARY KEY,record_id TEXT NOT NULL,url TEXT NOT NULL,name TEXT NOT NULL,media_type TEXT,sha256 TEXT,content BLOB,text TEXT,status TEXT NOT NULL,error TEXT,updated_at TEXT NOT NULL,byte_length INTEGER NOT NULL DEFAULT 0,UNIQUE(record_id,url));
CREATE TABLE batches(id TEXT PRIMARY KEY,kind TEXT NOT NULL,status TEXT NOT NULL,input TEXT NOT NULL,completed INTEGER NOT NULL DEFAULT 0,failed INTEGER NOT NULL DEFAULT 0,total INTEGER NOT NULL,error TEXT,updated_at TEXT NOT NULL);
CREATE TABLE research_tasks(source_id TEXT NOT NULL,run_id TEXT NOT NULL,record_id TEXT NOT NULL,kind TEXT NOT NULL,status TEXT NOT NULL,error TEXT,result TEXT,updated_at TEXT NOT NULL);`);
const T = '2026-11-20T00:00:00Z';
const record = (id: string, fields: Record<string, unknown>) => db.query('INSERT INTO records VALUES(?,?,?,?,?,?)').run(id, 'opportunity', `Title ${id}`, JSON.stringify({ status: 'Open', ...fields }), 'h', T);
const doc = (record: string, url: string, status: string, error: string | null = null, at = T) => db.query('INSERT INTO documents(id,record_id,url,name,status,error,updated_at) VALUES(?,?,?,?,?,?,?)').run(`${record}:${url}`, record, url, url.split('/').at(-1)!, status, error, at);
const file = (guid: string, query: string) => `https://bcbid.gov.bc.ca/bare.aspx/en/fil/download_public/${guid}?${query}`;
// Attachment discovery: one predicate for "not checked" (no attachment list and no file), whatever the source.
record('bc-1', { attachments: [{ url: file('aa', 'a=1&b=2') }], detailFields: [{}] });
record('bc-2', { attachments: [] });                                     // list saved, no links (not "not checked")
record('cb-1', { sourceId: 'canadabuys', attachments: [] });             // connector without detailFields: checked, no links
record('mu-1', { sourceId: 'municipal-sites' });                         // nothing saved yet: not checked
// Failure queue: bc-1's "aa" failed under one spelling and was saved under the other; "bb" failed for real.
doc('bc-1', file('aa', 'a=1&b=2'), 'failed', 'getaddrinfo EAI_AGAIN', '2026-11-19T00:00:00Z');
doc('bc-1', file('aa', 'b=2&a=1'), 'downloaded', null, '2026-11-21T00:00:00Z');
doc('bc-1', file('bb', 'a=1'), 'failed', 'Manual browser verification required. Complete the browser check manually, then retry.');
doc('bc-2', file('cc', 'a=1'), 'failed', 'Document download did not start. Manual browser verification required.');
const task = (record: string, kind: string, status: string, at: string) => db.query('INSERT INTO research_tasks VALUES(?,?,?,?,?,?,?,?)').run(`${record}:${kind}:${at}`, 'run', record, kind, status, 'boom', null, at);
task('cb-1', 'review', 'failed', '2026-11-20T00:00:00Z');
task('mu-1', 'review', 'failed', '2026-11-20T00:00:00Z'); task('mu-1', 'review', 'succeeded', '2026-11-21T00:00:00Z'); // fixed since
task('bc-2', 'attachment', 'waiting_for_user', '2026-11-22T00:00:00Z');   // task log rows never count on their own
db.query("INSERT INTO batches VALUES('q1','download','succeeded','{\"queueScope\":\"open\"}',367,0,466,NULL,'2026-11-27T00:00:00Z'),('x1','download','partial','{\"extractOnly\":true}',0,1,1,'x','2026-11-26T00:00:00Z'),('r1','download','running','{}',0,0,5,NULL,'2026-11-21T00:00:00Z')").run();
db.close();

test('attachment discovery uses the Acquire queue\'s "not checked" rule for every source', async () => {
  const rows = Object.fromEntries((await sql(ATTACHMENT_SQL)).map((row: any) => [row.sourceId, row]));
  expect(rows['bc-bid']).toMatchObject({ total: 2, notChecked: 0, checkedNoLinks: 1, withLinks: 1, withFiles: 1 });
  expect(rows.canadabuys).toMatchObject({ notChecked: 0, checkedNoLinks: 1 });
  expect(rows['municipal-sites']).toMatchObject({ notChecked: 1, checkedNoLinks: 0 });
});

test('failure queue: current file state with file identity, and only the latest non-download task', async () => {
  const files = failedFiles(await paged(FAILED_FILES_SQL, []));
  expect(files.map(task => [task.record_id, task.name, task.status])).toEqual([['bc-1', 'bb?a=1', 'waiting_for_user'], ['bc-2', 'cc?a=1', 'failed']]);
  const tasks = await paged(FAILED_TASKS_SQL, []);
  expect(tasks.map((task: any) => task.record_id)).toEqual(['cb-1']);
  expect(failureSummary([...files, ...tasks])).toEqual({ files: 2, fileNotices: 2, waitingFiles: 1, otherNotices: 1 });
  expect(groupFailures([...files, ...tasks]).map(group => group.recordId).sort()).toEqual(['bc-1', 'bc-2', 'cb-1']);
});

test('batches: extraction runs apart from downloads, queue batches count notices, stale running shows its real outcome', async () => {
  const rows = await sql(BATCH_SQL);
  expect(rows.map((row: any) => [row.id, row.kind])).toEqual([['q1', 'download'], ['x1', 'extract'], ['r1', 'download']]);
  const [download] = batchHealth(rows, [{ id: 'r1', status: 'cancelled' }]);
  expect(download.attempt).toMatchObject({ id: 'q1', statusText: 'Done', outcome: '367 of 466 notices complete (every file saved)' });
  const stale = batchHealth([{ ...rows[2], updated_at: '2026-11-28T00:00:00Z' }], [{ id: 'r1', status: 'cancelled' }])[0];
  expect(stale.attempt).toMatchObject({ statusText: 'Stopped', problem: true });
  expect(batchHealth([rows[2]], [])[0].attempt.statusText).toBe('Ended; outcome not recorded');
  expect(batchHealth([rows[2]])[0].attempt.statusText).toBe('Running');
});
