import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Btn, Modal, Select } from '@zoer/plugin-ui/controls';
import { PURSUIT_STAGES, type Pursuit, type PursuitStage } from './state-contract';
import { readProcurementState, saveProcurementState } from './state-client';
import { shortDate, sourceName } from './display';
import { LabelChips } from './AiResult';
import { NotebookPen } from 'lucide-react';
import './workflow.css';

export type PursuitRecord = { id: string; title: string; sourceId: string; kind?: string };
export type PursuitDetails = { kind: string; deadline: string | null; buyer: string | null };
export type PursuitBoardProps = { records?: PursuitRecord[]; details?: Map<string, PursuitDetails>; labels?: Map<string, string[]>; onOpenRecord?: (id: string) => void };

export function PursuitBoard({ records = [], details, labels, onOpenRecord }: PursuitBoardProps) {
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
    <div className="pc-board-toolbar">
      <label className="pc-board-add"><span className="sr-only">Shortlisted notice to add</span><Select aria-label="Shortlisted notice to add" value={chosen?.id ?? ''} disabled={busy || !available.length || state.isPending} onChange={event => setAddId(event.target.value)}><option value="" disabled>{available.length ? 'Choose a shortlisted notice' : 'No shortlisted notices to add'}</option>{available.map(record => <option value={record.id} key={record.id}>{record.title} · {sourceName(record.sourceId)}</option>)}</Select></label>
      <Btn disabled={busy || !chosen || state.isPending || !!state.error} onClick={() => chosen && void save({ recordId: chosen.id, sourceId: chosen.sourceId, stage: 'Watching', notes: '' })}>Add to Watching</Btn>
      <Btn variant="ghost" disabled={busy} onClick={() => void state.refetch()}>Refresh</Btn>
    </div>
    {!state.isPending && !pursuits.length && <p className="procurement-coverage">Shortlist notices in Search, or open one and choose Add to pursuits. Stages are for your team only; moving a card doesn’t submit a bid.</p>}
    {(error || state.error) && <p role="alert">{error || state.error?.message}</p>}{message && <p role="status">{message}</p>}{busy && <p role="status">Saving pursuit…</p>}{state.isPending && <p role="status">Loading saved pursuits…</p>}
    <div className="procurement-board" role="region" aria-label="Pursuit stages" tabIndex={0}>
      {PURSUIT_STAGES.map(stage => <section key={stage} className="procurement-board-column" aria-label={stage} onDragOver={event => { if (!busy) event.preventDefault(); }} onDrop={event => { event.preventDefault(); if (busy) return; const id = event.dataTransfer.getData('application/x-zoer-pursuit'); const item = pursuits.find(row => row.recordId === id); if (item) move(item, stage); }}>
        <h3>{stage} <span>({pursuits.filter(item => item.stage === stage).length})</span></h3>
        {pursuits.filter(item => item.stage === stage).map(item => { const info = details?.get(item.recordId), when = shortDate(info?.deadline); return <article key={item.recordId} className="procurement-board-card" draggable={!busy} onDragStart={event => { event.dataTransfer.setData('application/x-zoer-pursuit', item.recordId); event.dataTransfer.effectAllowed = 'move'; }}>
          {onOpenRecord ? <button type="button" className="procurement-title" onClick={() => onOpenRecord(item.recordId)}>{item.title}</button> : <h4>{item.title}</h4>}
          <p>{[info?.buyer, sourceName(item.sourceId)].filter(Boolean).join(' · ')}</p>
          {info?.deadline && <p className="pc-board-date" data-tone={when.tone || undefined}>{info.kind === 'award' ? 'Awarded ' : when.tone === 'passed' ? 'Closed ' : 'Closes '}{when.text}</p>}
          {!!labels?.get(item.recordId)?.length && <LabelChips labels={labels.get(item.recordId)!} limit={2} />}
          {item.notes && <p className="procurement-board-notes">{item.notes}</p>}
          <div className="pc-board-card-actions"><label><span className="sr-only">Stage</span><Select aria-label={`Pursuit stage: ${item.title}`} presentation="dropdown" searchable={false} value={item.stage} disabled={busy} onChange={event => move(item, event.target.value as PursuitStage)}>{PURSUIT_STAGES.map(value => <option key={value}>{value}</option>)}</Select></label><Btn size="sm" variant="ghost" disabled={busy} aria-label={`${item.notes ? 'Edit notes' : 'Add notes'} for ${item.title}`} tooltip={item.notes ? 'Edit notes' : 'Add notes'} icon={<NotebookPen aria-hidden="true" className="h-3.5 w-3.5" />} onClick={() => { setEditor(item); setNotes(item.notes); }}><span className="sr-only">Notes</span></Btn></div>
        </article>; })}
        {!pursuits.some(item => item.stage === stage) && <p className="procurement-coverage">Empty</p>}
      </section>)}
    </div>
    {editor && <Modal title={`Notes: ${editor.title}`} mobileSheet onClose={() => { if (!busy) setEditor(undefined); }} footer={<div className="procurement-actions"><Btn variant="secondary" disabled={busy} onClick={() => setEditor(undefined)}>Cancel</Btn><Btn disabled={busy} onClick={() => void save({ ...editor, notes })}>Save notes</Btn></div>}><label className="procurement-note-editor">Internal notes<textarea aria-label="Pursuit notes" rows={8} maxLength={4000} value={notes} disabled={busy} onChange={event => setNotes(event.target.value)} /></label><p className="procurement-coverage">{notes.length}/4,000 characters</p>{error && <p role="alert">{error}</p>}</Modal>}
  </section>;
}
