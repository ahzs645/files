import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it, vi } from 'vitest';
import type { Pursuit } from '../zoer/dashboard/procurement/state-contract';

/**
 * Home "Today" statements run through the same rules as Zoer's catalog reader (zoer/backend/src/catalog-reader.ts,
 * copied here because that repo is not part of this checkout) and the reader's `SELECT * FROM (…) LIMIT 201` wrap.
 */
function validateCatalogSelect(statement: string, parameters: unknown[]) {
  if (parameters.length > 200 || parameters.some(value => typeof value !== 'string' && (typeof value !== 'number' || !Number.isFinite(value))) || JSON.stringify(parameters).length > 100000) throw Error('Use at most 200 bounded string or number query parameters.');
  if (statement.length > 10000 || !/^\s*select\b/i.test(statement) || /;|\b(main|temp|pragma|attach|detach|load_extension|sqlite_|insert|update|delete|drop|alter)\b/i.test(statement)) throw Error('Use one read-only SELECT statement.');
  const functions = [...statement.matchAll(/([a-z_][a-z0-9_]*)\s*\(/gi)].map(m => m[1]!.toLowerCase());
  if (functions.some(f => !['select', 'in', 'exists', 'count', 'sum', 'avg', 'min', 'max', 'length', 'lower', 'upper', 'json_extract', 'coalesce', 'julianday', 'cast'].includes(f))) throw Error(`Function not allowed in: ${statement.slice(0, 200)}`);
  if (/\bcontent\b/i.test(statement)) throw Error('Binary content is not available in SQL results.');
}

const db = new DatabaseSync(':memory:');
db.exec(`CREATE TABLE records(id TEXT PRIMARY KEY,kind TEXT NOT NULL,title TEXT NOT NULL,data TEXT NOT NULL,hash TEXT NOT NULL,updated_at TEXT NOT NULL);
CREATE TABLE record_history(run_id TEXT NOT NULL,record_id TEXT NOT NULL,data TEXT NOT NULL,PRIMARY KEY(run_id,record_id));`);
const statements: { statement: string; parameters: unknown[] }[] = [];
vi.mock('../zoer/dashboard/procurement/display', () => ({
  sourceName: (id: string) => id,
  sql: async (statement: string, parameters: (string | number)[] = []) => {
    validateCatalogSelect(statement, parameters); statements.push({ statement, parameters });
    return db.prepare(`SELECT * FROM (${statement}) LIMIT 201`).all(...parameters);
  },
}));
const today = await import('../zoer/dashboard/review-workspace/today-data');

const T = '2026-09-20T00:00:00Z';
const record = (id: string, fields: Record<string, unknown>) => db.prepare('INSERT INTO records VALUES(?,?,?,?,?,?)').run(id, 'opportunity', id, JSON.stringify({ description: `Notice ${id}`, issuedBy: 'Buyer', status: 'Open', ...fields }), 'h', T);
const history = (run: string, key: string) => db.prepare('INSERT INTO record_history VALUES(?,?,?)').run(run, key, '{}');
// Closing soon (asOf = noon in Vancouver on 2026-09-27; window is today through 2026-09-30).
record('c1', { closingDate: '2026-09-29' });
record('c2', { sourceId: 'canadabuys', closingAt: '2026-09-28T14:00:00-05:00', starred: true });
record('c3', { closingDate: '2026-09-30' });                                 // pursued
record('c4', { closingDate: '2026-10-01' });                                 // day four: outside
record('c5', { closingAt: '2026-09-27T10:00:00-07:00' });                    // passed this morning
record('c6', { status: 'Closed', closingDate: '2026-09-28' });               // closed status
record('c7', { closingDate: '2026-09-27' });                                 // today, time unverified: still listed
record('c8', { sourceId: 'bidsandtenders', closingDate: 'Wed Sep 30, 2026 3:00 PM (PDT)', closingAt: '2026-09-30T15:00:00-07:00' });
// New since last visit: first saved by r-new1/r-new2 only.
record('n1', { sourceKey: 'k1', closingDate: '2026-11-01' }); history('r-new1', 'k1');
record('n2', { sourceKey: 'k2', closingDate: '2026-11-01' }); history('r-old', 'k2'); history('r-new1', 'k2'); // seen before: not new
record('n3', { sourceKey: 'k3', sourceId: 'canadabuys', status: 'Closed' }); history('r-new2', 'k3');           // new but closed
record('n4', { sourceKey: 'k4' });                                                                            // never in history
record('n5', { sourceKey: 'bidsandtenders:nanaimo:4318', sourceId: 'bidsandtenders' }); history('r-new1', 'bidsandtenders:nanaimo:4318'); history('r-new2', 'bidsandtenders:nanaimo:4318');
const asOf = Date.parse('2026-09-27T19:00:00Z');

describe('Today: closing within three days', () => {
  it('lists open notices closing today through day three, pursued then shortlisted then soonest', async () => {
    const result = await today.readClosingSoon('', asOf, ['opportunity:x', 'c3']);
    expect(result.total).toBe(5);
    expect(result.rows.map(row => row.id)).toEqual(['c3', 'c2', 'c7', 'c1', 'c8']);
    expect(result.rows.map(row => [row.pursued, row.shortlisted])).toEqual([[true, false], [false, true], [false, false], [false, false], [false, false]]);
    expect((await today.readClosingSoon('canadabuys', asOf, [])).rows.map(row => row.id)).toEqual(['c2']);
    expect((await today.readClosingSoon('', asOf, [], 0)).rows.map(row => row.id)).toEqual(['c7']);
  });
  it('stays within the reader limits with the maximum number of pursuits', async () => {
    const ids = Array.from({ length: 200 }, (_, i) => `opportunity:${i}`);
    await today.readClosingSoon('bc-bid', asOf, ids);
    const last = statements.at(-2)!;
    expect(last.parameters.length).toBeLessThanOrEqual(200);
  });
});

describe('Today: new since the last visit', () => {
  it('counts notices first saved by runs in the window, by source; lists the open ones', async () => {
    const result = await today.readNewSince('', ['r-new1', 'r-new2'], asOf);
    expect(result.bySource).toEqual([{ sourceId: 'bc-bid', count: 1 }, { sourceId: 'bidsandtenders', count: 1 }, { sourceId: 'canadabuys', count: 1 }]);
    expect(result.total).toBe(3);
    expect(result.rows.map(row => row.id)).toEqual(['n1', 'n5']);
    expect(result.openTotal).toBe(2);
    expect(await today.readNewSince('canadabuys', ['r-new1', 'r-new2'], asOf)).toMatchObject({ total: 1, rows: [], openTotal: 0 });
    expect((await today.readNewSince('', ['r-new2'], asOf)).bySource).toEqual([{ sourceId: 'canadabuys', count: 1 }]);
    expect(await today.readNewSince('', [], asOf)).toEqual({ total: 0, bySource: [], rows: [], openTotal: 0 });
  });
  it('stays within the reader limits with the maximum number of runs', async () => {
    const ids = Array.from({ length: 150 }, (_, i) => `run-${i}`);
    await today.readNewSince('bidsandtenders', ids, asOf);
    expect(statements.slice(-3).every(item => item.parameters.length <= 200 && item.statement.length <= 10_000)).toBe(true);
  });
  it('picks collection runs that could have saved notices after the last visit', () => {
    const since = Date.parse('2026-09-27T00:00:00Z');
    const runs = [
      { id: 'a', actionId: 'procurement.collect', status: 'succeeded', createdAt: '2026-09-27T06:00:00Z', completedAt: '2026-09-27T06:05:00Z' },
      { id: 'b', actionId: 'scrape.full', status: 'succeeded', createdAt: '2026-09-26T22:00:00Z', completedAt: '2026-09-27T01:00:00Z' }, // finished after
      { id: 'c', actionId: 'scrape.full', status: 'succeeded', createdAt: '2026-09-26T10:00:00Z', completedAt: '2026-09-26T11:00:00Z' }, // before
      { id: 'd', actionId: 'procurement.state', status: 'succeeded', createdAt: '2026-09-27T07:00:00Z', completedAt: '2026-09-27T07:00:01Z' }, // saves no notices
      { id: 'e', actionId: 'procurement.collect', status: 'running', createdAt: '2026-09-26T23:00:00Z', completedAt: null },
    ];
    expect(today.runsSince(runs, since)).toEqual({ ids: ['a', 'e', 'b'], from: since, narrowed: false });
    // The host listed only recent runs and all of them are after the visit: the window starts at the oldest listed.
    const recent = runs.filter(run => run.id === 'a' || run.id === 'd');
    expect(today.runsSince(recent, since, true)).toEqual({ ids: ['a'], from: Date.parse('2026-09-27T06:00:00Z'), narrowed: true });
    const many = Array.from({ length: 120 }, (_, i) => ({ id: `r${i}`, actionId: 'procurement.collect', status: 'succeeded', createdAt: new Date(since + (i + 1) * 60_000).toISOString(), completedAt: new Date(since + (i + 1) * 60_000 + 1000).toISOString() }));
    const capped = today.runsSince(many, since);
    expect(capped.ids).toHaveLength(today.MAX_RUN_IDS);
    expect(capped.narrowed).toBe(true);
    expect(capped.from).toBe(since + (120 - today.MAX_RUN_IDS + 1) * 60_000);
  });
  it('first visit falls back to the last 24 hours; a stored time is reused', () => {
    expect(today.visitWindow(null, asOf)).toEqual({ since: asOf - 86_400_000, first: true });
    expect(today.visitWindow('garbage', asOf).first).toBe(true);
    expect(today.visitWindow(String(asOf + 1000), asOf).first).toBe(true); // clock moved back
    expect(today.visitWindow(String(asOf - 5000), asOf)).toEqual({ since: asOf - 5000, first: false });
  });
});

describe('Today: pursuits gone quiet', () => {
  const pursuit = (recordId: string, stage: Pursuit['stage'], updatedAt: string, sourceId = 'bc-bid'): Pursuit => ({ recordId, stage, updatedAt, sourceId, title: recordId, notes: '', version: 1, lastRunId: 'r' });
  it('lists active pursuits with no update in 14 days, longest quiet first', () => {
    const list = [pursuit('p1', 'Watching', '2026-09-01T00:00:00Z'), pursuit('p2', 'Preparing', '2026-09-20T00:00:00Z'), pursuit('p3', 'Submitted', '2026-08-01T00:00:00Z'),
      pursuit('p4', 'Reviewing', '2026-09-10T00:00:00Z', 'canadabuys'), pursuit('p5', 'Closed', '2026-01-01T00:00:00Z'), pursuit('p6', 'Reviewing', 'not a date')];
    expect(today.quietPursuits(list, asOf).map(item => [item.recordId, item.idleDays])).toEqual([['p6', null], ['p1', 26], ['p4', 17]]);
    expect(today.quietPursuits(list, asOf, 'canadabuys').map(item => item.recordId)).toEqual(['p4']);
  });
});
