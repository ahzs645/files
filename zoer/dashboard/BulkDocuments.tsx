import { useEffect, useRef, useState } from 'react';
import { Select } from '@zoer/plugin-ui/database';
import { Button } from '../../apps/dashboard/src/components/ui/Button';
import { host } from './bridge';
import { documentScope, readDocumentCandidates, type DocumentCandidate } from './document-scope';
import { navigatePlugin } from './navigation';

export function BulkDocuments({running,onStarted}:{running:boolean;onStarted:()=>Promise<void>}) {
  const [scope,setScope]=useState<'current'|'all'>('current');
  const [records,setRecords]=useState<DocumentCandidate[]|null>(null);
  const [loading,setLoading]=useState(true),[busy,setBusy]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState('');
  const pending=useRef(false);
  const load=async()=>{setLoading(true);setError('');try{setRecords(await readDocumentCandidates(host));}catch(e){setRecords(null);setError((e as Error).message);}finally{setLoading(false);}};
  useEffect(()=>{void load();},[]);
  const preview=records?documentScope(records,scope):null;
  const start=async()=>{
    if(pending.current)return;pending.current=true;setBusy(true);setError('');setMessage('');
    try {
      // Refresh the full snapshot at the click; never submit only the visible table page.
      const fresh=await readDocumentCandidates(host);setRecords(fresh);
      const selected=documentScope(fresh,scope);
      if(!selected.ids.length)throw new Error('No saved attachment links in this scope. Capture opportunity details in Scraper first.');
      await host('action',{actionId:'documents.download.all',input:{recordIds:selected.ids,force:false}});
      setMessage(`Download started for ${selected.ids.length.toLocaleString()} opportunities. Progress appears in Batch history below; you can leave this page.`);
      await onStarted();
    }catch(e){setError((e as Error).message);}finally{pending.current=false;setBusy(false);}
  };
  const noun=scope==='current'?'current':'saved';
  return <section className="zoer-history" aria-label="Bulk attachment download">
    <h2>Bulk attachment download</h2>
    <div className="zoer-record-tools">
      <label className="research-label">Download scope<Select aria-label="Download scope" value={scope} onChange={e=>setScope(e.target.value as 'current'|'all')} disabled={busy}><option value="current">Current opportunities</option><option value="all">All saved opportunities</option></Select></label>
      <Button disabled={loading||busy||running||!preview?.ids.length} onClick={()=>void start()}>{busy?'Starting download…':'Download all attachments'}</Button>
      <Button variant="ghost" disabled={loading||busy} onClick={()=>void load()}>Refresh counts</Button>
    </div>
    {loading?<p role="status">Counting saved opportunities and attachment links…</p>:preview&&<p><strong>{preview.total.toLocaleString()} {noun} opportunities.</strong> {preview.ids.length.toLocaleString()} have {preview.links.toLocaleString()} saved attachment links; {preview.missing.toLocaleString()} have none.</p>}
    <p>{scope==='current'?'Current means the saved status is Open and the closing date is either still ahead or unknown.':'All includes closed and past opportunities in the saved catalog.'} This covers every saved opportunity, not only the records selected below. Counts come from saved data and may differ from the live site.</p>
    {!!preview?.unknownDates&&scope==='current'&&<p>{preview.unknownDates.toLocaleString()} of these have no usable closing date and are treated as current.</p>}
    {!!preview?.missing&&<div className="zoer-record-tools"><span>{preview.missing.toLocaleString()} opportunities have no saved attachment links and will be skipped.</span><Button variant="ghost" onClick={()=>navigatePlugin('/scraper')}>Capture missing details</Button></div>}
    <details><summary>Limits and storage</summary><p>Files are stored in Zoer for AI review, and files already downloaded are reused rather than fetched again. Each run takes up to 100 files per opportunity at 8 MiB per file and stops after six hours. Stop and Retry in Batch history keep the files already saved.</p></details>
    {running&&<p role="status">A download is already running. See Batch history below.</p>}
    {message&&<p role="status">{message}</p>}{error&&<p role="alert">{error}</p>}
  </section>;
}
