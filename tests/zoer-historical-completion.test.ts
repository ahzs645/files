import { describe, expect, it } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { CompletionQueue, assertCaptured, assertFinalCoverage, assertRun, attachmentsOf, missingAttachments } from '../zoer/tools/complete-historical.mjs';

const url = 'https://bcbid.gov.bc.ca/bare.aspx/en/fil/download_public/abc';
const row = { id: 'opportunity:1', version: 3, complete: 1, attachments: JSON.stringify([{url},{url}]) };

describe('finite historical completion queue', () => {
  it('requires full-tab capture and keeps no-link notices out of download failures', () => {
    expect(attachmentsOf(row)).toHaveLength(1);
    expect(missingAttachments({...row,attachments:null},[])).toEqual([]);
    expect(() => assertCaptured([row], ['opportunity:1'])).not.toThrow();
    expect(() => assertCaptured([{...row,complete:0}], ['opportunity:1'])).toThrow('incomplete');
    expect(() => assertCaptured([], ['opportunity:1'])).toThrow('incomplete');
    expect(() => attachmentsOf({...row,attachments:JSON.stringify([{url:'https://example.com/file'}])})).toThrow('Unreviewed');
  });
  it('only reuses downloaded nonempty originals bound to the exact expected URL', () => {
    const saved = {record_id:row.id,url,status:'downloaded',sha256:'a'.repeat(64),bytes:42};
    expect(missingAttachments(row,[saved])).toEqual([]);
    for(const change of [{record_id:'opportunity:2'},{url:url+'other'},{status:'failed'},{bytes:0},{sha256:'invalid'}]) {
      expect(missingAttachments(row,[{...saved,...change}])).toHaveLength(1);
    }
  });
  it('stops on interactive control, terminal failure, or changed action', () => {
    expect(assertRun({actionId:'scrape.details',status:'running'},'scrape.details')).toBe(false);
    expect(assertRun({actionId:'scrape.details',status:'succeeded'},'scrape.details')).toBe(true);
    expect(assertRun({actionId:'scrape.historical',status:'retry_scheduled',resumable:{state:'waiting'}},'scrape.historical')).toBe(false);
    for(const change of [{status:'failed'},{paused:true},{status:'waiting_for_approval'},{actionId:'other'}]) {
      expect(() => assertRun({id:'r',actionId:'scrape.details',status:'running',...change},'scrape.details')).toThrow();
    }
  });
  it('waits only for the host-projected maintenance pause, including non-resumable downloads', () => {
    const paused = {id:'source',actionId:'scrape.historical',status:'waiting_for_event',paused:true,
      statusReason:'Paused for Zoer update',resumable:{state:'paused-for-update'}};
    expect(assertRun(paused,'scrape.historical')).toBe(false);
    expect(assertRun({...paused,actionId:'documents.download',resumable:undefined},'documents.download')).toBe(false);
    for (const change of [
      {status:'waiting_for_user'}, {paused:false}, {statusReason:'Complete the browser check'},
      {resumable:{state:'needs-user'}}, {resumable:{state:'paused'}}, {resumable:{state:'waiting'}},
    ]) expect(() => assertRun({...paused,...change},'scrape.historical')).toThrow();
    expect(() => assertRun({...paused,actionId:'other'},'scrape.historical')).toThrow('Unexpected action');
  });
  it('preserves the pending run during maintenance and resumes polling it without resubmission', async () => {
    const pending={action:'documents.download',runId:'existing-download',phase:'running',ids:['opportunity:1']};
    const state:any={phase:'documents.download',pending:structuredClone(pending)};
    const saves:any[]=[];
    const queue=new CompletionQueue({historicalRun:'source'},state,async v=>saves.push(structuredClone(v)));
    queue.checkIdentity=async()=>{}; queue.storageGuard=async()=>{};
    queue.api=async()=>({run:{id:'source',actionId:'scrape.historical',status:'waiting_for_event',paused:true,
      statusReason:'Paused for Zoer update',resumable:{state:'paused-for-update'}}});
    queue.checkpoint=async()=>{throw Error('Should not read/select work during maintenance');};
    queue.pendingStep=async()=>{throw Error('Should not poll pending work during collector maintenance');};
    queue.submit=async()=>{throw Error('Should never resubmit an existing action');};
    await queue.step();
    expect(state.phase).toBe('waiting_for_maintenance');
    expect(saves.at(-1).pending).toEqual(pending);
    queue.api=async()=>({run:{id:'source',actionId:'scrape.historical',status:'running',resumable:{state:'running'}}});
    queue.checkpoint=async()=>({listingsCaptured:1,detailsCompleted:1,rangesCompleted:0,ranges:[],complete:false,capturedAt:'2026-11-10T21:17:23Z'});
    let polled=0;
    queue.pendingStep=async()=>{polled++;expect(state.pending).toEqual(pending);return false;};
    await queue.step();
    expect(polled).toBe(1);
    expect(state.phase).toBe('documents.download');
    expect(state.pending).toEqual(pending);
  });
  it('does not call an incomplete scope or mismatched count complete', () => {
    const cp={complete:true,pending:[],ranges:[],listingsCaptured:2,detailsCompleted:2};
    expect(() => assertFinalCoverage(cp,2,3,3,true)).not.toThrow();
    expect(() => assertFinalCoverage({...cp,complete:false},2,3,3,true)).toThrow();
    expect(() => assertFinalCoverage(cp,1,3,3,true)).toThrow('count');
    expect(() => assertFinalCoverage(cp,2,3,2,true)).toThrow('original');
  });
  it('durably preserves an ambiguous POST and refuses to create another action', async () => {
    const saved:any[]=[];
    const state:any={pending:null};
    const queue = new CompletionQueue({baseUrl:'http://localhost',pluginVersion:'v',documentBrowser:'br'}, state, async v=>saved.push(structuredClone(v)), async (_url:any,options:any)=> {
      if (String(_url).endsWith('/plan')) return Response.json({plan:{eligible:true,effect:'local_write',pluginVersion:'v',approval:{policy:'when_configured',requiredForExecution:null},fingerprintSha256:'a'.repeat(64)}});
      expect(saved.at(-1).pending.phase).toBe('intent');
      expect(JSON.parse(options.body).idempotencyKey).toBe(saved.at(-1).pending.idempotencyKey);
      throw Error('Connection reset after submission');
    });
    await expect(queue.submit('scrape.details',['opportunity:1'])).rejects.toThrow('Connection reset');
    expect(state.pending.phase).toBe('outcome_unknown');
    const key=state.pending.idempotencyKey;
    await expect(queue.submit('scrape.details',['opportunity:1'])).rejects.toThrow('intent already exists');
    expect(state.pending.idempotencyKey).toBe(key);
  });
  it('requires fresh eligible local-write plans with no pending approval', async () => {
    const state:any={pending:null};
    const queue = new CompletionQueue({baseUrl:'http://localhost',pluginVersion:'v'},state,async()=>{},async()=>Response.json({plan:{eligible:true,effect:'external_write',pluginVersion:'v'}}));
    await expect(queue.submit('scrape.details',['opportunity:1'])).rejects.toThrow('requires review');
    expect(state.pending).toBeNull();
  });
  it('hashes original bytes and rejects corruption even when byte counts match', async () => {
    const root=await mkdtemp(join(tmpdir(),'bcbid-verify-'));
    try {
      const bytes=Buffer.from('original'), hash=createHash('sha256').update(bytes).digest('hex');
      await writeFile(join(root,hash),bytes);
      const docs=[{id:'doc',record_id:row.id,url,sha256:hash,bytes:bytes.length,status:'downloaded'}];
      const queue=new CompletionQueue({filesDir:root},{verifiedHashes:{}},async()=>{});
      expect(await queue.verify([row],docs,true)).toMatchObject({files:1,bytes:bytes.length});
      await writeFile(join(root,hash),'changed!');
      await expect(queue.verify([row],docs,true)).rejects.toThrow('SHA-256 mismatch');
    } finally { await rm(root,{recursive:true}); }
  });
  it('rejects a truncated catalog result rather than treating a partial page as complete', async () => {
    const queue=new CompletionQueue({baseUrl:'http://localhost'}, {},async()=>{},async()=>Response.json({truncated:true,rows:[]}));
    await expect(queue.query('SELECT id FROM records')).rejects.toThrow('truncated');
  });
});
