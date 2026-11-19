import { validateCatalogSelect, runCatalogSelect } from '../../../../zoer/backend/src/catalog-reader';
import { test, expect, mock, afterAll } from 'bun:test';
import { Database } from 'bun:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// The Status page's document-gap statements go through the host's validator and its real read-only runner (plugin
// document view, 200-row cap), against a catalog large enough to need paging.
const dir = mkdtempSync(join(tmpdir(), 'status-gap-')), path = join(dir, 'catalog.sqlite');
afterAll(() => rmSync(dir, { recursive: true, force: true }));
const statements: string[] = [];
mock.module('../procurement/display', () => ({
  INVENTORY_SQL: '', sourceName: (id: string) => id,
  sql: async (statement: string, parameters: (string | number)[] = []) => { validateCatalogSelect(statement, parameters); statements.push(statement); return (await runCatalogSelect(path, statement, parameters, true)).rows; },
}));
const { readDocumentGap } = await import('../procurement/status-data');

const db = new Database(path);
db.exec(`CREATE TABLE records(id TEXT PRIMARY KEY,kind TEXT NOT NULL,title TEXT NOT NULL,data TEXT NOT NULL,hash TEXT NOT NULL,updated_at TEXT NOT NULL);
CREATE TABLE documents(id TEXT PRIMARY KEY,record_id TEXT NOT NULL,url TEXT NOT NULL,name TEXT NOT NULL,media_type TEXT,sha256 TEXT,content BLOB,text TEXT,status TEXT NOT NULL,error TEXT,updated_at TEXT NOT NULL,byte_length INTEGER NOT NULL DEFAULT 0,UNIQUE(record_id,url));
CREATE TABLE research_tasks(run_id TEXT NOT NULL,record_id TEXT NOT NULL,kind TEXT NOT NULL,status TEXT NOT NULL,error TEXT,result TEXT,updated_at TEXT NOT NULL);`);
const T = '2026-11-01T00:00:00Z', ASOF = Date.parse('2026-11-13T19:00:00Z');
const record = (id: string, fields: Record<string, unknown>) => db.query('INSERT INTO records VALUES(?,?,?,?,?,?)').run(id, 'opportunity', id, JSON.stringify({ description: id, status: 'Open', ...fields }), 'h', T);
const doc = (record: string, url: string, status: string, error: string | null = null) => db.query('INSERT INTO documents(id,record_id,url,name,status,error,updated_at,byte_length) VALUES(?,?,?,?,?,?,?,?)').run(`${record}:${url}`, record, url, url, status, error, T, status === 'downloaded' ? 10 : 0);
// 230 open BC Bid notices with two links each (more than one 200-row page of links and of documents).
for (let i = 0; i < 230; i++) {
  const id = `opportunity:${1000 + i}`;
  record(id, { closingDate: `2026-12-${String(1 + (i % 28)).padStart(2, '0')}`, attachments: [{ url: `${id}/a`, name: 'Spec.pdf' }, { url: `${id}/b`, name: 'Form.docx' }] });
  if (i < 150) { doc(id, `${id}/a`, 'downloaded'); doc(id, `${id}/b`, 'downloaded'); }
  else if (i < 160) { doc(id, `${id}/a`, 'downloaded'); doc(id, `${id}/b`, 'failed', 'getaddrinfo EAI_AGAIN'); }
  else if (i < 165) doc(id, `${id}/a`, 'failed', 'Manual browser verification required. Open the attachment in the saved browser, complete the browser check manually, then retry.');
  else if (i === 229) doc(id, `${id}/b`, 'downloaded');
}
record('opportunity:2000', { closingDate: '2026-12-02' });                                       // open, no links: needs details
record('opportunity:2003', { closingDate: '2026-12-02', attachments: [], detailCaptureVersion: 3 });   // captured, no public files
record('opportunity:2004', { closingDate: '2026-12-02', attachments: [], detailCaptureVersion: 3, detailNeedsRefresh: true }); // empty list, refresh due: needs details
record('opportunity:2005', { closingDate: '2026-12-02', attachments: [], detailCaptureVersion: 2 });   // empty list from an older capture: needs details
record('opportunity:2001', { closingDate: '2026-10-01', attachments: [{ url: 'x' }] });          // closed: out of scope
record('opportunity:2002', { sourceId: 'canadabuys', closingDate: '2026-12-02', attachments: [{ url: 'y' }] }); // another source
db.query("INSERT INTO research_tasks VALUES('r','opportunity:1160','attachment','waiting_for_user',NULL,NULL,?)").run(T);

test('document gap of open BC Bid notices, per file, read in pages through the host validator', async () => {
  const gap = await readDocumentGap(ASOF);
  expect(gap).toMatchObject({ open: 234, withLinks: 230, noLinks: 3, noFiles: 1, waitingNotices: 1, links: 460, saved: 311, failed: 10, waiting: 5, never: 134, fullySaved: 150, missingNotices: 80 });
  expect(gap.reasons.map(reason => reason.count)).toEqual([10, 5]);
  expect(gap.reasons[0].text).toMatch(/could not be reached/);
  expect(String(gap.notices[0].closing) <= String(gap.notices.at(-1)!.closing)).toBe(true);
  // Paging: more than one statement per list, none using a subquery in FROM/JOIN.
  expect(statements.filter(sql => sql.includes('OFFSET')).length).toBeGreaterThan(2);
  expect(statements.filter(sql => sql.includes('FROM documents')).every(sql => !sql.includes('FROM records'))).toBe(true);
  expect(statements.every(sql => !/\b(?:FROM|JOIN)\s*\(/i.test(sql))).toBe(true);
});
