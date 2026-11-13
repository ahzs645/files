import { validateCatalogSelect, runCatalogSelect } from '../../../zoer/backend/src/catalog-reader';
import { test, expect, afterAll } from 'bun:test';
import { Database } from 'bun:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Effective lifecycle and canonical-notice SQL through the host's validator and its real read-only runner: the SQL
// must give exactly the JS judgement (lifecycle.ts, canonical.ts) for every status/closing form seen in the catalog.
(globalThis as any).window ??= { addEventListener() {}, parent: { postMessage() {} } };
const { effectiveLifecycle, effectiveStatusSql, listedOpenSql } = await import('./procurement/lifecycle');
const { canonicalNoticeSql } = await import('./procurement/canonical');
const { buildProcurementQuery } = await import('./procurement/catalog');
const { INVENTORY_SQL } = await import('./procurement/display');
const { buildMarketSummaryQuery } = await import('./procurement/market-query');
const { openSql } = await import('./review-workspace/queue');

const dir = mkdtempSync(join(tmpdir(), 'quality-')), path = join(dir, 'catalog.sqlite');
afterAll(() => rmSync(dir, { recursive: true, force: true }));
const db = new Database(path);
db.exec(`CREATE TABLE records(id TEXT PRIMARY KEY,kind TEXT NOT NULL,title TEXT NOT NULL,data TEXT NOT NULL,hash TEXT NOT NULL,updated_at TEXT NOT NULL);
CREATE TABLE documents(id TEXT PRIMARY KEY,record_id TEXT NOT NULL,url TEXT NOT NULL,name TEXT NOT NULL,media_type TEXT,sha256 TEXT,content BLOB,text TEXT,status TEXT NOT NULL,error TEXT,updated_at TEXT NOT NULL,byte_length INTEGER NOT NULL DEFAULT 0,UNIQUE(record_id,url));
CREATE TABLE workspace_state(key TEXT PRIMARY KEY,data TEXT NOT NULL,updated_at TEXT NOT NULL);
CREATE TABLE tags(record_id TEXT NOT NULL,tag TEXT NOT NULL);`);
const put = (id: string, data: Record<string, unknown>, kind = id.split(':')[0]) => db.query('INSERT INTO records VALUES(?,?,?,?,?,?)').run(id, kind, id, JSON.stringify({ description: id, ...data }), 'h', '2026-11-01T00:00:00Z');
const run = async (statement: string, parameters: (string | number)[] = []) => { validateCatalogSelect(statement, parameters); return (await runCatalogSelect(path, statement, parameters, true)).rows as any[]; };

// 11:00 in Vancouver on 2026-11-13.
const ASOF = Date.parse('2026-11-13T19:00:00Z');
const LIFECYCLE: [string, Record<string, unknown>, string][] = [
  ['future-date', { status: 'Open', closingDate: '2026-11-20' }, 'open'],
  ['today-date', { status: 'Open', closingDate: '2026-11-13' }, 'open'],                         // time unverified: still open
  ['passed-date', { status: 'Open', closingDate: '2026-11-12' }, 'closed'],                       // BC Bid keeps saying Open
  ['passed-instant', { status: 'Open', closingAt: '2026-11-13T10:00:00-08:00' }, 'closed'],
  ['later-instant', { status: 'Open', closingAt: '2026-11-13T14:00:00-08:00' }, 'open'],
  ['utc-passed', { sourceId: 'canadabuys', status: 'Open', closingAt: '2026-11-13T18:59:00.000Z' }, 'closed'],
  ['zoneless-today', { status: 'Open', closingDate: '2026-11-13T09:00:00' }, 'open'],             // a day, not an instant
  ['placeholder-2074', { sourceId: 'canadabuys', status: 'Open', closingAt: '2074-12-31T14:00:00' }, 'open'],
  ['placeholder-2100', { status: 'Open', closingDate: '2100-12-31' }, 'open'],
  ['placeholder-shape', { sourceId: 'canadabuys', status: 'Open', closingDate: null, closingDateRaw: '2100-12-31T14:00:00', closingDatePlaceholder: true }, 'open'], // collectors' shape
  ['placeholder-shape-ended', { sourceId: 'canadabuys', status: 'Cancelled', closingDate: null, closingDateRaw: '2100-12-31T14:00:00', closingDatePlaceholder: true }, 'cancelled'],
  ['dated-2035', { status: 'Open', closingDate: '2035-04-24' }, 'open'],
  ['no-closing', { status: 'Open' }, 'unknown'],
  ['blank-closing', { sourceId: 'browser-sites', status: 'Open', closingDate: '' }, 'unknown'],
  ['text-closing', { sourceId: 'bidsandtenders', status: 'Open', closingDate: 'Thu Nov 12, 2026 2:00:00 PM (YST)' }, 'unknown'],
  ['text-filled', { sourceId: 'bidsandtenders', status: 'Open', closingDate: 'Thu Nov 12, 2026 2:00:00 PM (YST)', closingAt: '2026-11-12' }, 'closed'],
  ['closed-early', { status: 'Closed', closingDate: '2026-11-20' }, 'closed'],
  ['awarded', { sourceId: 'municipal-sites', status: 'Awarded', closingDate: '2026-10-01' }, 'awarded'],
  ['cancelled', { sourceId: 'municipal-sites', status: 'Cancelled', closingDate: '2026-12-01' }, 'cancelled'],
  ['reviewing', { sourceId: 'browser-sites', status: 'Reviewing', closingDate: '2026-12-01' }, 'closed'],
  ['evaluating', { sourceId: 'municipal-sites', status: 'Evaluating' }, 'closed'],
  ['processing', { status: 'Processing', closingDate: '2026-12-01' }, 'closed'],
  ['unknown-future', { sourceId: 'browser-sites', status: 'Unknown', closingDate: '2026-12-01' }, 'unknown'],
  ['unknown-passed', { sourceId: 'browser-sites', status: 'Unknown', closingDate: '2026-10-01' }, 'closed'],
  ['na-undated', { sourceId: 'municipal-sites', status: 'N/A' }, 'unknown'],
  ['blank-status', { status: '', closingDate: '2026-12-01' }, 'unknown'],
  ['active', { status: 'Active', closingDate: '2026-12-01' }, 'open'],
  ['published', { status: 'published', closingAt: '2026-12-01T10:00:00Z' }, 'open'],
];
for (const [id, data] of LIFECYCLE) put(`opportunity:${id}`, data);

test('effectiveStatus and its SQL agree on every closing and status form', async () => {
  const status = effectiveStatusSql(ASOF);
  const rows = await run(`SELECT id, ${status.sql} AS status FROM records WHERE kind='opportunity' ORDER BY id`, status.parameters);
  const sql = Object.fromEntries(rows.map(row => [row.id, row.status]));
  for (const [id, data, expected] of LIFECYCLE) {
    expect([id, effectiveLifecycle(data, ASOF).status]).toEqual([id, expected]);
    expect([id, sql[`opportunity:${id}`]]).toEqual([id, expected]);
  }
  const fixture = (name: string) => LIFECYCLE.find(([id]) => id === name)![1];
  expect(effectiveLifecycle(fixture('placeholder-2074'), ASOF)).toMatchObject({ noFixedDate: true, listedOpen: true });
  expect(effectiveLifecycle(fixture('placeholder-shape'), ASOF)).toMatchObject({ noFixedDate: true, listedOpen: true });
  expect(effectiveLifecycle(fixture('dated-2035'), ASOF).noFixedDate).toBe(false);
});

test('open lists: listedOpen in SQL is the JS rule (source-open and not closed; unknown dates stay listed)', async () => {
  const open = listedOpenSql(ASOF);
  const fixtures = new Set(LIFECYCLE.map(([id]) => id));
  const ids = (await run(`SELECT id FROM records WHERE ${open.sql} ORDER BY id`, open.parameters)).map(row => row.id.slice('opportunity:'.length)).filter(id => fixtures.has(id));
  const expected = LIFECYCLE.filter(([, data]) => effectiveLifecycle(data, ASOF).listedOpen).map(([id]) => id).sort();
  expect(ids).toEqual(expected);
  expect(ids).toEqual(['active', 'blank-closing', 'dated-2035', 'future-date', 'later-instant', 'no-closing', 'placeholder-2074', 'placeholder-2100', 'placeholder-shape', 'published', 'text-closing', 'today-date', 'zoneless-today']);
});

// One row per notice/award.
put('opportunity:canadabuys:tender:MX-1:000', { sourceId: 'canadabuys', externalId: 'MX-1', status: 'Open', closingAt: '2026-12-01T14:00:00-05:00', rawSourceData: { 'amendmentNumber-numeroModification': '000' } });
put('opportunity:canadabuys:tender:MX-1:001', { sourceId: 'canadabuys', externalId: 'MX-1', status: 'Open', closingAt: '2026-12-01T14:00:00-05:00', rawSourceData: { 'amendmentNumber-numeroModification': '001' } });
put('opportunity:canadabuys:tender:MX-1:002', { sourceId: 'canadabuys', externalId: 'MX-1', status: 'Open', closingAt: '2026-12-08T14:00:00-05:00', rawSourceData: { 'amendmentNumber-numeroModification': '002' } });
put('opportunity:canadabuys:tender:PW-2:000', { sourceId: 'canadabuys', externalId: 'PW-2', status: 'Open', closingAt: '2026-12-01T14:00:00-05:00', rawSourceData: { 'amendmentNumber-numeroModification': '000' } });
put('opportunity:merged', { status: 'Open', closingDate: '2026-12-01', mergedInto: 'opportunity:future-date', mergeReason: 'canadabuys-amendment' });
put('opportunity:canadabuys:tender:MX-3:', { sourceId: 'canadabuys', externalId: 'MX-3', status: 'Open', closingAt: '2026-12-01T14:00:00-05:00' }); // blank suffix: the original, canonical
put('opportunity:canadabuys:tender:MX-3:001', { sourceId: 'canadabuys', externalId: 'MX-3', status: 'Open', closingAt: '2026-12-01T14:00:00-05:00' });
put('opportunity:municipal-sites:x:copy', { sourceId: 'municipal-sites', status: 'Open', closingDate: '2026-11-20', duplicateOf: 'opportunity:future-date', duplicateReason: 'also-on-bc-bid' });
put('award:a1', { opportunityDescription: 'Paving', successfulSupplier: 'Acme', contractValue: 1000, currency: 'CAD', awardDate: '2025-01-01' });
put('award:a2', { opportunityDescription: 'Paving', successfulSupplier: 'Acme', contractValue: 1000, currency: 'CAD', awardDate: '2025-01-01', duplicateOf: 'award:a1', duplicateReason: 'same-award' });
put('award:a3', { opportunityDescription: 'Snow', successfulSupplier: 'Beta', contractValue: 500, currency: 'CAD', awardDate: '2025-02-01' });
// The canonical record is the lowest amendment (collectors update it); later amendment rows are superseded.
const HIDDEN_CB = ['opportunity:canadabuys:tender:MX-1:001', 'opportunity:canadabuys:tender:MX-1:002'];
const ALL_OPPORTUNITIES = LIFECYCLE.length + 8, ALL_AWARDS = 3;
HIDDEN_CB.push('opportunity:canadabuys:tender:MX-3:001');

test('canonical rule: current CanadaBuys amendment, no merged rows or repeated awards; copies only within their source', async () => {
  const ids = async (sql: string) => (await run(`SELECT id FROM records WHERE ${sql} ORDER BY id`)).map(row => row.id);
  const all = await ids(canonicalNoticeSql());
  expect(all.length).toBe(ALL_OPPORTUNITIES + ALL_AWARDS - HIDDEN_CB.length - 1 - 1);
  expect(all).toContain('opportunity:canadabuys:tender:MX-3:');
  for (const id of [...HIDDEN_CB, 'opportunity:merged', 'award:a2']) expect(all).not.toContain(id);
  expect(all).toContain('opportunity:canadabuys:tender:MX-1:000');
  expect(all).toContain('opportunity:municipal-sites:x:copy');
  const totals = await ids(canonicalNoticeSql('', { crossSource: 'exclude' }));
  expect(totals).not.toContain('opportunity:municipal-sites:x:copy');
  expect(totals.length).toBe(all.length - 1);
  // Aliased (Sources page) and source-scoped forms.
  expect((await run(`SELECT count(*) AS n FROM records r WHERE ${canonicalNoticeSql('r')}`))[0].n).toBe(all.length);
  expect(await ids(`kind='award' AND ${canonicalNoticeSql('', { source: 'bc-bid' })}`)).toEqual(['award:a1', 'award:a3']);
});

test('inventory, list, open counts and market totals count each notice once', async () => {
  const inventory = await run(INVENTORY_SQL);
  const row = (source: string, kind: string) => inventory.find(item => item.sourceId === source && item.kind === kind);
  expect(row('canadabuys', 'opportunity')).toMatchObject({ count: 7, saved: 10, linked: 0 }); // utc-passed, three placeholders, MX-1:000, MX-3:, PW-2
  expect(row('bc-bid', 'award')).toMatchObject({ count: 2, saved: 3 });
  expect(row('municipal-sites', 'opportunity')).toMatchObject({ count: 5, saved: 5, linked: 1 }); // the copy counts in its source; totals subtract it

  const list = buildProcurementQuery({ kind: 'opportunity', asOf: ASOF, limit: 50 });
  const listed = (await run(list.statement, list.parameters)).map(item => item.id);
  expect(listed).not.toContain('opportunity:municipal-sites:x:copy');
  for (const id of [...HIDDEN_CB, 'opportunity:merged']) expect(listed).not.toContain(id);
  expect((await run(list.countStatement, list.countParameters))[0].total).toBe(ALL_OPPORTUNITIES - HIDDEN_CB.length - 2);
  const own = buildProcurementQuery({ kind: 'opportunity', source: 'municipal-sites', asOf: ASOF, limit: 50 });
  expect((await run(own.statement, own.parameters)).map(item => item.id)).toContain('opportunity:municipal-sites:x:copy');
  const everything = buildProcurementQuery({ kind: 'opportunity', duplicates: 'include', asOf: ASOF, limit: 50 });
  expect((await run(everything.countStatement, everything.countParameters))[0].total).toBe(ALL_OPPORTUNITIES);

  // Effective lifecycle filter (Status: Closed incl. deadline passed).
  const closed = buildProcurementQuery({ lifecycle: 'closed', asOf: ASOF, limit: 50 });
  const closedIds = (await run(closed.statement, closed.parameters)).map(item => item.id.slice('opportunity:'.length)).sort();
  expect(closedIds).toEqual(LIFECYCLE.filter(([, , status]) => status === 'closed').map(([id]) => id).sort());

  // Open work (Home, Today, Status): listedOpen and canonical, the copy and old amendments excluded.
  const open = openSql(ASOF);
  const openIds = (await run(`SELECT id FROM records WHERE ${open.sql}`, open.parameters)).map(item => item.id);
  expect(openIds).toContain('opportunity:canadabuys:tender:MX-1:000');
  expect(openIds.filter(id => HIDDEN_CB.includes(id) || id.includes('copy') || id === 'opportunity:merged')).toEqual([]);
  expect(openIds.length).toBe(13 + 3); // the thirteen listed-open fixtures, MX-1 and MX-3 (canonical) and PW-2

  const market = buildMarketSummaryQuery({ kind: 'award' });
  expect((await run(market.statement, market.parameters))[0]).toMatchObject({ awardCount: 2, valuedCount: 2 });
});
