import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { captureMissingDetails } from '../zoer/src/missing-details';
const row=(id='123',details:any[]=[])=>({id:'opportunity:'+id,kind:'opportunity',data:{processId:id,detailFields:details,detailUrl:'https://bcbid.gov.bc.ca/page.aspx/en/bpm/process_manage_extranet/'+id}});
const html=readFileSync(new URL('./fixtures/detail/with-addenda.html',import.meta.url),'utf8');
const fixture=(url:string)=>({url,html,title:'BC Bid',capturedAt:'2026-10-07T22:00:00Z'});
describe('capture only missing saved details',()=>{
 it('skips completed notices on retry and saves each capture plus progress',async()=>{
  const calls:string[]=[],saved:any[]=[];
  const result=await captureMissingDetails({recordIds:['opportunity:123','opportunity:124','opportunity:123']},{read:async()=>({records:[row(),row('124',[{}])]}),capture:async url=>{calls.push(url);return fixture(url);},save:async doc=>{saved.push(doc);return 'saved';}});
  expect(result).toEqual({completed:1,skipped:1,total:2});expect(calls).toHaveLength(1);expect(saved.filter(x=>x.kind==='detail')).toHaveLength(1);expect(saved.at(-1)).toMatchObject({scope:'bcbid-missing-details',detailsCompleted:1});
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
