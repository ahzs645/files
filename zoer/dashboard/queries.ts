import { host } from './bridge';
import { queryModel, type Model } from './model';
const field = (name: string) => `json_extract(data, '$.${name}')`;
async function sql(statement: string, parameters: (string | number)[] = []) {
  return (await host('catalog.query', { statement, parameters })).rows as any[];
}
const opportunityFields = ['sourceKey','processId','opportunityId','description','status','type','issuedBy','closingDate','detailUrl','starred','commodities'];
const awardFields = ['importKey','_id','opportunityId','opportunityDescription','opportunityType','issuingOrganization','issuingLocation','contractNumber','contactEmail','contractContactEmail','contractValue','contractValueText','currency','successfulSupplier','supplierAddress','awardDate','justification','sourceUrl','starred','createdAt','updatedAt','sourceFileName'];
export async function readAll(kind: 'opportunity' | 'award', starredOnly = false) {
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
let analysis: { revision: number; promise: Promise<any[]> } | undefined;
export async function queryCatalog(name: string, args: any, model: Model, revision: number): Promise<any> {
  if (name.startsWith('contractAwardsAnalysis.')) {
    if (!analysis || analysis.revision !== revision) {
      const promise = readAll('award'); analysis = { revision, promise };
      void promise.catch(() => { if (analysis?.promise === promise) analysis = undefined; });
    }
    const awards = await analysis.promise;
    for (const row of awards) model.stars.set('award:' + row.importKey, row.starred === true);
    return queryModel({ ...model, awards }, name, args);
  }
  if(name === 'catalog.facets') {
    if(!['opportunity','award'].includes(args.kind))throw new Error('Unknown catalog kind.');
    const keys=args.kind==='award'?{organizations:'issuingOrganization',types:'opportunityType'}:{organizations:'issuedBy',statuses:'status',types:'type'};
    return Object.fromEntries(await Promise.all(Object.entries(keys).map(async([label,key])=>{
      const values:string[]=[];let after='';
      while(true){const rows=await sql(`SELECT DISTINCT ${field(key)} AS value FROM records WHERE kind=? AND ${field(key)} > ? ORDER BY value LIMIT 200`,[args.kind,after]);values.push(...rows.map(r=>String(r.value)));if(rows.length<200)break;after=values.at(-1)!;}
      return [label,values];
    })));
  }
  if (name === 'dashboard.summary') {
    const [counts, statuses, types] = await Promise.all([
      sql(`SELECT count(*) AS total, sum(CASE WHEN lower(${field('status')}) LIKE '%open%' THEN 1 ELSE 0 END) AS open, sum(CASE WHEN julianday(${field('closingDate')}) BETWEEN julianday(?) AND julianday(?) THEN 1 ELSE 0 END) AS closingSoon, count(DISTINCT CASE WHEN ${field('issuedBy')} <> '' THEN ${field('issuedBy')} END) AS organizations FROM records WHERE kind='opportunity'`, [new Date().toISOString(), new Date(Date.now()+7*86400000).toISOString()]),
      sql(`SELECT DISTINCT ${field('status')} AS value FROM records WHERE kind='opportunity' AND ${field('status')} <> '' ORDER BY value`),
      sql(`SELECT DISTINCT ${field('type')} AS value FROM records WHERE kind='opportunity' AND ${field('type')} <> '' ORDER BY value`),
    ]);
    return { ...counts[0], open: counts[0].open ?? 0, closingSoon: counts[0].closingSoon ?? 0, statusOptions: statuses.map(row => row.value), typeOptions: types.map(row => row.value) };
  }
  if (name === 'opportunities.getByProcessId') {
    const result = await host('catalog.read', { match: { kind: 'opportunity', field: 'processId', value: args.processId }, limit: 1 });
    if (result.records.length) return result.records[0].data;
    return (await host('catalog.read', { ids: ['opportunity:' + args.processId] })).records[0]?.data ?? null;
  }
  if (name === 'contractAwards.summary') {
    const [counts, latest] = await Promise.all([
      sql(`SELECT count(*) AS total, count(DISTINCT CASE WHEN ${field('issuingOrganization')} <> '' THEN ${field('issuingOrganization')} END) AS organizations, count(DISTINCT CASE WHEN ${field('successfulSupplier')} <> '' THEN ${field('successfulSupplier')} END) AS suppliers FROM records WHERE kind='award'`),
      sql(`SELECT ${field('updatedAt')} AS latestImportAt, ${field('sourceFileName')} AS latestImportFile FROM records WHERE kind='award' ORDER BY ${field('updatedAt')} DESC LIMIT 1`),
    ]);
    return { ...counts[0], latestImportAt: null, latestImportFile: null, ...latest[0] };
  }
  const kind = name === 'opportunities.list' ? 'opportunity' : name === 'contractAwards.list' ? 'award' : args.kind;
  if (['opportunities.list', 'contractAwards.list', 'catalog.rows', 'catalog.count'].includes(name)) {
    if (!['award', 'opportunity'].includes(kind)) throw new Error('Unknown catalog kind.');
    const fields = kind === 'award' ? awardFields : opportunityFields;
    const numeric = new Set(['contractValue','starred','createdAt','updatedAt']);
    const column = (key:string) => { if (!fields.includes(key)) throw new Error('Unknown table column.'); return numeric.has(key) ? `CAST(${field(key)} AS REAL)` : field(key); };
    const where = ['kind=?'], params: (string | number)[] = [kind];
    if (args.starredOnly) where.push(`${field('starred')}=1`);
    for (const key of ['status','type','issuedBy']) if (args[key]) { where.push(`${field(kind==='award'&&key==='type'?'opportunityType':key)}=?`); params.push(args[key]); }
    if(args.organization){where.push(`${field(kind==='award'?'issuingOrganization':'issuedBy')}=?`);params.push(args.organization);}
    if (args.closingBefore) { where.push(`coalesce(${field('closingDate')}, '') <= ?`); params.push(args.closingBefore); }
    if (args.search?.trim()) {
      const keys = kind === 'award' ? ['searchText','opportunityDescription','contractNumber','successfulSupplier','issuingOrganization'] : ['searchText','description','opportunityId','issuedBy'];
      where.push(`lower(${keys.map(key => `coalesce(${field(key)}, '')`).join(" || ' ' || ")}) LIKE ? ESCAPE '\\'`);
      params.push('%' + args.search.trim().toLowerCase().replace(/[\\%_]/g, (c: string) => '\\' + c) + '%');
    }
    if (args.filters !== undefined && (!Array.isArray(args.filters) || args.filters.length > 12)) throw new Error('Use at most 12 filters.');
    for (const filter of args.filters ?? []) {
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
    const count = sql(`SELECT count(*) AS total FROM records WHERE ${clause}`, params);
    if (name === 'catalog.count') return (await count)[0];
    const limit = Math.max(1, Math.min(200, Math.floor(Number(args.limit) || 50))), offset = Math.max(0, Math.floor(Number(args.cursor) || 0));
    const order = args.sort ? `${column(args.sort.id)} IS NULL, ${column(args.sort.id)} ${args.sort.desc === true ? 'DESC' : 'ASC'}, id` : kind === 'award' ? `${field('awardDate')} DESC, id` : `coalesce(${field('closingDate')}, '9999'), ${field('description')}, id`;
    const [items, totals] = await Promise.all([
      sql(`SELECT id AS catalogId, ${fields.map(key => `${field(key)} AS "${key}"`).join(', ')} FROM records WHERE ${clause} ORDER BY ${order} LIMIT ? OFFSET ?`, [...params, limit, offset]), count,
    ]);
    // SQLite JSON booleans arrive as integers. Preserve the preference adapter's boolean contract.
    for (const row of items) {
      row.starred = row.starred === 1 || row.starred === true;
      if (kind === 'opportunity') row.commodities = typeof row.commodities === 'string' ? JSON.parse(row.commodities) : row.commodities ?? [];
    }
    return { items, total: totals[0].total, nextCursor: offset+limit<totals[0].total ? String(offset+limit) : null, hasMore: offset+limit<totals[0].total };
  }
  return queryModel(model, name, args);
}
