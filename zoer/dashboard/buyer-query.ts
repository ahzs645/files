import { annotateBuyerRecord, buyerSearchMatches, resolveBuyer, type BuyerLevel } from './market/buyers';
export const buyerColumns = ['buyer', 'buyerOriginal', 'buyerClean', 'buyerOrganization', 'buyerGroup', 'buyerRegion', 'buyerType', 'buyerMappingStatus'] as const;
export function isBuyerColumn(key: string) { return (buyerColumns as readonly string[]).includes(key); }
function matches(value: string, filter: any) {
  const valid = (v: unknown) => { if ((typeof v !== 'string' && typeof v !== 'number') || String(v).length > 10000) throw Error('Invalid buyer filter value.'); return String(v); };
  switch (filter.operator) {
    case 'null': return false; // Derived labels always include an explicit unknown value.
    case 'not-null': return true;
    case 'in': if (!Array.isArray(filter.values) || !filter.values.length || filter.values.length > 50) throw Error('Choose between 1 and 50 filter values.'); return filter.values.map(valid).includes(value);
    case 'contains': return value.toLowerCase().includes(valid(filter.value).toLowerCase());
    case 'equals': return value === valid(filter.value);
    case 'gte': return value >= valid(filter.value);
    case 'lte': return value <= valid(filter.value);
    default: throw Error('Unsupported buyer filter condition.');
  }
}
/** A single bounded JSON parameter supplies flags/ranks for the complete name inventory.
 * SQL applies them before paging. Source names never become SQL text.
 * Names containing JSON escapes use fixed array paths because SQLite's quoted object paths cannot address them.
 */
export function buyerQuery(sources: string[], kind: 'award' | 'opportunity', level: BuyerLevel, args: any) {
  const filters = (args.filters ?? []).filter((f: any) => isBuyerColumn(f.column));
  const sourceField = `coalesce(json_extract(data, '$.${kind === 'award' ? 'issuingOrganization' : 'issuedBy'}'), '')`;
  const rows = sources.map(source => ({ source, data: annotateBuyerRecord({ [kind === 'award' ? 'issuingOrganization' : 'issuedBy']: source }, kind, level) }));
  const sorting = isBuyerColumn(args.sort?.id ?? '');
  const labels = sorting ? [...new Set(rows.map(r => String((r.data as any)[args.sort.id])))].sort((a,b) => a.localeCompare(b)) : [];
  const ranks = new Map(labels.map((label, i) => [label, i]));
  const plain: Record<string, number[]> = Object.create(null), quoted: { source: string; values: number[] }[] = [];
  for (const {source, data} of rows) {
    const values = [sorting ? ranks.get(String((data as any)[args.sort.id]))! : 0,
      (!args.organization || data.buyer === args.organization) && filters.every((f: any) => matches(String((data as any)[f.column]), f)) ? 1 : 0,
      args.search?.trim() && buyerSearchMatches(resolveBuyer(source), args.search) ? 1 : 0];
    if (/["\\\u0000-\u001f]/.test(source)) quoted.push({ source, values }); else plain[source] = values;
  }
  const parameter = JSON.stringify({ plain, quoted });
  const plainValue = `json_extract(buyer_mapping_json, '$.plain."' || ${sourceField} || '"')`;
  const value = quoted.length ? `CASE ${sourceField} ${quoted.map((_, i) => `WHEN json_extract(buyer_mapping_json, '$.quoted[${i}].source') THEN json_extract(buyer_mapping_json, '$.quoted[${i}].values')`).join(' ')} ELSE ${plainValue} END` : plainValue;
  if (parameter.length > 85000 || value.length > 2200) throw Error('Buyer name inventory exceeds the bounded query limit. Narrow the catalog or use original-source filters.');
  return { from: 'records, (SELECT ? AS buyer_mapping_json)', parameter,
    filter: args.organization || filters.length ? `coalesce(json_extract(${value}, '$[1]'), 0)=1` : null,
    search: `coalesce(json_extract(${value}, '$[2]'), 0)=1`,
    order: sorting ? `coalesce(json_extract(${value}, '$[0]'), ${labels.length}) ${args.sort.desc === true ? 'DESC' : 'ASC'}, id` : null };
}
