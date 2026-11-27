import { validateCatalogSelect, runCatalogSelect } from '../../../../zoer/backend/src/catalog-reader';
import { test, expect, mock, afterAll } from 'bun:test';
import { Database } from 'bun:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Home's saved-notice totals and batch health through the host's validator and read-only runner (plugin document view).
const dir = mkdtempSync(join(tmpdir(), 'home-data-')), path = join(dir, 'catalog.sqlite');
afterAll(() => rmSync(dir, { recursive: true, force: true }));
mock.module('../procurement/display', () => ({
  INVENTORY_SQL: '', sourceName: (id: string) => id,
  sql: async (statement: string, parameters: (string | number)[] = []) => { validateCatalogSelect(statement, parameters); return (await runCatalogSelect(path, statement, parameters, true)).rows; },
}));
const data = await import('./home-data');

const db = new Database(path);
db.exec(`CREATE TABLE records(id TEXT PRIMARY KEY,kind TEXT NOT NULL,title TEXT NOT NULL,data TEXT NOT NULL,hash TEXT NOT NULL,updated_at TEXT NOT NULL);
CREATE TABLE workspace_state(key TEXT PRIMARY KEY,data TEXT NOT NULL,updated_at TEXT NOT NULL);
CREATE TABLE documents(id TEXT PRIMARY KEY,record_id TEXT NOT NULL,url TEXT NOT NULL,name TEXT NOT NULL,media_type TEXT,sha256 TEXT,content BLOB,text TEXT,status TEXT NOT NULL,error TEXT,updated_at TEXT NOT NULL,byte_length INTEGER NOT NULL DEFAULT 0,UNIQUE(record_id,url));
CREATE TABLE batches(id TEXT PRIMARY KEY,kind TEXT NOT NULL,status TEXT NOT NULL,input TEXT NOT NULL,completed INTEGER NOT NULL DEFAULT 0,failed INTEGER NOT NULL DEFAULT 0,total INTEGER NOT NULL,error TEXT,updated_at TEXT NOT NULL);
CREATE TABLE procurement_stage_runs(id TEXT PRIMARY KEY,run_id TEXT NOT NULL,record_id TEXT NOT NULL,stage TEXT NOT NULL,is_current INTEGER NOT NULL DEFAULT 0);
CREATE TABLE procurement_assessments(id TEXT PRIMARY KEY,record_id TEXT NOT NULL,profile_version_id TEXT,is_current INTEGER NOT NULL DEFAULT 1);`);
const T = '2026-11-20T00:00:00Z';
const record = (id: string, fields: Record<string, unknown>) => db.query('INSERT INTO records VALUES(?,?,?,?,?,?)').run(id, 'opportunity', id, JSON.stringify({ status: 'Open', ...fields }), 'h', T);
record('opportunity:1', { attachments: [{ url: 'https://x/a' }] });                                   // BC Bid notice
record('copy:1', { sourceId: 'municipal-sites', duplicateOf: 'opportunity:1', attachments: [] });       // the same notice cross-posted
record('cb-1', { sourceId: 'canadabuys', externalId: 'X' });                                            // current CanadaBuys amendment
record('cb-2', { sourceId: 'canadabuys', externalId: 'X' });                                            // superseded amendment
record('merged', { sourceId: 'canadabuys', externalId: 'Y', mergedInto: 'cb-1' });
db.query("INSERT INTO documents(id,record_id,url,name,text,status,updated_at) VALUES('d1','copy:1','u','u','text','downloaded',?)").run(T);
const batch = (id: string, kind: string, status: string, input: object, at: string) => db.query('INSERT INTO batches VALUES(?,?,?,?,1,0,2,NULL,?)').run(id, kind, status, JSON.stringify(input), at);
batch('stale', 'download', 'running', { queueScope: 'open' }, '2026-11-21T00:15:46Z');   // its run was cancelled
batch('live', 'download', 'running', {}, '2026-11-27T21:00:00Z');
batch('extract', 'download', 'partial', { extractOnly: true }, '2026-11-26T17:11:00Z');  // a text-extraction run
batch('done', 'download', 'succeeded', {}, '2026-11-27T03:47:00Z');
db.close();

test('saved notices count each notice once, as Opportunities does; files count on every saved row', async () => {
  const all = await data.readCoverage('');
  expect(all.saved).toBe(2);          // opportunity:1 and cb-1: no cross-posted copy, superseded amendment or merged row
  expect(all.files).toBe(1);          // the file saved on the cross-posted copy still counts
  expect((await data.readCoverage('municipal-sites')).saved).toBe(1); // a source's own list keeps its copies
  expect((await data.readCoverage('canadabuys')).saved).toBe(1);
});

test('a batch is running only while its workflow run is active; extraction runs are their own kind', async () => {
  const runs = [{ id: 'stale', status: 'cancelled' }, { id: 'live', status: 'running' }];
  const health = await data.readSourceHealth(runs);
  expect(health.map(row => row.kind)).toEqual(['download', 'extract']);
  expect(health.find(row => row.kind === 'download')).toMatchObject({ running: 1, succeeded: '2026-11-27T03:47:00Z', partial: undefined });
  expect(health.find(row => row.kind === 'extract')!.partial).toMatchObject({ kind: 'extract', completed: 1, total: 2 });
  // The stale batch alone (its run ended or is no longer listed) is not running; without a run list nothing is.
  expect((await data.readSourceHealth([{ id: 'live', status: 'succeeded' }])).find(row => row.kind === 'download')!.running).toBeUndefined();
  expect((await data.readSourceHealth(null)).find(row => row.kind === 'download')!.running).toBeUndefined();
});
