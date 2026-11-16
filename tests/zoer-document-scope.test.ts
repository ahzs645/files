import { describe, it, expect } from 'vitest';
import { documentScope, readDocumentCandidates } from '../zoer/dashboard/document-scope';
import { assertDocumentBrowserIdle, documentDownloadActive, sourceCaptureActive, sourceCaptureProgressPath } from '../zoer/dashboard/document-run';
import { buildModel } from '../zoer/dashboard/model';
const row=(id:string,status='Open',closingDate='2027-01-01',attachments:unknown[]=[{}])=>({id,data:{status,closingDate,attachments}});
describe('bulk attachment scope',()=>{
  it('excludes past and closed bids, retains unknown dates, and reports missing links',()=>{
    const records=[row('open'),row('past','Open','2020-01-01'),row('closed','Closed'),row('unknown','Open',''),row('missing','Open','2027-01-01',[])];
    expect(documentScope(records,'current',Date.parse('2026-09-16'))).toEqual({ids:['open','unknown'],total:3,links:2,missing:1,missingDetails:['open','unknown','missing'],capturedWithoutLinks:0,unknownDates:1});
    expect(documentScope(records,'all').ids).toEqual(['open','past','closed','unknown']);
  });
  it('does not confuse captured notices without files with notices needing detail capture',()=>{
    const captured={...row('captured','Open','2027-01-01',[]),data:{...row('captured').data,attachments:[],detailFields:[{label:'Summary',value:'See external portal'}]}};
    expect(documentScope([captured,row('missing','Open','2027-01-01',[])],'current',Date.parse('2026-10-07'))).toMatchObject({missing:2,capturedWithoutLinks:1,missingDetails:['missing']});
  });
  it('offers stale notices for recapture while retaining their saved links for download',async()=>{
    const records=await readDocumentCandidates(async(_,input:any)=>input.ids?{revision:9}:{rows:[
      {id:'opportunity:123',status:'Open',closingDate:'2027-01-01',attachments:'[{"url":"saved-file"}]',detailsCaptured:1,detailNeedsRefresh:1},
      {id:'opportunity:124',status:'Open',closingDate:'2027-01-01',attachments:'[]',detailsCaptured:1,detailNeedsRefresh:0},
    ]});
    expect(documentScope(records,'current',Date.parse('2026-10-07'))).toMatchObject({ids:['opportunity:123'],links:1,missingDetails:['opportunity:123'],capturedWithoutLinks:1});
  });
  it('reads every page with one revision and checks the revision again before publishing',async()=>{
    const calls:any[]=[];
    const records=await readDocumentCandidates(async(method,input:any)=>{calls.push(input);if(input.ids)return {revision:9};return input.parameters[0]?{rows:[{id:'last',attachments:'[]',detailsCaptured:1}]}:{rows:Array.from({length:200},(_,i)=>({cursor:i+1,id:String(i).padStart(3,'0'),attachments:'[{}]',detailsCaptured:0}))};});
    expect(records).toHaveLength(201);expect(records.at(-1)?.id).toBe('last');
    expect(records.at(-1)?.data.detailsCaptured).toBe(true);
    expect(calls[1].statement).not.toContain('SELECT *');expect(calls[1].statement).not.toContain('descriptionText');
    expect(calls[2].parameters).toEqual([200]);expect(calls.at(-1)).toEqual({ids:[],revision:9});
  });
  it('fails instead of showing a partial snapshot when the catalog changes',async()=>{
    await expect(readDocumentCandidates(async(_,input:any)=>{if(input.ids&&input.revision)throw Error('Catalog changed');return input.ids?{revision:9}:{rows:[{id:'one',attachments:'[]',detailsCaptured:0}]};})).rejects.toThrow('Catalog changed');
  });
  it('bounds each read before filtering source, status and closing date',async()=>{
    let statement='';
    const records=await readDocumentCandidates(async(_,input:any)=>{if(input.ids)return {revision:9};statement=input.statement;return {rows:[{id:'other',sourceId:'canadabuys',status:'Open',closingDate:'',attachments:'[{}]'}, {id:'one',status:' Open ',closingDate:'2027-01-01',attachments:'[]',detailsCaptured:1}]};},'current');
    expect(statement).toContain("rowid>? ORDER BY rowid LIMIT 200");
    expect(documentScope(records,'current',Date.parse('2026-10-11'))).toMatchObject({total:1,capturedWithoutLinks:1,missingDetails:[]});
  });
  it('retries one revision race during background import without mixing snapshots',async()=>{
    let attempt=0;
    const records=await readDocumentCandidates(async(_,input:any)=>{
      if(input.ids && input.revision===undefined)return {revision:++attempt};
      if(input.ids){if(attempt===1)throw Error('Catalog changed; reload the snapshot.');return {revision:attempt};}
      return {rows:[{id:'attempt:'+attempt,attachments:'[]',detailsCaptured:0}]};
    });
    expect(attempt).toBe(2);expect(records.map(row=>row.id)).toEqual(['attempt:2']);
  });
  it('refuses nonadvancing pages and selections beyond the bulk limit',async()=>{
    const page=Array.from({length:200},(_,i)=>({cursor:i+1,id:String(i).padStart(4,'0'),attachments:'[]',detailsCaptured:0}));
    await expect(readDocumentCandidates(async(_,input:any)=>input.ids?{revision:1}:{rows:page})).rejects.toThrow('did not advance');
    let index=0;
    await expect(readDocumentCandidates(async(_,input:any)=>input.ids?{revision:1}:{rows:page.map(r=>({...r,cursor:index+1,id:String(index++).padStart(5,'0')}))})).rejects.toThrow('3,000-opportunity');
  });
  it('applies exact current status and deadline rules before the bulk limit',async()=>{
    let page=0,index=0;
    const records=await readDocumentCandidates(async(_,input:any)=>{
      if(input.ids)return {revision:1};
      if(page++<16)return {rows:Array.from({length:200},()=>({cursor:index+1,id:String(index++).padStart(5,'0'),status:'Not open',closingDate:'2027-01-01',attachments:'[]',detailsCaptured:0}))};
      return {rows:[{id:String(index++).padStart(5,'0'),status:' Open ',closingDate:'2027-01-01',attachments:'[]',detailsCaptured:1}]};
    },'current');
    expect(records).toHaveLength(1);expect(records[0].data.detailsCaptured).toBe(true);
  });
});

it('blocks another download from submission through queue, pause and execution, then releases after failure',()=>{
  expect(documentDownloadActive([], 'submitted')).toBe(true);
  for(const status of ['pending','claimed','running','waiting_for_user','waiting_for_event']) expect(documentDownloadActive([{id:'submitted',status}],'submitted')).toBe(true);
  for(const status of ['succeeded','failed','cancelled','outcome_unknown']) expect(documentDownloadActive([{id:'submitted',status}],'submitted')).toBe(false);
  expect(documentDownloadActive([{id:'other',status:'pending'}])).toBe(true);
});

import { researchRetry } from '../zoer/dashboard/research-retry';
it('resumes bulk downloads without leaking internal checkpoint fields into public input',()=>{
  const ids=Array.from({length:65},(_,i)=>String(i));
  const retry=researchRetry({id:'run',kind:'download',input:JSON.stringify({recordIds:ids,checkpointGeneration:'old',cliSelection:{},prompt:null})});
  expect(retry.actionId).toBe('documents.download.all');
  expect(retry.input).toEqual({recordIds:ids,force:false,resumeRunId:'run'});
});


describe('shared capture browser guards', () => {
  it('retains historical runs outside the current-scraper history projection', () => {
    const historical = {id:'historical',actionId:'scrape.historical',status:'running',createdAt:'2026-10-11T05:00:00Z'};
    const model = buildModel({runs:[historical],artifacts:[]}, []);
    expect(model.runs).toHaveLength(0);
    expect(model.captureRuns).toEqual([historical]);
    expect(sourceCaptureActive(model.captureRuns)).toBe(true);
    expect(sourceCaptureProgressPath(model.captureRuns)).toBe('/taxonomy');
  });
  it('blocks queued, paused and waiting source captures until a terminal outcome', () => {
    for(const status of ['pending','claimed','running','queued','retry_scheduled','waiting_for_approval','waiting_for_user','waiting_for_event','paused']) {
      expect(sourceCaptureActive([{actionId:'scrape.historical',status}])).toBe(true);
    }
    for(const status of ['succeeded','failed','cancelled','outcome_unknown']) {
      expect(sourceCaptureActive([{actionId:'scrape.historical',status}])).toBe(false);
      expect(sourceCaptureProgressPath([{actionId:'scrape.historical',status}])).toBe('/scraper/history');
    }
    expect(sourceCaptureProgressPath([{actionId:'scrape.details',status:'pending'}])).toBe('/scraper/history');
    for(const actionId of ['awards.history','detail.capture','procurement.collect.browser']) expect(sourceCaptureActive([{actionId,status:'pending'}])).toBe(true);
    for(const actionId of ['documents.extract','review.run','star.set','awards.import']) expect(sourceCaptureActive([{actionId,status:'running'}])).toBe(false);
  });
  it('rechecks live raw state before actions and leaves saved-byte extraction free', async () => {
    const calls:any[]=[];
    let runs:any[]=[{id:'history',actionId:'scrape.historical',status:'pending'}];
    const host=async (method:string,input?:unknown) => {calls.push({method,input});return {runs};};
    await expect(assertDocumentBrowserIdle(host)).rejects.toThrow('active source capture');
    runs=[{id:'download',actionId:'documents.download.all',status:'waiting_for_user'}];
    await expect(assertDocumentBrowserIdle(host)).rejects.toThrow('active attachment download');
    runs=[{id:'done',actionId:'scrape.historical',status:'succeeded'},{id:'extract',actionId:'documents.extract',status:'running'}];
    await expect(assertDocumentBrowserIdle(host)).resolves.toBeUndefined();
    expect(calls.map(call => call.method)).toEqual(['state', 'schedules.read', 'state', 'state']);
  });
});

it('permits overlapping work on separate browsers and keeps a shared or unknown browser exclusive', async () => {
  for (const purpose of ['download', 'capture'] as const) {
    const actionId = purpose === 'download' ? 'scrape.full' : 'documents.download.all';
    const runs = [{ id: 'active', actionId, status: 'running' }];
    const hostWith = (downloads: string) => async (method: string) => method === 'state' ? { runs } : {
      browsers: { collection: { id: 'scraper' }, downloads: { id: downloads } },
    };
    await expect(assertDocumentBrowserIdle(hostWith('dedicated'), purpose)).resolves.toBeUndefined();
    await expect(assertDocumentBrowserIdle(hostWith('scraper'), purpose)).rejects.toThrow(/Wait for/);
    await expect(assertDocumentBrowserIdle(hostWith(''), purpose)).rejects.toThrow(/Wait for/);
    await expect(assertDocumentBrowserIdle(hostWith('dedicated'), purpose === 'download' ? 'capture' : 'download')).rejects.toThrow(/Wait for/);
  }
});

it('finishes the preview during a capture and bounds every page at the original high-water mark', async () => {
  const calls: any[] = [];
  const host = async (method: string, input: any) => {
    expect(method).toBe('catalog.query');
    calls.push(input);
    if (input.statement.includes('max(rowid)')) return { rows: [{last: 201}] };
    const rows = Array.from({length: 202}, (_, i) => ({cursor:i+1,id:String(i+1),status:'Open',attachments:'[{}]'}));
    return { rows: rows.filter(r => r.cursor > input.parameters[0] && r.cursor <= input.parameters[1]).slice(0,200) };
  };
  const records = await readDocumentCandidates(host, 'current', true);
  expect(calls.slice(1).map(call => call.parameters)).toEqual([[0,201], [200,201]]);
  expect(records).toHaveLength(201);
  expect(records.some(row => row.id === '202')).toBe(false);
});
