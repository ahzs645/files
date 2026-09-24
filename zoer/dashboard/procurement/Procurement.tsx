import { useEffect, useRef, useState } from 'react';
import { useQuery as useCachedQuery, useQueryClient } from '@tanstack/react-query';
import { Btn, Modal, Select } from '@zoer/plugin-ui/controls';
import { host } from '../bridge';
import { useAction, useWorkspace, setStar } from '../backend';
import { navigatePlugin, patchPluginQuery, usePluginLocation } from '../navigation';
import { SOURCES, buildProcurementQuery, deadlineLabel, safeSourceUrl } from './catalog';
import { PursuitBoard } from './PursuitBoard';
import { SavedSearches } from './SavedSearches';
import { ProcurementMarket } from './ProcurementMarket';
import { SourceHealth } from './SourceHealth';
import { AlertSettings } from './AlertSettings';
import { EvidencePanel } from './EvidencePanel';
import { type ProcurementFilters } from './state-contract';
import { nextImportBatch } from './import-batches';
import { parseCanadaBuysCsv, preserveCanadaBuysEnrichment, verifyCanadaBuysImportReceipt } from './import-canadabuys';

const sourceName = (id: string) => SOURCES.find(source => source.id === id)?.label ?? id;
async function sql(statement: string, parameters: (string | number)[] = []) {
  return (await host('catalog.query', { statement, parameters })).rows as any[];
}
function LinkOut({ url, children }: { url: unknown; children: React.ReactNode }) {
  const safe = safeSourceUrl(typeof url === 'string' ? url : '');
  return safe ? <a className="procurement-link" href={safe} target="_blank" rel="noopener noreferrer">{children} ↗</a> : null;
}
function exportSelection(rows: any[]) {
  const blob = new Blob([JSON.stringify({ exportedAt: new Date().toISOString(), coverage: 'Selected saved records only; source completeness is not verified.', records: rows }, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob), a = document.createElement('a');
  a.href = url; a.download = 'procurement-shortlist.json'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function Procurement() {
  const location = usePluginLocation(), params = new URLSearchParams(location.split('?')[1]);
  const view = params.get('view') || 'browse';
  const source = params.get('source') ?? '', kind = view === 'deadlines' ? 'opportunity' : params.get('kind') ?? 'all', search = params.get('search') ?? '';
  const region=params.get('region')||'', category=params.get('category')||'', buyer=params.get('buyer')||'', supplier=params.get('supplier')||'', classification=params.get('classification')||'';
  const [evidenceIds,setEvidenceIds]=useState<string[]>([]);
  const starred = params.get('shortlist') === '1', deadline = view === 'deadlines' || params.get('deadline') === 'week' ? 'week' : 'all', after = params.get('after') ?? '';
  const { model } = useWorkspace(), client = useQueryClient();
  const [importOpen, setImportOpen] = useState(false), [compare, setCompare] = useState(false), [detailId, setDetailId] = useState('');
  const [selection, setSelection] = useState<Map<string, any>>(new Map()), [saving, setSaving] = useState(''), [error, setError] = useState('');
  const filter = (values: Record<string, string>) => { setSelection(new Map()); patchPluginQuery({ ...values, after: '', savedSearch: '' }); };
  const query = buildProcurementQuery({ source, kind: kind === 'award' || kind === 'opportunity' ? kind : 'all', search, starred, deadline, region, category, buyer, supplier, classification, after, limit: 26 });
  const list = useCachedQuery({ queryKey: ['catalog', 'procurement', source, kind, search, starred, deadline, region, category, buyer, supplier, classification, after], enabled: !!model,
    queryFn: async () => { const head = await host('catalog.read', { ids: [] }); const [rows, count] = await Promise.all([sql(query.statement, query.parameters), sql(query.countStatement, query.countParameters)]); await host('catalog.read', { ids: [], revision: head.revision }); return { rows, total: Number(count[0]?.total ?? 0) }; }, refetchInterval: 30000 });
  const inventory = useCachedQuery({ queryKey: ['catalog', 'procurement-sources'], enabled: !!model, queryFn: () => sql("SELECT CASE WHEN json_extract(data,'$.sourceId') IS NULL OR json_extract(data,'$.sourceId')='' THEN 'bc-bid' ELSE json_extract(data,'$.sourceId') END AS sourceId, count(*) AS count, max(json_extract(data,'$.importedAt')) AS importedAt FROM records WHERE kind IN ('opportunity','award') GROUP BY sourceId"), refetchInterval: 30000 });
  const detail = useCachedQuery({ queryKey: ['catalog', 'procurement-detail', detailId], enabled: !!detailId, queryFn: () => host('catalog.record', { id: detailId }) });
  const rows = (list.data?.rows ?? []).slice(0,25), hasMore = (list.data?.rows.length ?? 0) > 25, counts = inventory.data ?? [], selectedSource = SOURCES.find(item => item.id === source);
  const sources = [...SOURCES, ...counts.filter(row => !SOURCES.some(s => s.id === row.sourceId)).map(row => ({ id: row.sourceId, label: row.sourceId, jurisdiction: 'Unspecified', mode: 'planned', description: 'Imported source', url: '' }))];
  const toggleStar = async (row: any) => {
    setSaving(row.id); setError('');
    try { await setStar(row.kind, row.kind === 'award' ? row.importKey : row.sourceKey, !row.starred); await client.invalidateQueries({ queryKey: ['catalog'] }); }
    catch (e) { setError((e as Error).message); } finally { setSaving(''); }
  };
  const savedFilters:ProcurementFilters={source,kind:kind==='opportunity'||kind==='award'?kind:'all',search,region,category,buyer,supplier,classification,deadline,shortlist:starred};
  const applySaved=(filters:ProcurementFilters)=>filter({...filters,shortlist:filters.shortlist?'1':'',view:filters.deadline==='week'?'deadlines':'browse',classification:filters.classification??''});
  return <section className="procurement-workspace">
    <header className="procurement-header"><div><h1>{selectedSource?.label ?? (source || 'All procurement')}</h1><p>Discover saved opportunities and awards across procurement sources.</p></div><div className="procurement-actions"><Btn onClick={() => setImportOpen(true)}>Import CanadaBuys CSV</Btn><Btn variant="secondary" onClick={() => navigatePlugin('/documents')}>BC Bid workspace</Btn></div></header>
    <nav className="procurement-view-links zoer-tabs" aria-label="Procurement views">{[['browse','Browse'],['board','Pursuits'],['saved','Saved searches'],['deadlines','Deadlines'],['market','Market'],['sources','Sources']].map(([id,label])=><a key={id} href={'#/plugins/bc-bid-monitor/procurement?'+new URLSearchParams({...Object.fromEntries(params),view:id,...(id==='deadlines'?{kind:'opportunity'}:{})})} aria-current={view===id?'page':undefined} onClick={event=>{if(!event.metaKey&&!event.ctrlKey&&!event.shiftKey&&!event.altKey){event.preventDefault();filter({view:id,...(id==='deadlines'?{kind:'opportunity'}:{})});}}}>{label}</a>)}</nav>
    {view==='board'&&<><p className="procurement-coverage">This board includes saved pursuits from all sources. Notices available to add follow the current browse filters.</p><PursuitBoard records={rows} onOpenRecord={setDetailId}/></>}
    {view==='market'&&<ProcurementMarket source={source} onOpenCatalog={scope=>filter({source:scope.source||'',kind:scope.kind||'all',buyer:scope.buyer||'',supplier:scope.supplier||'',classification:scope.classification||'',region:'',category:'',search:'',shortlist:'',deadline:'',view:'browse'})}/>}
    {view==='sources'&&<SourceHealth/>}
    {view==='saved'&&<><SavedSearches filters={savedFilters} onApply={applySaved} onConfigureAlert={()=>document.getElementById('procurement-alerts')?.scrollIntoView({block:'start'})}/><div id="procurement-alerts"><AlertSettings/></div></>}
    {params.get('savedSearch')&&<SavedSearches filters={savedFilters} onApply={applySaved} initialSearchId={params.get('savedSearch')!}/>}
    {['browse','deadlines'].includes(view)&&<>
    <div className="procurement-sources" aria-label="Procurement sources">
      <button type="button" className="procurement-source" aria-pressed={!source} onClick={() => filter({ source: '' })}><span className="procurement-source-name">{!source && <span aria-hidden="true">✓ </span>}All sources</span><span>{inventory.isPending ? 'Loading…' : counts.reduce((n, row) => n + Number(row.count), 0).toLocaleString()} saved records</span><small>Your saved catalog, across sources</small></button>
      {sources.map(item => { const saved = counts.find(row => row.sourceId === item.id); return <button key={item.id} type="button" className="procurement-source" aria-pressed={source === item.id} onClick={() => filter({ source: item.id })}><span className="procurement-source-name">{source === item.id && <span aria-hidden="true">✓ </span>}{item.label}</span><span>{inventory.isPending ? 'Loading…' : Number(saved?.count ?? 0).toLocaleString()} saved · {item.jurisdiction}</span><small>{item.mode === 'scraper' ? 'Browser scraping available' : item.mode === 'csv-import' ? 'Dataset collection · CSV import' : 'Imported records'}{saved?.importedAt ? ` · Imported ${new Date(saved.importedAt).toLocaleDateString()}` : ''}</small></button>; })}
    </div>
    <p className="procurement-coverage">Counts describe saved records, not complete portal coverage. Existing records without a source label belong to BC Bid. Closing-soon filters use only deadlines with a known timezone.</p>
    {selectedSource && <p className="procurement-coverage">{selectedSource.description} <LinkOut url={selectedSource.url}>Visit {selectedSource.label}</LinkOut></p>}
    <div className="procurement-filters">
      <label className="procurement-search">Search procurement<input aria-label="Search procurement" placeholder="Title, buyer or notice number" value={search} onChange={event => filter({ search: event.target.value })} /></label>
      <label>Notice type<Select aria-label="Notice type" value={kind} onChange={event => filter({ kind: event.target.value,...(deadline==='week'&&event.target.value!=='opportunity'?{view:'browse',deadline:'all'}:{}) })}><option value="all">All notices</option><option value="opportunity">Opportunities</option><option value="award">Awards</option></Select></label>
      <label>Deadline<Select aria-label="Deadline" value={deadline} onChange={event => filter({ deadline: event.target.value,...(event.target.value==='week'?{kind:'opportunity'}:view==='deadlines'?{view:'browse'}:{}) })}><option value="all">Any deadline</option><option value="week">Closing in 7 days</option></Select></label>
      <label className="procurement-check"><input type="checkbox" checked={starred} onChange={event => filter({ shortlist: event.target.checked ? '1' : '' })} />Shortlisted only</label>
    </div>
    <details className="procurement-extra-filters"><summary>Region, category, buyer and supplier filters</summary><div className="procurement-filters">{[['region','Region',region],['category','Category',category],['buyer','Buyer',buyer],['supplier','Supplier',supplier]].map(([key,label,value])=><label key={key}>{label}<input aria-label={`Filter ${label}`} value={value} placeholder="Exact source value" onChange={e=>filter({[key]:e.target.value})}/></label>)}</div>{classification&&<p>Raw classification scope: {classification} <Btn variant="ghost" onClick={()=>filter({classification:''})}>Clear classification</Btn></p>}</details>
    <div className="procurement-actions"><Btn variant="secondary" onClick={()=>filter({view:'saved'})}>Save these filters</Btn><Btn variant="secondary" disabled={!selection.size} onClick={()=>setEvidenceIds([...selection.keys()])}>Evidence & AI</Btn><span role="status">{list.isPending ? 'Loading saved records…' : `${(list.data?.total ?? 0).toLocaleString()} matches`}</span><Btn variant="secondary" disabled={selection.size < 2} onClick={() => setCompare(true)}>Compare ({selection.size}/3)</Btn><Btn variant="secondary" disabled={!selection.size} onClick={() => { void host('catalog.read', {ids:[...selection.keys()]}).then(result => exportSelection(result.records)).catch(e => setError(e.message)); }}>Export selected</Btn>{selection.size > 0 && <Btn variant="ghost" onClick={() => setSelection(new Map())}>Clear selection</Btn>}</div>
    {(error || list.error || inventory.error) && <p role="alert">{error || list.error?.message || inventory.error?.message} <Btn variant="secondary" onClick={() => void client.invalidateQueries({ queryKey: ['catalog'] })}>Retry</Btn></p>}
    {!list.isPending && !list.error && !rows.length && <div className="procurement-empty"><h2>No matching saved notices</h2><p>{source === 'canadabuys' ? 'Import a CanadaBuys tender CSV to add federal notices. An empty catalog does not mean the portal has no opportunities.' : 'Try removing filters, import a source file, or open the BC Bid workspace to collect notices.'}</p><Btn variant="secondary" onClick={() => filter({ search: '', kind: 'all', deadline: 'all', shortlist: '', region:'',category:'',buyer:'',supplier:'',classification:'',view:'browse' })}>Clear filters</Btn></div>}
    <div className="procurement-results">{rows.map(row => <article className="procurement-result" key={row.id}>
      <label className="procurement-check"><input aria-label={`Compare ${row.title}`} type="checkbox" checked={selection.has(row.id)} disabled={!selection.has(row.id) && selection.size >= 3} onChange={event => setSelection(current => { const next = new Map(current); event.target.checked ? next.set(row.id, row) : next.delete(row.id); return next; })} /><span className="sr-only">Select for comparison</span></label>
      <div className="procurement-result-body"><div className="procurement-meta"><span>{sourceName(row.sourceId)}</span><span>{row.kind === 'award' ? 'Award' : 'Opportunity'}</span>{row.status && <span>{row.status}</span>}</div><button type="button" className="procurement-title" onClick={() => setDetailId(row.id)}>{row.title}</button><p>{row.buyer || 'Buyer not provided'}{row.region ? ` · ${row.region}` : ''}</p><small>{row.externalId || ''}{row.externalId ? ' · ' : ''}{row.kind === 'award' ? 'Award date: ' : 'Closes: '}{row.kind === 'award' ? row.deadline || 'Not provided' : deadlineLabel(row.deadline)}</small></div>
      <Btn variant="secondary" disabled={!!saving} aria-pressed={!!row.starred} aria-label={`${row.starred ? 'Remove from' : 'Add to'} shortlist: ${row.title}`} onClick={() => void toggleStar(row)}>{saving === row.id ? 'Saving…' : row.starred ? '★ Saved' : '☆ Shortlist'}</Btn>
    </article>)}</div>
    <div className="procurement-actions"><Btn variant="secondary" disabled={!after} onClick={() => patchPluginQuery({ after: '' })}>First page</Btn><span>{rows.length} shown</span><Btn variant="secondary" disabled={!hasMore || list.isFetching} onClick={() => patchPluginQuery({ after: rows.at(-1)?.id ?? '' }, 'push')}>Next page</Btn></div>
    </>}
    {evidenceIds.length>0&&<EvidencePanel recordIds={evidenceIds} onClose={()=>setEvidenceIds([])}/>}
    {compare && <Modal title="Compare selected notices" mobileSheet onClose={() => setCompare(false)}><div className="procurement-comparison" tabIndex={0} role="region" aria-label="Notice comparison"><table><thead><tr><th>Field</th>{[...selection.values()].map(row => <th key={row.id}>{row.title}</th>)}</tr></thead><tbody>{[['Source','sourceId'],['Type','kind'],['Buyer','buyer'],['Region','region'],['Source status','status'],['Deadline / award date','deadline']].map(([label,key]) => <tr key={key}><th>{label}</th>{[...selection.values()].map(row => <td key={row.id}>{key === 'sourceId' ? sourceName(row[key]) : key === 'deadline' ? row.kind === 'award' ? row[key] || 'Not provided' : deadlineLabel(row[key]) : row[key] || 'Not provided'}</td>)}</tr>)}</tbody></table></div><p>Source status describes the published notice. Shortlisting does not submit a bid.</p></Modal>}
    {detailId && <Modal title={detail.data?.record?.title ?? 'Notice details'} mobileSheet onClose={() => setDetailId('')}>
      {detail.isPending && <p role="status">Loading original record…</p>}{detail.error && <p role="alert">{detail.error.message}</p>}
      {detail.data?.record && <div className="procurement-detail"><p>{sourceName(detail.data.record.data.sourceId || 'bc-bid')} · {detail.data.record.kind}</p><LinkOut url={detail.data.record.data.detailUrl || detail.data.record.data.sourceUrl}>Open source</LinkOut><p className="procurement-description">{detail.data.record.data.sourceDescriptionText || detail.data.record.data.descriptionText || detail.data.record.data.opportunityDescription || 'No additional description saved.'}</p><dl>{[['Buyer',detail.data.record.data.issuedBy || detail.data.record.data.issuingOrganization],['Published status',detail.data.record.data.status],['Original reference',detail.data.record.data.externalId || detail.data.record.data.opportunityId],[detail.data.record.kind === 'award' ? 'Award date' : 'Closing date',detail.data.record.kind === 'award' ? detail.data.record.data.awardDate : deadlineLabel(detail.data.record.data.closingAt ?? detail.data.record.data.closingDate)],['Imported at',detail.data.record.data.importedAt],['Import file',detail.data.record.data.sourceFileName],['Import file SHA-256',detail.data.record.data.sourceFileSha256]].map(([label,value]) => <div key={label}><dt>{label}</dt><dd>{value || 'Not recorded'}</dd></div>)}</dl><Btn onClick={()=>setEvidenceIds([detailId])}>Analyze evidence</Btn><p>{detail.data.documents.length} downloaded documents · {detail.data.reviews.length} saved reviews</p>{(!detail.data.record.data.sourceId || detail.data.record.data.sourceId === 'bc-bid') ? <Btn onClick={() => navigatePlugin('/documents?record=' + encodeURIComponent(detailId) + '&kind=' + detail.data.record.kind)}>Documents & AI</Btn> : <p>CanadaBuys attachment retrieval is not connected yet. Its open-tender CSV can be collected from Sources.</p>}</div>}
    </Modal>}
    {importOpen && <CanadaBuysImport onClose={() => setImportOpen(false)} onImported={() => { void client.invalidateQueries({ queryKey: ['catalog'] }); }} />}
  </section>;
}

function CanadaBuysImport({ onClose, onImported }: { onClose(): void; onImported(): void }) {
  const importBatch = useAction('opportunities.importBatch');
  const [preview,setPreview] = useState<ReturnType<typeof parseCanadaBuysCsv>>(), [fileName,setFileName] = useState(''), [error,setError] = useState('');
  const [reading,setReading] = useState(false), [busy,setBusy] = useState(false), [completed,setCompleted] = useState(0), [message,setMessage] = useState('');
  const stop = useRef(false), readGeneration = useRef(0);
  useEffect(() => () => { stop.current = true; readGeneration.current++; }, []);
  const load = async (file?: File) => {
    const generation = ++readGeneration.current; setPreview(undefined); setError(''); setCompleted(0); setMessage(''); if (!file) return;
    setReading(true);
    try { if (file.size > 20 * 1024 * 1024) throw Error('Choose a CSV smaller than 20 MiB.'); const bytes = await file.arrayBuffer(); const sha256 = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(value => value.toString(16).padStart(2,'0')).join(''); const result = parseCanadaBuysCsv(new TextDecoder('utf-8', { fatal: true }).decode(bytes), { fileName: file.name, sha256, importedAt: new Date().toISOString() }); if (generation === readGeneration.current) { setPreview(result); setFileName(file.name); } }
    catch (e) { if (generation === readGeneration.current) setError((e as Error).message); } finally { if (generation === readGeneration.current) setReading(false); }
  };
  const run = async () => {
    if (!preview) return; stop.current = false; setBusy(true); setError(''); setMessage('');
    try { let batchSize = 0; for (let offset = completed; offset < preview.records.length && !stop.current; offset += batchSize) { const proposed = nextImportBatch(preview.records,offset); const existing: any[] = []; for(let i=0;i<proposed.length;i+=4) existing.push(...(await host('catalog.read', {ids:proposed.slice(i,i+4).map(row => 'opportunity:'+row.sourceKey)})).records); const batch = nextImportBatch(preserveCanadaBuysEnrichment(proposed,existing),0); batchSize = batch.length; await importBatch({ records: batch, fileName }); const verified: any[] = []; for(let i=0;i<batch.length;i+=4) { const saved = await host('catalog.read', { ids: batch.slice(i,i+4).map(row => 'opportunity:' + row.sourceKey) }); verified.push(...saved.records); } verifyCanadaBuysImportReceipt(batch, verified); setCompleted(offset+batch.length); onImported(); } setMessage(stop.current ? 'Stopped between batches. Confirmed saved records are retained.' : 'Import complete. Saved records verified in the existing catalog.'); }
    catch(e) { setError((e as Error).message + ' Confirmed batches are retained; retries merge the same source IDs.'); } finally { setBusy(false); }
  };
  return <Modal title="Import CanadaBuys tenders" mobileSheet onClose={() => { if (!busy) onClose(); }} footer={<div className="procurement-actions"><Btn variant="secondary" disabled={busy} onClick={onClose}>Close</Btn>{busy ? <Btn variant="secondary" onClick={() => { stop.current = true; setMessage('Stopping after the current batch is confirmed…'); }}>Stop after this batch</Btn> : <Btn disabled={reading || !preview?.records.length || completed === preview?.records.length} onClick={() => void run()}>{completed ? 'Continue import' : `Import ${preview?.records.length.toLocaleString() ?? ''} notices`}</Btn>}</div>}>
    <div className="procurement-detail"><p>Choose a CanadaBuys tender CSV. Preview it before merging into the existing procurement catalog. BC Bid records, documents and shortlists are retained.</p><LinkOut url="https://canadabuys.canada.ca/en/procurement-and-contracting-data">CanadaBuys datasets</LinkOut><label>CSV file<input aria-label="CanadaBuys CSV file" type="file" accept=".csv,text/csv" disabled={busy || reading} onChange={event => void load(event.target.files?.[0])} /></label><p>Up to 20 MiB and 10,000 notices. Imports run in batches of up to 100 notices, bounded by file size. Keep this workspace open; leaving stops further batches, while an already-started batch may still finish.</p>{reading && <p role="status">Validating CSV…</p>}{preview && <><p>{preview.records.length.toLocaleString()} unique notices · {preview.duplicateCount} duplicate rows removed</p>{preview.warnings.map((warning,i) => <p key={i}>{warning}</p>)}<ul>{preview.records.slice(0,5).map(row => <li key={row.sourceKey}>{row.description} — {row.externalId}</li>)}</ul><p>Missing timezone information remains unknown. CSVs do not include document files. No portal credentials or automatic scraper are configured by this import.</p></>}{(busy || completed > 0) && <p role="status">{completed} of {preview?.records.length} notices confirmed saved</p>}{message && <p role="status">{message}</p>}{error && <p role="alert">{error}</p>}</div>
  </Modal>;
}
