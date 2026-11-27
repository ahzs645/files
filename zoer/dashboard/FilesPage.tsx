import { useState } from 'react';
import { useCatalogState } from './BatchHistory';
import { DocumentFiles } from './DocumentInventory';
import { NoticeView } from './procurement/NoticeView';
import { splitDocumentBatches } from './document-processing';
import { usePluginQuery } from './navigation';
import { useDocumentBrowsers } from './use-document-browsers';
import './runs-page.css';

/**
 * Opportunities › Files (`/files`): the saved-files library that used to be Documents › Files. It keeps that tab's query
 * keys (`fileStatus` for the coverage filter, `record` for the open notice), so redirected `/documents?tab=files…` links
 * land filtered, and `search` keeps the search. The list says what it holds with real counts; failed downloads are grouped by
 * reason. Retry and Re-extract stay collection-gated inside the list; the stat tiles stay on Operations › Documents.
 */
export function FilesPage() {
  const { downloadBlocked: browserBusy } = useDocumentBrowsers();
  const [error, setError] = useState('');
  const [recordId, setRecordId] = usePluginQuery('record');
  const [state] = useCatalogState(setError);
  // A running download holds file retries and a running extraction holds Re-extract; neither blocks the other.
  const { downloads, processing } = splitDocumentBatches(state.batches);
  const running = (batches: any[]) => batches.some(batch => batch.status === 'running');
  return <section className="research doc-page">
    {(error || state.loadError) && <p role="alert">{error || state.loadError}</p>}
    <DocumentFiles fileTransferControls={!!state.fileTransferControls} onDetails={setRecordId} refreshKey={state.batches[0]?.updated_at ?? ''}
      downloadRunning={running(downloads)} processingRunning={running(processing)} browserBusy={browserBusy} />
    {recordId && <NoticeView id={recordId} layout="dialog" initialTab="documents" onClose={() => setRecordId('')} />}
  </section>;
}
