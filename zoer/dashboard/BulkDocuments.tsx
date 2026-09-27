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
      setMessage(`Download started for ${selected.ids.length.toLocaleString()} opportunities. You can leave this page.`);
      await onStarted();
    }catch(e){setError((e as Error).message);}finally{pending.current=false;setBusy(false);}
  };
  return <section className="zoer-history" aria-label="Download all attachments">
    <h2>Download all attachments</h2>
    <div className="research-toolbar research-stack">
      <label className="research-label">Scope<Select aria-label="Download scope" value={scope} onChange={e=>setScope(e.target.value as 'current'|'all')} disabled={busy}><option value="current">Open opportunities</option><option value="all">All opportunities</option></Select></label>
      <Button disabled={loading||busy||running||!preview?.ids.length} onClick={()=>void start()}>{busy?'Starting…':'Download all'}</Button>
      <Button variant="ghost" disabled={loading||busy} onClick={()=>void load()}>Refresh</Button>
    </div>
    {loading?<p role="status">Counting attachments…</p>:preview&&<p>
      <strong>{preview.links.toLocaleString()} attachment links</strong> across {preview.ids.length.toLocaleString()} of {preview.total.toLocaleString()} opportunities.
      {!!preview.missing&&<> {preview.missing.toLocaleString()} have no attachment links. <button type="button" className="research-link" onClick={()=>navigatePlugin('/scraper')}>Capture details</button></>}
    </p>}
    <p className="research-note">Up to 100 files per opportunity, 150 MiB each. Files already saved are reused.</p>
    {running&&<p role="status">A download is running. See Download history.</p>}
    {message&&<p role="status">{message}</p>}{error&&<p role="alert">{error}</p>}
  </section>;
}
