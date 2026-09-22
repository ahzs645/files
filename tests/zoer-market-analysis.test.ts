import { describe, expect, it } from 'vitest';
import { addExclusion, removeExclusion, parseExclusions, buildMarketView, normalizeAwards, filterAwards, defaultFilters, overview, distribution, comparison, trends, matrix, sliceAwards, type Award, type Overview, type Metadata } from '../zoer/dashboard/market/model';
const today = '2026-09-12';
function raw(id: string, value: number | null = 100, extra: Record<string, unknown> = {}) {
  return { importKey: id, opportunityDescription: `Contract ${id}`, successfulSupplier: 'Supplier A', issuingOrganization: 'Buyer A', opportunityType: 'RFP', awardDate: '2025-06-01', contractValue: value, currency: 'CAD', ...extra };
}
const records = [raw('a', 100), raw('b', 300, { successfulSupplier: 'Supplier B' }), raw('zero', 0), raw('negative', -50), raw('missing', null),
  raw('usd', 1000000, { currency: 'USD' }), raw('unknown', 1000000, { currency: null }), raw('future', 1000000, { awardDate: '2027-01-01' }),
  raw('placeholder', 1000000, { successfulSupplier: 'Migrated Supplier' }), raw('invalid-date', 50, { awardDate: '2025-02-30' })];
describe('market scope and defensible denominators', () => {
  it('separates currencies, future dates, placeholder suppliers and unusable dates', () => {
    const result = buildMarketView(records, 'overview', {}, {}, today) as Overview;
    expect(result.count).toBe(6); expect(result.value).toBe(400); expect(result.valuedCount).toBe(5);
    expect(result.median).toBe(50); expect(result.q1).toBe(0); expect(result.q3).toBe(100);
    expect(result.positiveTotal).toBe(450);
    expect(result.suppliers.find(r => r.name === 'Supplier B')?.share).toBeCloseTo(300 / 450);
    expect(buildMarketView(records, 'records', { currency: 'UNSPECIFIED' }, {}, today)).toHaveLength(1);
    const meta = buildMarketView(records, 'meta', {}, {}, today) as Metadata;
    expect(meta.count).toBe(10); expect(meta.quality.find(q => q.flag === 'undated')?.count).toBe(1);
    expect(meta.quality.find(q => q.flag === 'currency')?.count).toBe(1);
    expect(buildMarketView(records, 'records', { buyer: 'No match' }, { slice: { quality: 'future' } }, today)).toHaveLength(1);
  });
  it('preserves case-sensitive participant identity while normalizing whitespace and validates filters', () => {
    const rows = normalizeAwards([raw('x', 1, { successfulSupplier: ' Supplier\u00a0A  ' }), raw('y', 2, { successfulSupplier: 'supplier a' })]);
    expect(overview(rows).supplierCount).toBe(2);
    expect(() => filterAwards(rows, { from: '2025-03-01', to: '2025-02-01' }, today)).toThrow('Start date');
    expect(() => filterAwards(rows, { from: '2025-02-30' }, today)).toThrow('valid');
    expect(() => filterAwards(rows, { minValue: '-1' }, today)).toThrow('Minimum');
    expect(filterAwards(rows, { minValue: '2', supplier: 'supplier a' }, today)).toHaveLength(1);
  });
  it('keeps all-zero, empty and negative portfolios finite without inventing concentration', () => {
    for (const rows of [[], normalizeAwards([raw('zero', 0), raw('negative', -5)])]) {
      const result = overview(rows);
      expect(result.suppliersFor80).toBeNull(); expect(result.top10Share).toBe(0);
      expect(result.buyers.every(b => b.dependence === null)).toBe(true);
      expect(JSON.stringify(result)).not.toContain('NaN');
    }
  });
});
describe('reconcilable market views', () => {
  it('partitions every numeric award into exactly one size band, including exact boundaries', () => {
    const values = [-1, 0, .01, 9999.99, 10000, 49999.99, 50000, 100000, 250000, 500000, 1000000, 5000000, 10000000, 999999999];
    const rows = normalizeAwards([...values.map((v, i) => raw(String(i), v)), raw('null', null)]);
    const result = distribution(rows);
    expect(result.known).toBe(values.length); expect(result.missing).toBe(1);
    expect(result.bins.reduce((n, b) => n + b.count, 0)).toBe(values.length);
    const ids = result.bins.flatMap(b => sliceAwards(rows, b.slice, today).map(r => r.id));
    expect(new Set(ids).size).toBe(values.length);
    expect(result.bins.find(b => b.label === '10k–50k')?.count).toBe(2);
  });
  it('fills missing months as no recorded awards and reconciles every heatmap cell', () => {
    const rows = normalizeAwards([raw('jan', 10, { awardDate: '2025-01-01' }), raw('mar', 20, { awardDate: '2025-03-15' }), raw('undated', 50, { awardDate: null })]);
    const result = trends(rows, '2025', today);
    expect(result.series).toEqual([{ month: '2025-01', value: 10, count: 1 }, { month: '2025-02', value: 0, count: 0 }, { month: '2025-03', value: 20, count: 1 }]);
    expect(result.undated).toBe(1); expect(result.cells).toHaveLength(12); expect(result.shownCount).toBe(2);
    for (const cell of result.cells) expect(sliceAwards(rows, cell.slice, today)).toHaveLength(cell.count);
  });
  it('bounds matrices to top groups and explicitly accounts for omitted records', () => {
    const rows = normalizeAwards(Array.from({ length: 30 }, (_, i) => raw(String(i), i + 1, { issuingOrganization: `Buyer ${i}`, successfulSupplier: `Supplier ${i}`, opportunityType: `Type ${i}` })));
    for (const dimension of ['supplier', 'type'] as const) {
      const result = matrix(rows, dimension); expect(result.rows).toHaveLength(10); expect(result.columns).toHaveLength(10); expect(result.cells).toHaveLength(100);
      expect(result.shownCount).toBe(10); expect(result.totalCount).toBe(30);
      for (const cell of result.cells) expect(sliceAwards(rows, cell.slice, today)).toHaveLength(cell.count);
    }
  });
});
describe('period comparisons', () => {
  const rows = normalizeAwards([raw('old', 100, { awardDate: '2024-01-01' }), raw('new', 250, { awardDate: '2025-01-01' }), raw('new-only', 20, { awardDate: '2025-02-01', issuingOrganization: 'New in records' }), raw('lost', 50, { awardDate: '2024-05-01', issuingOrganization: 'Absent in B' }), raw('usd', 999999, { currency: 'USD' })]);
  it('replaces shared dates but preserves market filters and distinguishes zero baselines', () => {
    const result = comparison(rows, { ...defaultFilters, from: '2026-01-01' }, {}, today);
    expect(result.aValue).toBe(150); expect(result.bValue).toBe(270);
    expect(result.rows.find(r => r.name === 'Buyer A')).toMatchObject({ a: 100, b: 250, delta: 150, change: 1.5 });
    expect(result.rows.find(r => r.name === 'New in records')?.change).toBeNull();
    expect(result.rows.find(r => r.name === 'Absent in B')?.change).toBe(-1);
    expect(result.warnings.some(w => w.includes('different lengths'))).toBe(true);
    const counts = comparison(rows, {}, { metric: 'count' }, today);
    expect(counts.rows.find(r => r.name === 'Buyer A')).toMatchObject({ a: 1, b: 1, delta: 0 });
  });
  it('rejects reversed, invalid, overlapping, and empty dates and warns about empty/future periods', () => {
    expect(() => comparison(rows, {}, { aFrom: '2025-01-01' }, today)).toThrow('ordered');
    expect(() => comparison(rows, {}, { aTo: '2025-05-01' }, today)).toThrow('overlap');
    expect(() => comparison(rows, {}, { aFrom: '' }, today)).toThrow('valid');
    const result = comparison(rows, {}, { bFrom: '2027-01-01', bTo: '2027-12-31' }, today);
    expect(result.warnings.some(w => w.includes('beyond today'))).toBe(true);
    expect(result.warnings.some(w => w.includes('no saved awards'))).toBe(true);
  });
});

it('keeps concentration within 100% and retains its exact 80% threshold when sampling many suppliers', () => {
  const result = overview(normalizeAwards(Array.from({ length: 999 }, (_, i) => raw(String(i), .1 + i / 100, { successfulSupplier: `Supplier ${i}` }))));
  expect(result.pareto.length).toBeLessThan(110);
  expect(result.pareto.every(p => p.share >= 0 && p.share <= 100)).toBe(true);
  expect(result.pareto.some(p => p.rank === result.suppliersFor80)).toBe(true);
  expect(result.pareto.at(-1)?.share).toBeCloseTo(100);
});

describe('reversible analysis exclusions', () => {
  it('recalculates all views before ranking, preserves source rows and uses exact names', () => {
    const source = [raw('a', 100, {issuingOrganization:'Buyer A',successfulSupplier:'Supplier A'}), raw('b', 300,{issuingOrganization:'Buyer B',successfulSupplier:'Supplier B'}), raw('c',50,{issuingOrganization:'Buyer C',successfulSupplier:'supplier a'})];
    const before = JSON.stringify(source);
    const filters = {...defaultFilters, exclusions: JSON.stringify([{kind:'supplier',name:'Supplier A'}])};
    const totals = buildMarketView(source,'overview',filters,{},today) as Overview;
    expect(totals.count).toBe(2); expect(totals.value).toBe(350);
    expect(totals.suppliers.map(r=>r.name)).toEqual(['Supplier B','supplier a']);
    const grid = buildMarketView(source,'relationships',filters,{},today) as ReturnType<typeof matrix>;
    expect(grid.columns).not.toContain('Supplier A'); expect(grid.totalCount).toBe(2);
    expect(grid.cells.reduce((n,c)=>n+c.count,0)).toBe(2);
    expect(buildMarketView(source,'records',filters,{slice:{supplier:'Supplier A'}},today)).toHaveLength(0);
    const restored = buildMarketView(source,'overview',{...filters,exclusions:''},{},today) as Overview;
    expect(restored.count).toBe(3); expect(restored.value).toBe(450); expect(JSON.stringify(source)).toBe(before);
  });
  it('pins buyer exclusions to their selected grouping when the view changes', () => {
    const source = [raw('a',100,{issuingOrganization:'BC Hydro'}),raw('b',50,{issuingOrganization:'Buyer B'})];
    const identity=normalizeAwards(source)[0].buyerIdentity;
    const f={...defaultFilters,exclusions:JSON.stringify([{kind:'buyer',name:identity.dimensions.organization,level:'organization'}]),buyerLevel:'source' as const};
    expect(filterAwards(normalizeAwards(source),f,today).map(r=>r.id)).toEqual(['b']);
  });
  it('combines exclusions, handles empty results and rejects malformed bookmark data', () => {
    const rows=normalizeAwards([raw('a',100),raw('b',200,{successfulSupplier:'Supplier B'}),raw('c',300,{opportunityType:'RFT'})]);
    const f={...defaultFilters,exclusions:JSON.stringify([{kind:'supplier',name:'Supplier B'},{kind:'type',name:'RFP'}])};
    expect(filterAwards(rows,f,today).map(r=>r.id)).toEqual(['c']);
    expect(filterAwards(rows,{...f,exclusions:JSON.stringify([{kind:'buyer',name:'Buyer A',level:'source'}])},today)).toHaveLength(0);
    for(const exclusions of ['bad','{}',JSON.stringify([{kind:'buyer',name:'Buyer A'}]),JSON.stringify([{kind:'other',name:'x'}])]) expect(()=>filterAwards(rows,{exclusions},today)).toThrow('exclusion');
    expect(buildMarketView(records,'quality',{exclusions:JSON.stringify([{kind:'type',name:'RFP'}])},{},today)).toMatchObject({count:records.length});
  });
});

it('deduplicates, restores and round-trips exclusions without clearing other filters', () => {
  const initial={...defaultFilters,from:'2025-01-01',supplier:'Supplier A'};
  const once=addExclusion(initial,'supplier','Supplier A');
  expect(once.supplier).toBe('');expect(once.from).toBe(initial.from);
  expect(addExclusion(once,'supplier','Supplier A')).toEqual(once);
  const twice=addExclusion(once,'buyer','BC Hydro');
  expect(parseExclusions(twice.exclusions)).toHaveLength(2);
  expect(removeExclusion(twice,1)).toEqual(once);
  expect(removeExclusion(once,0).exclusions).toBe('');
  const url=new URLSearchParams({exclusions:twice.exclusions});
  expect(parseExclusions(new URLSearchParams(url.toString()).get('exclusions')!)).toEqual(parseExclusions(twice.exclusions));
});
