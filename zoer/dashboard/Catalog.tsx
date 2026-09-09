import { useContext, useEffect, useMemo, useState } from 'react';
import { BidPreferences } from '../../apps/dashboard/src/components/preferences/BidPreferences';
import { BidGrid, BidFilters, type BidFilterValues } from './BidGrid';
import { Button } from '../../apps/dashboard/src/components/ui/Button';
import { SearchInput } from '../../apps/dashboard/src/components/ui/SearchInput';
import { parseContractAwardsJson, normalizeContractAwardImportRecord } from '../../packages/shared/src/contractAwards';
import { activeAwardRun, startAwardHistory, stopAwardHistory, useWorkspace, useAction, useQuery, readAll } from './backend';
import { downloadRecords } from './export';
export function CatalogTools({ entity, showStarFilter=true, showCount=true }: { entity: 'award' | 'opportunity'; showStarFilter?:boolean; showCount?:boolean }) {
  const [exporting,setExporting]=useState(false),[exportError,setExportError]=useState('');
  const [importing,setImporting]=useState(false),[importError,setImportError]=useState('');
  const importBatch=useAction('opportunities.importBatch');
  const { onlyStarred, setOnlyStarred } = useContext(BidPreferences);
  const counts = useQuery('catalog.count', { kind: entity, starredOnly: onlyStarred });
  const exportRows = async (format: 'csv' | 'json') => {
    setExporting(true); setExportError('');
    try { downloadRecords(await readAll(entity, !!onlyStarred), entity, format); }
    catch (error) { setExportError((error as Error).message); }
    finally { setExporting(false); }
  };
  return <div className="zoer-record-tools">
    {showStarFilter&&<Button variant={onlyStarred ? 'primary' : 'ghost'} aria-pressed={!!onlyStarred} onClick={() => setOnlyStarred?.(!onlyStarred)}>{onlyStarred ? 'Showing starred' : 'Starred only'}</Button>}
    {showCount&&<span>{counts ? counts.total.toLocaleString() : 'Loading…'} {onlyStarred ? 'starred' : 'saved'} records</span>}
    <Button variant="ghost" disabled={!counts?.total || exporting} onClick={() => void exportRows('csv')}>Download CSV</Button>
    <Button variant="ghost" disabled={!counts?.total || exporting} onClick={() => void exportRows('json')}>Download JSON</Button>
    {exporting && <span role="status">Preparing complete export…</span>}{exportError && <p role="alert">{exportError}</p>}
    {entity==='opportunity'&&<details><summary>Import opportunity JSON</summary><input type="file" accept=".json,application/json" aria-label="Import opportunity JSON" disabled={importing} onChange={async event=>{
      const input=event.currentTarget,file=input.files?.[0];if(!file)return;setImporting(true);setImportError('');
      try{const records=JSON.parse(await file.text());if(!Array.isArray(records)||!records.length)throw new Error('Use a JSON array of opportunities.');for(let i=0;i<records.length;i+=50)await importBatch({records:records.slice(i,i+50),fileName:file.name});}catch(error){setImportError((error as Error).message);}finally{setImporting(false);input.value='';}
    }}/>{importing&&<p role="status">Saving opportunities…</p>}{importError&&<p role="alert">{importError}</p>}</details>}
  </div>;
}
export function AwardHistoryPanel() {
  const { model } = useWorkspace();
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  if (!model) return null;
  const active = activeAwardRun(model), checkpoint = model.awardCheckpoint, latest = model.awardRuns[0];
  const progress = latest && checkpoint?.runId !== latest.id ? null : checkpoint;
  const act = async (fn: () => Promise<void>) => { setBusy(true); setError(''); try { await fn(); } catch (e) { setError(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); } };
  return <section className="zoer-history" aria-label="Award history download">
    <h2>Historical contract awards</h2>
    <p>Collect every page available in BC Bid’s public award search, including older awards. Records are saved in Zoer as each page completes; exports include all saved records. Attachment files are not downloaded.</p>
    <div className="zoer-record-tools">
      <Button disabled={busy || !!active} onClick={() => act(() => startAwardHistory())}>Download award history</Button>
      {checkpoint && !checkpoint.complete && !active && <Button variant="ghost" disabled={busy} onClick={() => act(() => startAwardHistory(true))}>Resume history</Button>}
      {active && <Button variant="ghost" disabled={busy || !!active.cancelRequestedAt} onClick={() => act(stopAwardHistory)}>{active.cancelRequestedAt ? 'Stopping…' : 'Stop history'}</Button>}
    </div>
    <p role="status">{active ? active.cancelRequestedAt ? 'Stopping after the current request.' : 'History download running. You can close this dashboard.' : progress?.complete ? 'Search complete.' : latest ? `Last history run: ${latest.cancelRequestedAt ? 'stopped' : latest.status}. Saved records are retained.` : 'Ready to download history.'} {progress ? `${progress.count.toLocaleString()} rows saved across ${progress.page.toLocaleString()} pages.` : ''}</p>
    {(error || (!active && !latest?.cancelRequestedAt && latest?.error)) && <p role="alert">{error || latest.error}</p>}
  </section>;
}
export function AwardsBrowser() {
  const { model } = useWorkspace();
  const { onlyStarred } = useContext(BidPreferences);
  const [filters,setFilters]=useState<BidFilterValues>({search:'',organization:'',status:'',type:''});
  const [importing, setImporting] = useState(false), [error, setError] = useState('');
  const importBatch = useAction('contractAwards.importBatch');
  return <div className="zoer-awards"><h1>Contract awards</h1><AwardHistoryPanel /><CatalogTools entity="award" />
    <BidFilters kind="award" values={filters} onChange={setFilters}/>
    <BidGrid kind="award" filters={filters}/>
    <details className="zoer-history"><summary>Import award JSON</summary><input type="file" accept=".json,application/json" aria-label="Import award JSON" disabled={importing} onChange={async event => {
      const input=event.currentTarget; const file = input.files?.[0]; if (!file) return; setImporting(true); setError('');
      try { const text = await file.text(), parsed = JSON.parse(text); const records = Array.isArray(parsed) && parsed[0]?.opportunityDescription !== undefined ? parsed.map((row:any)=>({...normalizeContractAwardImportRecord(row),...(typeof row.starred==='boolean'?{starred:row.starred}:{}),...(typeof row.sourceUrl==='string'?{sourceUrl:row.sourceUrl}:{})})) : parseContractAwardsJson(text); if (!records.length) throw new Error('No award records found.'); for (let i=0; i<records.length; i+=100) await importBatch({ records: records.slice(i,i+100), fileName:file.name }); } catch(e) { setError(e instanceof Error ? e.message : String(e)); } finally { setImporting(false); input.value=''; }
    }} />{importing && <p role="status">Importing and saving awards…</p>}{error && <p role="alert">{error}</p>}</details>
  </div>;
}
