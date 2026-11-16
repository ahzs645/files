import { useState } from 'react';
import { Btn } from '@zoer/plugin-ui/controls';
import { fileSize } from '../file-size';
import { host } from '../bridge';
import { useWorkspace } from '../backend';
import { useCapabilities } from '../capabilities';
import { assertDocumentBrowserIdle, documentDownloadActive, sourceCaptureActive } from '../document-run';
import { plainError } from '../error-text';
import { runProcurementAction } from './state-client';
import { noticeFileRows, STATE_TEXT } from './notice-files';
import type { LinkState } from './status-data';

/**
 * Which of a notice's files are missing and why ("11 of 35 files saved" used to stop there): never tried, failed with
 * its reason, or waiting for a browser check. BC Bid notices can fetch the missing ones from here.
 */
export function NoticeFiles({ id, source, attachments, documents, onRefresh }: { id: string; source: string; attachments: unknown; documents: any[]; onRefresh(): void }) {
  const { collection } = useCapabilities(), { model } = useWorkspace();
  const [all, setAll] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState(''), [message, setMessage] = useState('');
  const rows = noticeFileRows(attachments, documents);
  if (!rows.length) return null;
  const missing = rows.filter(row => row.state !== 'saved'), saved = rows.length - missing.length;
  // Files saved from links the notice no longer lists (replaced addenda, earlier captures) are kept but not counted here.
  const linked = new Set(rows.map(row => row.url)), earlier = documents.filter(doc => doc.status === 'downloaded' && !linked.has(doc.url)).length;
  const browserBusy = !model || sourceCaptureActive(model.captureRuns) || documentDownloadActive(model.documentRuns);
  const shown = all ? missing : missing.slice(0, 8);
  const fetchMissing = async () => {
    setBusy(true); setError(''); setMessage('');
    try { await assertDocumentBrowserIdle(host); await runProcurementAction('documents.download', { recordIds: [id] }); setMessage('Missing files downloaded where BC Bid allowed it. Saved files were not downloaded again.'); onRefresh(); }
    catch (e) { setError(plainError((e as Error).message)); } finally { setBusy(false); }
  };
  return <section className="pc-card pc-notice-files" aria-label="Attachment files">
    <header><h3>{saved} of {rows.length} currently linked files saved</h3></header>
    {earlier > 0 && <p className="rw-muted">{earlier} more saved file{earlier === 1 ? ' comes' : 's come'} from links this notice no longer lists (for example replaced addenda); {earlier === 1 ? 'it is' : 'they are'} kept.</p>}
    {!missing.length ? <p className="rw-muted">Every linked file is saved.</p> : <>
      <ul className="pc-notice-file-list">{shown.map(row => <li key={row.url} data-state={row.state}>
        <div><a href={row.url} target="_blank" rel="noreferrer" className="pc-wrap">{row.name} ↗</a>{row.size !== undefined && <small> · {fileSize(row.size)}</small>}</div>
        <small className="pc-wrap"><span className="pc-status" data-tone={row.state === 'never' ? undefined : 'warn'}>{STATE_TEXT[row.state as Exclude<LinkState, 'saved'>]}</span>{row.reason ? ` ${row.reason}` : ''}</small>
      </li>)}</ul>
      {missing.length > shown.length && <Btn size="sm" variant="ghost" onClick={() => setAll(true)}>Show all {missing.length} missing files</Btn>}
      {collection && source === 'bc-bid' && <div className="procurement-actions"><Btn size="sm" variant="secondary" disabled={busy || browserBusy} onClick={() => void fetchMissing()}>{busy ? 'Downloading…' : `Get ${missing.length === 1 ? 'the missing file' : `the ${missing.length} missing files`}`}</Btn>{browserBusy && !busy && <span className="rw-muted">Wait for the running browser work to finish.</span>}</div>}
      {error && <p role="alert" className="pc-wrap">{error}</p>}{message && <p role="status">{message}</p>}
    </>}
  </section>;
}
