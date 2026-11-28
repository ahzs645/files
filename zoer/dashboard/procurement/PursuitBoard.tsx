import { EmptyState, Hint } from '../host-ui';
import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Btn, Modal, Select } from '@zoer/plugin-ui/controls';
import { ACTIVE_PURSUIT_STAGES, PURSUIT_STAGES, type Pursuit, type PursuitStage } from './state-contract';
import { readProcurementState, saveProcurementState } from './state-client';
import { sourceName } from './display';
import { useCapabilities } from '../capabilities';
import { LabelChips } from './AiResult';
import { KanbanSquare, NotebookPen, RefreshCw } from 'lucide-react';
import { navigatePlugin } from '../navigation';
import { count, plural } from '../format';
import { cardDeadline } from '../review-workspace/deadline-text';
import { label } from '../review-workspace/queries';
import type { DecisionRow } from '../review-workspace/queries';
import { CLOSED_REASONS, DEADLINE_PASSED_HINT, closedReason, closedReasonLabel, deadlinePassed, nextTask, withAwarded, withClosedReason, withSubmitted, type ClosedReason } from './pursuit-tasks';
import { dueText, type TaskRow } from './PursuitTasks';
import './workflow.css';
import '../review-workspace/review.css';

export type PursuitRecord = { id: string; title: string; sourceId: string; kind?: string };
export type PursuitDetails = { kind: string; deadline: string | null; buyer: string | null };
export type PursuitBoardProps = {
  records?: PursuitRecord[]; details?: Map<string, PursuitDetails>; labels?: Map<string, string[]>; onOpenRecord?: (id: string) => void;
  /** Latest human decision per notice (review workspace); undefined when the workspace is unavailable. */
  decisions?: Map<string, DecisionRow>;
  /** Complete open review tasks per notice; undefined until the list is available. */
  tasks?: Map<string, TaskRow[]>;
};
type StageConfirm = { item: Pursuit; stage: 'Submitted' | 'Awarded' | 'Closed' };
const today = () => new Date().toISOString().slice(0, 10);

export function PursuitBoard({ records = [], details, labels, onOpenRecord, decisions, tasks }: PursuitBoardProps) {
  const client = useQueryClient();
  const state = useQuery({ queryKey: ['catalog', 'procurement-state'], queryFn: readProcurementState, refetchInterval: 30_000 });
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [message, setMessage] = useState('');
  const [addId, setAddId] = useState(''), [editor, setEditor] = useState<Pursuit>(), [notes, setNotes] = useState('');
  const [confirm, setConfirm] = useState<StageConfirm>(), [reason, setReason] = useState<ClosedReason | ''>(''), [reasonText, setReasonText] = useState('');
  const lifecycle = useRef<AbortController | null>(null), { writes, surface } = useCapabilities();
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
      setMessage('Pursuit saved and verified.'); setEditor(undefined); setConfirm(undefined);
    } catch (e) { setError((e as Error).message); void state.refetch(); }
    finally { setBusy(false); }
  };
  // Submitted, Awarded and Closed record things that happened outside Zoer, so each asks for a human confirmation first.
  const move = (item: Pursuit, stage: PursuitStage) => {
    if (item.stage === stage) return;
    if (stage === 'Submitted' || stage === 'Awarded' || stage === 'Closed') { setConfirm({ item, stage }); setReason(stage === 'Closed' ? closedReason(item.notes) ?? '' : ''); setReasonText(''); setError(''); return; }
    void save({ ...item, stage });
  };
  const confirmMove = () => {
    if (!confirm) return;
    const { item, stage } = confirm;
    const notesWith = stage === 'Submitted' ? withSubmitted(item.notes, today(), reasonText) : stage === 'Awarded' ? withAwarded(item.notes, today(), reasonText) : reason ? withClosedReason(item.notes, reason, reasonText) : item.notes;
    void save({ ...item, stage, notes: notesWith });
  };
  const active = pursuits.filter(item => ACTIVE_PURSUIT_STAGES.includes(item.stage)).length;
  const stale = pursuits.filter(item => details?.get(item.recordId)?.kind !== 'award' && deadlinePassed(item.stage, details?.get(item.recordId)?.deadline)).length;
  const empty = !state.isPending && !state.error && !pursuits.length;
  // With half the stages or more empty, empty columns fold into one line at every width (phones always fold them).
  const emptyStages = PURSUIT_STAGES.filter(stage => !pursuits.some(item => item.stage === stage)), folded = emptyStages.length * 2 >= PURSUIT_STAGES.length;
  const addControl = writes && available.length > 0 && <div className="pc-board-toolbar"><label className="pc-board-add"><span className="sr-only">Shortlisted opportunity to add</span><Select aria-label="Shortlisted opportunity to add" value={chosen?.id ?? ''} disabled={busy || state.isPending} onChange={event => setAddId(event.target.value)}><option value="" disabled>Choose a shortlisted opportunity</option>{available.map(record => <option value={record.id} key={record.id}>{record.title} · {sourceName(record.sourceId)}</option>)}</Select></label>
    <Btn variant={!chosen || state.isPending || state.error ? 'secondary' : 'primary'} disabled={busy || !chosen || state.isPending || !!state.error} onClick={() => chosen && void save({ recordId: chosen.id, sourceId: chosen.sourceId, stage: 'Watching', notes: '' })}>Add to Watching</Btn></div>;
  return <section className="procurement-workflow pc-pursuits" aria-labelledby="pc-pursuits-title">
    <header className="rw-page-head pc-pursuits-head">
      <div><h1 id="pc-pursuits-title">Pursuits</h1><p className="rw-note">{state.isPending ? 'Loading saved pursuits…' : `${plural(pursuits.length, 'pursuit')}${pursuits.length ? ` · ${count(active)} active` : ''}${stale ? ` · ${count(stale)} past the deadline` : ''}`}</p></div>
      <div className="rw-actions">{addControl}{surface !== 'societyer' && <Btn size="sm" variant="ghost" disabled={busy} aria-label="Refresh pursuits" tooltip="Refresh" icon={<RefreshCw aria-hidden="true" className="h-3.5 w-3.5" />} onClick={() => void state.refetch()}><span className="sr-only">Refresh</span></Btn>}</div>
    </header>
    {(error || state.error) && <p role="alert">{error || state.error?.message}</p>}{message && <p role="status">{message}</p>}{busy && <p role="status">Saving pursuit…</p>}
    {empty ? <EmptyState icon={<KanbanSquare aria-hidden="true" />} title="No pursuits yet"
      description={!writes ? 'No pursuits in this copy.' : available.length ? 'Choose a shortlisted opportunity above and add it to Watching. Stages are for your team only; moving a card never submits a bid.' : 'Shortlist an opportunity in Browse, then add it here. Stages are for your team only; moving a card never submits a bid.'}
      action={writes && !available.length ? <Btn variant="secondary" size="sm" onClick={() => navigatePlugin('/procurement?shortlist=1')}>Open shortlisted opportunities</Btn> : undefined} />
    : !state.isPending && <div className="procurement-board" data-folded={folded || undefined} role="region" aria-label="Pursuit stages" tabIndex={0}>
      {PURSUIT_STAGES.map(stage => <section key={stage} className="procurement-board-column" data-stage={stage.toLowerCase()} data-empty={!pursuits.some(item => item.stage === stage) || undefined} aria-label={stage} onDragOver={event => { if (writes && !busy) event.preventDefault(); }} onDrop={event => { event.preventDefault(); if (!writes || busy) return; const id = event.dataTransfer.getData('application/x-zoer-pursuit'); const item = pursuits.find(row => row.recordId === id); if (item) move(item, stage); }}>
        <h3>{stage} <span>({pursuits.filter(item => item.stage === stage).length})</span></h3>
        {pursuits.filter(item => item.stage === stage).map(item => { const info = details?.get(item.recordId), award = info?.kind === 'award', when = cardDeadline(info?.deadline, info?.kind ?? 'opportunity', Date.now()), passed = !award && deadlinePassed(item.stage, info?.deadline); return <article key={item.recordId} className="procurement-board-card" data-passed={passed || undefined} draggable={writes && !busy} onDragStart={event => { event.dataTransfer.setData('application/x-zoer-pursuit', item.recordId); event.dataTransfer.effectAllowed = 'move'; }}>
          {onOpenRecord ? <button type="button" className="procurement-title" onClick={() => onOpenRecord(item.recordId)}>{item.title}</button> : <h4>{item.title}</h4>}
          <p>{[info?.buyer, sourceName(item.sourceId)].filter(Boolean).join(' · ')}</p>
          {info?.deadline && <Hint content={when.detail || undefined}><p className="pc-board-date" data-tone={when.tone || undefined}>{when.text}</p></Hint>}
          {passed && <div className="pc-board-passed" role="note"><Hint content={DEADLINE_PASSED_HINT}><span className="rw-chip" data-tone="blocker"><b>Deadline passed</b></span></Hint>
            {writes ? <span className="pc-board-passed-actions"><span>Next:</span><Btn size="sm" variant="ghost" disabled={busy} onClick={() => move(item, 'Submitted')}>Record as submitted</Btn><Btn size="sm" variant="ghost" disabled={busy} onClick={() => move(item, 'Closed')}>Close</Btn></span> : <span className="rw-note">Still in {item.stage}.</span>}</div>}
          {!!labels?.get(item.recordId)?.length && <LabelChips labels={labels.get(item.recordId)!} limit={2} />}
          {decisions && <PursuitReview recordId={item.recordId} stage={item.stage} notes={item.notes} decision={decisions.get(item.recordId)} tasks={tasks ? tasks.get(item.recordId) ?? [] : undefined} />}
          {item.notes && <p className="procurement-board-notes">{item.notes}</p>}
          {writes && <div className="pc-board-card-actions"><label><span className="sr-only">Stage</span><Select aria-label={`Pursuit stage: ${item.title}`} presentation="dropdown" searchable={false} value={item.stage} disabled={busy} onChange={event => move(item, event.target.value as PursuitStage)}>{PURSUIT_STAGES.map(value => <option key={value}>{value}</option>)}</Select></label><Btn size="sm" variant="ghost" disabled={busy} aria-label={`${item.notes ? 'Edit notes' : 'Add notes'} for ${item.title}`} icon={<NotebookPen aria-hidden="true" className="h-3.5 w-3.5" />} onClick={() => { setEditor(item); setNotes(item.notes); }}>Notes</Btn></div>}
        </article>; })}
      </section>)}
    </div>}
    {/* Phones hide empty stage columns (procurement.css) and list them on this one line instead. */}
    {pursuits.length > 0 && emptyStages.length > 0 && <p className="procurement-coverage pc-board-empty-stages" data-show={folded || undefined}>Empty stages: {emptyStages.join(', ')}</p>}
    {writes && confirm && <Modal fit title={confirm.stage === 'Submitted' ? 'Record submission' : confirm.stage === 'Awarded' ? 'Record award' : 'Close pursuit'} mobileSheet onClose={() => { if (!busy) setConfirm(undefined); }}
      footer={<div className="procurement-actions"><Btn variant="secondary" disabled={busy} onClick={() => setConfirm(undefined)}>Cancel</Btn><Btn variant={busy || (confirm.stage === 'Closed' && !reason) ? 'secondary' : 'primary'} disabled={busy || (confirm.stage === 'Closed' && !reason)} onClick={confirmMove}>{confirm.stage === 'Submitted' ? 'Record as submitted' : confirm.stage === 'Awarded' ? 'Record award' : 'Close pursuit'}</Btn></div>}>
      <div className="rw-form">
        <p><strong>{confirm.item.title}</strong></p>
        {confirm.stage === 'Submitted' && <p>Zoer does not submit bids. Moving this card only records that you already submitted through the buyer’s own process.</p>}
        {confirm.stage === 'Awarded' && <p>Record this only when the buyer has confirmed the award to you. Zoer never infers an award from historical data.</p>}
        {confirm.stage === 'Closed' && <label className="rw-field"><span>Why is it closed?</span><Select aria-label="Closed reason" presentation="dropdown" searchable={false} value={reason} disabled={busy} onChange={event => setReason(event.target.value as ClosedReason)}><option value="" disabled>Choose a reason</option>{CLOSED_REASONS.map(([id, text]) => <option key={id} value={id}>{text}</option>)}</Select></label>}
        <label className="rw-field"><span>Note (optional)</span><input value={reasonText} maxLength={300} disabled={busy} onChange={event => setReasonText(event.target.value)} /></label>
        <p className="procurement-coverage">This is saved as the first line of the pursuit notes. Earlier notes are kept.</p>
        {error && <p role="alert">{error}</p>}
      </div>
    </Modal>}
    {writes && editor && <Modal fit title={`Notes: ${editor.title}`} mobileSheet onClose={() => { if (!busy) setEditor(undefined); }} footer={<div className="procurement-actions"><Btn variant="secondary" disabled={busy} onClick={() => setEditor(undefined)}>Cancel</Btn><Btn variant="primary" disabled={busy} onClick={() => void save({ ...editor, notes })}>Save notes</Btn></div>}><label className="procurement-note-editor">Internal notes<textarea aria-label="Pursuit notes" rows={8} maxLength={4000} value={notes} disabled={busy} onChange={event => setNotes(event.target.value)} /></label><p className="procurement-coverage">{count(notes.length)}/4,000 characters</p>{error && <p role="alert">{error}</p>}</Modal>}
  </section>;
}

/** Human decision, reconfirmation flag, closing reason and next task for one card. AI suggestions are never shown as the stage. */
function PursuitReview({ stage, notes, decision, tasks }: { recordId: string; stage: PursuitStage; notes: string; decision?: DecisionRow; tasks?: TaskRow[] }) {
  const next = nextTask(tasks ?? []), reason = stage === 'Closed' ? closedReasonLabel(closedReason(notes)) : null;
  return <div className="rw-card-review">
    <span className="rw-chips" data-compact>
      {decision ? <Hint content={decision.note}><span className="rw-chip" data-tone="neutral">Decision: <b>{label(decision.decision)}</b></span></Hint> : <span className="rw-chip" data-tone="neutral">No decision recorded</span>}
      {decision?.needsReconfirmation && <Hint content={decision.staleReason ?? undefined}><span className="rw-chip" data-tone="stale"><b>Evidence changed; reconfirm this decision</b></span></Hint>}
      {stage === 'Closed' && <span className="rw-chip" data-tone="neutral">{reason ?? 'Closing reason not recorded'}</span>}
    </span>
    {decision?.note && <p className="rw-note rw-clamp">{decision.note}</p>}
    <p className="rw-note">{tasks === undefined ? 'Task status unavailable' : next ? <>Next: {next.title} · {next.owner || 'Unassigned'} · {dueText(next.dueAt)}{tasks.length > 1 ? ` · ${tasks.length - 1} more open` : ''}</> : 'No open tasks'}</p>
  </div>;
}
