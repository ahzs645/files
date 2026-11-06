/** The Opportunities table reads the list's shared filters, and award dates that cannot be right never lead a list. */
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it, vi } from 'vitest';
const { host } = vi.hoisted(() => ({ host: vi.fn() }));
vi.mock('../zoer/dashboard/bridge', () => ({ host }));
import { validateCatalogSelect } from '../../zoer/backend/src/catalog-reader';
import { awardDateText, plausibleAwardDate } from '../zoer/dashboard/award-dates';
import { awardSummary } from '../zoer/dashboard/bid-summaries';
import { buildProcurementQuery, listKind } from '../zoer/dashboard/procurement/catalog';
import { queryCatalog } from '../zoer/dashboard/queries';

const rows: [string, string, Record<string, unknown>][] = [
  ['opportunity:a', 'opportunity', { sourceKey: 'a', description: 'Roof repair', status: 'Open', sourceId: 'bc-bid', starred: true }],
  ['opportunity:b', 'opportunity', { sourceKey: 'b', description: 'Roof survey', status: 'Open', sourceId: 'canadabuys' }],
  ['opportunity:c', 'opportunity', { sourceKey: 'c', description: 'Road paving', status: 'Open', sourceId: 'bc-bid', region: 'Prince George' }],
  ['award:typo', 'award', { importKey: 'typo', opportunityDescription: 'Typo', awardDate: '2107-09-28' }],
  ['award:new', 'award', { importKey: 'new', opportunityDescription: 'Newest', awardDate: '2026-10-06' }],
  ['award:old', 'award', { importKey: 'old', opportunityDescription: 'Oldest', awardDate: '2016-01-02' }],
  ['award:blank', 'award', { importKey: 'blank', opportunityDescription: 'Undated', awardDate: '' }],
];
function catalog() {
  const db = new DatabaseSync(':memory:');
  db.exec('CREATE TABLE records(id TEXT PRIMARY KEY, kind TEXT, data TEXT, updated_at TEXT); CREATE TABLE documents(id TEXT, record_id TEXT, status TEXT)');
  for (const [id, kind, data] of rows) db.prepare('INSERT INTO records VALUES (?, ?, ?, ?)').run(id, kind, JSON.stringify(data), '2026-01-01');
  host.mockImplementation(async (method: string, input: { statement: string; parameters: (string | number)[] }) => {
    if (method === 'catalog.read') return {};
    if (method !== 'catalog.query') throw Error(method);
    validateCatalogSelect(input.statement, input.parameters);
    return { rows: db.prepare(`SELECT * FROM (${input.statement}) LIMIT 201`).all(...input.parameters) };
  });
}
const keys = async (args: Record<string, unknown>, key: string) => (await queryCatalog('catalog.rows', { limit: 50, ...args }, {} as never, 1)).items.map((row: Record<string, unknown>) => row[key]);

describe('Opportunities table scope', () => {
  it('applies the list filters on top of its own', async () => {
    catalog();
    const shared = buildProcurementQuery({ kind: 'opportunity', source: 'bc-bid' });
    expect((await keys({ kind: 'opportunity', scope: { sql: shared.where, parameters: shared.countParameters } }, 'sourceKey')).sort()).toEqual(['a', 'c']);
    expect(await keys({ kind: 'opportunity', search: 'roof', scope: { sql: shared.where, parameters: shared.countParameters } }, 'sourceKey')).toEqual(['a']);
    const count = await queryCatalog('catalog.count', { kind: 'opportunity', scope: { sql: shared.where, parameters: shared.countParameters } }, {} as never, 1);
    expect(Number(count.total)).toBe(2);
  });
  it('finds what the list search finds', async () => {
    catalog();
    expect(await keys({ kind: 'opportunity', search: 'prince george' }, 'sourceKey')).toEqual(['c']);
  });
  it('refuses a malformed scope', async () => {
    catalog();
    await expect(queryCatalog('catalog.rows', { kind: 'opportunity', scope: 'kind=1' }, {} as never, 1)).rejects.toThrow('Invalid table scope');
  });
});
describe('list contents', () => {
  it('holds opportunities unless a link asks for more', () => {
    expect(listKind(null, '', false)).toBe('opportunity');
    expect(listKind('all', '', false)).toBe('all');
    expect(listKind('award', '', false)).toBe('award');
    expect(listKind(null, 'Acme Ltd', false)).toBe('all');
    expect(listKind('award', '', true)).toBe('opportunity');
  });
});
describe('implausible award dates', () => {
  const now = Date.parse('2026-11-06T12:00:00Z');
  it('treats only dates more than a year ahead as wrong', () => {
    expect(plausibleAwardDate('2107-09-28', now)).toBe(false);
    expect(plausibleAwardDate('2027-07-01', now)).toBe(true);
    expect(plausibleAwardDate('', now)).toBe(true);
    expect(plausibleAwardDate('Spring 2107', now)).toBe(true);
    expect(awardDateText('2107-09-28', now)).toBe('Date unknown (source says 2107-09-28)');
  });
  it('shows them as unknown in the summary without changing the source value', () => {
    expect(awardSummary({ awardDate: '2107-09-28', importKey: 'x' }).awardDate).toMatch(/^Date unknown/);
  });
  it('sorts them last in both directions', async () => {
    catalog();
    expect(await keys({ kind: 'award' }, 'importKey')).toEqual(['new', 'old', 'blank', 'typo']);
    expect((await keys({ kind: 'award', sort: { id: 'awardDate', desc: true } }, 'importKey')).at(-1)).toBe('typo');
    expect((await keys({ kind: 'award', sort: { id: 'awardDate', desc: false } }, 'importKey')).at(-1)).toBe('typo');
  });
});
