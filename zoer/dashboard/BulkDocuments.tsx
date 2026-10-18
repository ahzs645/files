import { useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Select } from '@zoer/plugin-ui/database';
import { Button } from '../../apps/dashboard/src/components/ui/Button';
import { host } from './bridge';
import { documentScope, readDocumentCandidates, type DocumentCandidate } from './document-scope';
import { refresh, useWorkspace } from './backend';
import { navigatePlugin } from './navigation';
import { assertDocumentBrowserIdle, documentDownloadActive, sourceCaptureActive, sourceCaptureProgressPath } from './document-run';

export function BulkDocuments({running,onStarted}:{running:boolean;onStarted:()=>Promise<void>}) {
  const {model}=useWorkspace();
  const sourceRunning=sourceCaptureActive(model?.captureRuns);
  const [submitted,setSubmitted]=useState<string>();
  const downloadRunning=running||documentDownloadActive(model?.documentRuns,submitted);
  const [scope,setScope]=useState<'current'|'all'>('current');
  const client=useQueryClient(), queryKey=['procurement','document-candidates',scope];
  const candidates=useQuery({queryKey,enabled:!!model,queryFn:()=>readDocumentCandidates(host,scope),refetchInterval:sourceRunning?30000:false});
  const records=candidates.data,loading=candidates.isPending;
  const setRecords=(records:DocumentCandidate[])=>client.setQueryData(queryKey,records);
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState('');
  const pending=useRef(false);
  const load=async()=>{setError('');try{await candidates.refetch({throwOnError:true});}catch(e){setError((e as Error).message);}};
  const preview=records?documentScope(records,scope):null;
  const start=async()=>{
    if(pending.current)return;pending.current=true;setBusy(true);setError('');setMessage('');
    try {
      await assertDocumentBrowserIdle(host);
      // Refresh the full snapshot at the click; never submit only the visible table page.
      const fresh=await readDocumentCandidates(host,scope);setRecords(fresh);
      const selected=documentScope(fresh,scope);
      if(!selected.ids.length)throw new Error('No saved attachment links in this scope. Capture opportunity details in Scraper first.');
      const result=await host('action',{actionId:'documents.download.all',input:{recordIds:selected.ids,force:false}});
      setSubmitted(result.run.id);
      setMessage(`Download started for ${selected.ids.length.toLocaleString()} ${selected.ids.length === 1 ? 'opportunity' : 'opportunities'}. You can leave this page.`);
      await onStarted();
      await refresh();
    }catch(e){setError((e as Error).message);}finally{pending.current=false;setBusy(false);}
  };
  const captureDetails=async()=>{
    if(pending.current)return;pending.current=true;setBusy(true);setError('');setMessage('');
    try {
      await assertDocumentBrowserIdle(host);
      const fresh=await readDocumentCandidates(host,scope);setRecords(fresh);
      const ids=documentScope(fresh,scope).missingDetails;
      if(!ids.length){setMessage('All notices in this scope have captured details.');return;}
      await host('action',{actionId:'scrape.details',input:{recordIds:ids.slice(0,50)}});
      setMessage(`Detail capture started for ${Math.min(ids.length,50)} opportunities. Refresh after the run finishes${ids.length>50?' to capture the next 50':''}.`);
      await onStarted();
      await refresh();
    }catch(e){setError((e as Error).message);}finally{pending.current=false;setBusy(false);}
  };
  return <section className="zoer-history doc-download" aria-label="Download all attachments">
    <h2>Download all attachments</h2>
    <div className="research-toolbar research-stack">
      <label className="research-label"><span className="sr-only">Scope</span><Select aria-label="Download scope" value={scope} onChange={e=>setScope(e.target.value as 'current'|'all')} disabled={busy}><option value="current">Open opportunities</option><option value="all">All opportunities</option></Select></label>
      <Button disabled={loading||busy||downloadRunning||sourceRunning||!preview?.ids.length} onClick={()=>void start()} title="Up to 100 files per opportunity, 150 MB each. Files already saved are reused.">{busy?'Starting…':downloadRunning?'Download running…':'Download all'}</Button>
      <Button variant="ghost" disabled={loading||busy} onClick={()=>void load()}>Refresh</Button>
    </div>
    {loading?<p role="status">Counting attachments…</p>:preview&&<p>
      <strong>{preview.links.toLocaleString()} attachment links</strong> from {preview.ids.length.toLocaleString()} of {preview.total.toLocaleString()} opportunities.
      {!!preview.capturedWithoutLinks&&<> {preview.capturedWithoutLinks.toLocaleString()} have captured details with no saved attachment links.</>}
      {!!preview.missingDetails.length&&<> {preview.missingDetails.length.toLocaleString()} still need details. <button type="button" className="research-link" disabled={busy||downloadRunning||sourceRunning} onClick={()=>void captureDetails()}>Capture missing details</button></>}
    </p>}
    {sourceRunning&&<p role="status">A source capture is active or paused. <button type="button" className="research-link" onClick={()=>navigatePlugin(sourceCaptureProgressPath(model?.captureRuns))}>View progress</button></p>}
    {message&&<p role="status">{message}</p>}{(error||candidates.error)&&<p role="alert">{error||(candidates.error as Error).message}</p>}
  </section>;
}
