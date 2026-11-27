import { validateCatalogSelect, runCatalogSelect } from '../../../../zoer/backend/src/catalog-reader';
import { test, expect, mock, afterAll } from 'bun:test';
import { Database } from 'bun:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// AI results' "open opportunities reviewed" and the profile list, through the host's validator and read-only runner.
const dir = mkdtempSync(join(tmpdir(), 'review-cleanup-')), path = join(dir, 'catalog.sqlite');
afterAll(() => rmSync(dir, { recursive: true, force: true }));
const run = async (statement: string, parameters: (string | number)[] = []) => { validateCatalogSelect(statement, parameters); return (await runCatalogSelect(path, statement, parameters, true)).rows; };
mock.module('../procurement/display', () => ({ INVENTORY_SQL: '', sourceName: (id: string) => id, sql: run }));
const { openWork, readAttentionSummary } = await import('./home-data');
const { readOpenReviewed } = await import('../review-analysis');
const { readProfileSummaries } = await import('./profile-summaries');

const db = new Database(path);
db.exec(`CREATE TABLE records(id TEXT PRIMARY KEY,kind TEXT NOT NULL,title TEXT NOT NULL,data TEXT NOT NULL,hash TEXT NOT NULL,updated_at TEXT NOT NULL);
CREATE TABLE workspace_state(key TEXT PRIMARY KEY,data TEXT NOT NULL,updated_at TEXT NOT NULL);
CREATE TABLE reviews(id TEXT PRIMARY KEY,record_id TEXT NOT NULL,prompt_id TEXT NOT NULL,status TEXT NOT NULL,created_at TEXT NOT NULL);
CREATE TABLE procurement_profiles(id TEXT PRIMARY KEY,name TEXT NOT NULL);`);
const T = '2026-11-20T00:00:00Z';
const record = (id: string, fields: Record<string, unknown>) => db.query('INSERT INTO records VALUES(?,?,?,?,?,?)').run(id, 'opportunity', id, JSON.stringify({ status: 'Open', closingDate: '2027-01-15', ...fields }), 'h', T);
record('opportunity:1', {});                                                   // BC Bid, reviewed
record('copy:1', { sourceId: 'municipal-sites', duplicateOf: 'opportunity:1' }); // the same notice cross-posted: counted once
record('opportunity:2', {});                                                   // hidden as not relevant
record('opportunity:3', { closingDate: '2026-01-01' });                        // closed
record('opportunity:4', {});                                                   // open, review failed after a success
db.query("INSERT INTO workspace_state VALUES('procurement:hidden:opportunity:2',?,?)").run(JSON.stringify({ recordId: 'opportunity:2', hidden: 1 }), T);
const review = (id: string, recordId: string, status: string, at: string) => db.query('INSERT INTO reviews VALUES(?,?,?,?,?)').run(id, recordId, 'bid', status, at);
review('r1', 'opportunity:1', 'succeeded', '2026-11-01');
review('r2', 'opportunity:4', 'succeeded', '2026-11-01');
review('r3', 'opportunity:4', 'failed', '2026-11-02');
db.query("INSERT INTO procurement_profiles VALUES('p1','dssdf'),('p2','Acme')").run();
db.close();

const asOf = Date.parse('2026-11-27T20:00:00Z');
const query = async (_: string, input: { statement: string; parameters: (string | number)[] }) => ({ rows: await run(input.statement, input.parameters) });

test('open opportunities reviewed use the same population as Home (each notice once, hidden ones left out)', async () => {
  const home = await readAttentionSummary('', null, asOf);
  const reviewed = await readOpenReviewed(query, openWork(asOf, ''));
  expect(reviewed.open).toBe(home.open);
  expect(reviewed.open).toBe(2);       // opportunity:1 and opportunity:4
  expect(reviewed.reviewed).toBe(1);   // a newer failed review excludes opportunity:4's older success
});

test('profile summaries list drafts with whether a version is published', async () => {
  const profiles = await readProfileSummaries([{ id: 'v1', profileId: 'p2', version: 1, name: 'Acme', publishedAt: T }]);
  expect(profiles).toEqual([{ id: 'p2', name: 'Acme', published: true }, { id: 'p1', name: 'dssdf', published: false }]);
});
