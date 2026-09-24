import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { buildMarketGroupsQuery, buildMarketSummaryQuery, classificationLabel, formatMarketValue, marketDrilldown, type ProcurementMarketQuery, type ProcurementMarketRow } from '../zoer/dashboard/procurement/market-query';

function setup(rows: { kind?: string; data: Record<string, unknown> }[]) {
  const db = new DatabaseSync(':memory:');
  db.exec('CREATE TABLE records(id TEXT PRIMARY KEY, kind TEXT, data TEXT)');
  rows.forEach((row, index) => db.prepare('INSERT INTO records VALUES(?,?,?)').run(String(index), row.kind ?? 'award', JSON.stringify(row.data)));
  return { db, read: (query: ProcurementMarketQuery) => db.prepare(query.statement).all(...query.parameters) };
}

describe('bounded procurement market SQL', () => {
  it('keeps unknown amounts distinct from disclosed zero and excludes numeric strings and booleans', () => {
    const { db, read } = setup([0, 100, -10, null, '', '0', '100', true, false].map(contractValue => ({ data: { contractValue, currency: 'CAD' } })));
    try {
      expect(read(buildMarketSummaryQuery())[0]).toMatchObject({ recordCount: 9, awardCount: 9, valuedCount: 3, missingValueCount: 6, comparableValueCount: 3, zeroValueCount: 1, negativeValueCount: 1 });
      expect(read(buildMarketGroupsQuery({}, 'currencies'))[0]).toMatchObject({ currency: 'CAD', recordCount: 9, valuedCount: 3, totalValue: 90 });
    } finally { db.close(); }
  });

  it('never mixes currencies or totals amounts with unspecified currency', () => {
    const { db, read } = setup([
      { data: { contractValue: 100, currency: 'CAD' } },
      { data: { contractValue: 20, currency: 'cad' } },
      { data: { contractValue: 40, currency: 'USD' } },
      { data: { contractValue: 900 } },
      { data: { contractValue: 800, currency: 'dollars' } },
      { data: { currency: 'EUR' } },
    ]);
    try {
      const rows = read(buildMarketGroupsQuery({}, 'currencies'));
      expect(rows.find(row => row.currency === 'CAD')).toMatchObject({ totalValue: 120, valuedCount: 2 });
      expect(rows.find(row => row.currency === 'USD')).toMatchObject({ totalValue: 40 });
      expect(rows.find(row => row.currency === '')).toMatchObject({ totalValue: null, valuedCount: 2 });
      expect(rows.find(row => row.currency === 'EUR')).toMatchObject({ totalValue: null, valuedCount: 0 });
      expect(read(buildMarketSummaryQuery())[0]).toMatchObject({ valuedCount: 5, comparableValueCount: 3 });
      expect(formatMarketValue(null, 'CAD')).toBe('Not disclosed');
      expect(formatMarketValue(900, '')).toBe('Not comparable');
      expect(formatMarketValue(0, 'CAD')).toContain('0.00');
    } finally { db.close(); }
  });

  it('keeps equal buyer and supplier names from different sources separate during drilling', () => {
    const { db, read } = setup([
      { data: { issuingOrganization: 'Shared name', successfulSupplier: 'Same supplier', contractValue: 10, currency: 'CAD' } },
      { data: { sourceId: 'canadabuys', issuingOrganization: 'Shared name', successfulSupplier: 'Same supplier', contractValue: 50, currency: 'CAD' } },
      { data: { sourceId: 'canadabuys', issuingOrganization: 'Other buyer', successfulSupplier: 'Other supplier', contractValue: 70, currency: 'CAD' } },
    ]);
    try {
      const buyers = read(buildMarketGroupsQuery({}, 'buyers')) as ProcurementMarketRow[];
      expect(buyers.filter(row => row.label === 'Shared name')).toHaveLength(2);
      const canada = buyers.find(row => row.label === 'Shared name' && row.sourceId === 'canadabuys')!;
      const scope = marketDrilldown({ kind: 'award' }, 'buyers', canada);
      expect(scope).toEqual({ source: 'canadabuys', kind: 'award', buyer: 'Shared name' });
      expect(read(buildMarketSummaryQuery(scope))[0]).toMatchObject({ recordCount: 1 });
      expect(read(buildMarketGroupsQuery(scope, 'suppliers'))[0]).toMatchObject({ sourceId: 'canadabuys', label: 'Same supplier', totalValue: 50 });
      expect(() => buildMarketSummaryQuery({ buyer: 'Shared name' })).toThrow('Choose a source');
      expect(read(buildMarketSummaryQuery({ source: "' OR 1=1 --" }))[0].recordCount).toBe(0);
    } finally { db.close(); }
  });

  it('counts opportunities without inventing award value or collapsing notice kinds', () => {
    const { db, read } = setup([
      { kind: 'opportunity', data: { issuedBy: 'Buyer', contractValue: 100, currency: 'CAD' } },
      { kind: 'award', data: { issuingOrganization: 'Buyer', contractValue: 200, currency: 'CAD' } },
      { kind: 'scrape-state', data: { contractValue: 9999, currency: 'CAD' } },
    ]);
    try {
      expect(read(buildMarketSummaryQuery())[0]).toMatchObject({ recordCount: 2, opportunityCount: 1, awardCount: 1, valuedCount: 1 });
      expect(read(buildMarketGroupsQuery({ kind: 'opportunity' }, 'buyers'))[0]).toMatchObject({ recordCount: 1, awardCount: 0, valuedCount: 0, totalValue: null });
      expect(read(buildMarketGroupsQuery({ kind: 'award' }, 'buyers'))[0]).toMatchObject({ totalValue: 200 });
    } finally { db.close(); }
  });

  it('preserves whole classification sets and exact source scope without a guessed crosswalk', () => {
    const codes = [{ scheme: 'UNSPSC', code: '123' }, { scheme: 'GSIN', code: '456' }];
    const { db, read } = setup([
      { data: { sourceId: 'canadabuys', classificationCodes: codes } },
      { data: { classificationCodes: codes } },
      { data: { sourceId: 'canadabuys', classificationCodes: [], sourceCategory: '*GD' } },
      { data: { commodities: ['Construction', 'Supplies'] } },
    ]);
    try {
      const rows = read(buildMarketGroupsQuery({}, 'classifications')) as ProcurementMarketRow[];
      const federal = rows.find(row => row.sourceId === 'canadabuys' && row.label.includes('UNSPSC'))!;
      expect(JSON.parse(federal.label)).toEqual(codes);
      expect(read(buildMarketSummaryQuery(marketDrilldown({}, 'classifications', federal)))[0].recordCount).toBe(1);
      expect(rows.some(row => row.label === '*GD')).toBe(true);
      expect(classificationLabel(federal.label)).toBe('UNSPSC · 123; GSIN · 456');
      expect(classificationLabel('["Construction","Supplies"]')).toBe('Construction; Supplies');
    } finally { db.close(); }
  });

  it('pages aggregate groups, not raw records, with deterministic boundaries', () => {
    const { db, read } = setup(Array.from({ length: 120 }, (_, index) => ({ data: { issuingOrganization: `Buyer ${String(index).padStart(3, '0')}`, currency: 'CAD', contractValue: index } })));
    try {
      const first = read(buildMarketGroupsQuery({}, 'buyers', 0));
      const second = read(buildMarketGroupsQuery({}, 'buyers', 1));
      expect(first).toHaveLength(51); expect(second).toHaveLength(51);
      expect(first[0].label).toBe('Buyer 000'); expect(second[0].label).toBe('Buyer 050');
      expect(read(buildMarketGroupsQuery({}, 'buyers', 2))).toHaveLength(20);
      expect(first[0]).not.toHaveProperty('data');
    } finally { db.close(); }
  });

  it('fits the host read-only SQL validator and parameter limits', () => {
    const scope = { source: 'canadabuys', kind: 'award' as const, buyer: "O'Brien; DROP", supplier: 'Supplier', classification: 'Raw' };
    const queries = [buildMarketSummaryQuery(scope), ...(['currencies', 'sources', 'buyers', 'suppliers', 'classifications'] as const).map(view => buildMarketGroupsQuery(scope, view))];
    const allowed = ['select','in','exists','count','sum','avg','min','max','length','lower','upper','json_extract','coalesce','julianday','cast'];
    for (const query of queries) {
      expect(query.statement).toMatch(/^SELECT /); expect(query.statement.length).toBeLessThan(10000);
      expect(query.statement).not.toMatch(/;|\b(main|temp|pragma|attach|detach|load_extension|sqlite_|insert|update|delete|drop|alter)\b/i);
      for (const match of query.statement.matchAll(/([a-z_][a-z0-9_]*)\s*\(/gi)) expect(allowed).toContain(match[1].toLowerCase());
      expect(query.parameters.length).toBeLessThan(200);
    }
  });
});
