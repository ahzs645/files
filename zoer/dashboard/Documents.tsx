import { useState } from 'react';
import { Button } from '../../apps/dashboard/src/components/ui/Button';
import { BatchHistory, BatchProgress, useCatalogState } from './BatchHistory';
import { BulkDocuments } from './BulkDocuments';
import { RecordPicker } from './RecordPicker';
import { host } from './bridge';
import { usePluginQuery } from './navigation';
import { DocumentFiles, DocumentStats } from './DocumentInventory';
import { NoticeView } from './procurement/NoticeView';

const TABS: [string, string][] = [['', 'Download'], ['files', 'Files'], ['history', 'History']];

export function Documents() {
  const [error, setError] = useState(''), [message, setMessage] = useState(''), [busy, setBusy] = useState(false);
  const [selection, setSelection] = useState<Set<string>>(new Set());
  const [recordId, setRecordId] = usePluginQuery('record');
  const [tab, setTab] = usePluginQuery('tab');
  const [state, refresh] = useCatalogState(setError);
  const downloads = state.batches.filter((batch: any) => batch.kind === 'download');
  const running = state.batches.some((batch: any) => batch.status === 'running');
  const refreshKey = state.batches[0]?.updated_at ?? '';
  // Flag History only for the latest download, so old stopped runs do not keep it lit.
  const latest = downloads[0]?.status, attention = latest === 'waiting_for_user' || latest === 'failed';
  const download = async () => {
    setBusy(true); setError(''); setMessage('');
    try {
      await host('action', { actionId: 'documents.download', input: { recordIds: [...selection], force: false } });
      setMessage(`Download started for ${selection.size} ${selection.size === 1 ? 'opportunity' : 'opportunities'}.`);
      await refresh();
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };
  const current = TABS.some(([id]) => id === tab) ? tab : '';
  return <section className="research doc-page">
    <header className="bid-page-header"><h1>Documents</h1><Button variant="ghost" onClick={() => void host('catalog.open')}>Database viewer</Button></header>
    <DocumentStats refreshKey={refreshKey} />
    <BatchProgress batches={state.batches} tasks={state.tasks} />
    <div className="research-segment doc-tabs" role="tablist" aria-label="Document views">
      {TABS.map(([id, label]) => <Button key={id || 'download'} role="tab" aria-selected={current === id} variant={current === id ? 'primary' : 'ghost'} onClick={() => setTab(id)}>
        {label}{id === 'history' && attention && <span className="doc-dot" aria-label="needs attention" />}
      </Button>)}
    </div>
    {error && <p role="alert">{error}</p>}{message && <p role="status">{message}</p>}
    {current === '' && <>
      <BulkDocuments running={downloads.some((batch: any) => batch.status === 'running')} onStarted={refresh} />
      <h2 className="doc-subhead">Or pick opportunities</h2>
      <RecordPicker selection={selection} setSelection={setSelection} onDetails={setRecordId}
        actions={<Button disabled={busy || !selection.size} onClick={() => void download()}>Download selected</Button>} />
    </>}
    {current === 'files' && <DocumentFiles onDetails={setRecordId} refreshKey={refreshKey} running={running} />}
    {current === 'history' && <BatchHistory title="Download history" kind="download" batches={state.batches} tasks={state.tasks} onChanged={refresh} onError={setError} />}
    {recordId && <NoticeView id={recordId} layout="dialog" initialTab="documents" onClose={() => setRecordId('')} />}
  </section>;
}
