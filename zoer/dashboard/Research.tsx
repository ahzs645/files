import { researchRetry } from './research-retry';
import { BulkDocuments } from './BulkDocuments';
import { annotateBuyerRecord } from './market/buyers';
import { BuyerName } from '../../apps/dashboard/src/components/ui/BuyerName';
import { usePluginQuery } from "./navigation";
import { Select } from '@zoer/plugin-ui/database';
import { Modal } from '@zoer/plugin-ui/analysis';
import { useEffect,useMemo,useState } from 'react';
import { Button } from '../../apps/dashboard/src/components/ui/Button';
import { useWorkspace, useQuery } from './backend';
import { catalogRows } from './catalog-store';
import { host } from './bridge';
import { defaultReviewPrompt as defaultPrompt } from "./review-prompt";
function Choice({label,value,options,onChange}:{label:string;value:string;options:{id:string;name:string}[];onChange:(v:string)=>void}) {
  return <label className="research-label"><span>{label}</span><Select searchable aria-label={label} value={value} onChange={e=>onChange(e.target.value)}><option value="">Choose…</option>{options.map(o=><option key={o.id} value={o.id}>{o.name}</option>)}</Select></label>;
}
export function Research() {
  const {model}=useWorkspace();
  const [kind,setKind]=usePluginQuery('kind','opportunity'),[search,setSearch]=usePluginQuery('search'),[starred,setStarred]=useState(false),[page,setPage]=useState(0),[selection,setSelection]=useState<Set<string>>(new Set());
  const [state,setState]=useState<any>({prompts:[],batches:[]}),[models,setModels]=useState<any[]>([]),[modelId,setModelId]=useState(''),[promptId,setPromptId]=useState(''),[name,setName]=useState('Contract review'),[prompt,setPrompt]=useState(defaultPrompt),[documents,setDocuments]=useState(true),[force,setForce]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState('');
  const [recordId,setRecordId]=usePluginQuery('record'),[detail,setDetail]=useState<any>(),[tags,setTags]=useState('');
  const refresh=async()=>{const next=await host('catalog.state');setState(next);};
  useEffect(()=>{void refresh().catch(e=>setError(e.message));void host('models').then(r=>{setModels(r.models.filter((m:any)=>m.authReady));setModelId(r.models.some((m:any)=>m.id===r.activeModelProfileId&&m.authReady)?r.activeModelProfileId:'');}).catch(e=>setError(e.message));const timer=setInterval(()=>{if(!document.hidden)void refresh().catch(e=>setError(e.message));},10000);return()=>clearInterval(timer);},[]);
  useEffect(()=>{setPage(0);},[search,kind,starred]);
  useEffect(()=>{
    if(!recordId)return;let active=true;
    const load=()=>host('catalog.record',{id:recordId}).then(r=>{if(active)setDetail(r);});
    setDetail(undefined);void load().catch(e=>{if(active)setError(e.message);});
    const timer=setInterval(()=>{if(!document.hidden)void load().catch(e=>setError(e.message));},10000);return()=>{active=false;clearInterval(timer);};
  },[recordId]);
  useEffect(()=>{if(detail)setTags(detail.tags.join(', '));},[detail?.record?.id,JSON.stringify(detail?.tags)]);
  const result=useQuery('catalog.rows',{kind,search,starredOnly:starred,limit:25,cursor:String(page*25)});
  const visible=(result?.items??[]).map((data:any)=>({id:data.catalogId,kind,title:data.description??data.opportunityDescription,data}));
  const run=async(fn:()=>Promise<void>)=>{setBusy(true);setError('');setMessage('');try{await fn();}catch(e){setError((e as Error).message);}finally{setBusy(false);}};
  const start=async(actionId:string,input:any={})=>{
    if(!model)throw new Error('Wait for the saved catalog to load.');
    const cli=actionId==='records.review'&&modelId.startsWith('codex:');
    const response=await host('action',{actionId:cli?'records.review.cli':actionId,input:{recordIds:[...selection],force,...(cli?{computerId:modelId.slice(6)}:{}),...(actionId==='records.review'?{promptId,includeDocuments:documents}:{}),...input},modelProfileId:modelId});
    setMessage('Batch started.');await refresh();return response;
  };
  const close=()=>{setRecordId('');setDetail(undefined);};
  return <section className="research">
    <header className="bid-page-header"><div><h1>Documents & AI</h1><p>{state.counts?`${state.counts.reduce((sum:number,row:any)=>sum+row.count,0).toLocaleString()} bids saved`:'Loading saved bids…'}</p></div><Button variant="ghost" onClick={()=>void host('catalog.open')}>Open database viewer</Button></header>
    <BulkDocuments running={state.batches.some((batch:any)=>batch.kind==='download'&&batch.status==='running')} onStarted={refresh} />
    <div className="research-grid"><section className="zoer-history"><h2>Choose records</h2>
      <div className="zoer-record-tools"><Button variant={kind==='opportunity'?'primary':'ghost'} onClick={()=>setKind('opportunity')}>Opportunities</Button><Button variant={kind==='award'?'primary':'ghost'} onClick={()=>setKind('award')}>Contract awards</Button><label className="research-check"><input type="checkbox" checked={starred} onChange={e=>setStarred(e.target.checked)} />Starred only</label></div>
      <label className="research-label"><span className="sr-only">Search</span><input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search title, buyer or contract number" /></label>
      <div className="zoer-record-tools"><Button variant="ghost" disabled={!visible.length} onClick={()=>setSelection(new Set([...selection,...visible.map(r=>r.id)].slice(0,50)))}>Select page</Button><Button variant="ghost" disabled={!selection.size} onClick={()=>setSelection(new Set())}>Clear</Button><span>{selection.size}/50 selected</span></div>
      <div className="research-records">{visible.map(row=><article key={row.id}><label><input type="checkbox" checked={selection.has(row.id)} disabled={!selection.has(row.id)&&selection.size>=50} onChange={e=>setSelection(current=>{const next=new Set(current);e.target.checked?next.add(row.id):next.delete(row.id);return next;})} /><span><strong>{row.title}</strong><BuyerName record={row.data}/><small>{row.data.opportunityId||row.data.contractNumber}</small></span></label><Button variant="ghost" onClick={()=>setRecordId(row.id)}>Details</Button></article>)}</div>
      <div className="zoer-record-tools"><Button variant="ghost" disabled={!page} onClick={()=>setPage(page-1)}>Previous</Button><span>{result?result.total.toLocaleString():'Loading…'} matches · page {page+1}</span><Button variant="ghost" disabled={!result?.nextCursor} onClick={()=>setPage(page+1)}>Next</Button></div>
    </section><section className="zoer-history"><h2>Process selection</h2>
      <div className="zoer-record-tools"><Button disabled={busy||!selection.size} onClick={()=>void run(async()=>{await start('documents.download');})}>Get attachments</Button><span>Up to 100 files per record; 8 MiB per file.</span></div>
      <h3>Review prompt</h3><Choice label="Saved prompt" value={promptId} options={state.prompts} onChange={id=>{setPromptId(id);const p=state.prompts.find((p:any)=>p.id===id);if(p){setName(p.name);setPrompt(p.prompt);}}} />
      <label className="research-label">Prompt name<input value={name} maxLength={100} onChange={e=>setName(e.target.value)} /></label><label className="research-label">Review instructions<textarea value={prompt} maxLength={12000} rows={5} onChange={e=>setPrompt(e.target.value)} /></label>
      <div className="zoer-record-tools"><Button variant="ghost" disabled={busy||!name.trim()||!prompt.trim()} onClick={()=>void run(async()=>{const saved=await host('catalog.prompts',{id:promptId||undefined,name,prompt});setPromptId(saved.id);await refresh();setMessage(`Saved prompt version ${saved.version}.`);})}>Save prompt</Button><Button variant="ghost" onClick={()=>{setPromptId('');setName('New review');setPrompt(defaultPrompt);}}>New prompt</Button></div>
      <Choice label="Model" value={modelId} options={models} onChange={setModelId} />{!models.length&&<p>Configure a model profile or start a signed-in Codex computer before reviewing.</p>}
      <label className="research-check"><input type="checkbox" checked={documents} onChange={e=>setDocuments(e.target.checked)} />Include downloaded documents</label>
      <label className="research-check"><input type="checkbox" checked={force} onChange={e=>setForce(e.target.checked)} />Re-run unchanged records</label>
      <div className="zoer-record-tools"><Button disabled={busy||!selection.size||!promptId||!modelId} onClick={()=>void run(async()=>{await start('records.review');})}>Review selected bids</Button></div>
      <details><summary>How reviews work</summary><p>Documents are reviewed in chunks (up to 100 PDF pages; scanned PDFs need OCR) and combined with the bid record. Completed chunks are saved individually and reused when you retry interrupted work. Each batch is limited to 250 model calls. Manual tags stay separate from AI labels. Saved chunk results are available in the database viewer’s research_tasks table.</p></details>
    </section></div>
    {error&&<p role="alert">{error}</p>}{message&&<p role="status">{message}</p>}
    <section className="zoer-history"><h2>Batch history</h2>{!state.batches.length&&<p>No document or review batches yet.</p>}{state.batches.map((batch:any)=><article key={batch.id} className="research-batch"><div><strong>{batch.kind==='review'?'AI review':'Document download'} · {batch.status}</strong><p>{batch.completed}/{batch.total} complete · {batch.failed} failed{batch.error?<> · <span role="alert">{batch.error}</span></>:null}</p></div>{batch.status==='running'?<Button variant="ghost" disabled={busy} onClick={()=>void run(async()=>{await host('cancel',{id:batch.id});await refresh();})}>Stop</Button>:<Button variant="ghost" disabled={busy} onClick={()=>void run(async()=>{await host('action',researchRetry(batch,modelId));await refresh();})}>Retry</Button>}</article>)}</section>
    {recordId && <Modal mobileSheet title={detail?.record?.title ?? 'Loading record…'} onClose={close} footer={<Button variant="secondary" onClick={close}>Done</Button>}><div className="research research-record-detail">
      {!detail && <p role="status">Loading record…</p>}
      {detail&&<><h3>Buyer</h3><BuyerName record={annotateBuyerRecord(detail.record.data,detail.record.kind==='award'?'award':'opportunity')}/><h3>Manual tags</h3><label className="research-label">Comma-separated tags<input value={tags} onChange={e=>setTags(e.target.value)} /></label><Button disabled={busy} onClick={()=>void run(async()=>{setDetail(await host('catalog.tags',{id:recordId,tags:[...new Set(tags.split(',').map(t=>t.trim()).filter(Boolean))]}));setMessage('Tags saved.');})}>Save tags</Button>
      <h3>Documents</h3>{!detail.documents.length&&<p>No files downloaded for this record.</p>}{detail.documents.map((doc:any)=><article className="research-batch" key={doc.id}><div><strong>{doc.name}</strong><p>{doc.status} · {doc.bytes??0} bytes · {doc.text_length??0} text characters{doc.error?` · ${doc.error}`:''}</p></div>{doc.status==='downloaded'&&<Button variant="ghost" onClick={()=>void run(async()=>{await host('catalog.download',{id:doc.id,name:doc.name});})}>Download</Button>}</article>)}
      <h3>AI reviews</h3>{!detail.reviews.length&&<p>No AI review for this record yet.</p>}{detail.reviews.map((review:any)=><article key={review.id} className="research-review"><strong>{review.status} · prompt v{review.prompt_version} · {review.model}</strong>{review.error&&<p role="alert">{review.error}</p>}{review.result&&<><p>{review.result.summary}</p><p>{review.result.coverage.includeDocuments?`Documents reviewed: ${review.result.coverage.readable} of ${review.result.coverage.downloaded} downloaded files. ${!review.result.coverage.readable?"This review used the bid record only.":""}`:"Reviewed the bid record only."}</p>{review.result.coverage.includeDocuments&&<p>{review.result.coverage.discovered??'Unknown'} attachment links saved · {review.result.coverage.missing?.length??'Unknown'} missing downloads · {review.result.coverage.unreadable?.length??'Unknown'} unreadable files. Source completeness has not been verified.{review.result.coverage.recordTruncated?' Bid record was truncated.':''}</p>}<div className="zoer-record-tools">{review.result.labels.map((label:string)=><span className="research-tag" key={label}>{label}</span>)}</div><Button variant="ghost" disabled={busy} onClick={()=>void run(async()=>{setDetail(await host('catalog.tags',{id:recordId,tags:[...new Set([...detail.tags,...review.result.labels])]}));})}>Add labels to manual tags</Button><dl>{Object.entries(review.result.fields).map(([key,value])=><div key={key}><dt>{key}</dt><dd>{typeof value==='object'?JSON.stringify(value):String(value??'Not found')}</dd></div>)}</dl><details><summary>Evidence and document coverage</summary><pre>{JSON.stringify({evidence:review.result.evidence,coverage:review.result.coverage,documents:review.result.documentReviews},null,2)}</pre></details></>}</article>)}</>}
      {error&&<p role="alert">{error}</p>}
    </div></Modal>}
  </section>;
}
