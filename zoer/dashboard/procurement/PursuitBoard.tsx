import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Btn, Modal, Select } from '@zoer/plugin-ui/controls';
import { PURSUIT_STAGES, type Pursuit, type PursuitStage } from './state-contract';
import { readProcurementState, saveProcurementState } from './state-client';
import './workflow.css';

export type PursuitRecord = { id: string; title: string; sourceId: string; kind?: string };
export type PursuitBoardProps = { records?: PursuitRecord[]; onOpenRecord?: (id: string) => void };

export function PursuitBoard({ records = [], onOpenRecord }: PursuitBoardProps) {
  const client = useQueryClient();
  const state = useQuery({ queryKey: ['catalog', 'procurement-state'], queryFn: readProcurementState, refetchInterval: 30_000 });
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [message, setMessage] = useState('');
  const [addId, setAddId] = useState(''), [editor, setEditor] = useState<Pursuit>(), [notes, setNotes] = useState('');
  const lifecycle = useRef<AbortController | null>(null);
  useEffect(() => { const controller = new AbortController(); lifecycle.current = controller; return () => controller.abort(); }, []);
  const pursuits = state.data?.pursuits ?? [];
  const available = records.filter(row => !pursuits.some(item => item.recordId === row.id));
  const chosen = available.find(row => row.id === addId) ?? available[0];
  const save = async (item: Pick<Pursuit, 'recordId' | 'sourceId' | 'stage' | 'notes'> & { version?: number }) => {
    if (busy) return;
    setBusy(true); setError(''); setMessage('');
    try {
      const saved = await saveProcurementState({ operation: 'pursuit.upsert', recordId: item.recordId, sourceId: item.sourceId, stage: item.stage, notes: item.notes, expectedVersion: item.version ?? 0 }, lifecycle.current?.signal);
      client.setQueryData(['catalog', 'procurement-state'], saved);
      setMessage('Pursuit saved and verified.'); setEditor(undefined);
    } catch (e) { setError((e as Error).message); void state.refetch(); }
    finally { setBusy(false); }
  };
  const move = (item: Pursuit, stage: PursuitStage) => { if (item.stage !== stage) void save({ ...item, stage }); };
  return <section className="procurement-workflow" aria-label="Pursuit board">
    <header><h2>Pursuit board</h2><p>Your team's pursuit stage is separate from the source's published notice status. Moving a card does not submit a bid.</p></header>
    <div className="procurement-actions"><label>Add a notice from this view<Select aria-label="Notice to add to pursuit board" value={chosen?.id ?? ''} disabled={busy || !available.length || state.isPending} onChange={event => setAddId(event.target.value)}><option value="" disabled>Choose a saved notice</option>{available.map(record => <option value={record.id} key={record.id}>{record.title} · {record.sourceId}</option>)}</Select></label><Btn disabled={busy || !chosen || state.isPending || !!state.error} onClick={() => chosen && void save({ recordId: chosen.id, sourceId: chosen.sourceId, stage: 'Watching', notes: '' })}>Add to Watching</Btn><Btn variant="ghost" disabled={busy} onClick={() => void state.refetch()}>Refresh board</Btn></div>
    <p className="procurement-coverage">Drag a card between stages, or use its Stage menu. Up to 200 saved pursuits; notes are kept separately from imported records.</p>
    {(error || state.error) && <p role="alert">{error || state.error?.message}</p>}{message && <p role="status">{message}</p>}{busy && <p role="status">Saving pursuit…</p>}{state.isPending && <p role="status">Loading saved pursuits…</p>}
    <div className="procurement-board" role="region" aria-label="Pursuit stages" tabIndex={0}>
      {PURSUIT_STAGES.map(stage => <section key={stage} className="procurement-board-column" aria-label={stage} onDragOver={event => { if (!busy) event.preventDefault(); }} onDrop={event => { event.preventDefault(); if (busy) return; const id = event.dataTransfer.getData('application/x-zoer-pursuit'); const item = pursuits.find(row => row.recordId === id); if (item) move(item, stage); }}>
        <h3>{stage} <span>({pursuits.filter(item => item.stage === stage).length})</span></h3>
        {pursuits.filter(item => item.stage === stage).map(item => <article key={item.recordId} className="procurement-board-card" draggable={!busy} onDragStart={event => { event.dataTransfer.setData('application/x-zoer-pursuit', item.recordId); event.dataTransfer.effectAllowed = 'move'; }}>
          {onOpenRecord ? <button type="button" className="procurement-title" onClick={() => onOpenRecord(item.recordId)}>{item.title}</button> : <h4>{item.title}</h4>}
          <p>{item.sourceId}</p><label>Stage<Select aria-label={`Pursuit stage: ${item.title}`} value={item.stage} disabled={busy} onChange={event => move(item, event.target.value as PursuitStage)}>{PURSUIT_STAGES.map(value => <option key={value}>{value}</option>)}</Select></label>
          {item.notes && <p className="procurement-board-notes">{item.notes}</p>}<Btn variant="ghost" disabled={busy} onClick={() => { setEditor(item); setNotes(item.notes); }}>Edit notes<span className="sr-only"> for {item.title}</span></Btn>
        </article>)}
        {!pursuits.some(item => item.stage === stage) && <p className="procurement-coverage">No pursuits in this stage.</p>}
      </section>)}
    </div>
    {editor && <Modal title={`Notes: ${editor.title}`} mobileSheet onClose={() => { if (!busy) setEditor(undefined); }} footer={<div className="procurement-actions"><Btn variant="secondary" disabled={busy} onClick={() => setEditor(undefined)}>Cancel</Btn><Btn disabled={busy} onClick={() => void save({ ...editor, notes })}>Save notes</Btn></div>}><label className="procurement-note-editor">Internal notes<textarea aria-label="Pursuit notes" rows={8} maxLength={4000} value={notes} disabled={busy} onChange={event => setNotes(event.target.value)} /></label><p>{notes.length}/4,000 characters. Notes do not change the published notice.</p>{error && <p role="alert">{error}</p>}</Modal>}
  </section>;
}
