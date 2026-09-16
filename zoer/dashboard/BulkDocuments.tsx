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
      setMessage(`Download started for ${selected.ids.length} opportunities. Follow Batch history below; you can leave this page.`);
      await onStarted();
    }catch(e){setError((e as Error).message);}finally{pending.current=false;setBusy(false);}
  };
  return <section className="zoer-history" aria-label="Bulk attachment download">
    <h2>All opportunity attachments</h2>
    <div className="zoer-record-tools">
      <label className="research-label">Download scope<Select aria-label="Download scope" value={scope} onChange={e=>setScope(e.target.value as 'current'|'all')} disabled={busy}><option value="current">Current opportunities</option><option value="all">All saved opportunities</option></Select></label>
      <Button disabled={loading||busy||running||!preview?.ids.length} onClick={()=>void start()}>{busy?'Starting download…':'Download all attachments'}</Button>
      <Button variant="ghost" disabled={loading||busy} onClick={()=>void load()}>Refresh counts</Button>
    </div>
    {loading?<p role="status">Counting saved opportunities and attachment links…</p>:preview&&<p>{preview.total.toLocaleString()} opportunities · {preview.ids.length.toLocaleString()} with {preview.links.toLocaleString()} saved attachment links · {preview.missing.toLocaleString()} without saved links.</p>}
    <p>{scope==='current'?'Current means saved status Open with a closing date that has not passed, or no usable closing date.':'Includes closed and past opportunities in the saved catalog.'} This uses all saved pages, independent of the selection below. Live source completeness has not been verified.</p>
    {!!preview?.missing&&<p>{preview.missing} opportunities have no saved links and will be skipped. <Button variant="ghost" onClick={()=>navigatePlugin('/scraper')}>Capture missing details</Button></p>}
    {!!preview?.unknownDates&&<p>{preview.unknownDates} opportunities in this scope have an unknown closing date.</p>}
    <p>Files are saved in Zoer for AI review. Existing files are reused. Up to 100 files per opportunity, 8 MiB each; six hours per run. Stop and Retry in Batch history retain saved files.</p>
    {running&&<p role="status">A document download is already running. Follow Batch history below.</p>}
    {message&&<p role="status">{message}</p>}{error&&<p role="alert">{error}</p>}
  </section>;
}
