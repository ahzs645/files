import {test, expect, mock} from 'bun:test';
import {Database} from 'bun:sqlite';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {DOCUMENT_STATS_SQL, FAILED_ROWS_SQL, NO_TEXT_SQL, PENDING_COUNT_SQL, PENDING_EXTRACTION, PREFLIGHT_PENDING_SQL, fileFilterSql, fileState, noTextSql, unsavedFailures} from './document-processing';
import {RUN_CHECKS_SINCE_SQL, RUN_FILE_STATS_SQL} from './document-run';

const source = process.env.ZOER_SOURCE_ROOT ?? new URL('../../../zoer', import.meta.url).pathname;
const {runCatalogSelect, validateCatalogSelect} = await import(pathToFileURL(join(source, 'backend/src/catalog-reader.ts')).href);

// opportunity-queries reads through the dashboard bridge; only its SQL text is used here.
const core = await import('../../packages/procurement-core/src/index.ts');
mock.module('@bcbid/procurement-core', () => core);
mock.module('./procurement/display', () => ({INVENTORY_SQL: '', sourceName: (id: string) => id, sql: async () => []}));
const {EVIDENCE_COUNTS_SQL} = await import('./review-workspace/opportunity-queries');

/** One readable, one pending, one text-less (with an OCR warning), one text-less without a warning and one failed file. */
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'procurement-processing-'));
  const path = join(root, 'catalog.sqlite'), db = new Database(path);
  db.exec('CREATE TABLE records(id TEXT PRIMARY KEY,kind TEXT NOT NULL,title TEXT NOT NULL,data TEXT NOT NULL,hash TEXT NOT NULL,updated_at TEXT NOT NULL)');
  db.exec('CREATE TABLE documents(id TEXT,record_id TEXT,url TEXT,name TEXT,media_type TEXT,sha256 TEXT,byte_length INTEGER,text TEXT,status TEXT,error TEXT,updated_at TEXT)');
  const record = db.query("INSERT INTO records VALUES(?,'opportunity',?,?,'h','2026-11-16')");
  record.run('opportunity:a', 'A', JSON.stringify({attachments: [{url: 'u'}]})); record.run('opportunity:b', 'B', '{}');
  const insert = db.query('INSERT INTO documents(id,record_id,name,byte_length,text,status,error,updated_at) VALUES(?,?,?,?,?,?,?,?)');
  insert.run('readable', 'opportunity:a', 'Readable.pdf', 10, 'Scope of work', 'downloaded', 'OCR read pages 3; recognition errors are possible', '2026-11-16');
  insert.run('pending', 'opportunity:a', 'Pending.pdf', 10, null, 'downloaded', PENDING_EXTRACTION, '2026-11-16');
  insert.run('pending2', 'opportunity:b', 'Pending2.pdf', 10, null, 'downloaded', PENDING_EXTRACTION, '2026-11-16');
  insert.run('scan', 'opportunity:a', 'Scan.pdf', 10, '', 'downloaded', 'No text layer; OCR found nothing', '2026-11-16');
  insert.run('drawing', 'opportunity:a', 'Drawing.dwg', 10, null, 'downloaded', null, '2026-11-16');
  insert.run('failed', 'opportunity:a', 'Missing.pdf', 0, null, 'failed', 'Download failed', '2026-11-16');
  // A pending file whose notice was removed: no run can pick it up, so the Processing count leaves it out.
  insert.run('orphan', 'opportunity:removed', 'Orphan.pdf', 10, null, 'downloaded', PENDING_EXTRACTION, '2026-11-16');
  db.close();
  const query = async (statement: string, parameters: unknown[] = []) => { validateCatalogSelect(statement, parameters); return (await runCatalogSelect(path, statement, parameters, true)).rows as any[]; };
  return {query, done: () => rm(root, {recursive: true, force: true})};
}
const ids = (rows: any[]) => rows.map(row => row.id).sort();

test('AC-015: statistics count pending files apart from "No text"', async () => {
  const {query, done} = await fixture();
  try {
    // Files of notices that still exist (the orphan is left out), as Opportunities › Files lists them.
    expect((await query(DOCUMENT_STATS_SQL))[0]).toMatchObject({files: 6, downloaded: 5, failed: 1, readable: 1, pending: 2, unreadable: 2, bytes: 50});
    expect((await query(PENDING_COUNT_SQL))[0]).toEqual({files: 2, notices: 2});
  } finally { await done(); }
});

test('AC-015: a pending file matches the pending filter only; no-text queries exclude it', async () => {
  const {query, done} = await fixture();
  try {
    const list = (filter: string) => query(`SELECT d.id FROM documents d WHERE ${fileFilterSql(filter)}`);
    expect(ids(await list('pending'))).toEqual(['orphan', 'pending', 'pending2']);
    expect(ids(await list('unreadable'))).toEqual(['drawing', 'scan']);
    expect(ids(await list('warnings'))).toEqual(['readable', 'scan']);
    expect(ids(await list('failed'))).toEqual(['failed']);
    // "All" is the saved-files library; failed downloads are their own list.
    expect(await list('all')).toHaveLength(6);
    // Home, the Acquire queue and Sources build their conditions from these.
    expect(ids(await query(`SELECT d.id FROM documents d WHERE ${NO_TEXT_SQL}`))).toEqual(['drawing', 'scan']);
    expect(ids(await query(`SELECT id FROM documents WHERE ${noTextSql()}`))).toEqual(['drawing', 'scan']);
  } finally { await done(); }
});

test('AC-015 and AC-036: per-notice pending counts for the evidence column and the batch preflight', async () => {
  const {query, done} = await fixture();
  try {
    const evidence = await query(EVIDENCE_COUNTS_SQL(2), ['opportunity:a', 'opportunity:b']);
    expect(evidence.find(row => row.id === 'opportunity:a')).toMatchObject({downloaded: 4, usable: 1, pending: 1});
    expect(evidence.find(row => row.id === 'opportunity:b')).toMatchObject({downloaded: 1, usable: 0, pending: 1});
    const preflight = await query(PREFLIGHT_PENDING_SQL(2), ['opportunity:a', 'opportunity:b']);
    expect(preflight.sort((a, b) => a.id < b.id ? -1 : 1)).toEqual([{id: 'opportunity:a', pending: 1}, {id: 'opportunity:b', pending: 1}]);
  } finally { await done(); }
});

test('AC-015: fileState names a pending row "Text pending"', () => {
  expect(fileState({status: 'downloaded', chars: null, error: PENDING_EXTRACTION})).toEqual(['info', 'Text pending']);
  expect(fileState({status: 'downloaded', chars: 0, error: 'No text layer'})).toEqual(['neutral', 'No text']);
  expect(fileState({status: 'downloaded', chars: 12, error: null})).toEqual(['good', 'Readable']);
  expect(fileState({status: 'failed', chars: null, error: 'Download failed'})).toEqual(['bad', 'Download failed']);
  expect(fileState({status: 'failed', chars: null, error: 'Manual browser verification required.'})).toEqual(['warn', 'Waiting for you']);
});

test('Documents and Runs read through the host validator: failed files, run file stats and checks since the last save', async () => {
  const root = await mkdtemp(join(tmpdir(), 'procurement-runs-'));
  const path = join(root, 'catalog.sqlite'), db = new Database(path);
  try {
    db.exec('CREATE TABLE records(id TEXT PRIMARY KEY,kind TEXT NOT NULL,title TEXT NOT NULL,data TEXT NOT NULL,hash TEXT NOT NULL,updated_at TEXT NOT NULL)');
    db.exec('CREATE TABLE documents(id TEXT,record_id TEXT,url TEXT,name TEXT,media_type TEXT,sha256 TEXT,byte_length INTEGER,text TEXT,status TEXT,error TEXT,updated_at TEXT)');
    db.exec('CREATE TABLE research_tasks(id TEXT PRIMARY KEY,run_id TEXT NOT NULL,record_id TEXT NOT NULL,kind TEXT NOT NULL,source_id TEXT NOT NULL,status TEXT NOT NULL,result TEXT,error TEXT,attempt INTEGER NOT NULL DEFAULT 0,updated_at TEXT NOT NULL)');
    db.query("INSERT INTO records VALUES('opportunity:1','opportunity','Notice','{}','h','2026-11-27')").run();
    const guid = 'https://bcbid.gov.bc.ca/page.aspx/en/fil/download_public/fa3876c0-1111-2222-3333-444455556666';
    const doc = db.query('INSERT INTO documents(id,record_id,url,name,byte_length,status,error,updated_at) VALUES(?,?,?,?,?,?,?,?)');
    doc.run('saved', 'opportunity:1', guid + '?a=1&b=2', 'Map.zip', 5, 'downloaded', null, '2026-11-27T10:00:00Z');
    doc.run('elsewhere', 'opportunity:1', guid + '?b=2&a=1', 'Map.zip', 0, 'failed', 'Document download did not start.', '2026-11-27T09:00:00Z');
    doc.run('missing', 'opportunity:1', 'https://example.org/x.pdf', 'X.pdf', 0, 'failed', 'Manual browser verification required.', '2026-11-27T11:00:00Z');
    const task = db.query("INSERT INTO research_tasks(id,run_id,record_id,kind,source_id,status,updated_at) VALUES(?,?,'opportunity:1','attachment','s',?,?)");
    task.run('t1', 'run', 'succeeded', '2026-11-27T16:11:00Z'); task.run('t2', 'run', 'succeeded', '2026-11-27T16:26:43Z');
    task.run('t3', 'run', 'waiting_for_user', '2026-11-27T16:27:48Z'); task.run('t4', 'run', 'failed', '2026-11-27T17:00:33Z'); task.run('t5', 'run', 'waiting_for_user', '2026-11-27T18:13:04Z');
    task.run('t6', 'other', 'waiting_for_user', '2026-11-27T19:00:00Z');
    db.close();
    const query = async (statement: string, parameters: (string | number)[] = []) => { validateCatalogSelect(statement, parameters); return (await runCatalogSelect(path, statement, parameters, true)).rows as any[]; };
    // The saved-elsewhere failure is not a missing file; the browser-check one is.
    expect(unsavedFailures(await query(`${FAILED_ROWS_SQL} LIMIT 200 OFFSET ?`, [0])).map(row => row.id)).toEqual(['missing']);
    expect(await query(RUN_FILE_STATS_SQL(2), ['run', 'other'])).toEqual([
      {runId: 'other', saved: 0, checks: 1, firstAt: '2026-11-27T19:00:00Z', lastAt: '2026-11-27T19:00:00Z', lastSavedAt: null},
      {runId: 'run', saved: 2, checks: 2, firstAt: '2026-11-27T16:11:00Z', lastAt: '2026-11-27T18:13:04Z', lastSavedAt: '2026-11-27T16:26:43Z'},
    ]);
    expect(await query(RUN_CHECKS_SINCE_SQL, ['run', '2026-11-27T16:26:43Z'])).toEqual([{checks: 2}]);
  } finally { await rm(root, {recursive: true, force: true}); }
});
