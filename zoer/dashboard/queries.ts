import { buyerQuery, isBuyerColumn } from './buyer-query';
import { bcDate } from './bc-date';
import { BUYER_MAPPING_VERSION, annotateBuyerRecord, resolveBuyer, isBuyerLevel } from './market/buyers';
import { host } from './bridge';
import { queryModel, type Model } from './model';
const field = (name: string) => `json_extract(data, '$.${name}')`;
async function sql(statement: string, parameters: (string | number)[] = []) {
  return (await host('catalog.query', { statement, parameters })).rows as any[];
}
const opportunityFields = ['sourceKey','processId','opportunityId','description','status','type','issuedBy','closingDate','detailUrl','starred','commodities'];
const awardFields = ['importKey','_id','opportunityId','opportunityDescription','opportunityType','issuingOrganization','issuingLocation','contractNumber','contactEmail','contractContactEmail','contractValue','contractValueText','currency','successfulSupplier','supplierAddress','awardDate','justification','sourceUrl','starred','createdAt','updatedAt','sourceFileName'];
export async function readAll(kind: 'opportunity' | 'award', starredOnly = false, live = false) {
  if (live) {
    // A finite keyset export of saved records. Each row is read once; concurrent
    // updates may appear in a later export. This is deliberately not a snapshot.
    const bounds = await sql('SELECT max(id) AS last FROM records WHERE kind=?', [kind]);
    const last = bounds[0]?.last;
    if (!last) return [];
    const rows: any[] = [];
    let after = '';
    while (after < last) {
      const page = await sql('SELECT id, data FROM records WHERE kind=? AND id>? AND id<=? ORDER BY id LIMIT 50', [kind, after, last]);
      if (!page.length) break;
      for (const row of page) { const data = JSON.parse(row.data); if (!starredOnly || data.starred) rows.push(data); }
      after = page.at(-1).id;
    }
    return rows;
  }
  const head = await host('catalog.read', { ids: [] });
  const rows: any[] = [];
  let after: string | null = '';
  do {
    const page = await host('catalog.read', { kind, after, revision: head.revision, limit: 200 });
    rows.push(...page.records.filter((row: any) => !starredOnly || row.data.starred).map((row: any) => row.data));
    after = page.next;
  } while (after);
  // A changing catalog fails explicitly, rather than exporting a mixed snapshot.
  await host('catalog.read', { ids: [], revision: head.revision });
  return rows;
}
// Compact source-name inventory, shared by facets, counts and mapped SQL predicates.
const buyerInventories = new Map<string, { revision: number; promise: Promise<string[]> }>();
async function buyerSources(kind: 'award' | 'opportunity', revision: number): Promise<string[]> {
  const cached = buyerInventories.get(kind); if (cached?.revision === revision) return cached.promise;
  const promise = (async () => {
    await host('catalog.read', { ids: [], revision });
    const expression = `coalesce(${field(kind === 'award' ? 'issuingOrganization' : 'issuedBy')}, '')`;
    const values: string[] = []; let after: string | undefined;
    while (true) {
      const rows = await sql(`SELECT DISTINCT ${expression} AS value FROM records WHERE kind=?${after === undefined ? '' : ` AND ${expression}>?`} ORDER BY value LIMIT 200`, after === undefined ? [kind] : [kind, after]);
      values.push(...rows.map(r => String(r.value))); if (rows.length < 200) break; after = values.at(-1)!;
    }
    await host('catalog.read', { ids: [], revision }); return values;
  })();
  buyerInventories.set(kind, { revision, promise });
  void promise.catch(() => { if (buyerInventories.get(kind)?.promise === promise) buyerInventories.delete(kind); });
  return promise;
}
// Keep one revision in memory. Overview, drilldowns and search share both the
// pending snapshot and a bounded set of calculated results; failures are evicted.
let analysis: { revision: number; promise: Promise<any[]>; results: Map<string, Promise<any>> } | undefined;
const analysisFields = ['importKey','opportunityId','opportunityDescription','opportunityType','issuingOrganization','issuingLocation','contractNumber','contactEmail','contractValue','contractValueText','currency','successfulSupplier','supplierAddress','awardDate','justification','starred','createdAt','updatedAt','sourceFileName','sourceUrl'];
async function readAnalysis(revision: number) {
  await host('catalog.read', { ids: [], revision });
  const total = Number((await sql("SELECT count(*) AS total FROM records WHERE kind='award'"))[0].total);
  const pages: any[][] = [];
  const pageSize = 200;
  let nextOffset = 0;
  let failed = false;
  // Four bounded readers, within the bridge budget. SQL projects only the fields
  // used by the original analysis helpers, omitting redundant search/raw data.
  await Promise.all(Array.from({ length: Math.min(4, Math.ceil(total / pageSize)) }, async () => {
    while (!failed && nextOffset < total) {
      const offset = nextOffset;
      nextOffset += pageSize;
      try {
        const page = await sql(`SELECT ${analysisFields.map(key => `${field(key)} AS "${key}"`).join(', ')} FROM records WHERE kind='award' ORDER BY id LIMIT ? OFFSET ?`, [pageSize, offset]);
        if (page.length !== Math.min(pageSize, total - offset)) throw new Error('Catalog changed; reload the snapshot.');
        for (const row of page) row.starred = row.starred === 1 || row.starred === true;
        pages[offset / pageSize] = page;
      } catch (error) { failed = true; throw error; }
    }
  }));
  // Never publish mixed revisions, even if a scrape/import changes an earlier page.
  await host('catalog.read', { ids: [], revision });
  return pages.flat();
}
function analysisKey(name: string, args: any) {
  return JSON.stringify([BUYER_MAPPING_VERSION, name, new Date().toISOString().slice(0, 10), args], (_key, value) =>
    value && typeof value === 'object' && !Array.isArray(value)
      ? Object.fromEntries(Object.keys(value).sort().map(key => [key, value[key]])) : value);
}
export async function queryCatalog(name: string, args: any, model: Model, revision: number): Promise<any> {
  if (name.startsWith('contractAwardsAnalysis.')) {
    if (!analysis || analysis.revision !== revision) {
      const promise = readAnalysis(revision);
      analysis = { revision, promise, results: new Map() };
      void promise.catch(() => { if (analysis?.promise === promise) analysis = undefined; });
    }
    const entry = analysis;
    const key = analysisKey(name, args);
    const cached = entry.results.get(key);
    if (cached) return cached;
    const result = entry.promise.then(awards => {
      for (const row of awards) model.stars.set('award:' + row.importKey, row.starred === true);
      return queryModel({ ...model, awards }, name, args);
    });
    entry.results.set(key, result);
    if (entry.results.size > 32) entry.results.delete(entry.results.keys().next().value!);
    void result.catch(() => { if (entry.results.get(key) === result) entry.results.delete(key); });
    return result;
  }
  if(name === 'catalog.facets') {
    if(!['opportunity','award'].includes(args.kind))throw new Error('Unknown catalog kind.');
    const level = args.buyerLevel ?? 'organization'; if (!isBuyerLevel(level)) throw Error('Unknown buyer grouping.');
    const sources = await buyerSources(args.kind, revision);
    const organizations = [...new Set(sources.map(source => resolveBuyer(source).dimensions[level]))].sort((a,b)=>a.localeCompare(b));
    const keys=args.kind==='award'?{types:'opportunityType'}:{statuses:'status',types:'type'};
    return { organizations, ...Object.fromEntries(await Promise.all(Object.entries(keys).map(async([label,key])=>{
      const values:string[]=[];let after='';
      while(true){const rows=await sql(`SELECT DISTINCT ${field(key)} AS value FROM records WHERE kind=? AND ${field(key)} > ? ORDER BY value LIMIT 200`,[args.kind,after]);values.push(...rows.map(r=>String(r.value)));if(rows.length<200)break;after=values.at(-1)!;}
      return [label,values];
    }))) };
  }
  if (name === 'dashboard.summary') {
    const [counts, statuses, types] = await Promise.all([
      sql(`SELECT count(*) AS total, sum(CASE WHEN lower(${field('status')}) LIKE '%open%' THEN 1 ELSE 0 END) AS open, sum(CASE WHEN julianday(${field('closingDate')}) BETWEEN julianday(?) AND julianday(?) THEN 1 ELSE 0 END) AS closingSoon, count(DISTINCT CASE WHEN ${field('issuedBy')} <> '' THEN ${field('issuedBy')} END) AS organizations FROM records WHERE kind='opportunity'`, [bcDate(), bcDate(Date.now(), 7)]),
      sql(`SELECT DISTINCT ${field('status')} AS value FROM records WHERE kind='opportunity' AND ${field('status')} <> '' ORDER BY value`),
      sql(`SELECT DISTINCT ${field('type')} AS value FROM records WHERE kind='opportunity' AND ${field('type')} <> '' ORDER BY value`),
    ]);
    const sources = await buyerSources('opportunity', revision);
    return { ...counts[0], organizations: new Set(sources.map(s => resolveBuyer(s).organization)).size, originalOrganizations: sources.length, buyerMappingVersion: BUYER_MAPPING_VERSION, open: counts[0].open ?? 0, closingSoon: counts[0].closingSoon ?? 0, statusOptions: statuses.map(row => row.value), typeOptions: types.map(row => row.value) };
  }
  if (name === 'opportunities.getByProcessId') {
    const result = await host('catalog.read', { match: { kind: 'opportunity', field: 'processId', value: args.processId }, limit: 1 });
    if (result.records.length) return annotateBuyerRecord(result.records[0].data, 'opportunity');
    const row = (await host('catalog.read', { ids: ['opportunity:' + args.processId] })).records[0]?.data;
    return row ? annotateBuyerRecord(row, 'opportunity') : null;
  }
  if (name === 'contractAwards.summary') {
    const [counts, latest] = await Promise.all([
      sql(`SELECT count(*) AS total, count(DISTINCT CASE WHEN ${field('issuingOrganization')} <> '' THEN ${field('issuingOrganization')} END) AS organizations, count(DISTINCT CASE WHEN ${field('successfulSupplier')} <> '' THEN ${field('successfulSupplier')} END) AS suppliers FROM records WHERE kind='award'`),
      sql(`SELECT ${field('updatedAt')} AS latestImportAt, ${field('sourceFileName')} AS latestImportFile FROM records WHERE kind='award' ORDER BY ${field('updatedAt')} DESC LIMIT 1`),
    ]);
    const sources = await buyerSources('award', revision);
    return { ...counts[0], organizations: new Set(sources.map(s => resolveBuyer(s).organization)).size, originalOrganizations: sources.length, buyerMappingVersion: BUYER_MAPPING_VERSION, latestImportAt: null, latestImportFile: null, ...latest[0] };
  }
  const kind = name === 'opportunities.list' ? 'opportunity' : name === 'contractAwards.list' ? 'award' : args.kind;
  if (['opportunities.list', 'contractAwards.list', 'catalog.rows', 'catalog.count'].includes(name)) {
    if (!['award', 'opportunity'].includes(kind)) throw new Error('Unknown catalog kind.');
    const level = args.buyerLevel ?? 'organization'; if (!isBuyerLevel(level)) throw Error('Unknown buyer grouping.');
    if (args.filters !== undefined && (!Array.isArray(args.filters) || args.filters.length > 12)) throw new Error('Use at most 12 filters.');
    const needsMapping = !!args.organization || !!args.search?.trim() || isBuyerColumn(args.sort?.id ?? '') || args.filters?.some((f: any) => isBuyerColumn(f.column));
    const mapped = needsMapping ? buyerQuery(await buyerSources(kind, revision), kind, level, args) : undefined;
    const from = mapped?.from ?? 'records';
    const fields = kind === 'award' ? awardFields : opportunityFields;
    const numeric = new Set(['contractValue','starred','createdAt','updatedAt']);
    const column = (key:string) => { if (!fields.includes(key)) throw new Error('Unknown table column.'); return numeric.has(key) ? `CAST(${field(key)} AS REAL)` : field(key); };
    const where = ['kind=?'], params: (string | number)[] = [kind];
    if (args.starredOnly) where.push(`${field('starred')}=1`);
    // Status and type accept one value or a list (multi-select); issuedBy stays a single value.
    for (const key of ['status','type','issuedBy']) { const values = (Array.isArray(args[key]) ? args[key] : [args[key]]).filter((value: unknown): value is string => typeof value === 'string' && value !== ''); if (values.length) { where.push(`${field(kind==='award'&&key==='type'?'opportunityType':key)} IN (${values.map(() => '?').join(',')})`); params.push(...values); } }
    if(mapped?.filter) where.push(mapped.filter);
    if (args.closingBefore) { where.push(`coalesce(${field('closingDate')}, '') <= ?`); params.push(args.closingBefore); }
    if (args.search?.trim()) {
      const keys = kind === 'award' ? ['searchText','opportunityDescription','contractNumber','successfulSupplier','issuingOrganization'] : ['searchText','description','opportunityId','issuedBy'];
      where.push(`CASE WHEN lower(${keys.map(key => `coalesce(${field(key)}, '')`).join(" || ' ' || ")}) LIKE ? ESCAPE '\\' THEN 1${mapped ? ` WHEN ${mapped.search} THEN 1` : ''} ELSE 0 END=1`);
      params.push('%' + args.search.trim().toLowerCase().replace(/[\\%_]/g, (c: string) => '\\' + c) + '%');
    }
    if (args.filters !== undefined && (!Array.isArray(args.filters) || args.filters.length > 12)) throw new Error('Use at most 12 filters.');
    for (const filter of args.filters ?? []) {
      if (isBuyerColumn(filter.column)) continue;
      const expression = column(filter.column);
      const value = (raw:unknown) => {
        if(typeof raw !== 'string' && typeof raw !== 'number') throw new Error('Invalid filter value.');
        if(String(raw).length > 10000) throw new Error('Filter value is too long.');
        if(numeric.has(filter.column)) {
          const number = raw === 'true' ? 1 : raw === 'false' ? 0 : Number(raw);
          if(!Number.isFinite(number)) throw new Error('Use a number for this column.');
          return number;
        }
        return raw;
      };
      if(filter.operator === 'null' || filter.operator === 'not-null') where.push(`${expression} IS ${filter.operator === 'null' ? '' : 'NOT '}NULL`);
      else if(filter.operator === 'in') {
        if(!Array.isArray(filter.values) || !filter.values.length || filter.values.length > 50) throw new Error('Choose between 1 and 50 filter values.');
        where.push(`${expression} IN (${filter.values.map(()=>'?').join(',')})`);params.push(...filter.values.map(value));
      } else if(filter.operator === 'contains') {
        where.push(`lower(CAST(${expression} AS TEXT)) LIKE ? ESCAPE '\\'`);
        params.push('%'+String(value(filter.value)).toLowerCase().replace(/[\\%_]/g,c=>'\\'+c)+'%');
      } else {
        const op = ({equals:'=',gte:'>=',lte:'<='} as Record<string,string>)[filter.operator];
        if(!op) throw new Error('Unsupported filter condition.');
        where.push(`${expression} ${op} ?`);params.push(value(filter.value));
      }
    }
    const clause = where.join(' AND ');
    const queryParams = mapped ? [mapped.parameter, ...params] : params;
    const count = sql(`SELECT count(*) AS total FROM ${from} WHERE ${clause}`, queryParams);
    if (name === 'catalog.count') { const result = (await count)[0]; if (mapped) await host('catalog.read', { ids: [], revision }); return result; }
    const limit = Math.max(1, Math.min(200, Math.floor(Number(args.limit) || 50))), offset = Math.max(0, Math.floor(Number(args.cursor) || 0));
    const order = mapped?.order ?? (args.sort ? `${column(args.sort.id)} IS NULL, ${column(args.sort.id)} ${args.sort.desc === true ? 'DESC' : 'ASC'}, id` : kind === 'award' ? `${field('awardDate')} DESC, id` : `coalesce(${field('closingDate')}, '9999'), ${field('description')}, id`);
    const [items, totals] = await Promise.all([
      sql(`SELECT id AS catalogId, ${fields.map(key => `${field(key)} AS "${key}"`).join(', ')} FROM ${from} WHERE ${clause} ORDER BY ${order} LIMIT ? OFFSET ?`, [...queryParams, limit, offset]), count,
    ]);
    // SQLite JSON booleans arrive as integers. Preserve the preference adapter's boolean contract.
    for (const row of items) {
      row.starred = row.starred === 1 || row.starred === true;
      if (kind === 'opportunity') row.commodities = typeof row.commodities === 'string' ? JSON.parse(row.commodities) : row.commodities ?? [];
    }
    if (mapped) await host('catalog.read', { ids: [], revision });
    return { items: items.map(row => annotateBuyerRecord(row, kind, level)), total: totals[0].total, nextCursor: offset+limit<totals[0].total ? String(offset+limit) : null, hasMore: offset+limit<totals[0].total };
  }
  return queryModel(model, name, args);
}

export function resetCatalogCache() { buyerInventories.clear(); analysis = undefined; }
