import { awardProgress } from './award-progress';
import { annotateBuyerRecord } from './market/buyers';
import { useContext, useState } from 'react';
import { BidPreferences } from '../../apps/dashboard/src/components/preferences/BidPreferences';
import { BidGrid, BidFilters, LayoutToggle, useBidFilters, type BidFilterValues, type BidLayout } from './BidGrid';
import { useNarrowScreen } from './mobile';
import { Button } from '../../apps/dashboard/src/components/ui/Button';
import { parseContractAwardsJson, normalizeContractAwardImportRecord } from '../../packages/shared/src/contractAwards';
import { activeAwardRun, startAwardHistory, stopAwardHistory, useWorkspace, useAction, useQuery, readAll } from './backend';
import { downloadRecords } from './export';
import { StatusPill } from '../../apps/dashboard/src/components/scraper/StatusPill';
import { formatRuntime, formatTimestamp } from '../../apps/dashboard/src/lib/formatting';
function parseAwardImport(text: string) {
  const parsed = JSON.parse(text);
  return Array.isArray(parsed) && parsed[0]?.opportunityDescription !== undefined
    ? parsed.map((row: any) => ({ ...normalizeContractAwardImportRecord(row), ...(typeof row.starred === 'boolean' ? { starred: row.starred } : {}), ...(typeof row.sourceUrl === 'string' ? { sourceUrl: row.sourceUrl } : {}) }))
    : parseContractAwardsJson(text);
}
/** Export and import controls for one record type. Rendered inside the page header's "Export & import" disclosure. */
export function CatalogTools({ entity, showStarFilter=true, showCount=true }: { entity: 'award' | 'opportunity'; showStarFilter?:boolean; showCount?:boolean }) {
  const [exporting,setExporting]=useState(false),[exportError,setExportError]=useState('');
  const [importing,setImporting]=useState(false),[importError,setImportError]=useState('');
  const importOpportunities=useAction('opportunities.importBatch');
  const importAwards=useAction('contractAwards.importBatch');
  const { onlyStarred, setOnlyStarred } = useContext(BidPreferences);
  const counts = useQuery('catalog.count', { kind: entity, starredOnly: onlyStarred });
  const exportRows = async (format: 'csv' | 'json') => {
    setExporting(true); setExportError('');
    try { downloadRecords((await readAll(entity, !!onlyStarred, true)).map(row => annotateBuyerRecord(row, entity)), entity, format); }
    catch (error) { setExportError((error as Error).message); }
    finally { setExporting(false); }
  };
  const importFile = async (input: HTMLInputElement) => {
    const file = input.files?.[0]; if (!file) return;
    setImporting(true); setImportError('');
    try {
      if (entity === 'award') { const records = parseAwardImport(await file.text()); if (!records.length) throw new Error('No award records found.'); for (let i = 0; i < records.length; i += 100) await importAwards({ records: records.slice(i, i + 100), fileName: file.name }); }
      else { const records = JSON.parse(await file.text()); if (!Array.isArray(records) || !records.length) throw new Error('Use a JSON array of opportunities.'); for (let i = 0; i < records.length; i += 50) await importOpportunities({ records: records.slice(i, i + 50), fileName: file.name }); }
    } catch (error) { setImportError((error as Error).message); } finally { setImporting(false); input.value = ''; }
  };
  const noun = entity === 'award' ? 'award' : 'opportunity';
  return <div className="zoer-record-tools">
    {entity==='award'&&<AwardHistoryControls />}
    {showStarFilter&&<Button variant={onlyStarred ? 'primary' : 'ghost'} aria-pressed={!!onlyStarred} onClick={() => setOnlyStarred?.(!onlyStarred)}>{onlyStarred ? 'Showing starred' : 'Starred only'}</Button>}
    {showCount&&<span>{counts ? counts.total.toLocaleString() : 'Loading…'} {onlyStarred ? 'starred' : 'saved'} records</span>}
    <Button variant="ghost" disabled={!counts?.total || exporting} onClick={() => void exportRows('csv')}>Download CSV</Button>
    <Button variant="ghost" disabled={!counts?.total || exporting} onClick={() => void exportRows('json')}>Download JSON</Button>
    {exporting && <span role="status">Exporting…</span>}{exportError && <p role="alert">{exportError}</p>}
    <details><summary>Import {noun} JSON</summary><input type="file" accept=".json,application/json" aria-label={`Import ${noun} JSON`} disabled={importing} onChange={event => void importFile(event.currentTarget)} />{importing&&<p role="status">Saving {noun} records…</p>}{importError&&<p role="alert">{importError}</p>}</details>
  </div>;
}
/** Download / Resume / Stop for the public award history. Used in the awards header and on the Scraper tab. */
export function AwardHistoryControls({ note, showError = true }: { note?: string; showError?: boolean }) {
  const { model } = useWorkspace();
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [message, setMessage] = useState('');
  if (!model) return null;
  const active = activeAwardRun(model), checkpoint = model.awardCheckpoint;
  const resumable = !!checkpoint && !checkpoint.complete && !active;
  const act = async (fn: () => Promise<void>, done: string) => { setBusy(true); setError(''); setMessage(''); try { await fn(); setMessage(done); } catch (e) { setError(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); } };
  return <>
    {resumable && <Button disabled={busy} onClick={() => act(() => startAwardHistory(true), note ? `Resumed. ${note}` : 'Resumed.')}>{checkpoint.version === 2 ? 'Resume' : 'Backfill by date'}</Button>}
    {!resumable && <Button variant={resumable ? 'ghost' : 'primary'} disabled={busy || !!active || checkpoint?.version === 2 && checkpoint.complete} onClick={() => act(() => startAwardHistory(), note ? `Started. ${note}` : 'Started.')}>Download history</Button>}
    <Button variant="ghost" disabled={busy || !!active} onClick={() => act(() => startAwardHistory(false, true), 'Checking the last 30 days.')}>Refresh recent awards</Button>
    {active && <Button variant="ghost" disabled={busy || !!active.cancelRequestedAt} onClick={() => act(stopAwardHistory, 'Stopping after the current request.')}>{active.cancelRequestedAt ? 'Stopping…' : 'Stop'}</Button>}
    {message && <span role="status">{message}</span>}
    {showError && error && <p role="alert">{error}</p>}
  </>;
}
/** Scraper tab row: current award history status with its controls. */
export function AwardHistoryPanel() {
  const { model } = useWorkspace();
  if (!model) return null;
  const active = activeAwardRun(model), latest = model.awardRuns[0];
  const isRecent = model.awardRecentCheckpoint?.runId === latest?.id;
  const checkpoint = isRecent ? model.awardRecentCheckpoint : model.awardCheckpoint;
  // A retry can be interrupted before its first save. Keep the durable checkpoint visible.
  const status = active ? (active.cancelRequestedAt ? 'Stopping after the current request.' : active.queueReason || 'Download running. You can close this page.')
    : checkpoint?.complete ? isRecent ? 'Recent refresh complete.' : checkpoint.version === 2 ? 'Dated history complete.' : 'Search complete.'
    : latest ? `Last run ${latest.status === 'outcome_unknown' ? 'was interrupted' : latest.cancelRequestedAt ? 'stopped' : latest.status}. Saved records are retained.`
    : 'Not downloaded yet.';
  const lastError = !active && !latest?.cancelRequestedAt && latest?.status !== 'outcome_unknown' ? latest?.error : '';
  return <section className="zoer-history zoer-setup" aria-label="Award history download">
    <div className="zoer-setup-row">
      <div><h2>Award history</h2><p role="status">{status} {awardProgress(checkpoint)}</p>{isRecent && <p>Historical backfill: {model.awardCheckpoint?.version === 2 ? awardProgress(model.awardCheckpoint) : 'Date coverage has not been checked yet. Previously saved awards are retained.'}</p>}{lastError && <p role="alert">{lastError}</p>}</div>
      <div className="zoer-record-tools zoer-setup-actions"><AwardHistoryControls /></div>
    </div>
    <details><summary>About this download</summary><p>Checks public awards in date ranges and saves each page. Completed ranges are skipped; oversized ranges are split into smaller periods. Resume rechecks only the unfinished range, and unchanged records are retained. Refresh recent awards checks the last 30 days for new or changed records without replacing historical coverage. Undated awards and attachments are outside this download. Older page-number checkpoints are retained when starting the date backfill.</p></details>
  </section>;
}
/** Run history tab: award history runs, shown above the opportunity scrape runs. */
export function AwardRunList({ limit = 5 }: { limit?: number }) {
  const { model } = useWorkspace();
  if (!model?.awardRuns.length) return null;
  return <section aria-label="Award history runs" className="space-y-3">
    <h2 className="text-[15px] font-semibold text-text-primary">Award history runs</h2>
    {model.awardRuns.slice(0, limit).map((run: any) => {
      const interrupted = run.status === 'outcome_unknown';
      const status = ['succeeded', 'failed', 'cancelled'].includes(run.status) ? run.status : interrupted ? 'failed' : run.cancelRequestedAt ? 'stopping' : 'running';
      const startedAt = Date.parse(run.createdAt), completedAt = run.completedAt ? Date.parse(run.completedAt) : null;
      const progress = [model.awardCheckpoint, model.awardRecentCheckpoint].find(value => value?.runId === run.id);
      const rows = awardProgress(progress);
      const message = run.queueReason || (interrupted ? 'Interrupted before completion was confirmed. Saved pages are retained.' : run.error || (status === 'succeeded' ? 'Award search finished. See coverage above.' : status === 'cancelled' ? 'Stopped by operator.' : status === 'stopping' ? 'Stopping after the current request.' : 'Downloading public award history.'));
      return <article key={run.id} className="rounded-xl border border-border-subtle bg-bg-subtle p-4 space-y-2">
        <div className="flex items-center justify-between gap-3"><StatusPill status={status} interrupted={interrupted} /><span className="text-xs text-text-tertiary">{formatTimestamp(startedAt)}</span></div>
        <div className="text-sm font-medium text-text-primary">{message}</div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-text-secondary">{rows && <span>{rows}</span>}<span>{formatRuntime((completedAt ?? Date.now()) - startedAt)}</span><span className="text-text-tertiary">Award history</span></div>
      </article>;
    })}
    <h2 className="text-[15px] font-semibold text-text-primary">Opportunity scrape runs</h2>
  </section>;
}
export function AwardsBrowser() {
  const { onlyStarred, setOnlyStarred } = useContext(BidPreferences);
  const [filters,setFilters]=useBidFilters('award');
  const count = useQuery('catalog.count', { kind: 'award' });
  const narrow = useNarrowScreen(); const [layout, setLayout] = useState<BidLayout>('list');
  const [filtersOpen, setFiltersOpen] = useState(false), [columnFilters, setColumnFilters] = useState(0);
  const inlinePanel = narrow && layout === 'list';
  return <div className="bid-opportunities-page zoer-awards">
    <header className="bid-page-header"><div><h1>Contract awards</h1><p>{count ? count.total.toLocaleString() : 'Loading…'} {onlyStarred ? 'starred' : 'saved'} awards</p></div>{narrow && <LayoutToggle value={layout} onChange={setLayout} />}</header>
    <div className="bid-scope-bar"><button type="button" aria-pressed={!onlyStarred} onClick={()=>setOnlyStarred?.(false)}>All awards</button><button type="button" aria-pressed={!!onlyStarred} onClick={()=>setOnlyStarred?.(true)}>Starred</button></div>
    <BidFilters kind="award" values={filters} onChange={setFilters} open={filtersOpen} onOpenChange={setFiltersOpen} inlinePanel={inlinePanel} columnFilters={inlinePanel ? 0 : columnFilters}/>
    <BidGrid kind="award" filters={filters} onFiltersChange={setFilters} layout={layout} filtersOpen={filtersOpen} onFiltersOpenChange={setFiltersOpen} onColumnFiltersChange={setColumnFilters}/>
  </div>;
}
