import { useEffect, useRef, useState } from 'react';
import { Btn, Modal } from '@zoer/plugin-ui/controls';
import { host } from '../bridge';
import { useAction } from '../backend';
import { safeSourceUrl } from './catalog';
import { nextImportBatch } from './import-batches';
import { parseCanadaBuysCsv, preserveCanadaBuysEnrichment, verifyCanadaBuysImportReceipt } from './import-canadabuys';

/** Preview a CanadaBuys tender CSV, then merge it in verified batches. */
export function CanadaBuysImport({ onClose, onImported }: { onClose(): void; onImported(): void }) {
  const importBatch = useAction('opportunities.importBatch');
  const [preview,setPreview] = useState<ReturnType<typeof parseCanadaBuysCsv>>(), [fileName,setFileName] = useState(''), [error,setError] = useState('');
  const [reading,setReading] = useState(false), [busy,setBusy] = useState(false), [completed,setCompleted] = useState(0), [message,setMessage] = useState('');
  const stop = useRef(false), readGeneration = useRef(0);
  useEffect(() => () => { stop.current = true; readGeneration.current++; }, []);
  const load = async (file?: File) => {
    const generation = ++readGeneration.current; setPreview(undefined); setError(''); setCompleted(0); setMessage(''); if (!file) return;
    setReading(true);
    try { if (file.size > 20 * 1024 * 1024) throw Error('Choose a CSV smaller than 20 MiB.'); const bytes = await file.arrayBuffer(); const sha256 = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(value => value.toString(16).padStart(2,'0')).join(''); const result = parseCanadaBuysCsv(new TextDecoder('utf-8', { fatal: true }).decode(bytes), { fileName: file.name, sha256, importedAt: new Date().toISOString() }); if (generation === readGeneration.current) { setPreview(result); setFileName(file.name); } }
    catch (e) { if (generation === readGeneration.current) setError((e as Error).message); } finally { if (generation === readGeneration.current) setReading(false); }
  };
  const run = async () => {
    if (!preview) return; stop.current = false; setBusy(true); setError(''); setMessage('');
    try { let batchSize = 0; for (let offset = completed; offset < preview.records.length && !stop.current; offset += batchSize) { const proposed = nextImportBatch(preview.records,offset); const existing: any[] = []; for(let i=0;i<proposed.length;i+=4) existing.push(...(await host('catalog.read', {ids:proposed.slice(i,i+4).map(row => 'opportunity:'+row.sourceKey)})).records); const batch = nextImportBatch(preserveCanadaBuysEnrichment(proposed,existing),0); batchSize = batch.length; await importBatch({ records: batch, fileName }); const verified: any[] = []; for(let i=0;i<batch.length;i+=4) { const saved = await host('catalog.read', { ids: batch.slice(i,i+4).map(row => 'opportunity:' + row.sourceKey) }); verified.push(...saved.records); } verifyCanadaBuysImportReceipt(batch, verified); setCompleted(offset+batch.length); onImported(); } setMessage(stop.current ? 'Stopped between batches. Confirmed saved records are retained.' : 'Import complete. Saved records verified in the existing catalog.'); }
    catch(e) { setError((e as Error).message + ' Confirmed batches are retained; retries merge the same source IDs.'); } finally { setBusy(false); }
  };
  return <Modal title="Import CanadaBuys tenders" mobileSheet onClose={() => { if (!busy) onClose(); }} footer={<div className="procurement-actions"><Btn variant="secondary" disabled={busy} onClick={onClose}>Close</Btn>{busy ? <Btn variant="secondary" onClick={() => { stop.current = true; setMessage('Stopping after the current batch is confirmed…'); }}>Stop after this batch</Btn> : <Btn disabled={reading || !preview?.records.length || completed === preview?.records.length} onClick={() => void run()}>{completed ? 'Continue import' : `Import ${preview?.records.length.toLocaleString() ?? ''} notices`}</Btn>}</div>}>
    <div className="procurement-detail"><p>Choose a CanadaBuys tender CSV. You can review it before anything is saved.</p>{safeSourceUrl("https://canadabuys.canada.ca/en/procurement-and-contracting-data") && <a className="procurement-link" href="https://canadabuys.canada.ca/en/procurement-and-contracting-data" target="_blank" rel="noopener noreferrer">CanadaBuys datasets ↗</a>}<label>CSV file<input aria-label="CanadaBuys CSV file" type="file" accept=".csv,text/csv" disabled={busy || reading} onChange={event => void load(event.target.files?.[0])} /></label><p className="procurement-coverage">Up to 20 MiB and 10,000 notices. Keep this page open while importing.</p>{reading && <p role="status">Validating CSV…</p>}{preview && <><p>{preview.records.length.toLocaleString()} unique notices · {preview.duplicateCount} duplicate rows removed</p>{preview.warnings.map((warning,i) => <p key={i}>{warning}</p>)}<ul>{preview.records.slice(0,5).map(row => <li key={row.sourceKey}>{row.description} — {row.externalId}</li>)}</ul><p className="procurement-coverage">CSVs don’t include document files.</p></>}{(busy || completed > 0) && <p role="status">{completed} of {preview?.records.length} notices confirmed saved</p>}{message && <p role="status">{message}</p>}{error && <p role="alert">{error}</p>}</div>
  </Modal>;
}
