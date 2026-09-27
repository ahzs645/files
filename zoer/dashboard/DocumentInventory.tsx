import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Button } from '../../apps/dashboard/src/components/ui/Button';
import { Select } from '@zoer/plugin-ui/database';
import { host } from './bridge';

const query = (statement: string, parameters: (string | number)[] = []) => host('catalog.query', {statement,parameters});
const bytes = (n: number) => n >= 1048576 ? `${(n/1048576).toFixed(1)} MiB` : `${Math.ceil(n/1024)} KiB`;
export function DocumentInventory({onDetails, refreshKey = '', running}: {onDetails(id:string):void;refreshKey?:string;running:boolean}) {
  const [filter,setFilter]=useState('all'),[search,setSearch]=useState(''),[page,setPage]=useState(0);
  const [busy,setBusy]=useState(''),[error,setError]=useState(''),[message,setMessage]=useState('');
  const stats=useQuery({queryKey:['procurement','document-stats',refreshKey],queryFn:()=>query("SELECT count(*) files,count(DISTINCT record_id) records,sum(status='downloaded') downloaded,sum(status='failed') failed,sum(length(text)>0) readable,sum(status='downloaded' AND coalesce(length(text),0)=0) unreadable,sum(bytes) bytes FROM documents"),refetchInterval:10000});
  const where=filter==='failed'?"d.status='failed'":filter==='unreadable'?"d.status='downloaded' AND coalesce(length(d.text),0)=0":filter==='warnings'?"d.error IS NOT NULL AND d.status='downloaded'":"1=1";
  const parameters=[`%${search}%`,`%${search}%`,`%${search}%`];
  const clause=`d.name LIKE ? AND ${where} OR r.title LIKE ? AND ${where} OR d.record_id LIKE ? AND ${where}`;
  const files=useQuery({queryKey:['procurement','document-files',filter,search,page,refreshKey],queryFn:()=>query(`SELECT d.id,d.record_id,d.name,d.media_type,d.status,d.bytes,length(d.text) chars,d.error,d.updated_at,r.title FROM documents d JOIN records r ON r.id=d.record_id WHERE ${clause} ORDER BY d.updated_at DESC,d.id LIMIT 51 OFFSET ?`,[...parameters,page*50]),refetchInterval:10000});
  const rows=(files.data?.rows??[]).slice(0,50),count=stats.data?.rows?.[0];
  const act=async(row:any,extract:boolean)=>{setBusy(row.id);setError('');setMessage('');try{await host('action',{actionId:extract?'documents.extract':'documents.download',input:{recordIds:[row.record_id],...(extract?{}:{force:false})}});setMessage(`${extract?'Text extraction':'Download retry'} started for ${row.title}. Saved files are retained.`);}catch(e){setError((e as Error).message);}finally{setBusy('');}};
  return <section className="zoer-history" aria-label="Document coverage">
    <h2>Document coverage</h2>
    <p className="research-note">Saved files and text available to AI are counted separately. Empty text can mean a scan, drawing, unsupported file or failed extraction.</p>
    {count&&<dl className="research-metrics">{[['Saved files',`${count.downloaded??0} / ${count.files}`],['Readable by AI',count.readable??0],['Without text',count.unreadable??0],['Download failures',count.failed??0],['Stored originals',bytes(count.bytes??0)]].map(([label,value])=><div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>}
    <div className="research-toolbar"><label className="research-label research-grow">Search files<input maxLength={250} aria-label="Search files" placeholder="Filename, bid number or title" value={search} onChange={e=>{setSearch(e.target.value);setPage(0);}} /></label><label className="research-label">Show<Select aria-label="File coverage" value={filter} onChange={e=>{setFilter(e.target.value);setPage(0);}}><option value="all">All files</option><option value="failed">Download failed</option><option value="unreadable">Saved without text</option><option value="warnings">Extraction warnings</option></Select></label></div>
    {(error||files.error||stats.error)&&<p role="alert">{error||(files.error??stats.error)?.message}</p>}{message&&<p role="status">{message}</p>}
    {files.isPending?<p role="status">Loading saved files…</p>:!rows.length?<p>No files match these filters.</p>:<div className="research-file-list">{rows.map((row:any)=><article key={row.id}>
      <div className="research-file-info"><strong>{row.name}</strong><span className="research-note">{row.title} · {row.record_id.replace(/^opportunity:/,'')} · {row.bytes?bytes(row.bytes):'Size unknown'}</span><span>{row.status==='failed'?'Download failed':row.chars?'Text available':'Saved · no readable text'}{row.chars?` · ${Number(row.chars).toLocaleString()} characters`:''}</span>{row.error&&<p className="research-file-warning">{row.error}</p>}</div>
      <div className="research-toolbar"><Button variant="ghost" onClick={()=>onDetails(row.record_id)}>View files</Button><Button variant="ghost" disabled={!!busy||running} onClick={()=>void act(row,row.status==='downloaded')}>{busy===row.id?'Starting…':row.status==='downloaded'?'Extract saved text':'Retry bid downloads'}</Button></div>
    </article>)}</div>}
    <div className="research-toolbar research-pager"><Button variant="ghost" disabled={!page||files.isFetching} onClick={()=>setPage(page-1)}>Previous files</Button><span>Page {page+1}</span><Button variant="ghost" disabled={!files.data||files.data.rows.length<=50||files.isFetching} onClick={()=>setPage(page+1)}>Next files</Button></div>
    <details><summary>Extraction coverage and limits</summary><p className="research-note">PDF, DOCX, DOC, XLSX, text and bounded ZIP contents are supported. PDF extraction reads up to 100 pages and uses English/French OCR on up to 10 sparse pages per file or archive. Text is capped at 240,000 characters. Spreadsheet formulas are not recalculated. Nested ZIPs, encrypted archives, legacy XLS and CAD drawings need manual review. OCR and extraction warnings remain attached to each file. Extract saved text processes all saved files for that bid without downloading them again.</p></details>
  </section>;
}
