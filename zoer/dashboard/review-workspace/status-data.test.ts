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
CREATE TABLE batches(id TEXT PRIMARY KEY,kind TEXT NOT NULL,input TEXT NOT NULL);
CREATE TABLE research_tasks(source_id TEXT NOT NULL,run_id TEXT NOT NULL,record_id TEXT NOT NULL,kind TEXT NOT NULL,status TEXT NOT NULL,error TEXT,result TEXT,updated_at TEXT NOT NULL);`);
const T = '2026-11-01T00:00:00Z', ASOF = Date.parse('2026-11-13T19:00:00Z');
const record = (id: string, fields: Record<string, unknown>) => db.query('INSERT INTO records VALUES(?,?,?,?,?,?)').run(id, 'opportunity', id, JSON.stringify({ description: id, status: 'Open', detailCaptureVersion: 3, detailFields: [{ label: 'Title', value: id }], ...fields }), 'h', T);
const attachment = (id: string, file: string) => `https://bcbid.gov.bc.ca/bare.aspx/en/fil/download_public/${id.split(':').at(-1)}-${file}`;
const checkError = 'Manual browser verification required. Open the attachment in the saved browser, complete the browser check manually, then retry.';
const task = (run: string, id: string, file: string, status: string, at: string, browser?: string, extractOnly = false, url = attachment(id, file)) => {
  db.query("INSERT INTO batches VALUES(?,'download',?)").run(run, JSON.stringify({ extractOnly }));
  db.query("INSERT INTO research_tasks VALUES(?, ?, ?, 'attachment', ?, NULL, ?, ?)").run(
    `${id}:${url}`, run, id, status, browser ? JSON.stringify({ bcBidDownloadBrowserId: browser }) : null, at,
  );
};
const doc = (record: string, url: string, status: string, error: string | null = null) => db.query('INSERT INTO documents(id,record_id,url,name,status,error,updated_at,byte_length) VALUES(?,?,?,?,?,?,?,?)').run(`${record}:${url}`, record, url, url, status, error, T, status === 'downloaded' ? 10 : 0);
// 230 open BC Bid notices with two links each (more than one 200-row page of links and of documents).
for (let i = 0; i < 230; i++) {
  const id = `opportunity:${1000 + i}`;
  const a = attachment(id, 'a'), b = attachment(id, 'b');
  record(id, { ...(i===0 ? { tabCoverage: { complete: false } } : {}), closingDate: `2026-12-${String(1 + (i % 28)).padStart(2, '0')}`, attachments: [{ url: a, name: 'Spec.pdf' }, { url: b, name: 'Form.docx' }] });
  if (i < 150) { doc(id, a, 'downloaded'); doc(id, b, 'downloaded'); }
  else if (i < 160) { doc(id, a, 'downloaded'); doc(id, b, 'failed', 'getaddrinfo EAI_AGAIN'); }
  else if (i < 165) doc(id, a, 'failed', checkError);
  else if (i === 229) doc(id, b, 'downloaded');
}
record('opportunity:2000', { closingDate: '2026-12-02' });                                       // open, no links: needs details
record('opportunity:2003', { closingDate: '2026-12-02', attachments: [], detailCaptureVersion: 3 });   // captured, no public files
record('opportunity:2004', { closingDate: '2026-12-02', attachments: [], detailCaptureVersion: 3, detailNeedsRefresh: true }); // empty list, refresh due: needs details
record('opportunity:2005', { closingDate: '2026-12-02', attachments: [], detailCaptureVersion: 2 });   // empty list from an older capture: needs details
record('opportunity:2001', { closingDate: '2026-10-01', attachments: [{ url: attachment('opportunity:2001', 'a') }] });          // closed: out of scope
record('opportunity:2002', { sourceId: 'canadabuys', closingDate: '2026-12-02', attachments: [{ url: 'y' }] }); // another source
task('wait', 'opportunity:1160', 'a', 'waiting_for_user', T);

test('document gap of open BC Bid notices, per file, read in pages through the host validator', async () => {
  const gap = await readDocumentGap(ASOF);
  expect(gap).toMatchObject({ open: 234, withLinks: 230, noLinks: 3, detailsWithLinks: 1, noFiles: 1, waitingNotices: 1, links: 460, saved: 311, failed: 14, waiting: 1, never: 134, fullySaved: 150, missingNotices: 80 });
  expect(gap.reasons.map(reason => reason.count)).toEqual([10, 5]);
  expect(gap.reasons[0].text).toMatch(/could not be reached/);
  expect(String(gap.notices[0].closing) <= String(gap.notices.at(-1)!.closing)).toBe(true);
  // Paging: more than one statement per list, none using a subquery in FROM/JOIN.
  expect(statements.filter(sql => sql.includes('OFFSET')).length).toBeGreaterThan(2);
  expect(statements.filter(sql => sql.includes('FROM documents')).every(sql => !sql.includes('FROM records'))).toBe(true);
  expect(statements.every(sql => !/\b(?:FROM|JOIN)\s*\(/i.test(sql))).toBe(true);
});

test('only a BC Bid original on the same browser clears its recorded check', async () => {
  const browser = 'br-download', otherBrowser = 'br-other';
  const waited = '2026-11-02T00:00:00Z';
  task('wait-current', 'opportunity:1161', 'a', 'waiting_for_user', waited, browser);
  doc('opportunity:2002', 'https://canadabuys.canada.ca/file.pdf', 'downloaded');
  task('portal', 'opportunity:2002', 'a', 'succeeded', '2026-11-03T00:00:00Z', undefined, false, 'https://canadabuys.canada.ca/file.pdf');
  task('extraction', 'opportunity:1001', 'a', 'succeeded', '2026-11-03T00:01:00Z', undefined, true);
  task('other-browser', 'opportunity:1002', 'a', 'succeeded', '2026-11-03T00:02:00Z', otherBrowser);
  expect(await readDocumentGap(ASOF, browser)).toMatchObject({ checkPendingSince: waited, waiting: 2, waitingNotices: 2 });

  task('same-browser', 'opportunity:1001', 'b', 'succeeded', '2026-11-04T00:00:00Z', browser);
  expect(await readDocumentGap(ASOF, browser)).toMatchObject({ checkPendingSince: null, waiting: 0, waitingNotices: 0, failed: 15 });

  doc('opportunity:2001', attachment('opportunity:2001', 'a'), 'failed', checkError);
  task('closed-notice', 'opportunity:2001', 'a', 'waiting_for_user', '2026-11-05T00:00:00Z', browser);
  expect(await readDocumentGap(ASOF, browser)).toMatchObject({ checkPendingSince: '2026-11-05T00:00:00Z', waiting: 0, waitingNotices: 0 });
});
