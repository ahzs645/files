import { resolveBuyer, parseBuyerTrail, withinBuyerScope, buyerSearchMatches, type ResolvedBuyer } from './buyers';
import { isPlaceholderContractAwardSupplier, normalizeContractAwardEntityLabel } from '../../../packages/shared/src/contractAwardsAnalysis';
import { parseExclusions, validateFilters, type MarketFilters, type Overview } from './model';
import { awardDuplicates } from '../procurement/award-duplicates';

/**
 * Market › Overview from aggregate SQL instead of every saved award (`readAnalysis` in queries.ts).
 *
 * Every figure follows `overview(filterAwards(normalizeAwards(rows)))` in model.ts: the same filters, labels, buyer
 * mapping and value rules. SQL keeps the raw values and the browser applies the JavaScript rules to the few distinct
 * raw values that need them (buyer names, currencies, procurement types, irregularly spaced supplier names).
 *
 * Like the row-by-row reader, each award counts once: rows `catalog.normalize` marked `duplicateOf` are left out, and
 * the caller passes the repeats saved since (`unmarkedDuplicates`) as `exclude`.
 *
 * Returns null when a bound of the host's SQL console (200 rows, 200 parameters) would make an exact answer
 * impossible; the caller then reads every award.
 */
export type Run = (statement: string, parameters: (string | number)[]) => Promise<any[]>;
export interface Ranked { name: string; count: number; value: number }
export interface OverviewSummary {
  count: number; value: number; valuedCount: number; positiveTotal: number; median: number | null;
  buyerCount: number; supplierCount: number; top10Share: number; suppliersFor80: number | null;
  buyers: Ranked[]; types: Ranked[];
}
/** The Overview figures of a row-by-row `overview()` result, for the fallback path and tests. */
export function summarizeOverview(o: Overview): OverviewSummary {
  const ranked = (rows: Overview['buyers']) => rows.map(r => ({ name: r.name, count: r.count, value: r.value }));
  return { count: o.count, value: o.value, valuedCount: o.valuedCount, positiveTotal: o.positiveTotal, median: o.median, buyerCount: o.buyerCount, supplierCount: o.supplierCount, top10Share: o.top10Share, suppliersFor80: o.suppliersFor80, buyers: ranked(o.buyers), types: ranked(o.types) };
}

const F = (key: string) => `json_extract(data,'$.${key}')`;
const SOURCE = `CASE WHEN ${F('sourceId')} IS NULL OR ${F('sourceId')}='' THEN 'bc-bid' ELSE ${F('sourceId')} END`;
/** The BC Bid awards the row reader loads, without rows `catalog.normalize` marked as repeats. */
export const AWARD_BASE = `kind='award' AND ${SOURCE}='bc-bid' AND ${F('duplicateOf')} IS NULL`;
const VALUE = F('contractValue'), DATE = F('awardDate'), SUPPLIER = F('successfulSupplier'), BUYER = F('issuingOrganization'), CURRENCY = F('currency'), TYPE = F('opportunityType');
/** A JSON number (JavaScript `typeof === 'number'`); a numeric string is not a value, as in model.ts. */
const NUM = `CASE WHEN ${VALUE}=${VALUE}+0 THEN ${VALUE} END`;
const POS = `CASE WHEN ${VALUE}=${VALUE}+0 AND ${VALUE}>0 THEN ${VALUE} ELSE 0 END`;
/** `isoDate()` in model.ts: a real calendar day written YYYY-MM-DD. */
const leap = `CASE WHEN CAST(${DATE} AS INTEGER) % 400 = 0 THEN 1 WHEN CAST(${DATE} AS INTEGER) % 100 = 0 THEN 0 WHEN CAST(${DATE} AS INTEGER) % 4 = 0 THEN 1 ELSE 0 END`;
export const VALID_DATE = `CASE WHEN ${DATE} GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]' THEN CASE WHEN julianday(${DATE}) IS NULL THEN 0 WHEN ${DATE} GLOB '*-0[469]-31' THEN 0 WHEN ${DATE} GLOB '*-11-31' THEN 0 WHEN ${DATE} GLOB '*-02-3[01]' THEN 0 WHEN ${DATE} GLOB '*-02-29' THEN ${leap} ELSE 1 END ELSE 0 END`;
/** Every character JavaScript's `\s` matches except the plain space. */
const OTHER_SPACE = '\t\n\u000b\f\r                 　﻿';
const PLACEHOLDER_TEXT = `CASE WHEN ${SUPPLIER} IS NULL THEN 1 WHEN lower(${SUPPLIER})='migrated supplier' THEN 1 ELSE 0 END`;
const label = (value: unknown, fallback: string) => normalizeContractAwardEntityLabel(typeof value === 'string' ? value : null) ?? fallback;

/** Numbered parameters, so one value used in several places costs one of the host's 200. */
class Params {
  values: (string | number)[] = []; private refs = new Map<string, string>();
  ref(value: string | number) { const key = typeof value + ':' + value; let ref = this.refs.get(key); if (!ref) { this.values.push(value); ref = '?' + this.values.length; this.refs.set(key, ref); } return ref; }
}
type Raw = string | number | null;
/** `x IN (values)`, with null matched explicitly; '0=1' when nothing qualifies. */
function membership(params: Params, expression: string, values: Raw[], negate = false) {
  const nulls = values.some(v => v === null), listed = values.filter((v): v is string | number => v !== null);
  const inList = listed.length ? `WHEN ${expression} IN (${listed.map(v => params.ref(v)).join(',')}) THEN ${negate ? 0 : 1} ` : '';
  return `CASE WHEN ${expression} IS NULL THEN ${nulls !== negate ? 1 : 0} ${inList}ELSE ${negate ? 1 : 0} END=1`;
}

/**
 * Awards that repeat another award (award-duplicates.ts) but are not marked `duplicateOf` yet, so the SQL figures count
 * each award once, as the row-by-row reader does. One grouped scan finds the candidates: rows sharing opportunity,
 * value, date and contract number (ignoring letter case) whose suppliers may be the same (equal apart from one trailing
 * period, identical "Migrated Supplier" addresses, a migrated row beside a named one, or unusual spacing). The rule
 * itself then decides on just those rows.
 *
 * Not caught (counted twice until `catalog.normalize` marks them): repeats whose opportunity id, award date or contract
 * number differ only in spacing or non-ASCII letter case, and two "Migrated Supplier" rows naming the same supplier
 * with different address text. Returns null when there are too many candidates; the caller then reads every award.
 */
export async function unmarkedDuplicates(run: Run, signal?: AbortSignal): Promise<string[] | null> {
  const params = new Params(), odd = params.ref(`*[${OTHER_SPACE}]*`), wide = params.ref('*[^ -~]*');
  // Names lower-case comparison could misjudge: stray spacing or non-ASCII letters. A group holding one is a candidate.
  const unusual = `CASE WHEN ${SUPPLIER} GLOB ' *' THEN 1 WHEN ${SUPPLIER} GLOB '* ' THEN 1 WHEN ${SUPPLIER} GLOB '*  *' THEN 1 WHEN ${SUPPLIER} GLOB ${odd} THEN 1 WHEN ${SUPPLIER} GLOB ${wide} THEN 1 ELSE 0 END`;
  const name = `lower(${SUPPLIER})`, migrated = `CASE WHEN ${name}='migrated supplier' THEN 1 ELSE 0 END`;
  // One value per possible supplier: "acme ltd" and "acme ltd." meet at "acme ltd."; migrated rows by their address.
  const same = `CASE WHEN ${name}='migrated supplier' THEN 'm:' || lower(coalesce(${F('supplierAddress')},'')) WHEN ${name} GLOB '*.' THEN ${name} ELSE ${name} || '.' END`;
  signal?.throwIfAborted();
  const groups = await run(`SELECT lower(${F('opportunityId')}) AS o, min(id) AS lo, max(id) AS hi, count(*) AS n FROM records WHERE ${AWARD_BASE} AND coalesce(${SUPPLIER},'')<>'' AND coalesce(${F('opportunityId')},'')<>'' GROUP BY o, CAST(${VALUE} AS REAL), lower(${DATE}), lower(coalesce(${F('contractNumber')},'')) HAVING count(*)>1 AND CASE WHEN count(DISTINCT ${same})<count(*) THEN 1 WHEN sum(${migrated})>0 AND sum(${migrated})<count(*) THEN 1 WHEN sum(${unusual})>0 THEN 1 ELSE 0 END=1 LIMIT 200`, params.values);
  if (groups.length >= 200) return null;
  const fields = ['sourceId', 'opportunityId', 'successfulSupplier', 'supplierAddress', 'awardDate', 'contractValue', 'contractNumber'].map(k => `${F(k)} AS "${k}"`).join(', ');
  const rows = new Map<string, Record<string, unknown>>();
  const read = async (where: (page: Params) => string) => {
    for (let after = ''; ;) {
      signal?.throwIfAborted();
      const page = new Params(), found = await run(`SELECT id, ${fields} FROM records WHERE ${AWARD_BASE} AND ${where(page)} AND id>${page.ref(after)} ORDER BY id LIMIT 200`, page.values);
      for (const { id, ...data } of found) rows.set(String(id), data);
      if (found.length < 200) return;
      after = String(found.at(-1).id);
    }
  };
  // Pairs are read by id; a larger group by its opportunity (a superset, which the rule sorts out).
  const pairIds = groups.filter(g => Number(g.n) === 2).flatMap(g => [String(g.lo), String(g.hi)]);
  for (let i = 0; i < pairIds.length; i += 150) await read(page => `id IN (${pairIds.slice(i, i + 150).map(id => page.ref(id)).join(',')})`);
  const larger = [...new Set(groups.filter(g => Number(g.n) > 2).map(g => g.o as string | number))];
  for (let i = 0; i < larger.length; i += 150) await read(page => `lower(${F('opportunityId')}) IN (${larger.slice(i, i + 150).map(o => page.ref(o)).join(',')})`);
  return [...awardDuplicates([...rows].map(([id, data]) => ({ id, data }))).keys()];
}

export interface SummaryOptions { signal?: AbortSignal; onStep?: (step: number) => void; exclude?: string[] }
const PARAMETER_BUDGET = 190, MAX_IRREGULAR = 60, MAX_RAW_LIST = 120;

export async function marketSummary(run: Run, input: Partial<MarketFilters>, today: string, options: SummaryOptions = {}): Promise<OverviewSummary | null> {
  const f = validateFilters(input), trail = parseBuyerTrail(f.buyerTrail), exclusions = parseExclusions(f.exclusions);
  let step = 0;
  // Repeats to leave out: one JSON object parameter looked up by record id; ids JSON paths cannot quote go in a list.
  const plain = (options.exclude ?? []).filter(id => !/["\\\u0000-\u001f]/.test(id)), quoted = (options.exclude ?? []).filter(id => !plain.includes(id));
  const lookup = JSON.stringify(Object.fromEntries(plain.map(id => [id, 1])));
  if (lookup.length > 80_000 || quoted.length > 40) return null;
  const base = (params: Params) => AWARD_BASE + (plain.length ? ` AND json_extract(${params.ref(lookup)}, '$."' || id || '"') IS NULL` : '') + (quoted.length ? ` AND id NOT IN (${quoted.map(id => params.ref(id)).join(',')})` : '');
  const query =async (statement: string, params: Params) => {
    options.signal?.throwIfAborted();
    if (params.values.length > PARAMETER_BUDGET || statement.length > 9800) throw new SummaryLimit();
    const rows = await run(statement, params.values); options.onStep?.(++step); options.signal?.throwIfAborted(); return rows;
  };
  try {
    // 1. Distinct raw currencies and types, and every supplier name the label rules would change.
    const irregular = (x: string, params: Params) => `CASE WHEN ${x} IS NULL THEN 0 WHEN ${x}=${x}+0 THEN 1 WHEN ${x}='' THEN 1 WHEN ${x} GLOB ' *' THEN 1 WHEN ${x} GLOB '* ' THEN 1 WHEN ${x} GLOB '*  *' THEN 1 WHEN ${x} GLOB ${params.ref(`*[${OTHER_SPACE}]*`)} THEN 1 ELSE 0 END`;
    const discovery = new Params();
    const groups = await query(`SELECT ${CURRENCY} AS c, ${TYPE} AS t, CASE WHEN ${irregular(SUPPLIER, discovery)}=1 THEN ${SUPPLIER} END AS s, ${PLACEHOLDER_TEXT} AS pl, CASE WHEN ${VALID_DATE}=1 AND ${DATE}>${discovery.ref(today)} THEN 1 ELSE 0 END AS fu, count(*) AS n, sum(${NUM}) AS v, count(${NUM}) AS vn, sum(${POS}) AS p FROM records WHERE ${base(discovery)} GROUP BY c, t, s, pl, fu ORDER BY n DESC LIMIT 200`, discovery);
    if (groups.length >= 200) return null;
    const irregularSuppliers = [...new Set(groups.map(g => g.s).filter((s): s is string | number => s !== null))];
    if (irregularSuppliers.length > MAX_IRREGULAR) return null;
    const currencyOf = (raw: Raw) => label(raw, 'Unspecified').toUpperCase(), typeOf = (raw: Raw) => label(raw, 'Unspecified type');
    const placeholder = (g: any) => g.s !== null ? isPlaceholderContractAwardSupplier(typeof g.s === 'string' ? g.s : null) : g.pl === 1;
    const currencies = [...new Set(groups.map(g => g.c as Raw))], types = [...new Set(groups.map(g => g.t as Raw))];
    const allowedCurrency = currencies.filter(raw => currencyOf(raw) === f.currency);
    const excludedTypes = new Set(exclusions.filter(e => e.kind === 'type').map(e => e.name));
    const typeAllowed = (raw: Raw) => (!f.type || typeOf(raw) === f.type) && !excludedTypes.has(typeOf(raw));
    const allowedTypes = types.filter(typeAllowed);

    // The shared row filter (filterAwards) as SQL. `buyer` adds the raw buyer names the browser kept.
    const supplierKey = (params: Params) => {
      const mapped = irregularSuppliers.map(raw => `WHEN ${params.ref(raw)} THEN ${params.ref(label(raw, 'Unknown supplier'))}`).join(' ');
      return `coalesce(${mapped ? `CASE ${SUPPLIER} ${mapped} ELSE ${SUPPLIER} END` : SUPPLIER},${params.ref('Unknown supplier')})`;
    };
    const filter = (params: Params, buyers?: { values: Raw[]; negate: boolean }) => {
      const where = [base(params), membership(params, CURRENCY, allowedCurrency)];
      if (allowedTypes.length !== types.length) where.push(membership(params, TYPE, allowedTypes));
      if (!f.includePlaceholders) {
        const listed = irregularSuppliers.filter(raw => isPlaceholderContractAwardSupplier(typeof raw === 'string' ? raw : null));
        where.push(`CASE WHEN ${PLACEHOLDER_TEXT}=1 THEN 0 ${listed.length ? `WHEN ${SUPPLIER} IN (${listed.map(v => params.ref(v)).join(',')}) THEN 0 ` : ''}ELSE 1 END=1`);
      }
      if (!f.includeFuture) where.push(`CASE WHEN ${VALID_DATE}=1 AND ${DATE}>${params.ref(today)} THEN 0 ELSE 1 END=1`);
      if (f.from) where.push(`${VALID_DATE}=1 AND ${DATE}>=${params.ref(f.from)}`);
      if (f.to) where.push(`${VALID_DATE}=1 AND ${DATE}<=${params.ref(f.to)}`);
      if (f.minValue) where.push(`${NUM}>=${params.ref(Number(f.minValue))}`);
      if (f.supplier) where.push(`${supplierKey(params)}=${params.ref(f.supplier)}`);
      for (const e of exclusions) if (e.kind === 'supplier') where.push(`${supplierKey(params)}<>${params.ref(e.name)}`);
      if (buyers) where.push(membership(params, BUYER, buyers.values, buyers.negate));
      return where.join(' AND ');
    };

    // 2. Buyers: one row per raw name, mapped to the chosen grouping here (buyers.ts), so buyer filters apply exactly.
    const rawBuyers: { raw: Raw; n: number; v: number }[] = [];
    for (let offset = 0; ; offset += 200) {
      const params = new Params();
      const page = await query(`SELECT ${BUYER} AS k, count(*) AS n, sum(${NUM}) AS v FROM records WHERE ${filter(params)} GROUP BY k ORDER BY k LIMIT 200 OFFSET ${params.ref(offset)}`, params);
      rawBuyers.push(...page.map(r => ({ raw: r.k as Raw, n: Number(r.n), v: Number(r.v ?? 0) })));
      if (page.length < 200) break;
    }
    const buyerExclusions = exclusions.filter(e => e.kind === 'buyer');
    const buyerFiltered = !!f.buyer || trail.length > 0 || !!f.buyerSearch || buyerExclusions.length > 0;
    const keepBuyer = (b: ResolvedBuyer) => !buyerExclusions.some(e => b.dimensions[e.level!] === e.name) && withinBuyerScope(b, trail) && (!f.buyerSearch || buyerSearchMatches(b, f.buyerSearch)) && (!f.buyer || b.dimensions[f.buyerLevel] === f.buyer);
    const buyerRanks = new Map<string, Ranked>(), kept: Raw[] = [], dropped: Raw[] = [];
    for (const row of rawBuyers) {
      const b = resolveBuyer(row.raw);
      if (!keepBuyer(b)) { dropped.push(row.raw); continue; }
      kept.push(row.raw);
      const name = b.dimensions[f.buyerLevel], entry = buyerRanks.get(name) ?? { name, count: 0, value: 0 };
      entry.count += row.n; entry.value += row.v; buyerRanks.set(name, entry);
    }
    let buyerScope: { values: Raw[]; negate: boolean } | undefined;
    if (buyerFiltered && dropped.length) {
      buyerScope = kept.length <= dropped.length ? { values: kept, negate: false } : { values: dropped, negate: true };
      if (buyerScope.values.length > MAX_RAW_LIST) return null;
    }
    const simple = !buyerScope && !f.supplier && !exclusions.some(e => e.kind === 'supplier') && !f.from && !f.to && !f.minValue;
    const scoped = (params: Params) => filter(params, buyerScope);

    // 3. Totals and procurement types: from step 1's groups when the filter only uses their columns.
    let totals: { n: number; v: number; vn: number; p: number }, typeRows: { raw: Raw; n: number; v: number }[];
    if (simple) {
      const included = groups.filter(g => allowedCurrency.includes(g.c) && typeAllowed(g.t) && (f.includePlaceholders || !placeholder(g)) && (f.includeFuture || g.fu !== 1));
      totals = included.reduce((t, g) => ({ n: t.n + Number(g.n), v: t.v + Number(g.v ?? 0), vn: t.vn + Number(g.vn), p: t.p + Number(g.p ?? 0) }), { n: 0, v: 0, vn: 0, p: 0 });
      typeRows = included.map(g => ({ raw: g.t, n: Number(g.n), v: Number(g.v ?? 0) }));
    } else {
      const params = new Params();
      const [row] = await query(`SELECT count(*) AS n, sum(${NUM}) AS v, count(${NUM}) AS vn, sum(${POS}) AS p FROM records WHERE ${scoped(params)}`, params);
      totals = { n: Number(row?.n ?? 0), v: Number(row?.v ?? 0), vn: Number(row?.vn ?? 0), p: Number(row?.p ?? 0) };
      const typeParams = new Params();
      const rows = await query(`SELECT ${TYPE} AS t, count(*) AS n, sum(${NUM}) AS v FROM records WHERE ${scoped(typeParams)} GROUP BY t LIMIT 200`, typeParams);
      if (rows.length >= 200) return null;
      typeRows = rows.map(r => ({ raw: r.t, n: Number(r.n), v: Number(r.v ?? 0) }));
    }
    const typeRanks = new Map<string, Ranked>();
    for (const row of typeRows) { const name = typeOf(row.raw), entry = typeRanks.get(name) ?? { name, count: 0, value: 0 }; entry.count += row.n; entry.value += row.v; typeRanks.set(name, entry); }
    const rank = (map: Map<string, Ranked>) => [...map.values()].sort((a, b) => b.value - a.value || a.name.localeCompare(b.name));

    // 4. Suppliers by positive value: the top 200, then value bands until the one that reaches 80% (see `overview`).
    const T = totals.p;
    const supplierTotals = (params: Params) => `SELECT ${supplierKey(params)} AS k, sum(${POS}) AS p FROM records WHERE ${scoped(params)} GROUP BY k`;
    const topParams = new Params();
    const top = (await query(`${supplierTotals(topParams)} ORDER BY p DESC, k LIMIT 200`, topParams)).map(r => Number(r.p ?? 0));
    const top10Share = top.slice(0, 10).reduce((n, p) => n + (T > 0 ? p / T : 0), 0);
    let supplierCount = top.length, suppliersFor80: number | null = null, cumulative = 0, ranked = 0;
    const add = (p: number, times = 1) => { for (let i = 0; i < times; i++) { cumulative += p; ranked++; if (T > 0 && suppliersFor80 === null && cumulative / T >= .8) suppliersFor80 = ranked; } };
    for (const p of top) add(p);
    if (top.length === 200) {
      // One row per band of the remaining suppliers. A band is refined until it holds at most 200 suppliers.
      const floor = top[199], one = `FROM records one, (`, close = `) g WHERE one.id=(SELECT min(id) FROM records)`;
      const bands = async (path: { width: number; band: number }[], width: number) => {
        const params = new Params(), inner = supplierTotals(params);
        const within = path.map(b => `CAST(g.p/${params.ref(b.width)} AS INTEGER)=${params.ref(b.band)}`);
        return query(`SELECT CASE WHEN g.p>=${params.ref(floor)} THEN -1 ELSE CAST(g.p/${params.ref(width)} AS INTEGER) END AS b, count(*) AS n, sum(g.p) AS s, min(g.p) AS lo, max(g.p) AS hi ${one}${inner}${close}${within.length ? ' AND ' + within.join(' AND ') : ''} GROUP BY b ORDER BY b DESC`, params);
      };
      const values = async (path: { width: number; band: number }[]) => {
        const params = new Params(), inner = supplierTotals(params);
        const within = path.map(b => `CAST(g.p/${params.ref(b.width)} AS INTEGER)=${params.ref(b.band)}`).join(' AND ');
        return (await query(`SELECT g.p AS p ${one}${inner}${close} AND g.p<${params.ref(floor)} AND ${within} ORDER BY g.p DESC LIMIT 200`, params)).map(r => Number(r.p));
      };
      const width = floor > 0 ? floor / 100 : 1;
      const first = await bands([], width);
      supplierCount = first.reduce((n, b) => n + Number(b.n), 0);
      const ties = Number(first.find(b => Number(b.b) === -1)?.n ?? 0) - 200;
      add(floor, Math.max(0, ties));
      // Walk bands from the largest values down; only the band that reaches 80% is read in detail.
      const walk = async (rows: any[], path: { width: number; band: number }[], width: number): Promise<void> => {
        if (path.length > 6) throw new SummaryLimit();
        for (const band of rows.filter(b => Number(b.b) !== -1)) {
          if (suppliersFor80 !== null || T <= 0) return;
          const n = Number(band.n), sum = Number(band.s);
          // A band that clearly stays below 80% is added whole; the margin absorbs summation-order rounding.
          if ((cumulative + sum) / T < .8 - 1e-9) { cumulative += sum; ranked += n; continue; }
          const next = [...path, { width, band: Number(band.b) }];
          if (Number(band.lo) === Number(band.hi)) add(Number(band.lo), n);
          else if (n <= 200) for (const p of await values(next)) add(p);
          else await walk(await bands(next, width / 100), next, width / 100);
        }
      };
      await walk(first, [], width);
    }

    // 5. Median of the valued awards (`quantile` in model.ts).
    let median: number | null = null;
    if (totals.vn > 0) {
      const position = (totals.vn - 1) * .5, base = Math.floor(position), params = new Params();
      const rows = (await query(`SELECT ${NUM} AS v FROM records WHERE ${scoped(params)} AND ${VALUE}=${VALUE}+0 ORDER BY v LIMIT 2 OFFSET ${params.ref(base)}`, params)).map(r => Number(r.v));
      const low = rows[0], high = position > base ? rows[1] : rows[0];
      median = low + (high - low) * (position - base);
    }
    return { count: totals.n, value: totals.v, valuedCount: totals.vn, positiveTotal: T, median, buyerCount: buyerRanks.size, supplierCount, top10Share, suppliersFor80, buyers: rank(buyerRanks), types: rank(typeRanks) };
  } catch (error) { if (error instanceof SummaryLimit) return null; throw error; }
}
class SummaryLimit extends Error {}
