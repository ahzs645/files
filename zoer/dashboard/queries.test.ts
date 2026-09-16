import { validateCatalogSelect } from '../../../zoer/backend/src/catalog-reader';
import { test, expect, mock } from 'bun:test';
import { Database } from 'bun:sqlite';
const db = new Database(':memory:');
db.exec('CREATE TABLE records(id TEXT PRIMARY KEY,kind TEXT,data TEXT)');
let revision = 1;
let queryHook: ((input: any) => void | Promise<void>) | undefined;
const calls: any[] = [];
mock.module('./bridge', () => ({ host: async (method: string, input: any) => {
  calls.push({ method, input });
  if (method === 'catalog.query') { validateCatalogSelect(input.statement,input.parameters); await queryHook?.(input); return { rows: db.query(input.statement).all(...input.parameters) }; }
  if (method === 'catalog.read') {
    if (input.revision !== undefined && input.revision !== revision) throw Error('Catalog changed');
    const rows = input.ids ? input.ids.flatMap((id: string) => db.query('SELECT * FROM records WHERE id=?').all(id)) : db.query('SELECT * FROM records WHERE kind=? AND id>? ORDER BY id LIMIT ?').all(input.kind, input.after ?? '', input.limit ?? 200);
    return { primary: true, revision, records: rows.map((row: any) => ({ ...row, data: JSON.parse(row.data) })), next: !input.ids && rows.length ? (rows.at(-1) as any).id : null };
  }
  throw Error(method);
} }));
const { queryCatalog, readAll } = await import('./queries');
const model: any = { awards: [], opportunities: [], stars: new Map(), history: new Map(), runs: [] };
for (const kind of ['award','opportunity']) for (let i=0;i<413;i++) db.query('INSERT INTO records VALUES(?,?,?)').run(`${kind}:${String(i).padStart(4,'0')}`,kind,JSON.stringify({ sourceKey:String(i),importKey:String(i),description:i===410?"100%_unique' DROP;":`Item ${i}`,opportunityDescription:`Award ${i}`,status:'Open',type:'RFP',issuedBy:'Buyer',closingDate:new Date(Date.now()+86400000).toISOString(),awardDate:'2026-09-01',starred:i===410, detailFields:[{large:'detail'}] }));
test('dashboard only aggregates and pages visible summaries; literal hostile search and stars reach later records', async () => {
  calls.length=0;
  expect((await queryCatalog('dashboard.summary',{},model,1)).total).toBe(413);
  const first=await queryCatalog('opportunities.list',{limit:8},model,1);
  expect(first.items).toHaveLength(8); expect(first.total).toBe(413); expect(first.nextCursor).toBe('8');
  expect(first.items[0].detailFields).toBeUndefined();
  expect(calls.every(call=>call.method==='catalog.query'||(call.method==='catalog.read'&&call.input.ids?.length===0))).toBe(true);
  const search=await queryCatalog('opportunities.list',{search:"%_unique' DROP;"},model,1);
  expect(search.items.map((row:any)=>row.sourceKey)).toEqual(['410']);
  const starred=await queryCatalog('opportunities.list',{starredOnly:true},model,1);
  expect(starred.items[0].starred).toBe(true); expect(starred.total).toBe(1);
  const last=await queryCatalog('contractAwards.list',{cursor:'400',limit:100},model,1);
  expect(last.items).toHaveLength(13); expect(last.nextCursor).toBeNull();
});
test('full and starred exports include all pages and original details only when requested', async () => {
  calls.length=0;
  const all=await readAll('opportunity'); expect(all).toHaveLength(413); expect(all[0].detailFields).toEqual([{large:'detail'}]);
  expect(calls.filter(call=>call.input.kind==='opportunity')).toHaveLength(4);
  expect(await readAll('award',true)).toHaveLength(1);
  expect(calls.every(call=>call.method==='catalog.read')).toBe(true);
});
test('shared grid sorts the full dataset with stable pages, numeric values and safe column filters', async()=>{
  for(let i=0;i<413;i++)db.query("UPDATE records SET data=json_set(data,'$.contractValue',?,'$.contactEmail','public@example.test') WHERE id=?").run(String(i),`award:${String(i).padStart(4,'0')}`);
  const sorted=await queryCatalog('catalog.rows',{kind:'award',limit:10,sort:{id:'contractValue',desc:true}},model,1);
  expect(sorted.items[0].contactEmail).toBe('public@example.test');
  expect(sorted.items.map((r:any)=>r.importKey)).toEqual(Array.from({length:10},(_,i)=>String(412-i)));
  const next=await queryCatalog('catalog.rows',{kind:'award',limit:10,cursor:'10',sort:{id:'contractValue',desc:true}},model,1);
  expect(next.items[0].importKey).toBe('402');expect(new Set([...sorted.items,...next.items].map(r=>r.importKey)).size).toBe(20);
  const ascending=await queryCatalog('catalog.rows',{kind:'award',limit:10,sort:{id:'contractValue',desc:false}},model,1);
  expect(ascending.items.map((r:any)=>r.importKey)).toEqual(Array.from({length:10},(_,i)=>String(i)));
  const filtered=await queryCatalog('catalog.rows',{kind:'award',filters:[{column:'contractValue',operator:'gte',value:'410'}]},model,1);
  expect(filtered.total).toBe(3);
  const literal=await queryCatalog('catalog.rows',{kind:'opportunity',filters:[{column:'description',operator:'contains',value:"%_unique' DROP;"}]},model,1);
  expect(literal.items.map((r:any)=>r.sourceKey)).toEqual(['410']);
  const stars=await queryCatalog('catalog.rows',{kind:'award',filters:[{column:'starred',operator:'in',values:['true']}]},model,1);expect(stars.total).toBe(1);
  const ties=await queryCatalog('catalog.rows',{kind:'award',limit:10,sort:{id:'awardDate',desc:true}},model,1);expect(ties.items[0].importKey).toBe('0');
  await expect(queryCatalog('catalog.rows',{kind:'award',sort:{id:'contractValue); DROP TABLE records',desc:true}},model,1)).rejects.toThrow('Unknown table column');
  await expect(queryCatalog('catalog.rows',{kind:'award',filters:[{column:'contractValue',operator:'equals',value:'oops'}]},model,1)).rejects.toThrow('Use a number');
});
test('organization options include values beyond one catalog page and exact organization filtering uses the full table', async()=>{
  for(let i=0;i<413;i++)db.query("UPDATE records SET data=json_set(data,'$.issuedBy',?) WHERE id=?").run(`Buyer ${String(i).padStart(3,'0')}`,`opportunity:${String(i).padStart(4,'0')}`);
  revision++;
  const facets=await queryCatalog('catalog.facets',{kind:'opportunity'},model,revision);
  expect(facets.organizations).toHaveLength(413);expect(facets.organizations.at(-1)).toBe('Buyer 412');
  const result=await queryCatalog('catalog.rows',{kind:'opportunity',organization:'Buyer 410'},model,revision);expect(result.total).toBe(1);expect(result.items[0].sourceKey).toBe('410');
});
test('live exports keep full records without revision coupling to concurrent saves', async () => {
  calls.length=0;
  const rows=await readAll('opportunity',false,true);
  expect(rows).toHaveLength(413);
  expect(rows[0].detailFields).toEqual([{large:'detail'}]);
  expect(new Set(rows.map((r:any)=>r.sourceKey)).size).toBe(413);
  expect(calls.every(call=>call.method==='catalog.query' && call.input.revision===undefined)).toBe(true);
  expect(await readAll('award',true,true)).toHaveLength(1);
});

test('analysis shares bounded reads and calculated results; compact records preserve overview and profile semantics', async () => {
  const { queryModel } = await import('./model');
  const awards = Array.from({ length: 413 }, (_, i) => ({
    importKey: String(i), opportunityId: `OPP-${i}`, opportunityDescription: `Award ${i}`,
    opportunityType: i % 2 ? 'RFP' : 'RFQ', issuingOrganization: `Buyer ${i % 5}`,
    issuingLocation: 'Victoria', contractNumber: i % 3 ? `CN-${i}` : null, contactEmail: null,
    contractValue: i % 7 ? i * 100 : null, contractValueText: i % 7 ? String(i * 100) : '',
    currency: 'CAD', successfulSupplier: i % 10 ? `Supplier ${i % 8}` : 'Migrated Supplier',
    supplierAddress: null, awardDate: i % 11 ? '2025-06-01' : '2099-01-01',
    justification: i % 2 ? 'Continuation' : null, starred: i === 410,
    sourceFileName: 'awards.json', createdAt: 1, updatedAt: 1,
    searchText: 'redundant'.repeat(100),
  }));
  awards.forEach((row, i) => db.query('UPDATE records SET data=? WHERE id=?').run(JSON.stringify(row), `award:${String(i).padStart(4, '0')}`));
  revision++;
  calls.length = 0;
  let active = 0, peak = 0;
  queryHook = async input => {
    if (!input.statement.includes('OFFSET')) return;
    active++; peak = Math.max(peak, active);
    await new Promise(resolve => setTimeout(resolve, 5)); active--;
  };
  const args = { datePreset: 'all', includePlaceholderSuppliers: false };
  const [overview, duplicate] = await Promise.all([
    queryCatalog('contractAwardsAnalysis.overview', args, model, revision),
    queryCatalog('contractAwardsAnalysis.overview', { includePlaceholderSuppliers: false, datePreset: 'all' }, model, revision),
  ]);
  queryHook = undefined;
  expect(overview).toBe(duplicate);
  expect(peak).toBe(3);
  expect(calls.filter(call => call.method === 'catalog.query' && call.input.statement.includes('OFFSET'))).toHaveLength(3);
  expect(calls.some(call => call.method === 'catalog.read' && call.input.kind === 'award')).toBe(false);
  expect(overview).toEqual(queryModel({ ...model, awards }, 'contractAwardsAnalysis.overview', args));
  const readCount = calls.length;
  for (const [name, input] of [
    ['overview', { datePreset: 'all', minAwardValue: 20000, includePlaceholderSuppliers: true }],
    ['supplierProfile', { supplierKey: 'supplier-1', filters: {} }],
    ['organizationProfile', { organizationKey: 'buyer-1', filters: {} }],
    ['entityOptions', { kind: 'supplier', search: 'supplier', includePlaceholderSuppliers: false }],
  ] as const) {
    expect(await queryCatalog('contractAwardsAnalysis.' + name, input, model, revision))
      .toEqual(queryModel({ ...model, awards }, 'contractAwardsAnalysis.' + name, input));
  }
  expect(calls).toHaveLength(readCount);
  expect(model.stars.get('award:410')).toBe(true);
  db.query("UPDATE records SET data=json_set(data,'$.contractValue',1000000) WHERE id='award:0001'").run();
  revision++;
  const updated = await queryCatalog('contractAwardsAnalysis.overview', args, model, revision);
  expect(updated.summary.totalAwardValue - overview.summary.totalAwardValue).toBe(999900);
  expect(updated).not.toBe(overview);
});

test('analysis rejects mixed revisions and failed reads, then permits a clean retry', async () => {
  revision++;
  let changed = false;
  queryHook = input => { if (input.statement.includes('OFFSET') && !changed) { changed = true; revision++; } };
  await expect(queryCatalog('contractAwardsAnalysis.overview', {}, model, revision)).rejects.toThrow('Catalog changed');
  queryHook = undefined;
  expect((await queryCatalog('contractAwardsAnalysis.overview', {}, model, revision)).summary.totalAwards).toBeGreaterThan(0);
  revision++;
  queryHook = () => { throw Error('Temporary read failure'); };
  await expect(queryCatalog('contractAwardsAnalysis.overview', {}, model, revision)).rejects.toThrow('Temporary read failure');
  queryHook = undefined;
  expect((await queryCatalog('contractAwardsAnalysis.overview', {}, model, revision)).summary.totalAwards).toBeGreaterThan(0);
});


test('market views and evidence drilldowns share one snapshot and preserve source links', async () => {
  db.query("UPDATE records SET data=json_set(data,'$.sourceUrl','https://bcbid.gov.bc.ca/example') WHERE id='award:0001'").run();
  revision++; calls.length = 0;
  const args = { view: 'overview', filters: {}, options: {} };
  const [first, second] = await Promise.all([queryCatalog('contractAwardsAnalysis.market', args, model, revision), queryCatalog('contractAwardsAnalysis.market', args, model, revision)]);
  expect(first).toBe(second); expect(first.count).toBeGreaterThan(0);
  const reads = calls.length;
  const buyer = first.buyers[0];
  const records = await queryCatalog('contractAwardsAnalysis.market', { view: 'records', filters: {}, options: { slice: { buyer: buyer.name } } }, model, revision);
  expect(records).toHaveLength(buyer.count);
  const all = await queryCatalog('contractAwardsAnalysis.market', { view: 'records', filters: {}, options: {} }, model, revision);
  expect(all.find((r: any) => r.importKey === '1').sourceUrl).toBe('https://bcbid.gov.bc.ca/example');
  for (const view of ['trends', 'sizes', 'mix', 'relationships', 'quality']) await queryCatalog('contractAwardsAnalysis.market', { view, filters: {}, options: {} }, model, revision);
  expect(calls.length).toBe(reads);
  revision++;
  await queryCatalog('contractAwardsAnalysis.market', args, model, revision);
  expect(calls.length).toBeGreaterThan(reads);
});


test('mapped buyers filter and sort the complete catalog while raw names and keys remain intact', async () => {
  const { resolveBuyer } = await import('./market/buyers');
  const south='Ministry of Transportation and TransitSouth Coast Regional Office';
  const north='Ministry of Transportation and TransitNorthern Regional Office';
  const hydro='British Columbia Hydro and Power Authority';
  const hostile='Buyer "quoted". [x] %_ DROP;';
  const sources=[south,north,hydro,hostile,''];
  for (let i=0;i<413;i++) db.query("UPDATE records SET data=json_set(data,'$.issuingOrganization',?,'$.issuedBy',?) WHERE id=?").run(sources[i%5],sources[i%5],`award:${String(i).padStart(4,'0')}`);
  revision++;
  const org=resolveBuyer(south).organization;
  const rows=await queryCatalog('catalog.rows',{kind:'award',organization:org,limit:100,buyerLevel:'organization'},model,revision);
  expect(rows.total).toBe(166);expect(rows.items).toHaveLength(100);
  expect(rows.items.every((r:any)=>r.buyer===org&&[south,north].includes(r.issuingOrganization)&&r.importKey)).toBe(true);
  const second=await queryCatalog('catalog.rows',{kind:'award',organization:org,cursor:'100',limit:100},model,revision);
  expect(second.items).toHaveLength(66);expect(new Set([...rows.items,...second.items].map(r=>r.importKey)).size).toBe(166);
  const raw=await queryCatalog('catalog.rows',{kind:'award',organization:south,buyerLevel:'source'},model,revision);expect(raw.total).toBe(83);
  const hydroRows=await queryCatalog('catalog.rows',{kind:'award',search:'BC Hydro'},model,revision);expect(hydroRows.total).toBe(83);
  const quoted=await queryCatalog('catalog.rows',{kind:'award',organization:hostile,sort:{id:'buyer',desc:true}},model,revision);expect(quoted.total).toBe(82);expect(quoted.items[0].buyerOriginal).toBe(hostile);
  const unknown=await queryCatalog('catalog.rows',{kind:'award',organization:'Unknown buyer'},model,revision);expect(unknown.total).toBe(82);
  const facets=await queryCatalog('catalog.facets',{kind:'award'},model,revision);expect(facets.organizations).toHaveLength(4);
  expect((await queryCatalog('contractAwards.summary',{},model,revision)).organizations).toBe(4);
  const filtered=await queryCatalog('catalog.rows',{kind:'award',filters:[{column:'buyerOrganization',operator:'equals',value:org}],sort:{id:'buyerOriginal',desc:false},limit:100},model,revision);
  expect(filtered.total).toBe(166);expect(filtered.items[0].buyerOriginal).toBe(north);
  const sorted:any[]=[];
  for(let offset=0;offset<413;offset+=100) sorted.push(...(await queryCatalog('catalog.rows',{kind:'award',sort:{id:'buyer',desc:false},cursor:String(offset),limit:100},model,revision)).items);
  expect(sorted.map(r=>r.buyer)).toEqual(sorted.map(r=>r.buyer).sort((a,b)=>a.localeCompare(b)));expect(new Set(sorted.map(r=>r.importKey)).size).toBe(413);
  db.query("UPDATE records SET data=json_set(data,'$.issuingOrganization','New buyer') WHERE id='award:0000'").run(); revision++;
  expect((await queryCatalog('catalog.rows',{kind:'award',organization:'New buyer'},model,revision)).total).toBe(1);
});

test('escaped JSON-path characters in newly encountered buyers remain filterable', async()=>{
 const {resolveBuyer}=await import('./market/buyers');
 for(const source of ['Buyer \\ path', 'Buyer \n office', 'Buyer \u0000 unit']) {
  db.query("UPDATE records SET data=json_set(data,'$.issuingOrganization',?) WHERE id='award:0000'").run(source);revision++;
  const result=await queryCatalog('catalog.rows',{kind:'award',organization:resolveBuyer(source).organization,sort:{id:'buyer',desc:false}},model,revision);
  expect(result.total).toBe(1);expect(result.items[0].buyerOriginal).toBe(source);
 }
});
