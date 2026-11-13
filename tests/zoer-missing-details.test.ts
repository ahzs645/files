import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { captureMissingDetails, selectMissingDetails } from '../zoer/src/missing-details';
import { DETAIL_CAPTURE_VERSION } from '../zoer/src/detail-policy';
const row=(id='123',details:any[]=[])=>({id:'opportunity:'+id,kind:'opportunity',data:{processId:id,detailFields:details,detailCaptureVersion:DETAIL_CAPTURE_VERSION,detailUrl:'https://bcbid.gov.bc.ca/page.aspx/en/bpm/process_manage_extranet/'+id}});
const html=readFileSync(new URL('./fixtures/detail/with-addenda.html',import.meta.url),'utf8');
const fixture=(url:string)=>({url,html,title:'BC Bid',capturedAt:'2026-10-07T22:00:00Z'});
describe('capture only missing saved details',()=>{
 it('skips completed notices on retry and saves each capture plus progress',async()=>{
  const calls:string[]=[],saved:any[]=[];
  const result=await captureMissingDetails({recordIds:['opportunity:123','opportunity:124','opportunity:123']},{read:async()=>({records:[row(),row('124',[{}])]}),capture:async url=>{calls.push(url);return fixture(url);},save:async doc=>{saved.push(doc);return 'saved';}});
  expect(result).toEqual({completed:1,skipped:1,total:2});expect(calls).toHaveLength(1);expect(saved.filter(x=>x.kind==='detail')).toHaveLength(1);expect(saved.at(-1)).toMatchObject({scope:'bcbid-missing-details',detailsCompleted:1});
 });
 it('recaptures a notice marked stale even when old detail fields remain available',async()=>{
  const stale=row('123',[{label:'Scope',value:'Older scope'}]);
  Object.assign(stale.data,{detailNeedsRefresh:true});
  const calls:string[]=[];
  const result=await captureMissingDetails({recordIds:['opportunity:123','opportunity:124']},{read:async()=>({records:[stale,row('124',[{label:'Scope',value:'Current scope'}])]}),capture:async url=>{calls.push(url);return fixture(url);},save:async()=> 'saved'});
  expect(result).toEqual({completed:1,skipped:1,total:2});expect(calls).toEqual([stale.data.detailUrl]);
 });
 it('recaptures details saved before the current capture version and stamps the new capture',async()=>{
  const legacy=row('123',[{label:'Scope',value:'Three-tab capture'}]);delete (legacy.data as any).detailCaptureVersion;
  const calls:string[]=[],saved:any[]=[];
  const result=await captureMissingDetails({recordIds:['opportunity:123','opportunity:124']},{read:async()=>({records:[legacy,row('124',[{label:'Scope',value:'Current scope'}])]}),capture:async url=>{calls.push(url);return fixture(url);},save:async doc=>{saved.push(doc);return 'saved';}});
  expect(result).toEqual({completed:1,skipped:1,total:2});expect(calls).toEqual([legacy.data.detailUrl]);
  expect(saved.find(doc=>doc.kind==='detail')).toMatchObject({scope:'bcbid-missing-details',detailCaptureVersion:DETAIL_CAPTURE_VERSION});
 });
 it('validates the whole selection before making requests',async()=>{
  let captures=0;
  const host={read:async()=>({records:[row(),{...row('124'),data:{...row('124').data,detailUrl:'https://evil.test'}}]}),capture:async(url:string)=>{captures++;return fixture(url);},save:async()=>''};
  await expect(captureMissingDetails({recordIds:['opportunity:123','opportunity:124']},host)).rejects.toThrow('valid saved');expect(captures).toBe(0);
  await expect(captureMissingDetails({recordIds:['opportunity:bidsandtenders:123']},host)).rejects.toThrow('1–50');
 });
 it('retains completed work and stops immediately at a real browser check',async()=>{
  const saved:any[]=[];let captures=0;
  await expect(captureMissingDetails({recordIds:['opportunity:123','opportunity:124']},{read:async()=>({records:[row(),row('124')]}),capture:async url=>++captures===1?fixture(url):{...fixture('https://bcbid.gov.bc.ca/page.aspx/en/bas/browser_check'),html:'<body>Browser check</body>'},save:async doc=>{saved.push(doc);return 'saved';}})).rejects.toThrow('manually');
  expect(saved.filter(x=>x.kind==='detail')).toHaveLength(1);expect(saved.at(-1).detailsCompleted).toBe(1);
 });
 it('refuses a different returned notice',async()=>{
  const saved:any[]=[];
  await expect(captureMissingDetails({recordIds:['opportunity:123']},{read:async()=>({records:[row()]}),capture:async()=>fixture(row('124').data.detailUrl),save:async doc=>{saved.push(doc);return 'saved';}})).rejects.toThrow('different opportunity');expect(saved.some(x=>x.kind==='detail')).toBe(false);
 });
 it('retries a native connect failure once after its bounded lease wait',async()=>{
  let captures=0,waited=0;
  const result=await captureMissingDetails({recordIds:['opportunity:123']},{read:async()=>({records:[row()]}),capture:async url=>{if(++captures===1)throw Error('Native browser connect failed (400).');return fixture(url);},save:async()=>''},{sleep:async ms=>{waited+=ms;}});
  expect(result.completed).toBe(1);expect(captures).toBe(2);expect(waited).toBe(70000);
 });
 it('stops after repeated connect failure or a maintenance pause during recovery',async()=>{
  let captures=0;
  const host={read:async()=>({records:[row()]}),capture:async()=>{captures++;throw Error('Native browser connect failed (400).');},save:async()=>''};
  await expect(captureMissingDetails({recordIds:['opportunity:123']},host,{sleep:async()=>{}})).rejects.toThrow('connect failed');expect(captures).toBe(2);
  captures=0;let paused=false;
  await expect(captureMissingDetails({recordIds:['opportunity:123']},host,{sleep:async()=>{paused=true;},paused:()=>paused})).rejects.toThrow('Paused for Zoer update');expect(captures).toBe(1);
 });
});

describe('missing mode chooses open notices itself',()=>{
 const NOW=Date.parse('2026-11-13T19:00:00Z');
 const open=(id:string,closingDate:string,extra:any={})=>{const r=row(id);Object.assign(r.data,{status:'Open',closingDate,...extra});return r;};
 const current={detailFields:[{label:'Scope',value:'Captured'}],attachments:[]};
 const catalog=[
  open('101','2026-12-01'),                                   // no details: wanted
  open('102','2026-11-20T23:00:00Z',{detailFields:[{}]}),     // current details, no attachment list: wanted
  open('103','2026-11-14',current),                           // current details and a saved (empty) list: not wanted
  open('104','2026-11-01'),                                   // closed
  open('105','2026-11-13'),                                   // closing today (time unverified): still open, soonest
  {...open('106','2026-11-15'),data:{...open('106','2026-11-15').data,status:'Closed'}},
  {...open('107','2026-11-15'),data:{...open('107','2026-11-15').data,sourceId:'canadabuys'}},
  {...open('108','2026-11-15'),data:{...open('108','2026-11-15').data,historical:{from:'2015-04-01',to:'2022-12-15'}}},
  open('109','2026-11-16',{...current,detailNeedsRefresh:true}), // marked stale: wanted
 ];
 const pages=(records:any[],size=3)=>async(after:string)=>({records:records.filter(r=>r.id>after).slice(0,size)});
 it('pages the whole catalog and orders open notices by closing date',async()=>{
  expect(await selectMissingDetails(pages(catalog),50,NOW)).toEqual(['opportunity:105','opportunity:109','opportunity:102','opportunity:101']);
  expect(await selectMissingDetails(pages(catalog),2,NOW)).toEqual(['opportunity:105','opportunity:109']);
  await expect(selectMissingDetails(async()=>({records:[catalog[0]]}),5,NOW)).rejects.toThrow('did not advance');
 });
 it('captures the chosen notices and reports how many were selected',async()=>{
  const calls:string[]=[];
  const host={read:async(ids:string[])=>({records:catalog.filter(r=>ids.includes(r.id))}),list:pages(catalog),capture:async(url:string)=>{calls.push(url);return fixture(url);},save:async()=>'saved'};
  const result=await captureMissingDetails({missing:{limit:3}},host,{now:NOW});
  expect(result).toEqual({completed:3,skipped:0,total:3,selected:3,failed:0});
  expect(calls).toEqual(['105','109','102'].map(id=>row(id).data.detailUrl));
  expect(await captureMissingDetails({missing:{limit:3}},{...host,list:async()=>({records:[]})},{now:NOW})).toEqual({completed:0,skipped:0,total:0,selected:0,failed:0});
 });
 it('counts a notice that fails and moves on, but stops at a browser check or when every capture fails',async()=>{
  const list=pages(catalog),read=async(ids:string[])=>({records:catalog.filter(r=>ids.includes(r.id))});
  const flaky=await captureMissingDetails({missing:{limit:3}},{read,list,save:async()=>'',capture:async(url:string)=>url.endsWith('/105')?{...fixture(url),html:'<html></html>'}:fixture(url)},{now:NOW});
  expect(flaky).toMatchObject({completed:2,failed:1,selected:3});
  await expect(captureMissingDetails({missing:{limit:3}},{read,list,save:async()=>'',capture:async()=>({...fixture('https://bcbid.gov.bc.ca/page.aspx/en/bas/browser_check'),html:'<body>Browser check</body>'})},{now:NOW})).rejects.toThrow('browser check');
  await expect(captureMissingDetails({missing:{limit:2}},{read,list,save:async()=>'',capture:async(url:string)=>({...fixture(url),html:'<html></html>'})},{now:NOW})).rejects.toThrow('not loaded');
 });
 it('takes exactly one of recordIds or missing',async()=>{
  const host={read:async()=>({records:[]}),list:pages([]),capture:async()=>{throw Error('no');},save:async()=>''};
  for(const input of [{},{recordIds:['opportunity:1'],missing:{limit:1}}])await expect(captureMissingDetails(input,host)).rejects.toThrow('not both');
  for(const limit of [0,51,1.5,'5'])await expect(captureMissingDetails({missing:{limit}},host)).rejects.toThrow('1 to 50');
  await expect(captureMissingDetails({missing:{limit:5}},{...host,list:undefined})).rejects.toThrow('Update Zoer');
 });
});

describe('stale mode refreshes closed current notices after open ones',()=>{
 const NOW=Date.parse('2026-11-13T19:00:00Z');
 const notice=(id:string,status:string,closingDate:string,extra:any={})=>{const r=row(id,[{label:'Scope',value:'Old'}]);delete (r.data as any).detailCaptureVersion;Object.assign(r.data,{status,closingDate,attachments:[],...extra});return r;};
 const catalog=[
  notice('201','Closed','2026-10-01'),                                   // older capture, closed in October
  notice('202','Closed','2026-11-10'),                                   // older capture, closed recently
  notice('203','Open','2026-11-01'),                                     // Open label, past its deadline
  notice('204','Open','2026-12-01'),                                     // open, older capture: first
  notice('205','Closed','2026-11-11',{detailCaptureVersion:DETAIL_CAPTURE_VERSION,tabCoverage:{complete:true}}), // current capture
  notice('206','Closed','2026-11-12',{historical:{from:'2015-04-01',to:'2022-12-15'}}), // historical queue owns it
  {...notice('207','Closed','2026-11-12'),data:{...notice('207','Closed','2026-11-12').data,sourceId:'canadabuys'}},
 ];
 const pages=(records:any[],size=2)=>async(after:string)=>({records:records.filter(r=>r.id>after).slice(0,size)});
 it('selects open first, then most recently closed, and only when asked',async()=>{
  expect(await selectMissingDetails(pages(catalog),50,NOW)).toEqual(['opportunity:204']);
  expect(await selectMissingDetails(pages(catalog),50,NOW,{stale:true})).toEqual(['opportunity:204','opportunity:202','opportunity:203','opportunity:201']);
  expect(await selectMissingDetails(pages(catalog),2,NOW,{stale:true})).toEqual(['opportunity:204','opportunity:202']);
 });
 it('keeps the input strict and backward compatible',async()=>{
  const host={read:async(ids:string[])=>({records:catalog.filter(r=>ids.includes(r.id))}),list:pages(catalog),capture:async(url:string)=>fixture(url),save:async()=>'saved'};
  expect(await captureMissingDetails({missing:{limit:5,stale:true}},host,{now:NOW})).toMatchObject({selected:4,completed:4});
  expect(await captureMissingDetails({missing:{limit:5,stale:false}},host,{now:NOW})).toMatchObject({selected:1});
  for(const missing of [{limit:5,stale:'yes'},{limit:5,stale:1},{limit:5,closed:true}])await expect(captureMissingDetails({missing},host,{now:NOW})).rejects.toThrow(/stale|1 to 50/);
 });
 it('treats one notice without a readable tab menu as that notice failing, but stops after several in a row',async()=>{
  const read=async(ids:string[])=>({records:catalog.filter(r=>ids.includes(r.id))}),list=pages(catalog);
  const noTabs=()=>{throw Error('Public detail tab inventory is unavailable or exceeds its bound.');};
  expect(await captureMissingDetails({missing:{limit:5,stale:true}},{read,list,save:async()=>'',capture:async(url:string)=>url.endsWith('/202')?noTabs():fixture(url)},{now:NOW})).toMatchObject({completed:3,failed:1});
  let captures=0;
  await expect(captureMissingDetails({missing:{limit:5,stale:true}},{read,list,save:async()=>'',capture:async()=>{captures++;return noTabs();}},{now:NOW})).rejects.toThrow('tab inventory');
  expect(captures).toBe(3);
  await expect(captureMissingDetails({missing:{limit:5,stale:true}},{read,list,save:async()=>'',capture:async()=>{throw Error('Saved browser unavailable');}},{now:NOW})).rejects.toThrow('unavailable');
 });
});
