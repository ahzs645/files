import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Button } from '../../apps/dashboard/src/components/ui/Button';
import { Select } from '@zoer/plugin-ui/database';
import { host } from './bridge';
import { shortError } from './error-text';

const query = (statement: string, parameters: (string | number)[] = []) => host('catalog.query', {statement,parameters});
const bytes = (n: number) => n >= 1073741824 ? `${(n/1073741824).toFixed(1)} GB` : n >= 1048576 ? `${(n/1048576).toFixed(1)} MB` : `${Math.ceil(n/1024)} KB`;

/** Saved files and their AI-readable text, counted separately: empty text can mean a scan, drawing or unsupported file. */
export function DocumentStats({refreshKey = ''}: {refreshKey?: string}) {
  const stats=useQuery({queryKey:['procurement','document-stats',refreshKey],queryFn:()=>query("SELECT count(*) files,sum(status='downloaded') downloaded,sum(status='failed') failed,sum(length(text)>0) readable,sum(status='downloaded' AND coalesce(length(text),0)=0) unreadable,sum(bytes) bytes FROM documents"),refetchInterval:10000});
  const count=stats.data?.rows?.[0];
  if(stats.error)return <p role="alert">{(stats.error as Error).message}</p>;
  if(!count)return <p role="status" className="research-note">Counting saved files…</p>;
  const tiles:[string,string,string?][]=[
    ['Files saved',Number(count.downloaded??0).toLocaleString()],
    ['Readable by AI',Number(count.readable??0).toLocaleString()],
    ['No text',Number(count.unreadable??0).toLocaleString(),'Scans, drawings or unsupported files'],
    ['Failed',Number(count.failed??0).toLocaleString()],
    ['Storage',bytes(Number(count.bytes??0))],
  ];
  return <dl className="research-metrics doc-stats" aria-label="Document coverage">{tiles.map(([label,value,hint])=><div key={label} title={hint} data-tone={label==='Failed'&&value!=='0'?'bad':undefined}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>;
}

const STATUS:[string,string][]=[['all','All files'],['failed','Failed'],['unreadable','No text'],['warnings','With warnings']];

/** Searchable list of saved files with a per-bid retry or text extraction. */
export function DocumentFiles({onDetails, refreshKey = '', running}: {onDetails(id:string):void;refreshKey?:string;running:boolean}) {
  const [filter,setFilter]=useState('all'),[search,setSearch]=useState(''),[page,setPage]=useState(0);
  const [busy,setBusy]=useState(''),[error,setError]=useState(''),[message,setMessage]=useState('');
  const where=filter==='failed'?"d.status='failed'":filter==='unreadable'?"d.status='downloaded' AND coalesce(length(d.text),0)=0":filter==='warnings'?"d.error IS NOT NULL AND d.status='downloaded'":"1=1";
  const parameters=[`%${search}%`,`%${search}%`,`%${search}%`];
  const clause=`d.name LIKE ? AND ${where} OR r.title LIKE ? AND ${where} OR d.record_id LIKE ? AND ${where}`;
  const files=useQuery({queryKey:['procurement','document-files',filter,search,page,refreshKey],queryFn:()=>query(`SELECT d.id,d.record_id,d.name,d.media_type,d.status,d.bytes,length(d.text) chars,d.error,d.updated_at,r.title FROM documents d JOIN records r ON r.id=d.record_id WHERE ${clause} ORDER BY d.updated_at DESC,d.id LIMIT 51 OFFSET ?`,[...parameters,page*50]),refetchInterval:10000});
  const rows=(files.data?.rows??[]).slice(0,50);
  const act=async(row:any,extract:boolean)=>{setBusy(row.id);setError('');setMessage('');try{await host('action',{actionId:extract?'documents.extract':'documents.download',input:{recordIds:[row.record_id],...(extract?{}:{force:false})}});setMessage(`${extract?'Text extraction':'Download retry'} started for ${row.title}.`);}catch(e){setError((e as Error).message);}finally{setBusy('');}};
  return <section className="zoer-history" aria-label="Saved files">
    <div className="research-toolbar">
      <label className="research-label research-grow"><span className="sr-only">Search files</span><input maxLength={250} aria-label="Search files" placeholder="Search by file name, bid number or title" value={search} onChange={e=>{setSearch(e.target.value);setPage(0);}} /></label>
      <label className="research-label"><span className="sr-only">Show</span><Select aria-label="File coverage" value={filter} onChange={e=>{setFilter(e.target.value);setPage(0);}}>{STATUS.map(([id,label])=><option key={id} value={id}>{label}</option>)}</Select></label>
    </div>
    {(error||files.error)&&<p role="alert">{error||(files.error as Error).message}</p>}{message&&<p role="status">{message}</p>}
    {files.isPending?<p role="status">Loading saved files…</p>:!rows.length?<p>No files match.</p>:<div className="research-file-list doc-file-list">{rows.map((row:any)=>{
      const state=row.status==='failed'?['bad','Failed']:row.chars?['good','Readable']:['warn','No text'];
      return <article key={row.id}>
        <div className="research-file-info">
          <strong>{row.name}</strong>
          <span className="research-note">{row.title} · {row.record_id.replace(/^opportunity:/,'')}{row.bytes?` · ${bytes(row.bytes)}`:''}</span>
          {row.error&&<span className="research-file-warning doc-clamp" title={row.error}>{shortError(row.error)}</span>}
        </div>
        <span className="doc-chip" data-tone={state[0]} title={row.chars?`${Number(row.chars).toLocaleString()} characters of text`:undefined}>{state[1]}</span>
        <div className="research-toolbar doc-file-actions"><Button variant="ghost" onClick={()=>onDetails(row.record_id)}>Open</Button><Button variant="ghost" disabled={!!busy||running} onClick={()=>void act(row,row.status==='downloaded')}>{busy===row.id?'Starting…':row.status==='downloaded'?'Re-extract':'Retry'}</Button></div>
      </article>;})}</div>}
    <div className="research-toolbar research-pager"><Button variant="ghost" disabled={!page||files.isFetching} onClick={()=>setPage(page-1)}>Previous</Button><span>Page {page+1}</span><Button variant="ghost" disabled={!files.data||files.data.rows.length<=50||files.isFetching} onClick={()=>setPage(page+1)}>Next</Button></div>
    <details><summary>Supported file types</summary><p className="research-note">PDF (first 100 pages, OCR on up to 10 scanned pages), DOCX, DOC, XLSX, text and ZIP. Text is capped at 240,000 characters. Nested or encrypted ZIPs, XLS and CAD drawings need manual review.</p></details>
  </section>;
}
