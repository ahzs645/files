import { fileSize } from './file-size';
import { Hint } from './host-ui';
import { useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Button } from '../../apps/dashboard/src/components/ui/Button';
import { Select } from '@zoer/plugin-ui/database';
import { host } from './bridge';
import { shortError } from './error-text';
import { assertDocumentBrowserIdle } from './document-run';
import { refreshAfterChange } from './backend';
import { useCapabilities } from './capabilities';
import { hostHref, usePluginQuery } from './navigation';
import { count, plural } from './format';
import { PluginLink } from './procurement/Status';
import { paged } from './procurement/status-data';
import { DOCUMENT_STATS_SQL, FAILED_ROWS_SQL, FILE_FILTERS, fileFilterSql, fileState, fileWarning, groupByReason, isWaitingForCheck, unsavedFailures, type FailedRow } from './document-processing';

const query = (statement: string, parameters: (string | number)[] = []) => host('catalog.query', {statement,parameters});
const PAGE = 50;

/** The stat row's counts (one cached read, shared with the Text extraction card). */
export const useDocumentStats = (enabled = true) => useQuery({queryKey:['procurement','document-stats'],enabled,queryFn:()=>query(DOCUMENT_STATS_SQL),refetchInterval:10000});
/** Files not saved after a failed download, one row per file (the failure queue's rule), for the tile and Files. */
export const useFailedFiles = (enabled = true) => useQuery({queryKey:['procurement','failed-files'],enabled,refetchInterval:60_000,
  queryFn:async()=>unsavedFailures(await paged(FAILED_ROWS_SQL,[]) as FailedRow[])});

type Tile = { label: string; value: string; hint: string; to?: string; onClick?: () => void; tone?: 'warn' | 'bad' };
/**
 * Operations › Documents' one stat row. Every tile names what it counts and, when it links, where to (the hint line, which
 * every tile has so the tiles stay one height). "Download failed" counts files still not saved, not failed rows.
 */
export function DocumentStats({onShowPending}: {refreshKey?: string; onShowPending?: () => void}) {
  const stats=useDocumentStats(), failed=useFailedFiles();
  const row=stats.data?.rows?.[0];
  if(stats.error)return <p role="alert">{(stats.error as Error).message}</p>;
  if(!row)return <p role="status" className="research-note">Counting saved files…</p>;
  const n=(key:string)=>Number(row[key]??0), waiting=failed.data?.filter(item=>isWaitingForCheck({status:'failed',error:item.error})).length??0;
  const tiles:Tile[]=[
    {label:'Files saved',value:count(n('downloaded')),hint:'All opportunities · open Files',to:'/files'},
    {label:'Readable by AI',value:count(n('readable')),hint:'Text extracted'},
    {label:'Text pending',value:count(n('pending')),hint:'Not read yet · Text extraction below',onClick:onShowPending},
    {label:'Text failed',value:count(n('extractFailed')),hint:'Could not be read · open in Files',to:'/files?fileStatus=extractFailed',tone:n('extractFailed')?'warn':undefined},
    {label:'No text',value:count(n('unreadable')),hint:'Scans, drawings · open in Files',to:'/files?fileStatus=unreadable'},
    {label:'Download failed',value:failed.data?count(failed.data.length):'…',hint:failed.data?waiting?`${count(waiting)} waiting for you · open in Files`:'Still not saved · open in Files':'Counting files…',to:'/files?fileStatus=failed',tone:failed.data?.length?'bad':undefined},
    {label:'Storage',value:fileSize(n('bytes')),hint:'Saved originals'},
  ];
  return <dl className="research-metrics doc-stats" aria-label="Saved files">{tiles.map(tile=><div key={tile.label} data-tone={tile.tone}><dt>{tile.label}</dt><dd>{
    tile.to?<PluginLink to={tile.to} className="doc-stat-link">{tile.value}</PluginLink>
    :tile.onClick?<button type="button" className="doc-stat-link" aria-label={`${tile.value} ${tile.label}: go to Text extraction`} onClick={tile.onClick}>{tile.value}</button>:tile.value}</dd><small className="doc-stat-hint">{tile.hint}</small></div>)}</dl>;
}

const SEARCH_CLAUSE = (where: string) => `d.name LIKE ? AND ${where} OR r.title LIKE ? AND ${where} OR d.record_id LIKE ? AND ${where}`;
const HEADER: Record<string, (n: number) => string> = {
  all: n => `${plural(n, 'saved file')}`, pending: n => `${plural(n, 'saved file')} with text pending`, extractFailed: n => `${plural(n, 'saved file')} whose text could not be read`,
  unreadable: n => `${plural(n, 'saved file')} with no text (scans, drawings or unsupported files)`, warnings: n => `${plural(n, 'saved file')} with a warning`,
};
const matches = (row: FailedRow, search: string) => !search || [row.name, row.title, row.recordId].some(value => String(value ?? '').toLowerCase().includes(search.toLowerCase()));

/**
 * Opportunities › Files: saved files with their text state, or (filter "Not saved") the files still not saved after a
 * failed download, grouped by reason so each reason reads once. Retry and Re-extract are collection-gated.
 */
export function DocumentFiles({onDetails, downloadRunning, processingRunning, browserBusy = false, fileTransferControls = false, showSize: initialSize = true}: {showSize?:boolean;fileTransferControls?:boolean;onDetails(id:string):void;refreshKey?:string;
  /** A download batch is running: file retries wait. */ downloadRunning:boolean;
  /** A text extraction is running: Re-extract waits. Neither blocks the other. */ processingRunning:boolean;browserBusy?:boolean}) {
  const [filterValue,setFilter]=usePluginQuery('fileStatus','all'),[search,setSearch]=usePluginQuery('search'),[page,setPage]=useState(0);
  const filter=FILE_FILTERS.some(([id])=>id===filterValue)?filterValue:'all', failedView=filter==='failed';
  const [showSize,setShowSize]=useState(initialSize);
  const [busy,setBusy]=useState(''),[error,setError]=useState(''),[message,setMessage]=useState('');
  const {collection}=useCapabilities();
  const where=fileFilterSql(filter), parameters=[`%${search}%`,`%${search}%`,`%${search}%`];
  const files=useQuery({queryKey:['procurement','document-files',filter,search,page],enabled:!failedView,queryFn:()=>query(`SELECT d.id,d.record_id,d.name,d.media_type,d.status,d.bytes,length(d.text) chars,d.error,d.updated_at,r.title FROM documents d JOIN records r ON r.id=d.record_id WHERE ${SEARCH_CLAUSE(where)} ORDER BY d.updated_at DESC,d.id LIMIT ${PAGE} OFFSET ?`,[...parameters,page*PAGE]),refetchInterval:10000});
  const total=useQuery({queryKey:['procurement','document-files-count',filter,search],enabled:!failedView,queryFn:()=>query(`SELECT count(*) AS total FROM documents d JOIN records r ON r.id=d.record_id WHERE ${SEARCH_CLAUSE(where)}`,parameters),refetchInterval:30000});
  const failed=useFailedFiles(failedView);
  const failures=(failed.data??[]).filter(row=>matches(row,search)), groups=groupByReason(failures);
  // The failed list pages through its groups in order, so a reason's header shows its full count once.
  const ordered=groups.flatMap(group=>group.rows), count_=failedView?failures.length:Number(total.data?.rows?.[0]?.total??NaN);
  const rows:any[]=failedView?ordered.slice(page*PAGE,page*PAGE+PAGE):(files.data?.rows??[]);
  const loading=failedView?failed.isPending:files.isPending, loadError=failedView?failed.error:files.error;
  const act=async(row:any,extract:boolean)=>{setBusy(row.id);setError('');setMessage('');try{if(!extract)await assertDocumentBrowserIdle(host);const recordId=row.record_id??row.recordId;await host('action',{actionId:extract?'documents.extract':'documents.download',input:{recordIds:[recordId],...(extract?{}:{force:false,...(fileTransferControls?{documentId:row.id}:{})})}});void refreshAfterChange();setMessage(`${extract?'Text extraction':'Download retry'} started for ${!extract && fileTransferControls ? row.name : row.title ?? recordId}.`);}catch(e){setError((e as Error).message);}finally{setBusy('');}};
  const waiting=failures.filter(row=>isWaitingForCheck({status:'failed',error:row.error})).length, notices=new Set(failures.map(row=>row.recordId)).size;
  const header=failedView
    ? failed.data ? `${plural(failures.length,'file')} not saved after a failed download, on ${plural(notices,'opportunity','opportunities')}${waiting?` · ${count(waiting)} waiting for a browser check`:''}${search?` · matching “${search}”`:''}` : ''
    : Number.isFinite(count_) ? `${HEADER[filter](count_)}${search?` matching “${search}”`:''}` : '';
  const pages=Number.isFinite(count_)?Math.max(1,Math.ceil(count_/PAGE)):null;
  let lastReason='';
  const item=(row:any)=>{
    const failedRow=failedView, recordId=String(row.record_id??row.recordId), state=fileState(failedRow?{status:'failed',error:row.error}:row), held=failedRow&&isWaitingForCheck({status:'failed',error:row.error});
    const warning=failedRow?'':fileWarning(row), reference=recordId.replace(/^(opportunity|award):/,'');
    const size=showSize&&row.status==='downloaded'?fileSize(row.bytes):'';
    return <article key={row.id}>
      <div className="research-file-info">
        <strong>{row.name}</strong>
        <span className="research-note">{row.title ?? recordId}{reference.includes(':')?'':` · ${reference}`}{size&&` · ${size}`}</span>
        {warning&&<Hint content={warning}><span className="research-file-warning doc-clamp">{shortError(warning)}</span></Hint>}
      </div>
      <Hint content={row.chars?`${count(row.chars)} characters of text`:undefined}><span className="doc-chip" data-tone={state[0]}>{state[1]}</span></Hint>
      <div className="research-toolbar doc-file-actions"><Button variant="ghost" onClick={()=>onDetails(recordId)}>Open</Button>{collection&&!held&&<Button variant="ghost" disabled={!!busy||(row.status==='downloaded'?processingRunning:downloadRunning||browserBusy)} onClick={()=>void act(row,row.status==='downloaded')}>{busy===row.id?'Starting…':row.status==='downloaded'?'Re-extract':fileTransferControls?'Retry':'Retry notice'}</Button>}</div>
    </article>;
  };
  const listed:ReactNode[]=[];
  for(const row of rows){
    if(failedView){
      const group=groups.find(entry=>entry.rows.includes(row))!;
      if(group.reason!==lastReason){lastReason=group.reason;listed.push(<div key={`reason:${group.reason}`} className="pc-file-group" data-tone={group.waiting?'warn':'bad'}>
        <p><strong>{group.waiting?'Waiting for you':'Download failed'} · {plural(group.rows.length,'file')}</strong> · {group.reason}</p>
        {group.waiting&&<a className="procurement-link" href={hostHref('#/browsers')}>Open the download browser</a>}
      </div>);}
    }
    listed.push(item(row));
  }
  return <section className="zoer-history" aria-label="Saved files">
    {header&&<p className="pc-files-header"><strong>{header}</strong></p>}
    <div className="research-toolbar">
      <label className="research-label research-grow"><span className="sr-only">Search files</span><input maxLength={250} aria-label="Search files" placeholder="Search by file name, bid number or title" value={search} onChange={e=>{setSearch(e.target.value);setPage(0);}} /></label>
      <label className="research-label"><span className="sr-only">Show</span><Select aria-label="File coverage" value={filter} onChange={e=>{setFilter(e.target.value==='all'?'':e.target.value);setPage(0);}}>{FILE_FILTERS.map(([id,label])=><option key={id} value={id}>{label}</option>)}</Select></label>
      {!failedView&&<label className="research-check"><input type="checkbox" checked={showSize} onChange={e=>setShowSize(e.target.checked)} />Show file sizes</label>}
    </div>
    {(error||loadError)&&<p role="alert">{error||(loadError as Error).message}</p>}{message&&<p role="status">{message}</p>}
    {failedView&&waiting>0&&collection&&<p className="research-note">Files held by BC Bid’s browser check have no Retry: complete the check in the download browser and the next download continues with them.</p>}
    {loading?<p role="status">Loading files…</p>:!rows.length?<p>No files match.</p>:<div className="research-file-list doc-file-list">{listed}</div>}
    <div className="research-toolbar research-pager"><Button variant="ghost" disabled={!page||files.isFetching} onClick={()=>setPage(page-1)}>Previous</Button><span>{Number.isFinite(count_)&&count_>0?`${count(page*PAGE+1)}–${count(Math.min(count_,page*PAGE+PAGE))} of ${count(count_)}`:`Page ${page+1}`}</span><Button variant="ghost" disabled={pages===null?rows.length<PAGE:page+1>=pages} onClick={()=>setPage(page+1)}>Next</Button></div>
    <details><summary data-zoer-disclosure="">Supported file types</summary><p className="research-note">PDF (OCR on up to 40 scanned pages), Word (DOCX, DOC, RTF), Excel (XLSX, XLS), PowerPoint (PPTX, PPT), images by OCR, Google Earth maps (KML, KMZ), text and ZIP, including one nested ZIP level. Text is capped at 1,500,000 characters. Encrypted ZIPs, CAD drawings and GIS data are kept as originals for manual review.</p></details>
  </section>;
}
