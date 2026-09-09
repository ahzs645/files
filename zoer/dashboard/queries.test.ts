import { test, expect, mock } from 'bun:test';
import { Database } from 'bun:sqlite';
const db = new Database(':memory:');
db.exec('CREATE TABLE records(id TEXT PRIMARY KEY,kind TEXT,data TEXT)');
let revision = 1;
const calls: any[] = [];
mock.module('./bridge', () => ({ host: async (method: string, input: any) => {
  calls.push({ method, input });
  if (method === 'catalog.query') return { rows: db.query(input.statement).all(...input.parameters) };
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
  expect(calls.every(call=>call.method==='catalog.query')).toBe(true);
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
  const facets=await queryCatalog('catalog.facets',{kind:'opportunity'},model,1);
  expect(facets.organizations).toHaveLength(413);expect(facets.organizations.at(-1)).toBe('Buyer 412');
  const result=await queryCatalog('catalog.rows',{kind:'opportunity',organization:'Buyer 410'},model,1);expect(result.total).toBe(1);expect(result.items[0].sourceKey).toBe('410');
});
