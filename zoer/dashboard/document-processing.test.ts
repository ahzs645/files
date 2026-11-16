import {test, expect, mock} from 'bun:test';
import {Database} from 'bun:sqlite';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {DOCUMENT_STATS_SQL, NO_TEXT_SQL, PENDING_COUNT_SQL, PENDING_EXTRACTION, PREFLIGHT_PENDING_SQL, fileFilterSql, fileState, noTextSql} from './document-processing';

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
    expect((await query(DOCUMENT_STATS_SQL))[0]).toMatchObject({files: 7, downloaded: 6, failed: 1, readable: 1, pending: 3, unreadable: 2});
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
    expect(await list('all')).toHaveLength(7);
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
  expect(fileState({status: 'downloaded', chars: 0, error: 'No text layer'})).toEqual(['warn', 'No text']);
  expect(fileState({status: 'downloaded', chars: 12, error: null})).toEqual(['good', 'Readable']);
  expect(fileState({status: 'failed', chars: null, error: 'Download failed'})).toEqual(['bad', 'Failed']);
});
