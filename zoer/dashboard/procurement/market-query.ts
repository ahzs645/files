export type ProcurementMarketKind = 'all' | 'opportunity' | 'award';
export type ProcurementMarketView = 'currencies' | 'sources' | 'buyers' | 'suppliers' | 'classifications';
export type ProcurementMarketScope = {
  source?: string;
  kind?: ProcurementMarketKind;
  buyer?: string;
  supplier?: string;
  classification?: string;
};
export type ProcurementMarketQuery = { statement: string; parameters: (string | number)[] };
export type ProcurementMarketSummary = {
  recordCount: number; awardCount: number; opportunityCount: number;
  valuedCount: number; missingValueCount: number; comparableValueCount: number;
  zeroValueCount: number; negativeValueCount: number;
};
export type ProcurementMarketRow = {
  sourceId: string; currency: string; label: string;
  recordCount: number; awardCount: number; valuedCount: number;
  zeroValueCount: number; negativeValueCount: number; totalValue: number | null;
};

const field = (name: string) => `json_extract(data, '$.${name}')`;
const source = `coalesce(CASE WHEN ${field('sourceId')}='' THEN NULL ELSE ${field('sourceId')} END, 'bc-bid')`;
const buyer = `coalesce(${field('issuedBy')}, ${field('issuingOrganization')}, '')`;
const supplier = `coalesce(${field('successfulSupplier')}, '')`;
const codes = field('classificationCodes');
const commodities = field('commodities');
// Whole raw sets remain intact. Their source stays in every classification group;
// there is no inferred UNSPSC/GSIN/BC commodity crosswalk or first-code shortcut.
const classification = `coalesce(CASE WHEN ${codes}='' OR ${codes}='[]' THEN NULL ELSE ${codes} END, CASE WHEN ${commodities}='' OR ${commodities}='[]' THEN NULL ELSE ${commodities} END, ${field('sourceCategory')}, ${field('category')}, '')`;
const currency = `CASE WHEN length(${field('currency')})=3 AND ${field('currency')} GLOB '[A-Za-z][A-Za-z][A-Za-z]' THEN upper(${field('currency')}) ELSE '' END`;
// json_extract(value,value) keeps JSON's scalar type in a small encoded array.
// This avoids coercing strings, booleans and null to numeric zero with CAST;
// json_type/typeof are intentionally outside the host SQL reader's allowlist.
const value = `CASE WHEN kind='award' AND json_extract(data, '$.contractValue', '$.contractValue') GLOB '[[][-0-9]*' AND ${field('contractValue')} BETWEEN -1.7976931348623157e308 AND 1.7976931348623157e308 THEN ${field('contractValue')} END`;

function where(scope: ProcurementMarketScope) {
  const filters = ["kind IN ('opportunity','award')"], parameters: (string | number)[] = [];
  if (scope.kind && scope.kind !== 'all') { filters.push('kind=?'); parameters.push(scope.kind); }
  if (scope.source && scope.source !== 'all') { filters.push(`${source}=?`); parameters.push(scope.source); }
  for (const [key, expression] of [['buyer', buyer], ['supplier', supplier], ['classification', classification]] as const) {
    if (scope[key] !== undefined) { filters.push(`${expression}=?`); parameters.push(scope[key]!); }
  }
  // Exact entity names are source-local identities. Refuse unscoped drilldowns.
  if ((scope.buyer !== undefined || scope.supplier !== undefined || scope.classification !== undefined) && (!scope.source || scope.source === 'all')) throw new Error('Choose a source before inspecting a buyer, supplier or classification.');
  return { statement: filters.join(' AND '), parameters };
}

export function buildMarketSummaryQuery(scope: ProcurementMarketScope = {}): ProcurementMarketQuery {
  const filter = where(scope);
  return { statement: `SELECT count(*) AS recordCount, count(CASE WHEN kind='award' THEN 1 END) AS awardCount, count(CASE WHEN kind='opportunity' THEN 1 END) AS opportunityCount, count(${value}) AS valuedCount, count(CASE WHEN kind='award' THEN 1 END)-count(${value}) AS missingValueCount, count(CASE WHEN ${currency}<>'' THEN ${value} END) AS comparableValueCount, count(CASE WHEN ${value}=0 THEN 1 END) AS zeroValueCount, count(CASE WHEN ${value}<0 THEN 1 END) AS negativeValueCount FROM records WHERE ${filter.statement}`, parameters: filter.parameters };
}

/** At most 51 aggregate rows: 50 visible plus a next-page indicator. */
export function buildMarketGroupsQuery(scope: ProcurementMarketScope = {}, view: ProcurementMarketView = 'sources', page = 0): ProcurementMarketQuery {
  const filter = where(scope);
  const label = view === 'buyers' ? buyer : view === 'suppliers' ? supplier : view === 'classifications' ? classification : view === 'sources' ? source : currency;
  const sourceColumn = view === 'currencies' ? "''" : source;
  const offset = Number.isFinite(page) ? Math.max(0, Math.min(100000, Math.floor(page))) * 50 : 0;
  return {
    statement: `SELECT ${sourceColumn} AS sourceId, ${currency} AS currency, ${label} AS label, count(*) AS recordCount, count(CASE WHEN kind='award' THEN 1 END) AS awardCount, count(${value}) AS valuedCount, count(CASE WHEN ${value}=0 THEN 1 END) AS zeroValueCount, count(CASE WHEN ${value}<0 THEN 1 END) AS negativeValueCount, CASE WHEN ${currency}<>'' THEN sum(${value}) ELSE NULL END AS totalValue FROM records WHERE ${filter.statement} GROUP BY sourceId, currency, label ORDER BY recordCount DESC, sourceId, currency, label LIMIT 51 OFFSET ?`,
    parameters: [...filter.parameters, offset],
  };
}

export function marketDrilldown(scope: ProcurementMarketScope, view: ProcurementMarketView, row: ProcurementMarketRow): ProcurementMarketScope {
  if (view === 'currencies') return scope;
  const result = { ...scope, source: row.sourceId };
  if (view === 'buyers') result.buyer = row.label;
  if (view === 'suppliers') result.supplier = row.label;
  if (view === 'classifications') result.classification = row.label;
  return result;
}

export function classificationLabel(raw: string): string {
  if (!raw || raw === '[]') return 'Not stated';
  try {
    const values: unknown = JSON.parse(raw);
    if (Array.isArray(values)) return values.map(value => {
      if (typeof value === 'string') return value;
      if (value && typeof value === 'object') {
        const item = value as { scheme?: unknown; code?: unknown; label?: unknown };
        return [item.scheme, item.code, item.label].filter(value => typeof value === 'string' && value).join(' · ') || JSON.stringify(value);
      }
      return String(value);
    }).join('; ') || 'Not stated';
  } catch { /* Source categories may be plain text. */ }
  return raw;
}

export function formatMarketValue(value: number | null, currencyCode: string): string {
  if (!currencyCode) return 'Not comparable';
  if (value === null) return 'Not disclosed';
  if (!Number.isFinite(value)) return 'Outside numeric range';
  return `${currencyCode} ${value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
