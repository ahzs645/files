import { useState } from 'react';
import { Button } from '../../apps/dashboard/src/components/ui/Button';
import { BatchHistory, BatchProgress, useCatalogState } from './BatchHistory';
import { BulkDocuments } from './BulkDocuments';
import { RecordPicker } from './RecordPicker';
import { host } from './bridge';
import { BUNDLE_MAX_NOTICES, downloadDocumentBundle, sizeText } from './document-bundle';
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
  const bundle = async () => {
    setBusy(true); setError(''); setMessage('');
    try { const result = await downloadDocumentBundle(host, [...selection], { scope: 'selected notices' }); setMessage(`Downloaded ${result.name}: ${result.documents} file${result.documents === 1 ? '' : 's'} (${sizeText(result.bytes)}).`); }
    catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };
  const current = TABS.some(([id]) => id === tab) ? tab : '';
  return <section className="research doc-page">
    {/* Download · Files · History are the section's tabs (Shell); the page itself has no heading. */}
    <DocumentStats refreshKey={refreshKey} />
    <BatchProgress batches={state.batches} tasks={state.tasks} />
    {attention && current !== 'history' && <p className="doc-attention" role="status"><span className="doc-dot" aria-hidden="true" />The last download needs attention. <button type="button" onClick={() => setTab('history')}>Open history</button></p>}
    {error && <p role="alert">{error}</p>}{message && <p role="status">{message}</p>}
    {current === '' && <>
      <BulkDocuments running={downloads.some((batch: any) => batch.status === 'running')} onStarted={refresh} />
      <h2 className="doc-subhead">Or pick opportunities</h2>
      <RecordPicker selection={selection} setSelection={setSelection} onDetails={setRecordId} more={[{ label: 'Open database viewer', onClick: () => void host('catalog.open') }]}
        actions={<><Button disabled={busy || !selection.size} onClick={() => void download()}>Download selected</Button><Button variant="ghost" disabled={busy || !selection.size || selection.size > BUNDLE_MAX_NOTICES} title="Saved files of the selected notices and a CSV, as one zip" onClick={() => void bundle()}>Save files as zip</Button></>} />
    </>}
    {current === 'files' && <DocumentFiles onDetails={setRecordId} refreshKey={refreshKey} running={running} />}
    {current === 'history' && <BatchHistory title="Download history" kind="download" batches={state.batches} tasks={state.tasks} onChanged={refresh} onError={setError} />}
    {recordId && <NoticeView id={recordId} layout="dialog" initialTab="documents" onClose={() => setRecordId('')} />}
  </section>;
}
