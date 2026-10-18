/** The shared catalog grid (Opportunities grid/list, Documents and AI pickers) orders notices open first, soonest closing first. */
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it, vi } from 'vitest';
const { host } = vi.hoisted(() => ({ host: vi.fn() }));
vi.mock('../zoer/dashboard/bridge', () => ({ host }));
import { validateCatalogSelect } from '../../zoer/backend/src/catalog-reader';
import { queryCatalog } from '../zoer/dashboard/queries';
import { addDays, zoneDate } from '../zoer/dashboard/procurement/deadline';

const DAY = 86_400_000, iso = (offset: number) => new Date(Date.now() + offset).toISOString();
const notices: [string, Record<string, string>][] = [
  ['blank', { closingDate: '' }], ['free-text', { closingDate: 'Closes when filled' }], ['number', { closingDate: '12345' }],
  ['old-2015', { closingDate: '2015-03-01' }], ['closed-yesterday', { closingDate: 'Oct 1, 2026 2:00 pm', closingAt: iso(-DAY) }],
  ['date-in-2-days', { closingDate: addDays(zoneDate(), 2) }], ['instant-in-5-days', { closingDate: 'Five days', closingAt: iso(5 * DAY) }],
  ['in-1-day-no-zone', { closingDate: `${addDays(zoneDate(), 1)}T09:00:00` }], ['today-date-only', { closingDate: zoneDate() }],
];
function catalog() {
  const db = new DatabaseSync(':memory:');
  db.exec('CREATE TABLE records(id TEXT PRIMARY KEY, kind TEXT, data TEXT, updated_at TEXT); CREATE TABLE documents(id TEXT, record_id TEXT, status TEXT)');
  for (const [key, data] of notices) db.prepare('INSERT INTO records VALUES (?, ?, ?, ?)').run('opportunity:' + key, 'opportunity', JSON.stringify({ sourceKey: key, description: key, status: 'Open', ...data }), '');
  host.mockImplementation(async (method: string, input: { statement: string; parameters: (string | number)[] }) => {
    if (method !== 'catalog.query') throw Error(method);
    validateCatalogSelect(input.statement, input.parameters);
    return { rows: db.prepare(`SELECT * FROM (${input.statement}) LIMIT 201`).all(...input.parameters) };
  });
  return async (args: Record<string, unknown> = {}) => (await queryCatalog('catalog.rows', { kind: 'opportunity', limit: 50, ...args }, {} as never, 1)).items.map((row: { sourceKey: string }) => row.sourceKey);
}

describe('grid deadline order', () => {
  it('lists upcoming deadlines soonest first, then unknown ones, then closed newest-closed first', async () => {
    const keys = await catalog()();
    expect(keys).toEqual(['today-date-only', 'in-1-day-no-zone', 'date-in-2-days', 'instant-in-5-days', 'blank', 'free-text', 'number', 'closed-yesterday', 'old-2015']);
  });
  it('sorts the Closing date column by parsed time, unknown deadlines last both ways', async () => {
    const rows = catalog();
    expect(await rows({ sort: { id: 'closingDate', desc: false } })).toEqual(['old-2015', 'closed-yesterday', 'today-date-only', 'in-1-day-no-zone', 'date-in-2-days', 'instant-in-5-days', 'blank', 'free-text', 'number']);
    expect((await rows({ sort: { id: 'closingDate', desc: true } })).slice(0, 2)).toEqual(['instant-in-5-days', 'date-in-2-days']);
    expect((await rows({ sort: { id: 'closingDate', desc: true } })).slice(-3)).toEqual(['blank', 'free-text', 'number']);
  });
  it('keeps the sort helper out of the returned rows', async () => {
    catalog();
    const result = await queryCatalog('catalog.rows', { kind: 'opportunity', limit: 1 }, {} as never, 1);
    expect(result.items[0]).not.toHaveProperty('deadlineTime');
  });
});
