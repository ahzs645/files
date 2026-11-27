import { test, expect } from 'bun:test';
import { Database } from 'bun:sqlite';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { marketSummary, summarizeOverview, unmarkedDuplicates, type OverviewSummary } from './market/sql-summary';
import { buildMarketView, defaultFilters, type MarketFilters, type Overview } from './market/model';
import { buyerRegistry, resolveBuyer } from './market/buyers';
import { collapseAwardDuplicates } from './procurement/award-duplicates';
const readerSource = process.env.ZOER_SOURCE_ROOT
  ? pathToFileURL(join(process.env.ZOER_SOURCE_ROOT, 'backend/src/catalog-reader.ts')).href
  : new URL('../../../zoer/backend/src/catalog-reader.ts', import.meta.url).href;
const { validateCatalogSelect } = await import(readerSource);

const db = new Database(':memory:');
db.exec('CREATE TABLE records(id TEXT PRIMARY KEY,kind TEXT,data TEXT)');
let statements = 0;
/** The host's catalog console: validated, wrapped and capped at 200 rows. */
const run = async (statement: string, parameters: (string | number)[]) => {
  validateCatalogSelect(statement, parameters); statements++;
  return db.query(`SELECT * FROM (${statement}) LIMIT 201`).all(...parameters).slice(0, 200) as any[];
};
const insert = db.query('INSERT INTO records VALUES(?,?,?)');
const pick = <T,>(values: T[], i: number) => values[i % values.length];
const buyers: unknown[] = [...buyerRegistry.slice(0, 280).map(m => m.sourceName), 'Unmapped Buyer A', 'Unmapped  Buyer A', 'District of Nowhere', null, 42];
for (let i = 0; i < 1600; i++) {
  const k = i % 450;
  const supplier = k % 41 === 0 ? `  Supplier ${k} ` : k % 53 === 0 ? `SUPPLIER ${k}` : `Supplier ${k}`;
  const data: Record<string, unknown> = {
    importKey: `k${i}`, opportunityId: `OPP-${i}`, opportunityDescription: `Award ${i}`,
    issuingOrganization: pick(buyers, i * 7), successfulSupplier: i % 97 === 0 ? pick([null, '', '   ', 'Migrated Supplier', ' migrated  supplier', 42, 'Unknown supplier', 'Ac\tme'], i) : supplier,
    currency: pick(['CAD', 'CAD', 'CAD', 'CAD', ' cad', 'USD', null, 7, 'cad'], i), opportunityType: pick(['RFP', ' RFP ', 'ITQ', null, 'Request for Proposal (BPS)', 'ITT'], i),
    awardDate: i % 89 === 0 ? pick(['2099-01-01', '2026-02-29', '2024-02-29', 'TBD', null, 20240101, '2026-11-28', '2026-11-27'], i) : `202${i % 5}-${String(1 + i % 12).padStart(2, '0')}-${String(1 + i % 28).padStart(2, '0')}`,
    contractValue: i % 61 === 0 ? pick(['500', null, -2500, 0, 12.5], i) : k < 30 ? Math.round(4e4 / (k + 1)) + 0.25 : 1000 + (k * 7919 % 50) * 10,
    sourceUrl: 'https://example.test', duplicateOf: i % 151 === 0 ? 'award:other' : undefined, createdAt: 1000, contractNumber: `C-${i}`,
  };
  insert.run(`award:${String(i).padStart(5, '0')}`, 'award', JSON.stringify(data));
}
// Repeats saved after the last normalize run: the same award again (re-typed description, other case), and a migrated
// listing whose supplier is named only in its address. Plus one old pair the rule does not treat as a repeat.
const copy = (from: number, id: string, patch: Record<string, unknown>) => {
  const data = JSON.parse((db.query('SELECT data FROM records WHERE id=?').get(`award:${String(from).padStart(5, '0')}`) as any).data);
  insert.run(id, 'award', JSON.stringify({ ...data, importKey: id, opportunityDescription: 'Re-typed', createdAt: 5000, ...patch }));
};
copy(3, 'award:repeat-a', {}); copy(4, 'award:repeat-b', { opportunityId: 'opp-4', successfulSupplier: 'supplier 4.' });
copy(5, 'award:repeat-c', { successfulSupplier: 'Migrated Supplier', supplierAddress: 'Successful Supplier: Supplier 5 Supplier Address: 1 Main St' });
copy(6, 'award:repeat-d', { contractNumber: 'C-other' });
insert.run('award:zz-other-source', 'award', JSON.stringify({ sourceId: 'canadabuys', successfulSupplier: 'Supplier 1', contractValue: 1e9, currency: 'CAD', awardDate: '2025-01-01', opportunityId: 'X' }));
insert.run('opportunity:1', 'opportunity', JSON.stringify({ description: 'Not an award' }));

const fields = ['duplicateOf','sourceId','importKey','opportunityId','opportunityDescription','opportunityType','issuingOrganization','issuingLocation','contractNumber','contactEmail','contractValue','contractValueText','currency','successfulSupplier','supplierAddress','awardDate','justification','starred','createdAt','updatedAt','sourceFileName','sourceUrl'];
/** The rows `readAnalysis` reads (queries.ts), one per award. */
const rows = collapseAwardDuplicates(db.query(`SELECT id AS recordId, ${fields.map(k => `json_extract(data,'$.${k}') AS "${k}"`).join(', ')} FROM records WHERE kind='award' AND CASE WHEN json_extract(data,'$.sourceId') IS NULL OR json_extract(data,'$.sourceId')='' THEN 'bc-bid' ELSE json_extract(data,'$.sourceId') END='bc-bid' ORDER BY id`).all() as any[], row => row.recordId);
const today = '2026-11-27';
function same(sql: OverviewSummary | null, expected: OverviewSummary) {
  expect(sql).not.toBeNull();
  const close = (a: number, b: number) => expect(Math.abs(a - b)).toBeLessThanOrEqual(1e-6 * Math.max(1, Math.abs(b)));
  for (const key of ['count', 'valuedCount', 'buyerCount', 'supplierCount', 'suppliersFor80'] as const) expect(sql![key]).toBe(expected[key]);
  for (const key of ['value', 'positiveTotal', 'top10Share'] as const) close(sql![key], expected[key]);
  if (expected.median === null) expect(sql!.median).toBeNull(); else close(sql!.median!, expected.median);
  for (const key of ['buyers', 'types'] as const) {
    expect(sql![key].map(r => [r.name, r.count])).toEqual(expected[key].map(r => [r.name, r.count]));
    sql![key].forEach((r, i) => close(r.value, expected[key][i].value));
  }
}
const someBuyer = resolveBuyer(buyerRegistry[20].sourceName);
const cases: [string, Partial<MarketFilters>][] = [
  ['default', {}],
  ['placeholders and future included', { includePlaceholders: true, includeFuture: true }],
  ['other currency', { currency: 'USD' }],
  ['unspecified currency', { currency: 'UNSPECIFIED', includePlaceholders: true }],
  ['type', { type: 'RFP' }],
  ['original buyer names', { buyerLevel: 'source' }],
  ['buyer type grouping', { buyerLevel: 'type' }],
  ['one organization', { buyer: someBuyer.organization }],
  ['buyer search', { buyerSearch: 'district' }],
  ['excluded buyer, supplier and type', { exclusions: JSON.stringify([{ kind: 'buyer', level: 'organization', name: someBuyer.organization }, { kind: 'supplier', name: 'Supplier 1' }, { kind: 'type', name: 'ITQ' }]) }],
  ['supplier', { supplier: 'Supplier 41' }],
  ['dates and minimum', { from: '2022-01-01', to: '2023-06-30', minValue: '1500' }],
];
for (const [name, filters] of cases) test(`aggregate Overview matches the row-by-row computation: ${name}`, async () => {
  const expected = summarizeOverview(buildMarketView(rows, 'overview', { ...defaultFilters, ...filters }, {}, today) as Overview);
  statements = 0;
  const exclude = await unmarkedDuplicates(run);
  expect([...exclude!].sort()).toEqual(['award:repeat-a', 'award:repeat-b', 'award:repeat-c']);
  const summary = await marketSummary(run, { ...defaultFilters, ...filters }, today, { exclude: exclude! });
  same(summary, expected);
  expect(statements).toBeLessThanOrEqual(14);
});
test('repeats not marked yet are what keeps the figures exact', async () => {
  // Without the repeats the figures would count those awards twice.
  const expected = summarizeOverview(buildMarketView(rows, 'overview', defaultFilters, {}, today) as Overview);
  expect((await marketSummary(run, defaultFilters, today))!.count).toBeGreaterThan(expected.count);
});
test('the fixture exercises the hard paths', () => {
  const o = buildMarketView(rows, 'overview', defaultFilters, {}, today) as Overview;
  expect(o.supplierCount).toBeGreaterThan(200); expect(o.suppliersFor80!).toBeGreaterThan(200);
  expect(new Set(rows.map(r => r.issuingOrganization)).size).toBeGreaterThan(200);
  expect(rows.length).toBeLessThan(1601);
});
test('a stopped read rejects before its next query', async () => {
  const controller = new AbortController(); controller.abort();
  await expect(marketSummary(run, defaultFilters, today, { signal: controller.signal })).rejects.toThrow();
});
