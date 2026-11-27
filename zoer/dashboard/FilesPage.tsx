import { useState } from 'react';
import { useCatalogState } from './BatchHistory';
import { DocumentFiles } from './DocumentInventory';
import { NoticeView } from './procurement/NoticeView';
import { splitDocumentBatches } from './document-processing';
import { usePluginQuery } from './navigation';
import { useDocumentBrowsers } from './use-document-browsers';

/**
 * Opportunities › Files (`/files`): the saved-files library that used to be Documents › Files. It keeps that tab's query
 * keys (`fileStatus` for the coverage filter, `record` for the open notice), so redirected `/documents?tab=files…` links
 * land filtered. Retry and Re-extract stay collection-gated inside the list; the stat tiles stay on Operations › Documents.
 */
export function FilesPage() {
  const { downloadBlocked: browserBusy } = useDocumentBrowsers();
  const [error, setError] = useState(''), [showSize, setShowSize] = useState(true);
  const [recordId, setRecordId] = usePluginQuery('record');
  const [state] = useCatalogState(setError);
  // A running download holds file retries and a running extraction holds Re-extract; neither blocks the other.
  const { downloads, processing } = splitDocumentBatches(state.batches);
  const running = (batches: any[]) => batches.some(batch => batch.status === 'running');
  return <section className="research doc-page">
    <label className="research-note"><input type="checkbox" checked={showSize} onChange={e => setShowSize(e.target.checked)} /> Show file sizes</label>
    {(error || state.loadError) && <p role="alert">{error || state.loadError}</p>}
    <DocumentFiles showSize={showSize} fileTransferControls={!!state.fileTransferControls} onDetails={setRecordId} refreshKey={state.batches[0]?.updated_at ?? ''}
      downloadRunning={running(downloads)} processingRunning={running(processing)} browserBusy={browserBusy} />
    {recordId && <NoticeView id={recordId} layout="dialog" initialTab="documents" onClose={() => setRecordId('')} />}
  </section>;
}
