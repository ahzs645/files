import { BUYER_MAPPING_VERSION, buyerRegistry, isBuyerLevel, parseBuyerTrail, resolveBuyer, withinBuyerScope, buyerSearchMatches, type BuyerLevel, type ResolvedBuyer } from './buyers';
import { isPlaceholderContractAwardSupplier, normalizeContractAwardEntityLabel } from '../../../packages/shared/src/contractAwardsAnalysis';

export interface MarketFilters {
  buyerLevel: BuyerLevel; buyerTrail: string; buyerSearch: string; from: string; to: string; buyer: string; supplier: string; type: string;
  currency: string; includePlaceholders: boolean; includeFuture: boolean; minValue: string;
}
export const defaultFilters: MarketFilters = { buyerLevel: 'organization', buyerTrail: '', buyerSearch: '', from: '', to: '', buyer: '', supplier: '', type: '', currency: 'CAD', includePlaceholders: false, includeFuture: false, minValue: '' };
export type QualityFlag = 'future' | 'undated' | 'currency' | 'placeholder' | 'value' | 'negative' | 'zero' | 'contract' | 'justification';
export interface Slice { buyer?: string; supplier?: string; type?: string; month?: string; from?: string; to?: string; min?: number; max?: number; exact?: number; quality?: QualityFlag }
export interface MarketOptions { year?: string; dimension?: 'buyer' | 'supplier' | 'type'; metric?: 'value' | 'count'; aFrom?: string; aTo?: string; bFrom?: string; bTo?: string; slice?: Slice }
export interface Award extends Record<string, unknown> {
  buyerIdentity: ResolvedBuyer; buyerOriginal: string; buyerClean: string; buyerOrganization: string; buyerGroup: string; buyerType: string; buyerMappingStatus: string; buyerMappingVersion: string; buyerParticipants: string[]; buyerAggregation: BuyerLevel; id: string; buyer: string; supplier: string; type: string; currencyCode: string;
  date: string | null; value: number | null; placeholder: boolean;
  importKey: string; opportunityDescription: string;
}
const label = (value: unknown, fallback: string) => normalizeContractAwardEntityLabel(typeof value === 'string' ? value : null) ?? fallback;
export function isoDate(value: unknown): string | null {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(value + 'T00:00:00Z');
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value ? value : null;
}
const normalized = new WeakMap<object, Award[]>();
export function normalizeAwards(raw: Record<string, unknown>[]): Award[] {
  const cached = normalized.get(raw); if (cached) return cached;
  const result = raw.map((r, index): Award => { const b = resolveBuyer(r.issuingOrganization); return ({ ...r,
    buyerIdentity: b, buyerOriginal: b.sourceName, buyerClean: b.clean, buyerOrganization: b.organization, buyerGroup: b.group, buyerType: b.type, buyerMappingStatus: b.status, buyerMappingVersion: BUYER_MAPPING_VERSION, buyerParticipants: b.participants, buyerAggregation: 'source',
    id: String(r.importKey ?? index), importKey: String(r.importKey ?? index), opportunityDescription: String(r.opportunityDescription ?? ''),
    buyer: label(r.issuingOrganization, 'Unknown buyer'), supplier: label(r.successfulSupplier, 'Unknown supplier'), type: label(r.opportunityType, 'Unspecified type'),
    currencyCode: label(r.currency, 'Unspecified').toUpperCase(), date: isoDate(r.awardDate),
    value: typeof r.contractValue === 'number' && Number.isFinite(r.contractValue) ? r.contractValue : null,
    placeholder: isPlaceholderContractAwardSupplier(typeof r.successfulSupplier === 'string' ? r.successfulSupplier : null),
  }); });
  normalized.set(raw, result); return result;
}
export function validateFilters(input: Partial<MarketFilters>): MarketFilters {
  const f = { ...defaultFilters, ...input };
  if (!isBuyerLevel(f.buyerLevel)) throw new Error('Choose a valid buyer grouping.');
  parseBuyerTrail(f.buyerTrail);
  if ((f.from && !isoDate(f.from)) || (f.to && !isoDate(f.to))) throw new Error('Choose valid start and end dates.');
  if (f.from && f.to && f.from > f.to) throw new Error('Start date must be on or before end date.');
  if (f.minValue && (!Number.isFinite(Number(f.minValue)) || Number(f.minValue) < 0)) throw new Error('Minimum award value must be zero or a positive number.');
  return f;
}
/** Inspections saved before mapping used exact source labels, regardless of today's default. */
export function inspectionFilters(input: Partial<MarketFilters>): MarketFilters {
  return { ...defaultFilters, ...input, buyerLevel: input.buyerLevel ?? 'source' };
}
export function filterAwards(rows: Award[], input: Partial<MarketFilters>, today: string): Award[] {
  const f = validateFilters(input);
  const trail = parseBuyerTrail(f.buyerTrail);
  return projectBuyers(rows, f.buyerLevel).filter(r => withinBuyerScope(r.buyerIdentity, trail) && (!f.buyerSearch || buyerSearchMatches(r.buyerIdentity, f.buyerSearch)) && (!f.buyer || r.buyer === f.buyer) && (!f.supplier || r.supplier === f.supplier) && (!f.type || r.type === f.type)
    && r.currencyCode === f.currency && (f.includePlaceholders || !r.placeholder) && (f.includeFuture || !r.date || r.date <= today)
    && (!f.from || !!r.date && r.date >= f.from) && (!f.to || !!r.date && r.date <= f.to)
    && (!f.minValue || r.value !== null && r.value >= Number(f.minValue)));
}
const projected = new WeakMap<Award[], Map<BuyerLevel, Award[]>>();
export function projectBuyers(rows: Award[], level: BuyerLevel): Award[] {
  let levels = projected.get(rows); if (!levels) { levels = new Map(); projected.set(rows, levels); }
  let result = levels.get(level);
  if (!result) { result = rows.map(r => ({ ...r, buyer: r.buyerIdentity.dimensions[level], buyerAggregation: level })); levels.set(level, result); }
  return result;
}
export function qualityMatch(r: Award, flag: QualityFlag, today: string) {
  switch (flag) {
    case 'future': return !!r.date && r.date > today;
    case 'undated': return !r.date;
    case 'currency': return r.currencyCode === 'UNSPECIFIED';
    case 'placeholder': return r.placeholder;
    case 'value': return r.value === null;
    case 'negative': return r.value !== null && r.value < 0;
    case 'zero': return r.value === 0;
    case 'contract': return !r.contractNumber;
    case 'justification': return !r.justification;
  }
}
export function sliceAwards(rows: Award[], slice: Slice = {}, today: string): Award[] {
  return rows.filter(r => (!slice.buyer || r.buyer === slice.buyer) && (!slice.supplier || r.supplier === slice.supplier)
    && (!slice.type || r.type === slice.type) && (!slice.month || r.date?.slice(0, 7) === slice.month)
    && (!slice.from || !!r.date && r.date >= slice.from) && (!slice.to || !!r.date && r.date <= slice.to)
    && (slice.min === undefined || r.value !== null && r.value >= slice.min)
    && (slice.max === undefined || r.value !== null && r.value < slice.max)
    && (slice.exact === undefined || r.value === slice.exact) && (!slice.quality || qualityMatch(r, slice.quality, today)));
}
const sum = (rows: Award[]) => rows.reduce((n, r) => n + (r.value ?? 0), 0);
const positive = (rows: Award[]) => rows.reduce((n, r) => n + Math.max(0, r.value ?? 0), 0);
export function quantile(values: number[], q: number): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b), p = (sorted.length - 1) * q, base = Math.floor(p);
  return sorted[base] + (sorted[Math.ceil(p)] - sorted[base]) * (p - base);
}
function groups(rows: Award[], dimension: 'buyer' | 'supplier' | 'type') {
  const result = new Map<string, Award[]>();
  for (const r of rows) { const key = r[dimension]; const bucket = result.get(key); if (bucket) bucket.push(r); else result.set(key, [r]); }
  return result;
}
/** Skip singleton hierarchy levels; source aliases remain evidence on awards, not subsidiaries. */
function buyerDrillLevel(records: Award[]): BuyerLevel | null {
  const level = records[0]?.buyerAggregation;
  const candidates: BuyerLevel[] = level === 'type' || level === 'group' ? ['organization', 'region', 'office']
    : level === 'organization' ? ['region', 'office'] : level === 'region' ? ['office'] : [];
  for (const next of candidates) {
    const first = records[0]?.buyerIdentity.dimensions[next];
    if (records.some(r => r.buyerIdentity.dimensions[next] !== first)) return next;
  }
  return null;
}
export function rank(rows: Award[], dimension: 'buyer' | 'supplier' | 'type') {
  const total = positive(rows);
  return [...groups(rows, dimension)].map(([name, records]) => {
    const counterparties = groups(records, dimension === 'supplier' ? 'buyer' : 'supplier');
    const leading = [...counterparties].map(([name, items]) => ({ name, value: positive(items) })).sort((a, b) => b.value - a.value || a.name.localeCompare(b.name))[0];
    const value = sum(records), positiveValue = positive(records);
    return { name, nextLevel: dimension === 'buyer' ? buyerDrillLevel(records) : null, count: records.length, value, positiveValue, share: total > 0 ? positiveValue / total : 0,
      median: quantile(records.flatMap(r => r.value === null ? [] : [r.value]), .5), counterparties: counterparties.size,
      dependence: positiveValue > 0 ? (leading?.value ?? 0) / positiveValue : null, leading: leading?.name ?? '',
    };
  }).sort((a, b) => b.value - a.value || a.name.localeCompare(b.name));
}
export function overview(rows: Award[]) {
  const suppliers = rank(rows, 'supplier'), buyers = rank(rows, 'buyer'), types = rank(rows, 'type');
  const values = rows.flatMap(r => r.value === null ? [] : [r.value]);
  const positiveTotal = positive(rows);
  const sortedSuppliers = [...suppliers].sort((a, b) => b.positiveValue - a.positiveValue || a.name.localeCompare(b.name));
  let cumulative = 0, suppliersFor80: number | null = null;
  const pareto = sortedSuppliers.map((r, i) => {
    cumulative += r.positiveValue;
    const share = positiveTotal ? cumulative / positiveTotal : 0;
    if (positiveTotal > 0 && suppliersFor80 === null && share >= .8) suppliersFor80 = i + 1;
    return { rank: i + 1, share: Math.min(100, share * 100), name: r.name };
  });
  // Preserve the endpoints and key early ranks while bounding rendered SVG marks.
  const step = Math.max(1, Math.ceil(pareto.length / 80));
  return { count: rows.length, value: sum(rows), valuedCount: values.length, positiveTotal, median: quantile(values, .5), q1: quantile(values, .25), q3: quantile(values, .75),
    buyerCount: buyers.length, supplierCount: suppliers.length, top10Share: sortedSuppliers.slice(0, 10).reduce((n, r) => n + r.share, 0), suppliersFor80,
    suppliers, buyers, types, pareto: pareto.filter((_, i) => i < 10 || i % step === 0 || i === pareto.length - 1 || i + 1 === suppliersFor80) };
}
export function metadata(rows: Award[], today: string, filters: Partial<MarketFilters> = {}) {
  const f = validateFilters(filters), trail = parseBuyerTrail(f.buyerTrail);
  const buyerRows = projectBuyers(rows, f.buyerLevel).filter(r => withinBuyerScope(r.buyerIdentity, trail));
  const distinct = (key: 'buyer' | 'supplier' | 'type' | 'currencyCode') => [...new Set(rows.map(r => r[key]))].sort((a, b) => a.localeCompare(b));
  const dates = rows.flatMap(r => r.date ? [r.date] : []).sort();
  const flags: QualityFlag[] = ['currency', 'future', 'undated', 'placeholder', 'value', 'negative', 'zero', 'contract', 'justification'];
  return { count: rows.length, buyers: [...new Set(buyerRows.map(r => r.buyer))].sort((a, b) => a.localeCompare(b)), suppliers: distinct('supplier'), types: distinct('type'), currencies: distinct('currencyCode'),
    firstDate: dates[0] ?? null, lastDate: dates.at(-1) ?? null, years: [...new Set(dates.map(d => d.slice(0, 4)))].reverse(),
    quality: flags.map(flag => ({ flag, count: rows.filter(r => qualityMatch(r, flag, today)).length })) };
}
export function trends(rows: Award[], year: string, today: string) {
  const yearNumber = Number(year || today.slice(0, 4));
  if (!Number.isInteger(yearNumber) || yearNumber < 1900 || yearNumber > 2200) throw new Error('Choose a valid heatmap year.');
  const buckets = new Map<string, Award[]>();
  for (const r of rows) if (r.date) { const month = r.date.slice(0, 7); const bucket = buckets.get(month); if (bucket) bucket.push(r); else buckets.set(month, [r]); }
  const dates = [...buckets.keys()].sort();
  const series: { month: string; value: number; count: number }[] = [];
  if (dates.length) {
    let cursor = new Date(dates[0] + '-01T00:00:00Z');
    const end = dates.at(-1)!;
    // At most 301 years; source dates outside this range remain in the records table.
    while (cursor.toISOString().slice(0, 7) <= end && series.length < 3612) {
      const month = cursor.toISOString().slice(0, 7), bucket = buckets.get(month) ?? [];
      series.push({ month, value: sum(bucket), count: bucket.length }); cursor.setUTCMonth(cursor.getUTCMonth() + 1);
    }
  }
  const yearRows = rows.filter(r => r.date?.startsWith(String(yearNumber) + '-'));
  const buyers = rank(yearRows, 'buyer').slice(0, 10);
  const months = Array.from({ length: 12 }, (_, i) => `${yearNumber}-${String(i + 1).padStart(2, '0')}`);
  const cells = buyers.flatMap(buyer => months.map(month => { const bucket = yearRows.filter(r => r.buyer === buyer.name && r.date?.startsWith(month)); return { row: buyer.name, column: month, count: bucket.length, value: sum(bucket), slice: { buyer: buyer.name, month } }; }));
  return { series, months, buyers, cells, undated: rows.filter(r => !r.date).length, year: String(yearNumber), shownCount: cells.reduce((n, c) => n + c.count, 0), yearCount: yearRows.length };
}
export function distribution(rows: Award[]) {
  const edges = [0, 10000, 50000, 100000, 250000, 500000, 1000000, 5000000, 10000000, Infinity];
  const names = ['Under 10k', '10k–50k', '50k–100k', '100k–250k', '250k–500k', '500k–1m', '1m–5m', '5m–10m', '10m and above'];
  const bins = [ { label: 'Negative values', slice: { max: 0 } as Slice }, { label: 'Zero', slice: { exact: 0 } as Slice },
    ...names.map((label, i) => ({ label, slice: { min: i === 0 ? Number.MIN_VALUE : edges[i], ...(Number.isFinite(edges[i + 1]) ? { max: edges[i + 1] } : {}) } as Slice }))
  ].map(bin => { const bucket = sliceAwards(rows, bin.slice, '9999-12-31'); return { ...bin, count: bucket.length, value: sum(bucket) }; });
  const values = rows.flatMap(r => r.value === null ? [] : [r.value]);
  return { bins, count: rows.length, known: values.length, missing: rows.length - values.length, median: quantile(values, .5), q1: quantile(values, .25), q3: quantile(values, .75), max: values.length ? values.reduce((max, value) => Math.max(max, value), -Infinity) : null };
}
export function matrix(rows: Award[], dimension: 'supplier' | 'type') {
  const buyers = rank(rows, 'buyer').slice(0, 10), columns = rank(rows, dimension).slice(0, 10);
  const cells = buyers.flatMap(buyer => columns.map(column => {
    const bucket = rows.filter(r => r.buyer === buyer.name && r[dimension] === column.name);
    return { row: buyer.name, column: column.name, count: bucket.length, value: sum(bucket), slice: { buyer: buyer.name, [dimension]: column.name } as Slice };
  }));
  return { rows: buyers.map(r => r.name), columns: columns.map(r => r.name), cells,
    shownCount: cells.reduce((n, c) => n + c.count, 0), totalCount: rows.length, buyerCount: new Set(rows.map(r => r.buyer)).size, columnCount: new Set(rows.map(r => r[dimension])).size };
}
export function comparison(all: Award[], input: Partial<MarketFilters>, options: MarketOptions, today: string) {
  const defaultYear = Number(today.slice(0, 4)) - 1;
  const aFrom = options.aFrom ?? `${defaultYear - 1}-01-01`, aTo = options.aTo ?? `${defaultYear - 1}-12-31`;
  const bFrom = options.bFrom ?? `${defaultYear}-01-01`, bTo = options.bTo ?? `${defaultYear}-12-31`;
  if (![aFrom, aTo, bFrom, bTo].every(isoDate) || aFrom > aTo || bFrom > bTo) throw new Error('Choose valid, ordered dates for both periods.');
  if (aFrom <= bTo && bFrom <= aTo) throw new Error('Comparison periods must not overlap.');
  const dimension = options.dimension ?? 'buyer', metric = options.metric ?? 'value';
  const baseFilters = { ...input, from: '', to: '' };
  const base = filterAwards(all, baseFilters, today);
  const a = sliceAwards(base, { from: aFrom, to: aTo }, today), b = sliceAwards(base, { from: bFrom, to: bTo }, today);
  const ga = new Map(rank(a, dimension).map(r => [r.name, r])), gb = new Map(rank(b, dimension).map(r => [r.name, r]));
  const rows = [...new Set([...ga.keys(), ...gb.keys()])].map(name => {
    const av = ga.get(name)?.[metric] ?? 0, bv = gb.get(name)?.[metric] ?? 0;
    return { name, a: av, b: bv, delta: bv - av, change: av > 0 ? (bv - av) / av : null, aCount: ga.get(name)?.count ?? 0, bCount: gb.get(name)?.count ?? 0 };
  }).sort((l, r) => Math.abs(r.delta) - Math.abs(l.delta) || l.name.localeCompare(r.name));
  const days = (from: string, to: string) => Math.round((Date.parse(to) - Date.parse(from)) / 86400000) + 1;
  const warnings = ['Changes describe saved awards, not verified growth in the complete BC procurement market.'];
  if (days(aFrom, aTo) !== days(bFrom, bTo)) warnings.push(`Periods have different lengths (${days(aFrom, aTo)} and ${days(bFrom, bTo)} days).`);
  if (aTo > today || bTo > today) warnings.push('A selected period extends beyond today.');
  if (!a.length || !b.length) warnings.push('At least one period has no saved awards for these filters; source coverage is unknown.');
  return { rows, aFrom, aTo, bFrom, bTo, aCount: a.length, bCount: b.length, aValue: sum(a), bValue: sum(b), dimension, metric, warnings };
}
export function buildMarketView(raw: Record<string, unknown>[], view: string, filters: Partial<MarketFilters> = {}, options: MarketOptions = {}, today = new Date().toISOString().slice(0, 10)): unknown {
  const all = normalizeAwards(raw);
  if (view === 'mapping') return mappingOverview(all);
  if (view === 'meta' || view === 'quality') return metadata(all, today, view === 'meta' ? filters : {});
  if (view === 'compare') return comparison(all, filters, options, today);
  // Quality drilldowns intentionally use the complete saved catalog, labelled in the UI.
  if (view === 'records' && options.slice?.quality) return sliceAwards(projectBuyers(all, validateFilters(filters).buyerLevel), options.slice, today);
  const rows = filterAwards(all, filters, today);
  if (view === 'overview' || view === 'buyers' || view === 'suppliers') return overview(rows);
  if (view === 'trends') return trends(rows, options.year ?? '', today);
  if (view === 'sizes') return distribution(rows);
  if (view === 'mix') return matrix(rows, 'type');
  if (view === 'relationships') return matrix(rows, 'supplier');
  if (view === 'records') return sliceAwards(rows, options.slice, today);
  throw new Error('Unknown market analysis view.');
}
export type Overview = ReturnType<typeof overview>;
export type Metadata = ReturnType<typeof metadata>;
export type Trends = ReturnType<typeof trends>;
export type Distribution = ReturnType<typeof distribution>;
export type Matrix = ReturnType<typeof matrix>;
export type Comparison = ReturnType<typeof comparison>;

export function mappingOverview(rows: Award[]) {
  const counts = new Map<string, number>();
  for (const row of rows) { const key = row.buyerIdentity.dimensions.source; counts.set(key, (counts.get(key) ?? 0) + 1); }
  const sources = new Set([...buyerRegistry.map(m => m.sourceName), ...rows.map(r => r.buyerOriginal)]);
  const entries = [...sources].map(source => { const b = resolveBuyer(source); return { sourceName: source || '(missing buyer)', cleanName: b.clean, organization: b.organization, group: b.group, buyerType: b.type, status: b.status, proposedHierarchy: b.mapping?.hierarchy.join(' → ') ?? '', participants: b.participants.join(' + '), awardCount: counts.get(b.dimensions.source) ?? 0, notes: b.mapping?.notes.join(' ') ?? 'New source label; no parent inferred.', evidence: b.mapping?.evidenceUrls.join('\n') ?? '', mappingVersion: BUYER_MAPPING_VERSION }; });
  return { entries, version: BUYER_MAPPING_VERSION, awardCount: rows.length, reviewCount: entries.filter(e => e.status === 'Review required' || e.status === 'Not mapped').length };
}
export type MappingOverview = ReturnType<typeof mappingOverview>;
