import { buyerQuery, isBuyerColumn } from './buyer-query';
import { BUYER_MAPPING_VERSION, annotateBuyerRecord, resolveBuyer, isBuyerLevel } from './market/buyers';
import { host } from './bridge';
import { queryModel, type Model } from './model';
import { zoneDate } from './procurement/deadline';
import { opportunityLifecycle } from './procurement/lifecycle';
import { canonicalNoticeSql } from './procurement/canonical';
import { collapseAwardDuplicates } from './procurement/award-duplicates';
import { OPEN_FIRST_ORDER, closingSql, deadlineTimeSql } from './procurement/catalog';
import { implausibleAwardOrder } from './award-dates';
import { AWARD_BASE, marketSummary, summarizeOverview, unmarkedDuplicates, type OverviewSummary, type Run } from './market/sql-summary';
const isBcBid = (row: any) => !row.sourceId || row.sourceId === 'bc-bid';
const field = (name: string) => `json_extract(data, '$.${name}')`;
// A record's home source. Records saved before multi-source support carry no sourceId.
// CASE instead of nullif(): the catalog console only admits allowlisted functions.
const SOURCE_EXPRESSION = `CASE WHEN ${field('sourceId')} IS NULL OR ${field('sourceId')}='' THEN 'bc-bid' ELSE ${field('sourceId')} END`;
async function unscopedSql(statement: string, parameters: (string | number)[] = []) {
  return (await host('catalog.query', { statement, parameters })).rows as any[];
}
async function sql(statement: string, parameters: (string | number)[] = []) {
  // BC Bid's own tools (overview, exports, awards analysis) stay scoped to their source.
  statement = statement.replace(/\bWHERE\b/i, `WHERE CASE WHEN ${SOURCE_EXPRESSION}='bc-bid' THEN 1 ELSE 0 END=1 AND`);
  return unscopedSql(statement, parameters);
}
/** The shared grid's source scope: undefined/empty selects every source. */
function sourceScope(sources: unknown): string[] | undefined {
  if (sources === undefined) return undefined;
  if (!Array.isArray(sources) || sources.length > 20 || sources.some(value => typeof value !== 'string' || !value || value.length > 100)) throw new Error('Invalid source filter.');
  return sources.length ? sources : undefined;
}
const sourcePredicate = (sources: string[]) => `${SOURCE_EXPRESSION} IN (${sources.map(() => '?').join(',')})`;
const opportunityFields = ['sourceKey','processId','opportunityId','externalId','description','status','type','sourceId','issuedBy','closingDate','closingAt','detailUrl','starred','commodities'];
const awardFields = ['importKey','_id','opportunityId','opportunityDescription','opportunityType','sourceId','issuingOrganization','issuingLocation','contractNumber','contactEmail','contractContactEmail','contractValue','contractValueText','currency','successfulSupplier','supplierAddress','awardDate','justification','sourceUrl','starred','createdAt','updatedAt','sourceFileName'];
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
      for (const row of page) { const data = JSON.parse(row.data); if (isBcBid(data) && (!starredOnly || data.starred)) rows.push(data); }
      after = page.at(-1).id;
    }
    return rows;
  }
  const head = await host('catalog.read', { ids: [] });
  const rows: any[] = [];
  let after: string | null = '';
  do {
    const page = await host('catalog.read', { kind, after, revision: head.revision, limit: 200 });
    rows.push(...page.records.filter((row: any) => isBcBid(row.data) && (!starredOnly || row.data.starred)).map((row: any) => row.data));
    after = page.next;
  } while (after);
  // A changing catalog fails explicitly, rather than exporting a mixed snapshot.
  await host('catalog.read', { ids: [], revision: head.revision });
  return rows;
}
// Compact source-name inventory, shared by facets, counts and mapped SQL predicates.
const buyerInventories = new Map<string, { revision: number; promise: Promise<string[]> }>();
async function buyerSources(kind: 'award' | 'opportunity', revision: number, sources?: string[]): Promise<string[]> {
  const key = kind + '|' + (sources?.join(',') ?? '');
  const cached = buyerInventories.get(key); if (cached?.revision === revision) return cached.promise;
  const promise = (async () => {
    await host('catalog.read', { ids: [], revision });
    const expression = `coalesce(${field(kind === 'award' ? 'issuingOrganization' : 'issuedBy')}, '')`;
    const scope = sources ? ` AND ${sourcePredicate(sources)}` : '';
    const values: string[] = []; let after: string | undefined;
    while (true) {
      const rows = await unscopedSql(`SELECT DISTINCT ${expression} AS value FROM records WHERE kind=?${scope}${after === undefined ? '' : ` AND ${expression}>?`} ORDER BY value LIMIT 200`, [kind, ...(sources ?? []), ...(after === undefined ? [] : [after])]);
      values.push(...rows.map(r => String(r.value))); if (rows.length < 200) break; after = values.at(-1)!;
    }
    await host('catalog.read', { ids: [], revision }); return values;
  })();
  buyerInventories.set(key, { revision, promise });
  void promise.catch(() => { if (buyerInventories.get(key)?.promise === promise) buyerInventories.delete(key); });
  return promise;
}
// Shared reads: every caller of one key shares one promise. A caller that passes a signal stops waiting when it aborts,
// and the read itself stops once no caller waits for it (the user left the page). Failures and aborts are evicted.
type Shared<T> = { promise: Promise<T>; controller: AbortController; waiting: number; pinned: boolean; settled: boolean };
function share<T>(cache: Map<string, Shared<T>>, key: string, start: (signal: AbortSignal) => Promise<T>, signal?: AbortSignal): Promise<T> {
  let entry = cache.get(key);
  if (!entry) {
    const created: Shared<T> = { promise: undefined as unknown as Promise<T>, controller: new AbortController(), waiting: 0, pinned: false, settled: false };
    created.promise = start(created.controller.signal);
    created.promise.then(() => { created.settled = true; }, () => { created.settled = true; if (cache.get(key) === created) cache.delete(key); });
    cache.set(key, created); entry = created;
  }
  const e = entry;
  if (!signal) { e.pinned = true; return e.promise; }
  if (signal.aborted) return Promise.reject(signal.reason);
  e.waiting++;
  return new Promise<T>((resolve, reject) => {
    const done = () => { signal.removeEventListener('abort', abort); e.waiting--; };
    const abort = () => {
      done();
      if (!e.waiting && !e.pinned && !e.settled) { e.controller.abort(signal.reason); if (cache.get(key) === e) cache.delete(key); }
      reject(signal.reason);
    };
    signal.addEventListener('abort', abort, { once: true });
    e.promise.then(value => { if (signal.aborted) return; done(); resolve(value); }, error => { if (signal.aborted) return; done(); reject(error); });
  });
}
// One award snapshot per catalog revision: Overview's SQL figures, drilldowns and the other market views share it.
const snapshots = new Map<string, Shared<any[]>>();
let snapshotResults: { revision: number; results: Map<string, Promise<any>> } = { revision: -1, results: new Map() };
const summaries = new Map<string, Shared<any>>();
/** Rows read so far by the award snapshot the page is waiting for. */
let progress: { revision: number; read: number; total: number } | undefined;
const progressListeners = new Set<() => void>();
const emitProgress = () => { for (const listener of progressListeners) listener(); };
export function analysisProgress() { return progress; }
export function subscribeAnalysisProgress(listener: () => void) { progressListeners.add(listener); return () => { progressListeners.delete(listener); }; }
const analysisFields = ['duplicateOf','sourceId','importKey','opportunityId','opportunityDescription','opportunityType','issuingOrganization','issuingLocation','contractNumber','contactEmail','contractValue','contractValueText','currency','successfulSupplier','supplierAddress','awardDate','justification','starred','createdAt','updatedAt','sourceFileName','sourceUrl'];
/** Every BC Bid award, 200 at a time by rowid (keyset on SQLite's own key, so each page costs the same), reporting progress. */
async function readAnalysis(revision: number, signal: AbortSignal) {
  await host('catalog.read', { ids: [], revision });
  const total = Number((await sql("SELECT count(*) AS total FROM records WHERE kind='award'"))[0].total);
  const rows: any[] = []; let after = 0;
  progress = { revision, read: 0, total }; emitProgress();
  // SQL projects only the fields used by the analysis helpers, omitting redundant search/raw data.
  const statement = `SELECT rowid AS "rowKey", id AS "recordId", ${analysisFields.map(key => `${field(key)} AS "${key}"`).join(', ')} FROM records WHERE kind='award' AND rowid>? ORDER BY rowid LIMIT 200`;
  while (true) {
    signal.throwIfAborted();
    const page = await sql(statement, [after]);
    for (const row of page) { row.starred = row.starred === 1 || row.starred === true; rows.push(row); }
    if (progress?.revision === revision) { progress = { revision, read: rows.length, total: Math.max(total, rows.length) }; emitProgress(); }
    if (page.length < 200) break;
    const next = Number(page.at(-1).rowKey);
    if (!Number.isFinite(next) || next <= after) throw new Error('Award read did not advance; reload the analysis.');
    after = next;
  }
  for (const row of rows) delete row.rowKey;
  // Never publish mixed revisions, even if a scrape/import changes an earlier page.
  await host('catalog.read', { ids: [], revision });
  if (rows.length !== total) throw new Error('Catalog changed; reload the snapshot.');
  // One row per award (award-duplicates.ts): a repeated listing never doubles a total, marked or not yet marked.
  return collapseAwardDuplicates(rows, row => String(row.recordId));
}
function analysisKey(name: string, args: any) {
  return JSON.stringify([BUYER_MAPPING_VERSION, name, new Date().toISOString().slice(0, 10), args], (_key, value) =>
    value && typeof value === 'object' && !Array.isArray(value)
      ? Object.fromEntries(Object.keys(value).sort().map(key => [key, value[key]])) : value);
}
function readSnapshot(revision: number, signal?: AbortSignal) {
  for (const key of snapshots.keys()) if (key !== String(revision)) { const old = snapshots.get(key)!; if (!old.settled) old.controller.abort(); snapshots.delete(key); }
  return share(snapshots, String(revision), inner => readAnalysis(revision, inner), signal);
}
/** Unmarked repeats (market/sql-summary.ts `unmarkedDuplicates`) for one revision. Null: read every award instead. */
function repeats(revision: number, signal?: AbortSignal): Promise<string[] | null> {
  for (const key of summaries.keys()) if (!key.startsWith(revision + '|')) summaries.delete(key);
  return share(summaries, revision + '|repeats', inner => unmarkedDuplicates(unscopedSql, inner), signal);
}
/** Market › Overview from aggregate SQL (market/sql-summary.ts); the full snapshot only when SQL cannot be exact. */
async function overviewSummary(args: any, model: Model, revision: number, signal?: AbortSignal): Promise<OverviewSummary> {
  const today = new Date().toISOString().slice(0, 10);
  const run: Run = async (statement, parameters) => unscopedSql(statement, parameters);
  const compute = async (inner: AbortSignal) => {
    await host('catalog.read', { ids: [], revision });
    const exclude = await repeats(revision, inner);
    const summary = exclude && await marketSummary(run, args.filters ?? {}, today, { signal: inner, exclude });
    await host('catalog.read', { ids: [], revision });
    if (summary) return summary;
    const awards = await readSnapshot(revision, inner);
    return summarizeOverview(queryModel({ ...model, awards }, 'contractAwardsAnalysis.market', { ...args, view: 'overview' }));
  };
  for (const key of summaries.keys()) if (!key.startsWith(revision + '|')) summaries.delete(key);
  return share(summaries, revision + '|' + analysisKey('summary', args.filters ?? {}), compute, signal);
}
export interface CatalogOptions { signal?: AbortSignal }
export async function queryCatalog(name: string, args: any, model: Model, revision: number, options: CatalogOptions = {}): Promise<any> {
  if (name === 'contractAwardsAnalysis.market' && args?.view === 'overview') return overviewSummary(args, model, revision, options.signal);
  if (name === 'contractAwardsAnalysis.market' && args?.view === 'count') {
    for (const key of summaries.keys()) if (!key.startsWith(revision + '|')) summaries.delete(key);
    // Each award once, as in every Market figure: marked repeats are left out, and so are unmarked ones when known.
    return share(summaries, revision + '|count', async inner => {
      const exclude = await repeats(revision, inner), lookup = JSON.stringify(Object.fromEntries((exclude ?? []).map(id => [id, 1])));
      if (!exclude || lookup.length > 80_000 || exclude.some(id => /["\\\u0000-\u001f]/.test(id))) { const rows = await readSnapshot(revision, inner); return { total: rows.length, repeats: null }; }
      return { total: Number((await unscopedSql(`SELECT count(*) AS total FROM records WHERE ${AWARD_BASE} AND json_extract(?, '$."' || id || '"') IS NULL`, [lookup]))[0].total), repeats: exclude.length };
    }, options.signal);
  }
  if (name.startsWith('contractAwardsAnalysis.')) {
    const awards = readSnapshot(revision, options.signal);
    if (snapshotResults.revision !== revision) snapshotResults = { revision, results: new Map() };
    const entry = snapshotResults;
    const key = analysisKey(name, args);
    let result = entry.results.get(key);
    if (!result) {
      const computed = awards.then(rows => {
        for (const row of rows) model.stars.set('award:' + row.importKey, row.starred === true);
        return queryModel({ ...model, awards: rows }, name, args);
      });
      entry.results.set(key, computed);
      if (entry.results.size > 32) entry.results.delete(entry.results.keys().next().value!);
      void computed.catch(() => { if (entry.results.get(key) === computed) entry.results.delete(key); });
      result = computed;
    }
    return result;
  }
  if(name === 'catalog.facets') {
    if(!['opportunity','award'].includes(args.kind))throw new Error('Unknown catalog kind.');
    const level = args.buyerLevel ?? 'organization'; if (!isBuyerLevel(level)) throw Error('Unknown buyer grouping.');
    const scope = sourceScope(args.sources), scopeSql = scope ? ` AND ${sourcePredicate(scope)}` : '', scopeParams = scope ?? [];
    const sources = await buyerSources(args.kind, revision, scope);
    const organizations = [...new Set(sources.map(source => resolveBuyer(source).dimensions[level]))].sort((a,b)=>a.localeCompare(b));
    const sourceIds = await unscopedSql(`SELECT DISTINCT ${SOURCE_EXPRESSION} AS value FROM records WHERE kind=? ORDER BY value LIMIT 200`, [args.kind]);
    const keys=args.kind==='award'?{types:'opportunityType'}:{statuses:'status',types:'type'};
    return { organizations, sources: sourceIds.map(row=>String(row.value)), ...Object.fromEntries(await Promise.all(Object.entries(keys).map(async([label,key])=>{
      const values:string[]=[];let after='';
      while(true){const rows=await unscopedSql(`SELECT DISTINCT ${field(key)} AS value FROM records WHERE kind=?${scopeSql} AND ${field(key)} > ? ORDER BY value LIMIT 200`,[args.kind,...scopeParams,after]);values.push(...rows.map(r=>String(r.value)));if(rows.length<200)break;after=values.at(-1)!;}
      return [label,values];
    }))) };
  }
  if (name === 'dashboard.summary') {
    const asOf = typeof args.asOf === 'number' && Number.isFinite(args.asOf) ? args.asOf : Date.now();
    const countLifecycles = async () => {
      await host('catalog.read', { ids: [], revision });
      let after = '', total = 0, open = 0, closingSoon = 0;
      while (true) {
        // One row per notice (canonical.ts), judged by the effective lifecycle (lifecycle.ts).
        const rows = await sql(`SELECT id,${field('status')} status,${field('closingAt')} closingAt,${field('closingDate')} closingDate FROM records WHERE kind='opportunity' AND ${canonicalNoticeSql('', { crossSource: 'exclude' })} AND id>? ORDER BY id LIMIT 200`, [after]);
        for (const row of rows) { const lifecycle = opportunityLifecycle(row, asOf); total++; open += Number(lifecycle.open); closingSoon += Number(lifecycle.closingSoon); }
        if (rows.length < 200) break;
        const next = rows.at(-1)?.id;
        if (typeof next !== 'string' || next <= after) throw new Error('Opportunity summary did not advance; reload the catalog.');
        after = next;
      }
      await host('catalog.read', { ids: [], revision });
      return { total, open, closingSoon };
    };
    const [counts, statuses, types] = await Promise.all([
      countLifecycles(),
      sql(`SELECT DISTINCT ${field('status')} AS value FROM records WHERE kind='opportunity' AND ${field('status')} <> '' ORDER BY value`),
      sql(`SELECT DISTINCT ${field('type')} AS value FROM records WHERE kind='opportunity' AND ${field('type')} <> '' ORDER BY value`),
    ]);
    const sources = await buyerSources('opportunity', revision, ['bc-bid']);
    return { ...counts, organizations: new Set(sources.map(s => resolveBuyer(s).organization)).size, originalOrganizations: sources.length, buyerMappingVersion: BUYER_MAPPING_VERSION, open: counts.open, closingSoon: counts.closingSoon, statusOptions: statuses.map(row => row.value), typeOptions: types.map(row => row.value) };
  }
  if (name === 'opportunities.getByProcessId') {
    // Details resolve across every source: the shared grid lists them all.
    const result = await host('catalog.read', { match: { kind: 'opportunity', field: 'processId', value: args.processId }, limit: 1 });
    if (result.records.length) return annotateBuyerRecord(result.records[0].data, 'opportunity');
    const row = (await host('catalog.read', { ids: ['opportunity:' + args.processId] })).records[0]?.data;
    return row ? annotateBuyerRecord(row, 'opportunity') : null;
  }
  if (name === 'contractAwards.summary') {
    const [counts, latest] = await Promise.all([
      sql(`SELECT count(*) AS total, count(DISTINCT CASE WHEN ${field('issuingOrganization')} <> '' THEN ${field('issuingOrganization')} END) AS organizations, count(DISTINCT CASE WHEN ${field('successfulSupplier')} <> '' THEN ${field('successfulSupplier')} END) AS suppliers FROM records WHERE kind='award' AND ${canonicalNoticeSql()}`),
      sql(`SELECT ${field('updatedAt')} AS latestImportAt, ${field('sourceFileName')} AS latestImportFile FROM records WHERE kind='award' ORDER BY ${field('updatedAt')} DESC LIMIT 1`),
    ]);
    const sources = await buyerSources('award', revision, ['bc-bid']);
    return { ...counts[0], organizations: new Set(sources.map(s => resolveBuyer(s).organization)).size, originalOrganizations: sources.length, buyerMappingVersion: BUYER_MAPPING_VERSION, latestImportAt: null, latestImportFile: null, ...latest[0] };
  }
  const kind = name === 'opportunities.list' ? 'opportunity' : name === 'contractAwards.list' ? 'award' : args.kind;
  if (['opportunities.list', 'contractAwards.list', 'catalog.rows', 'catalog.count'].includes(name)) {
    if (!['award', 'opportunity'].includes(kind)) throw new Error('Unknown catalog kind.');
    const level = args.buyerLevel ?? 'organization'; if (!isBuyerLevel(level)) throw Error('Unknown buyer grouping.');
    if (args.filters !== undefined && (!Array.isArray(args.filters) || args.filters.length > 12)) throw new Error('Use at most 12 filters.');
    const scope = sourceScope(args.sources);
    const needsMapping = !!args.organization || !!args.search?.trim() || isBuyerColumn(args.sort?.id ?? '') || args.filters?.some((f: any) => isBuyerColumn(f.column));
    const mapped = needsMapping ? buyerQuery(await buyerSources(kind, revision, scope), kind, level, args) : undefined;
    const from = mapped?.from ?? 'records';
    const fields = kind === 'award' ? awardFields : opportunityFields;
    const numeric = new Set(['contractValue','starred','createdAt','updatedAt']);
    const column = (key:string) => { if (!fields.includes(key)) throw new Error('Unknown table column.'); return key === 'sourceId' ? SOURCE_EXPRESSION : numeric.has(key) ? `CAST(${field(key)} AS REAL)` : field(key); };
    const where = ['kind=?'], params: (string | number)[] = [kind];
    if (scope) { where.push(sourcePredicate(scope)); params.push(...scope); }
    if (args.starredOnly) where.push(`${field('starred')}=1`);
    // Documents: `downloaded` has at least one saved file; `pending` has attachment links but no saved file yet.
    if (args.documents !== undefined && !['', 'downloaded', 'pending'].includes(args.documents)) throw new Error('Unknown document filter.');
    const downloaded = "id IN (SELECT record_id FROM documents WHERE status='downloaded')";
    if (args.documents === 'downloaded') where.push(downloaded);
    if (args.documents === 'pending') where.push(`${field('attachments[0]')} IS NOT NULL AND NOT ${downloaded}`);
    if (args.upcoming) { where.push(`julianday(${field('closingDate')}) >= julianday(?)`); params.push(zoneDate()); } // Vancouver day; see dashboard.summary
    // Status and type accept one value or a list (multi-select); issuedBy stays a single value.
    for (const key of ['status','type','issuedBy']) { const values = (Array.isArray(args[key]) ? args[key] : [args[key]]).filter((value: unknown): value is string => typeof value === 'string' && value !== ''); if (values.length) { where.push(`${field(kind==='award'&&key==='type'?'opportunityType':key)} IN (${values.map(() => '?').join(',')})`); params.push(...values); } }
    if(mapped?.filter) where.push(mapped.filter);
    // The Opportunities list's shared filters, already parameterized by buildProcurementQuery.
    if (args.scope !== undefined) {
      if (typeof args.scope?.sql !== 'string' || !Array.isArray(args.scope.parameters)) throw new Error('Invalid table scope.');
      where.push(args.scope.sql); params.push(...args.scope.parameters);
    } else if (args.duplicates !== 'include') where.push(canonicalNoticeSql('', { crossSource: scope ? 'include' : 'exclude' })); // one row per notice/award (canonical.ts)
    if (args.closingBefore) { where.push(`coalesce(${field('closingDate')}, '') <= ?`); params.push(args.closingBefore); }
    if (args.search?.trim()) {
      const keys = kind === 'award' ? ['searchText','opportunityDescription','contractNumber','successfulSupplier','issuingOrganization'] : ['searchText','description','opportunityId','issuedBy','externalId','sourceKey','status','region'];
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
    const count = unscopedSql(`SELECT count(*) AS total FROM ${from} WHERE ${clause}`, queryParams);
    if (name === 'catalog.count') { const result = (await count)[0]; if (mapped) await host('catalog.read', { ids: [], revision }); return result; }
    const limit = Math.max(1, Math.min(200, Math.floor(Number(args.limit) || 50))), offset = Math.max(0, Math.floor(Number(args.cursor) || 0));
    // Notices order by their parsed deadline (`deadlineTime`, see deadlineTimeSql): by default open first, soonest closing
    // first, then unknown/free-text deadlines, then closed newest-closed first; the Closing date column sorts by that time.
    // Award dates past the plausible limit count as unknown, so a source typo (2107) never leads the list in either direction.
    const dated = kind === 'opportunity', closingSort = dated && ['closingDate', 'closingAt'].includes(args.sort?.id);
    const awardOrder = kind === 'award' ? `${implausibleAwardOrder(field('awardDate'))}, ` : '';
    const order = mapped?.order ?? (closingSort ? `deadlineTime IS NULL, deadlineTime ${args.sort.desc === true ? 'DESC' : 'ASC'}, id` : args.sort?.id === 'awardDate' ? `${awardOrder}${column('awardDate')} IS NULL, ${column('awardDate')} ${args.sort.desc === true ? 'DESC' : 'ASC'}, id` : args.sort ? `${column(args.sort.id)} IS NULL, ${column(args.sort.id)} ${args.sort.desc === true ? 'DESC' : 'ASC'}, id` : kind === 'award' ? `${awardOrder}${field('awardDate')} DESC, id` : `${OPEN_FIRST_ORDER}, ${field('description')}, id`);
    const [items, totals] = await Promise.all([
      unscopedSql(`SELECT id AS catalogId, ${fields.map(key => `${key === 'sourceId' ? SOURCE_EXPRESSION : field(key)} AS "${key}"`).join(', ')}${dated ? `, ${deadlineTimeSql(closingSql)} AS deadlineTime` : ''} FROM ${from} WHERE ${clause} ORDER BY ${order} LIMIT ? OFFSET ?`, [...queryParams, limit, offset]), count,
    ]);
    // SQLite JSON booleans arrive as integers. Preserve the preference adapter's boolean contract.
    for (const row of items) {
      row.starred = row.starred === 1 || row.starred === true; delete row.deadlineTime;
      if (kind === 'opportunity') row.commodities = typeof row.commodities === 'string' ? JSON.parse(row.commodities) : row.commodities ?? [];
    }
    if (mapped) await host('catalog.read', { ids: [], revision });
    return { items: items.map(row => annotateBuyerRecord(row, kind, level)), total: totals[0].total, nextCursor: offset+limit<totals[0].total ? String(offset+limit) : null, hasMore: offset+limit<totals[0].total };
  }
  return queryModel(model, name, args);
}

export function resetCatalogCache() {
  buyerInventories.clear();
  for (const entry of [...snapshots.values(), ...summaries.values()]) if (!entry.settled) entry.controller.abort();
  snapshots.clear(); summaries.clear(); snapshotResults = { revision: -1, results: new Map() }; progress = undefined; emitProgress();
}
