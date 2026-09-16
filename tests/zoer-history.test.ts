import { describe, it, expect } from 'vitest';
import { scrapeAwardHistory, parseAwardPage, AWARDS_URL, AWARD_SEARCH } from '../zoer/src/award-history';
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
  it.each(['wrong-page', 'search', 'pager'])('restores a changed %s once and verifies the saved page before continuing', async reason => {
    const saved:any[]=[], calls:any[]=[];
    const resume={page:2,count:2,fingerprint:parseAwardPage(page(2)).fingerprint,complete:false};
    let initial=true, continuation=true;
    const result=await scrapeAwardHistory(async options=>{
      calls.push(options);
      if(initial){initial=false;if(reason==='search')throw new Error('The saved search changed. Start the history search again.');return page(reason==='wrong-page'?8:2);}
      if(options.applySearch)return page(options.pageNumber);
      if(reason==='pager'&&continuation){continuation=false;throw new Error('The saved pager changed. Start the history search again.');}
      return page(options.continuePage,3);
    },store(saved),resume);
    expect(calls.filter(call=>call.applySearch)).toEqual([{pageNumber:2,applySearch:true,searchFields:AWARD_SEARCH}]);
    expect(saved.map(doc=>doc.checkpoint.page)).toEqual([3]);
    expect(result).toMatchObject({count:3,pages:3,complete:true});
  });
  it.each(['fingerprint','page'])('rejects restored %s mismatches without saving or advancing',async mismatch=>{
    const saved:any[]=[],calls:any[]=[];
    const resume={page:2,count:2,fingerprint:parseAwardPage(page(2)).fingerprint,complete:false};
    await expect(scrapeAwardHistory(async options=>{
      calls.push(options);
      if(!options.applySearch)return page(8);
      return mismatch==='page'?page(1):{...page(9),pagination:page(2).pagination};
    },store(saved),resume)).rejects.toThrow('saved awards are retained');
    expect(saved).toEqual([]);expect(calls).toHaveLength(2);
  });
  it.each(['Wrong captcha answer','Complete the browser check manually','Cancelled','Runtime budget exceeded'])('does not restore or retry %s',async message=>{
    const saved:any[]=[],calls:any[]=[];
    const resume={page:2,count:2,fingerprint:parseAwardPage(page(2)).fingerprint,complete:false};
    await expect(scrapeAwardHistory(async options=>{calls.push(options);throw new Error(message);},store(saved),resume)).rejects.toThrow(message);
    expect(calls).toHaveLength(1);expect(saved).toEqual([]);
  });
  it('does not restore a verification page returned as a capture',async()=>{
    let calls=0;
    const resume={page:2,count:2,fingerprint:parseAwardPage(page(2)).fingerprint,complete:false};
    await expect(scrapeAwardHistory(async()=>{calls++;return {...page(1),html:'<p>Wrong captcha answer</p>'};},store([]),resume)).rejects.toThrow('grid');
    expect(calls).toBe(1);
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

 it('re-reads stale rows without clicking the next page twice', async () => {
   const saved:any[]=[],calls:any[]=[];let reads=0;
   const resume={page:2,count:2,fingerprint:parseAwardPage(page(2)).fingerprint,complete:false};
   const result=await scrapeAwardHistory(async options=>{
     calls.push(options);
     if (++reads===1)return page(2,3);
     if(reads===2)return {...page(2,3),pagination:page(3,3).pagination};
     return page(3,3);
   },store(saved),resume);
   expect(result).toMatchObject({pages:3,complete:true});
   expect(calls.filter(c=>c.continuePage)).toHaveLength(1);
   expect(saved).toHaveLength(1);
 });
 it('stops bounded stale reads without marking duplicate rows complete', async () => {
   const saved:any[]=[],calls:any[]=[];
   const resume={page:2,count:2,fingerprint:parseAwardPage(page(2)).fingerprint,complete:false};
   await expect(scrapeAwardHistory(async options=>{calls.push(options);return calls.length===1?page(2):{...page(2),pagination:page(3,3).pagination};},store(saved),resume)).rejects.toThrow('pagination did not advance');
   expect(calls).toHaveLength(4);expect(saved).toHaveLength(0);
 });
it('does not retry a browser check during a stale-row re-read', async () => {
 const saved:any[]=[];let calls=0;
 const resume={page:2,count:2,fingerprint:parseAwardPage(page(2)).fingerprint,complete:false};
 await expect(scrapeAwardHistory(async()=>{
   calls++;if(calls===1)return page(2);
   if(calls===2)return {...page(2),pagination:page(3).pagination};
   throw Error('Complete the browser check manually');
 },store(saved),resume)).rejects.toThrow('browser check manually');
 expect(calls).toBe(3);expect(saved).toHaveLength(0);
});

it('restores a high checkpoint in bounded calls without resetting a valid intermediate page', async()=>{
 const calls:any[]=[],saved:any[]=[]; const resume={page:856,count:856,fingerprint:parseAwardPage(page(856)).fingerprint,complete:false};
 const result=await scrapeAwardHistory(async options=>{calls.push(options);return page(options.pageNumber??options.continuePage??800,857);},store(saved),resume);
 expect(calls.filter(c=>c.pageNumber).map(c=>c.pageNumber)).toEqual([820,840,856]);
 expect(calls.some(c=>c.applySearch)).toBe(false);
 expect(saved.map(d=>d.checkpoint.page)).toEqual([857]); expect(result.complete).toBe(true);
});
it('stops a checkpoint restore at verification without advancing or overwriting saved data', async()=>{
 const calls:any[]=[],saved:any[]=[];const resume={page:856,count:856,fingerprint:parseAwardPage(page(856)).fingerprint,complete:false};
 await expect(scrapeAwardHistory(async options=>{calls.push(options);if(options.pageNumber===820)throw Error('Complete the browser check manually');return page(800);},store(saved),resume)).rejects.toThrow('browser check manually');
 expect(calls).toHaveLength(2);expect(saved).toEqual([]);
});
