import { useEffect, useRef, useState } from 'react';
import { Button } from '../../apps/dashboard/src/components/ui/Button';
import { BatchProgress } from './BatchProgress';
import { useCatalogState } from './BatchHistory';
import { BulkDocuments } from './BulkDocuments';
import { RecordPicker } from './RecordPicker';
import { host } from './bridge';
import { BUNDLE_MAX_NOTICES, downloadDocumentBundle, sizeText } from './document-bundle';
import { navigatePlugin, usePluginQuery } from './navigation';
import { Hint } from './host-ui';
import { DocumentStats } from './DocumentInventory';
import { NoticeView } from './procurement/NoticeView';
import { useCapabilities } from './capabilities';
import { useDocumentBrowsers } from './use-document-browsers';
import { activeDownloadBatch, assertDocumentBrowserIdle } from './document-run';
import { refreshAfterChange, useWorkspace } from './backend';
import { splitDocumentBatches } from './document-processing';
import { DocumentProcessing } from './DocumentProcessing';

export function Documents() {
  const { downloadBlocked: browserBusy } = useDocumentBrowsers();
  const { model } = useWorkspace();
  const [error, setError] = useState(''), [message, setMessage] = useState(''), [busy, setBusy] = useState(false);
  const [showSize,setShowSize] = useState(true);
  const [selection, setSelection] = useState<Set<string>>(new Set());
  const [recordId, setRecordId] = usePluginQuery('record');
  // Operations › Documents is one page: `?focus=extraction` (old Processing links) scrolls to Text extraction.
  const [focus] = usePluginQuery('focus'), page = useRef<HTMLElement>(null);
  const toExtraction = () => page.current?.querySelector('[aria-label="Text extraction"]')?.scrollIntoView?.({ block: 'start' });
  useEffect(() => {
    if (focus !== 'extraction') return;
    // The panels above it fill in as their counts load (and the shell starts a new page at the top), so settle a few times
    // until the user scrolls or clicks.
    const timers = [0, 300, 1000, 2500].map(delay => setTimeout(toExtraction, delay)), events = ['wheel', 'touchstart', 'keydown', 'pointerdown'] as const;
    const stop = () => { timers.forEach(clearTimeout); events.forEach(name => window.removeEventListener(name, stop, true)); };
    events.forEach(name => window.addEventListener(name, stop, { capture: true, passive: true }));
    return stop;
  }, [focus]);
  const [state, refresh] = useCatalogState(setError);
  // Downloads and text extraction are separate runs: neither one's progress, history or controls include the other's.
  const { downloads, processing } = splitDocumentBatches(state.batches);
  const extraction = new Set(processing.map((batch: any) => batch.id)), withoutProcessing = state.batches.filter((batch: any) => !extraction.has(batch.id));
  const downloadRunning = downloads.some((batch: any) => batch.status === 'running');
  const refreshKey = state.batches[0]?.updated_at ?? '';
  // Flag the download runs only for the latest download, so old stopped runs do not keep it lit.
  const latest = downloads[0]?.status, attention = latest === 'waiting_for_user' || latest === 'failed';
  const download = async () => {
    setBusy(true); setError(''); setMessage('');
    try {
      await assertDocumentBrowserIdle(host);
      await host('action', { actionId: 'documents.download', input: { recordIds: [...selection], force: false } });
      setMessage(`Download started for ${selection.size} ${selection.size === 1 ? 'opportunity' : 'opportunities'}.`);
      // The run list decides what can be stopped; reload it with the batch list.
      await Promise.all([refresh(), refreshAfterChange()]);
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };
  const bundle = async () => {
    setBusy(true); setError(''); setMessage('');
    try { const result = await downloadDocumentBundle(host, [...selection], { scope: 'selected notices' }); setMessage(`Downloaded ${result.name}: ${result.documents} file${result.documents === 1 ? '' : 's'} (${sizeText(result.bytes)}).`); }
    catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };
  const { collection } = useCapabilities();
  return <section ref={page} className="research doc-page">
    {/* Operations › Documents is named by the section's view tabs (Shell); the page itself has no heading. */}
    <DocumentStats refreshKey={refreshKey} onShowFailed={() => navigatePlugin('/files?fileStatus=failed')} onShowPending={toExtraction} />
    <label className="research-note"><input type="checkbox" checked={showSize} onChange={e => setShowSize(e.target.checked)} /> Show file sizes</label>
    <BatchProgress showSize={showSize} batches={withoutProcessing} tasks={state.tasks} onSkip={collection && state.fileTransferControls ? async (taskId,transferId) => {
      await host('catalog.skipDownload',{taskId,transferId});
      await refresh();
    } : undefined} />
    {collection && attention && <p className="doc-attention" role="status"><span className="doc-dot" aria-hidden="true" />The last download needs attention. <button type="button" onClick={() => navigatePlugin('/runs?kind=downloads')}>Open download runs</button></p>}
    {(error || state.loadError) && <p role="alert">{error || state.loadError}</p>}{message && <p role="status">{message}</p>}
    {collection && <>
      <BulkDocuments running={downloadRunning} activeBatch={activeDownloadBatch(downloads, model?.workflowRuns)} onStarted={refresh} />
      <h2 className="doc-subhead">Or pick opportunities</h2>
      <RecordPicker selection={selection} setSelection={setSelection} onDetails={setRecordId} more={[{ label: 'Open database viewer', onClick: () => void host('catalog.open') }]}
        actions={<><Button disabled={busy || browserBusy || !selection.size} onClick={() => void download()}>Download selected</Button><Hint action content="Saved files of the selected notices and a CSV, as one zip"><Button variant="ghost" disabled={busy || !selection.size || selection.size > BUNDLE_MAX_NOTICES} onClick={() => void bundle()}>Save files as zip</Button></Hint></>} />
    </>}
    <DocumentProcessing supported={!!state.deferredExtraction} collection={collection} batches={processing} tasks={state.tasks} onChanged={refresh} onError={setError} />
    {recordId && <NoticeView id={recordId} layout="dialog" initialTab="documents" onClose={() => setRecordId('')} />}
  </section>;
}
