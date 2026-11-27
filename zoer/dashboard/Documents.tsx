import { useEffect, useRef, useState } from 'react';
import { Button } from '../../apps/dashboard/src/components/ui/Button';
import { BatchProgress } from './BatchProgress';
import { useCatalogState } from './BatchHistory';
import { BulkDocuments } from './BulkDocuments';
import { RecordPicker } from './RecordPicker';
import { host } from './bridge';
import { BUNDLE_MAX_NOTICES, downloadDocumentBundle, sizeText } from './document-bundle';
import { usePluginQuery } from './navigation';
import { Hint } from './host-ui';
import { DocumentStats } from './DocumentInventory';
import { NoticeView } from './procurement/NoticeView';
import { useCapabilities } from './capabilities';
import { useDocumentBrowsers } from './use-document-browsers';
import { activeDownloadBatch, assertDocumentBrowserIdle } from './document-run';
import { refreshAfterChange, useWorkspace } from './backend';
import { splitDocumentBatches } from './document-processing';
import { DocumentProcessing } from './DocumentProcessing';
import { plural } from './format';
import './runs-page.css';

/**
 * Operations › Documents, one page: the stat row once, Download missing files (with the document gap and the active run's
 * pace), Text extraction (its history is under Operations › Runs), and "Download files for specific opportunities"
 * (the record picker, folded away by default).
 */
export function Documents() {
  const { downloadBlocked: browserBusy } = useDocumentBrowsers();
  const { model } = useWorkspace();
  const [error, setError] = useState(''), [message, setMessage] = useState(''), [busy, setBusy] = useState(false);
  const [selection, setSelection] = useState<Set<string>>(new Set());
  const [recordId, setRecordId] = usePluginQuery('record');
  // `?focus=extraction` (old Processing links, the Text pending tile) scrolls to Text extraction.
  const [focus, setFocus] = usePluginQuery('focus'), page = useRef<HTMLElement>(null);
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
  // Downloads and text extraction are separate runs: neither one's progress or controls include the other's.
  const { downloads, processing } = splitDocumentBatches(state.batches);
  const downloadRunning = downloads.some((batch: any) => batch.status === 'running');
  const download = async () => {
    setBusy(true); setError(''); setMessage('');
    try {
      await assertDocumentBrowserIdle(host);
      await host('action', { actionId: 'documents.download', input: { recordIds: [...selection], force: false } });
      setMessage(`Download started for ${plural(selection.size, 'opportunity', 'opportunities')}.`);
      // The run list decides what can be stopped; reload it with the batch list.
      await Promise.all([refresh(), refreshAfterChange()]);
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };
  const bundle = async () => {
    setBusy(true); setError(''); setMessage('');
    try { const result = await downloadDocumentBundle(host, [...selection], { scope: 'selected notices' }); setMessage(`Downloaded ${result.name}: ${plural(result.documents, 'file')} (${sizeText(result.bytes)}).`); }
    catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };
  const { collection } = useCapabilities();
  const canDownload = !busy && !browserBusy && selection.size > 0;
  const progress = <BatchProgress fileOnly batches={downloads} tasks={state.tasks} onSkip={collection && state.fileTransferControls ? async (taskId,transferId) => {
    await host('catalog.skipDownload',{taskId,transferId});
    await refresh();
  } : undefined} />;
  return <section ref={page} className="research doc-page">
    {/* Operations › Documents is named by the section's view tabs (Shell); the page itself has no heading. */}
    <DocumentStats onShowPending={() => { if (focus === 'extraction') toExtraction(); else setFocus('extraction'); }} />
    {(error || state.loadError) && <p role="alert">{error || state.loadError}</p>}{message && <p role="status">{message}</p>}
    {collection && <BulkDocuments running={downloadRunning} activeBatch={activeDownloadBatch(downloads, model?.workflowRuns)} onStarted={refresh} downloads={downloads} progress={progress} />}
    <DocumentProcessing supported={!!state.deferredExtraction} collection={collection} batches={processing} tasks={state.tasks} onChanged={refresh} onError={setError} />
    {collection && <details className="zoer-history doc-picker">
      <summary data-zoer-disclosure=""><h2>Download files for specific opportunities</h2></summary>
      <RecordPicker selection={selection} setSelection={setSelection} onDetails={setRecordId} more={[{ label: 'Open database viewer', onClick: () => void host('catalog.open') }]}
        actions={<><Button variant={canDownload ? 'primary' : 'ghost'} disabled={!canDownload} onClick={() => void download()}>Download selected</Button><Hint action content="Saved files of the selected opportunities and a CSV, as one zip"><Button variant="ghost" disabled={busy || !selection.size || selection.size > BUNDLE_MAX_NOTICES} onClick={() => void bundle()}>Save files as zip</Button></Hint></>} />
    </details>}
    {recordId && <NoticeView id={recordId} layout="dialog" initialTab="documents" onClose={() => setRecordId('')} />}
  </section>;
}
