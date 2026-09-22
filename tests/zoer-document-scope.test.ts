import { describe, it, expect } from 'vitest';
import { documentScope, readDocumentCandidates } from '../zoer/dashboard/document-scope';
const row=(id:string,status='Open',closingDate='2027-01-01',attachments:unknown[]=[{}])=>({id,data:{status,closingDate,attachments}});
describe('bulk attachment scope',()=>{
  it('excludes past and closed bids, retains unknown dates, and reports missing links',()=>{
    const records=[row('open'),row('past','Open','2020-01-01'),row('closed','Closed'),row('unknown','Open',''),row('missing','Open','2027-01-01',[])];
    expect(documentScope(records,'current',Date.parse('2026-09-16'))).toEqual({ids:['open','unknown'],total:3,links:2,missing:1,unknownDates:1});
    expect(documentScope(records,'all').ids).toEqual(['open','past','closed','unknown']);
  });
  it('keeps a date-only closing date current through its whole day in BC',()=>{
    const evening=Date.parse('2026-09-22T00:30:00Z'); // 17:30 PDT on September 21
    const records=[row('today','Open','2026-09-21'),row('tomorrow','Open','2026-09-22'),row('yesterday','Open','2026-09-20')];
    expect(documentScope(records,'current',evening).ids).toEqual(['today','tomorrow']);
  });
  it('reads every page with one revision and checks the revision again before publishing',async()=>{
    const calls:any[]=[];
    const records=await readDocumentCandidates(async(method,input:any)=>{calls.push(input);if(input.ids)return {revision:9};return input.after?{records:[row('last')],next:null}:{records:Array.from({length:200},(_,i)=>row(String(i))),next:'200'};});
    expect(records).toHaveLength(201);expect(records.at(-1)?.id).toBe('last');
    expect(calls.slice(1).every(c=>c.revision===9)).toBe(true);expect(calls.at(-1)).toEqual({ids:[],revision:9});
  });
  it('fails instead of showing a partial snapshot when the catalog changes',async()=>{
    await expect(readDocumentCandidates(async(_,input:any)=>{if(input.ids&&input.revision)throw Error('Catalog changed');return input.ids?{revision:9}:{records:[row('one')],next:null};})).rejects.toThrow('Catalog changed');
  });
});

import { researchRetry } from '../zoer/dashboard/research-retry';
it('resumes bulk downloads without leaking internal checkpoint fields into public input',()=>{
  const ids=Array.from({length:65},(_,i)=>String(i));
  const retry=researchRetry({id:'run',kind:'download',input:JSON.stringify({recordIds:ids,checkpointGeneration:'old',cliSelection:{},prompt:null})});
  expect(retry.actionId).toBe('documents.download.all');
  expect(retry.input).toEqual({recordIds:ids,force:false,resumeRunId:'run'});
});
