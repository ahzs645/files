import { useEffect, useRef, useState } from 'react';
import { Btn, Modal } from '@zoer/plugin-ui/controls';
import { classificationLabel } from './market-query';
import { readClassificationState, saveClassificationMapping } from './classification-client';
import { findClassificationMapping, type ClassificationMapping } from './classification-contract';

export function ClassificationMappingModal({ sourceId, sourceLabel, rawClassification, initial, onClose, onSaved }: {
  sourceId: string; sourceLabel: string; rawClassification: string;
  initial?: ClassificationMapping; onClose: () => void; onSaved: (items: ClassificationMapping[]) => void;
}) {
  const [current, setCurrent] = useState(initial), [label, setLabel] = useState(initial?.label ?? '');
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [message, setMessage] = useState('');
  const abort = useRef<AbortController | null>(null);
  useEffect(() => () => abort.current?.abort(), []);
  const save = async (archive = false) => {
    setBusy(true); setError(''); setMessage(''); abort.current = new AbortController();
    try {
      const items = await saveClassificationMapping({ operation: archive ? 'mapping.archive' : 'mapping.upsert', sourceId, rawClassification, expectedVersion: current?.version ?? 0, ...(archive ? {} : { label: label.trim() }) }, abort.current.signal);
      onSaved(items); onClose();
    } catch (error) { if (!abort.current.signal.aborted) setError((error as Error).message); }
    finally { if (!abort.current.signal.aborted) setBusy(false); }
  };
  const reload = async () => {
    setBusy(true); setError('');
    try {
      const latest = findClassificationMapping(await readClassificationState(), sourceId, rawClassification);
      setCurrent(latest); setLabel(latest?.label ?? '');
      setMessage('Latest saved mapping loaded. Review this value before saving.');
    } catch (error) { setError((error as Error).message); }
    finally { setBusy(false); }
  };
  return <Modal title={current && !current.archived ? 'Edit classification label' : 'Map classification'} mobileSheet onClose={() => { if (!busy) onClose(); }} footer={<div className="procurement-classification-actions">
    {current && !current.archived && <Btn variant="ghost" disabled={busy} onClick={() => void save(true)}>Remove mapping</Btn>}
    <Btn variant="secondary" disabled={busy} onClick={onClose}>Cancel</Btn>
    <Btn disabled={busy || !label.trim() || label.length > 160} onClick={() => void save()}>{busy ? 'Saving…' : current?.archived ? 'Restore mapping' : 'Save mapping'}</Btn>
  </div>}>
    <div className="procurement-classification-form">
      <p>This is your display label for an exact classification in one source. Source records, classification codes, and amount groups remain unchanged.</p>
      <dl><div><dt>Source</dt><dd>{sourceLabel} <small>({sourceId})</small></dd></div><div><dt>Original classification</dt><dd>{classificationLabel(rawClassification)}</dd></div></dl>
      <details><summary>Exact source value</summary><pre>{rawClassification}</pre></details>
      <label htmlFor="procurement-classification-label">Your classification label<input id="procurement-classification-label" value={label} maxLength={160} disabled={busy} onChange={event => setLabel(event.target.value)} placeholder="For example, Building maintenance" /></label>
      <p className="procurement-market-note">Mappings stay source-specific. Identical labels do not merge records or imply equivalent UNSPSC, GSIN or BC commodity codes. Removing a mapping archives it and retains its version history marker.</p>
      {current && <p className="procurement-market-note">Version {current.version} · Updated {new Date(current.updatedAt).toLocaleString()}{current.archived ? ' · Archived' : ''}</p>}
      {busy && <p role="status">Waiting for the durable save and read-back verification…</p>}
      {message && <p role="status">{message}</p>}
      {error && <div role="alert"><p>{error}</p><Btn variant="secondary" disabled={busy} onClick={() => void reload()}>Reload saved mapping</Btn></div>}
    </div>
  </Modal>;
}
