import { useState } from 'react';
import { Button } from '../../apps/dashboard/src/components/ui/Button';
import { BatchHistory, BatchProgress, useCatalogState } from './BatchHistory';
import { BulkDocuments } from './BulkDocuments';
import { RecordPicker } from './RecordPicker';
import { host } from './bridge';
import { usePluginQuery } from './navigation';
import { DocumentInventory } from './DocumentInventory';
import { NoticeView } from './procurement/NoticeView';

export function Documents() {
  const [error, setError] = useState(''), [message, setMessage] = useState(''), [busy, setBusy] = useState(false);
  const [selection, setSelection] = useState<Set<string>>(new Set());
  const [recordId, setRecordId] = usePluginQuery('record');
  const [state, refresh] = useCatalogState(setError);
  const download = async () => {
    setBusy(true); setError(''); setMessage('');
    try {
      await host('action', { actionId: 'documents.download', input: { recordIds: [...selection], force: false } });
      setMessage(`Download started for ${selection.size} ${selection.size === 1 ? 'record' : 'records'}.`);
      await refresh();
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };
  return <section className="research">
    <header className="bid-page-header"><h1>Documents</h1><Button variant="ghost" onClick={() => void host('catalog.open')}>Open database viewer</Button></header>
    <BatchProgress batches={state.batches} tasks={state.tasks} />
    <DocumentInventory onDetails={setRecordId} refreshKey={state.batches[0]?.updated_at??''} running={state.batches.some((batch:any)=>batch.status==='running')} />
    <BulkDocuments running={state.batches.some((batch: any) => batch.kind === 'download' && batch.status === 'running')} onStarted={refresh} />
    <RecordPicker selection={selection} setSelection={setSelection} onDetails={setRecordId}
      actions={<Button disabled={busy || !selection.size} onClick={() => void download()}>Download selected</Button>} />
    {error && <p role="alert">{error}</p>}{message && <p role="status">{message}</p>}
    <BatchHistory title="Download history" kind="download" batches={state.batches} tasks={state.tasks} onChanged={refresh} onError={setError} />
    {recordId && <NoticeView id={recordId} layout="dialog" initialTab="documents" onClose={() => setRecordId('')} />}
  </section>;
}
