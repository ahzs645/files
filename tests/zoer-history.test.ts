import { describe, it, expect } from 'vitest';
import { scrapeAwardHistory, parseAwardPage, AWARDS_URL } from '../zoer/src/award-history';
import { buildModel, queryModel } from '../zoer/dashboard/model';
import { exportRecords } from '../zoer/dashboard/export';
function page(number: number, last = 9) {
  const headers=['Opportunity ID','Opportunity Description','Successful Supplier','Award Date','Contract Value'];
  return {url:AWARDS_URL,title:'Awards',capturedAt:'2026-09-06T00:00:00Z',html:`<table id="body_x_grid_grd"><thead><tr>${headers.map(h=>`<th>${h}</th>`).join('')}</tr></thead><tbody><tr><td>${number}</td><td>Award ${number}</td><td>Supplier</td><td>2015-04-01</td><td>1,250.00</td></tr></tbody></table>`,pagination:{currentPage:number,hasNext:number<last,visiblePages:[1,2]}};
}
const store = (saved:any[]) => async (document:any) => {saved.push(document);return String(saved.length)};
describe('award history',()=>{
  it('walks beyond the first visible pager and saves every page before completion',async()=>{
    const saved:any[]=[];
    const result=await scrapeAwardHistory(async options=>page(options.continuePage??1),store(saved));
    expect(saved).toHaveLength(9);expect(saved[0].checkpoint.complete).toBe(false);expect(result).toMatchObject({count:9,pages:9,complete:true});
    expect(saved[0].records[0]).toMatchObject({awardDate:'2015-04-01',contractValueText:'1,250.00'});
  });
  it('retains partial data on error and resumes after the durable checkpoint',async()=>{
    const saved:any[]=[];
    await expect(scrapeAwardHistory(async options=>{if(options.continuePage===3)throw new Error('Browser check');return page(options.continuePage??1)},store(saved))).rejects.toThrow('Browser check');
    expect(saved.at(-1).checkpoint).toMatchObject({page:2,complete:false});
    const result=await scrapeAwardHistory(async options=>page(options.continuePage??2,4),store(saved),saved.at(-1).checkpoint);
    expect(result).toMatchObject({count:4,complete:true});expect(saved.map(d=>d.checkpoint.page)).toEqual([1,2,3,4]);
  });
  it('replays a page advanced before an interrupted save without skipping it',async()=>{
    const saved:any[]=[];await expect(scrapeAwardHistory(async options=>page(options.continuePage??1),store(saved),undefined,2)).rejects.toThrow('limit');
    const result=await scrapeAwardHistory(async options=>page(options.continuePage??3,4),store(saved),saved.at(-1).checkpoint);
    expect(result.count).toBe(4);expect(saved.map(d=>d.checkpoint.page)).toEqual([1,2,3,4]);
  });
  it('rejects repeated pages, malformed grids, redirects and changed resume positions',async()=>{
    const saved:any[]=[];
    await expect(scrapeAwardHistory(async options=>({...page(1),pagination:{...page(1).pagination,currentPage:options.continuePage??1}}),store(saved))).rejects.toThrow('did not advance');
    expect(saved).toHaveLength(1);
    await expect(scrapeAwardHistory(async()=>page(8),store(saved),saved[0].checkpoint)).rejects.toThrow('changed');
    expect(()=>parseAwardPage({...page(1),html:'<p>Browser check</p>'})).toThrow('grid');
    expect(()=>parseAwardPage({...page(1),url:'https://evil.test/ctr/contract_browse_public'})).toThrow('unavailable');
  });
});
it('merges durable stars, unstars and duplicate awards across reloads',()=>{
  const award=parseAwardPage(page(1)).records[0];
  const docs:any[]=[{version:1,kind:'listing',records:[{sourceKey:'one',description:'One'}]},{version:1,kind:'awards',records:[award]},{version:1,kind:'awards',records:[award]},{version:1,kind:'star',entity:'opportunity',key:'one',starred:true}];
  const build=()=>buildModel({runs:[],artifacts:[]},docs.map((document,i)=>({record:{id:String(i),runId:String(i),createdAt:new Date(i*1000).toISOString()},document})));
  let model=build();expect(model.awards).toHaveLength(1);expect(queryModel(model,'opportunities.list',{starredOnly:true}).total).toBe(1);
  docs.push({version:1,kind:'star',entity:'opportunity',key:'one',starred:false});model=build();expect(queryModel(model,'opportunities.list',{starredOnly:true}).total).toBe(0);expect(model.opportunities).toHaveLength(1);
});
it('exports all saved rows and protects CSV cells without changing JSON values',()=>{
  const rows=Array.from({length:38129},(_,i)=>({opportunityId:String(i),opportunityDescription:i===0?' \t=HYPERLINK("evil")':'Unicode café, "bid"\nline'}));
  const json=exportRecords(rows,'award','json');expect(JSON.parse(json)).toHaveLength(38129);expect(JSON.parse(json)[0].opportunityDescription).toBe(rows[0].opportunityDescription);
  const csv=exportRecords(rows,'award','csv');expect(csv).toContain('"\' \t=HYPERLINK(""evil"")"');expect(csv).toContain('"38128"');expect(csv).toContain('Unicode café, ""bid""\nline');
});
