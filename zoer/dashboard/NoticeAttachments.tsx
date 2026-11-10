import {useState} from 'react';
import {useQuery} from '@tanstack/react-query';
import {Btn} from '@zoer/plugin-ui/controls';
import type {OpportunityDetail} from '@bcbid/shared';
import {host} from './bridge';
import {useCapabilities} from './capabilities';
import {downloadDocumentBundle,sizeText} from './document-bundle';
import {navigatePlugin} from './navigation';
import {attachmentFileName,attachmentInventory} from './notice-attachments';

/** Saved originals on legacy opportunity links; no source-site navigation is needed to download them. */
export function NoticeAttachments({detail}:{detail:OpportunityDetail}) {
 const {writes}=useCapabilities();
 const id='opportunity:'+detail.sourceKey;
 const query=useQuery({queryKey:['catalog','procurement-detail',id],queryFn:()=>host('catalog.record',{id})});
 const [busy,setBusy]=useState(''),[error,setError]=useState('');
 const inventory=attachmentInventory(detail.attachments,query.data?.documents??[]),saved=inventory.filter(row=>row.saved).length;
 const download=async(key:string,work:()=>Promise<unknown>)=>{setBusy(key);setError('');try{await work();}catch(e){setError((e as Error).message);}finally{setBusy('');}};
 return <div>
  {query.isPending ? <p role="status">Checking saved files…</p> : query.isError ? <p role="alert">Saved file status could not be read. {(query.error as Error).message}</p> : <p>{saved} of {inventory.length} files saved in Zoer.</p>}
  {saved>0 && <div className="bid-detail-actions">{writes && <Btn size="sm" disabled={!!busy} onClick={()=>void download('all',()=>downloadDocumentBundle(host,[id],{scope:'this notice'}))}>{busy==='all'?'Preparing ZIP…':`Download all ${saved} saved files (ZIP)`}</Btn>}<Btn size="sm" variant="secondary" onClick={()=>navigatePlugin(`/procurement?kind=opportunity&notice=${encodeURIComponent(id)}&tab=evidence`)}>View saved files</Btn></div>}
  {error && <p role="alert">{error}</p>}
  <ul className="bid-detail-documents">{inventory.map(({attachment,saved:doc})=><li key={attachment.url}><div style={{minWidth:0,width:'100%'}}>
   {doc ? <><button type="button" className="pc-link-btn" disabled={!!busy} onClick={()=>void download(doc.id,()=>host('catalog.download',{id:doc.id,name:attachmentFileName(doc.name,doc.media_type)}))}>{attachment.name}</button><p className="bid-detail-muted">Saved · {sizeText(doc.bytes??0)} · <button type="button" className="pc-link-btn" disabled={!!busy} onClick={()=>void download(doc.id,()=>host('catalog.download',{id:doc.id,name:attachmentFileName(doc.name,doc.media_type)}))}>Download saved file</button></p></> : <><span>{attachment.name}</span>{!query.isPending && !query.isError && <p className="bid-detail-muted">Not saved yet</p>}</>}
   <a href={attachment.url} target="_blank" rel="noreferrer">Open BC Bid original ↗</a>
  </div></li>)}</ul>
 </div>;
}
