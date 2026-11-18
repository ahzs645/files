import { useRef, useState } from 'react';
import { Select } from '@zoer/plugin-ui/database';
import { Button } from '../../apps/dashboard/src/components/ui/Button';
import { host } from './bridge';
import { useDocumentQueue, type DownloadScope } from './document-queue';
import { useDocumentBrowsers } from './use-document-browsers';
import { documentScope, readDocumentCandidates } from './document-scope';
import { refresh, refreshAfterChange, useWorkspace } from './backend';
import { hostHref, navigatePlugin } from './navigation';
import { activeDocumentDownload, assertDocumentBrowserIdle, retryTimeText, sourceCaptureProgressPath, type ActiveDownload } from './document-run';

export function BulkDocuments({running,activeBatch,onStarted}:{running:boolean;/** The running or paused download batch, known before the run list catches up. */activeBatch?:ActiveDownload|null;onStarted:()=>Promise<void>}) {
  const {model}=useWorkspace();
  const [submitted,setSubmitted]=useState<string>();
  const { capturing: sourceRunning, downloading, separate, downloadBlocked, captureBlocked } = useDocumentBrowsers(submitted);
  const downloadRunning = running || downloading;
  // The run that blocks a new download. It can be stopped here, also while it only waits for an automatic retry.
  const active = activeDocumentDownload(model?.documentRuns) ?? activeBatch ?? null;
  const [scope,setScope]=useState<DownloadScope>('open');
  const coverage=useDocumentQueue(scope,{enabled:!!model,running:downloadRunning || sourceRunning});
  const {data:preview,isPending:loading}=coverage;
  const [busy,setBusy]=useState(false),[stopping,setStopping]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState('');
  const pending=useRef(false);
  const load=async()=>{setError('');try{await coverage.refetch({throwOnError:true});}catch(e){setError((e as Error).message);}};
  const start=async()=>{
    if(pending.current)return;pending.current=true;setBusy(true);setError('');setMessage('');
    try {
      await assertDocumentBrowserIdle(host);
      const result=await host('action',{actionId:'documents.download.queue',input:{scope}});
      setSubmitted(result.run.id);
      setMessage('Download queued. You can leave this page.');
      await onStarted();
      await refresh();
    }catch(e){setError((e as Error).message);}finally{pending.current=false;setBusy(false);}
  };
  const stop=async()=>{
    if(pending.current||!active)return;pending.current=true;setStopping(true);setError('');setMessage('');
    try {
      await host('cancel',{id:active.id});
      setSubmitted(undefined);
      setMessage('Download stopped. Saved files are kept; start a new download or use Retry in History.');
      await onStarted();
      await refreshAfterChange();
    }catch(e){setError((e as Error).message);}finally{pending.current=false;setStopping(false);}
  };
  const captureDetails=async()=>{
    if(pending.current)return;pending.current=true;setBusy(true);setError('');setMessage('');
    try {
      await assertDocumentBrowserIdle(host, 'capture');
      const detailScope=scope==='open'?'current':'all';
      const fresh=await readDocumentCandidates(host,detailScope,sourceRunning);
      const ids=documentScope(fresh,detailScope).missingDetails;
      if(!ids.length){setMessage('All notices in this scope have captured details.');return;}
      await host('action',{actionId:'scrape.details',input:{recordIds:ids.slice(0,50)}});
      setMessage(`Detail capture started for ${Math.min(ids.length,50)} opportunities. Refresh after the run finishes${ids.length>50?' to capture the next 50':''}.`);
      await onStarted();
      await refresh();
    }catch(e){setError((e as Error).message);}finally{pending.current=false;setBusy(false);}
  };
  const actionable=preview && (preview.neverTried+preview.retryDue+preview.retryScheduled+preview.waitingForBrowser);
  const counts=preview ? [
    [preview.neverTried,'never tried'], [preview.retryDue,'ready to retry'], [preview.retryScheduled,'scheduled for retry'],
    [preview.waitingForBrowser,'waiting for a browser check'], [preview.skipped,'skipped'],
    [preview.unavailable,'unavailable'], [preview.exhausted,'retry limit reached'],
  ].flatMap(([count,label])=>count?[`${count.toLocaleString()} ${label}`]:[]) : [];
  return <section className="zoer-history doc-download" aria-label="Download missing attachments">
    <h2>Download missing attachments</h2>
    <div className="research-toolbar research-stack">
      <label className="research-label"><span className="sr-only">Scope</span><Select aria-label="Download scope" value={scope} onChange={e=>setScope(e.target.value as DownloadScope)} disabled={busy||stopping}><option value="open">Open opportunities</option><option value="all">All opportunities</option></Select></label>
      <Button disabled={loading||busy||stopping||running||downloadBlocked||!actionable} onClick={()=>void start()}>{busy?'Starting…':!downloadRunning?'Download missing files':active?.waiting?'Download paused…':'Download running…'}</Button>
      {active&&<Button variant="ghost" disabled={busy||stopping} onClick={()=>void stop()}>{stopping?'Stopping…':'Stop download'}</Button>}
      <Button variant="ghost" disabled={loading||busy||stopping} onClick={()=>void load()}>Refresh</Button>
    </div>
    {loading?<p role="status">Counting attachments…</p>:preview&&<>
      <p><strong>{preview.saved.toLocaleString()} of {preview.files.toLocaleString()} linked files saved</strong> · {preview.fullySaved.toLocaleString()} of {preview.withLinks.toLocaleString()} opportunities with links complete</p>
      {counts.length>0&&<p aria-label="Files still missing">{counts.join(' · ')}</p>}
      {preview.nextRetryAt!==null&&<p>Next file eligible for retry {new Date(preview.nextRetryAt).toLocaleString(undefined,{dateStyle:'medium',timeStyle:'short'})}.</p>}
      {preview.waitingForBrowser>0&&<a className="research-link" href={hostHref('#/browsers')}>Open the download browser</a>}
      {preview.retryDue+preview.retryScheduled+preview.skipped+preview.exhausted>0&&<button type="button" className="research-link" onClick={()=>navigatePlugin('/documents?tab=files&fileStatus=failed')}>Review failed and skipped files</button>}
      {(preview.withoutLinks>0||preview.needsDetails>0)&&<p>
        {preview.withoutLinks>0&&<>{preview.withoutLinks.toLocaleString()} opportunities have captured details with no saved links. </>}
        {preview.needsDetails>0&&<>{preview.needsDetails.toLocaleString()} need details. <button type="button" className="research-link" disabled={busy||stopping||running||captureBlocked} onClick={()=>void captureDetails()}>Capture missing details</button></>}
      </p>}
    </>}
    {sourceRunning&&<p role="status">{separate ? 'A source capture is active. Downloads use a separate browser. Refresh to include newly captured links.' : 'A source capture is active or paused. A separate download browser is needed to download at the same time.'} <button type="button" className="research-link" onClick={()=>navigatePlugin(sourceCaptureProgressPath(model?.captureRuns))}>View progress</button></p>}
    {active?.waiting&&<p role="status">The download is paused and nothing is transferring. Zoer retries automatically{retryTimeText(active.retryAt)&&` at ${retryTimeText(active.retryAt)}`}. Stop it to start a new download now; saved files are kept.</p>}
    {message&&<p role="status">{message}</p>}{(error||coverage.error)&&<p role="alert">{error||(coverage.error as Error).message}</p>}
  </section>;
}
