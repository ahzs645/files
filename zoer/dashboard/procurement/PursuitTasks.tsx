import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Btn, Modal, Select } from '@zoer/plugin-ui/controls';
import { REVIEW_KEY, reviewWrite, useReviewInvalidate } from '../review-workspace/actions';
import { label } from '../review-workspace/queries';
import { sql } from './display';
import { dueClusters, type DueItem } from './pursuit-tasks';
import '../review-workspace/review.css';

export interface TaskRow {
  id: string; recordId: string; recordTitle: string | null; title: string; kind: string; linkedType: string | null; linkedId: string | null; linkedText: string | null;
  owner: string | null; dueAt: string | null; status: 'open' | 'done' | 'cancelled'; completionNote: string | null; version: number; createdAt: string; updatedAt: string;
}
const TASK_KINDS: [string, string][] = [['acquire_evidence', 'Acquire evidence'], ['resolve_gap', 'Resolve a company gap'], ['reconfirm_change', 'Reconfirm a change'], ['decide', 'Make a decision'], ['other', 'Other']];
const kindLabel = (kind: string) => TASK_KINDS.find(([id]) => id === kind)?.[1] ?? kind;
const COMPLETION_COPY = 'Completing a task does not satisfy a requirement until supporting evidence is added and reviewed.';
const friendly = (e: unknown) => { const message = (e as Error)?.message ?? String(e); return /^Conflict:/i.test(message) ? 'Someone else changed this; reload and review it.' : message; };
export const dueText = (value: string | null) => !value ? 'No due date' : /^\d{4}-\d{2}-\d{2}/.test(value) ? value.slice(0, 10) : value;

async function readTasks(status: 'open' | 'closed'): Promise<TaskRow[]> {
  const rows = await sql(`SELECT t.id, t.record_id AS recordId, r.title AS recordTitle, t.title, t.kind, t.linked_type AS linkedType, t.linked_id AS linkedId, (SELECT q.text FROM procurement_requirements q WHERE q.id=t.linked_id AND t.linked_type='requirement') AS linkedText, t.owner, t.due_at AS dueAt, t.status, t.completion_note AS completionNote, t.version, t.created_at AS createdAt, t.updated_at AS updatedAt FROM procurement_tasks t LEFT JOIN records r ON r.id=t.record_id WHERE ${status === 'open' ? "t.status='open' ORDER BY coalesce(t.due_at,'9999-12-31'), t.created_at" : "t.status<>'open' ORDER BY t.updated_at DESC"} LIMIT 200`);
  return rows.map(row => ({ ...row, version: Number(row.version) }));
}
/** Open review tasks across notices (shared cache for pursuit cards and the task panel). */
export function useOpenTasks(enabled: boolean) {
  return useQuery({ queryKey: [...REVIEW_KEY, 'tasks', 'open'], queryFn: () => readTasks('open'), enabled, refetchInterval: 30_000 });
}

export type PursuitDue = { recordId: string; title: string; stage: string; deadline: string | null };

/** Tasks across notices with owner/due/link, status updates, and deadline/capacity overlap hints. */
export function PursuitTasks({ pursuits, enabled }: { pursuits: PursuitDue[]; enabled: boolean }) {
  const open = useOpenTasks(enabled), invalidate = useReviewInvalidate();
  const [showClosed, setShowClosed] = useState(false);
  const closed = useQuery({ queryKey: [...REVIEW_KEY, 'tasks', 'closed'], queryFn: () => readTasks('closed'), enabled: enabled && showClosed });
  const [editing, setEditing] = useState<TaskRow | null>(null), [adding, setAdding] = useState(false);
  const tasks = open.data ?? [];
  const active = pursuits.filter(item => ['Watching', 'Reviewing', 'Preparing'].includes(item.stage));
  const closings: DueItem[] = active.map(item => ({ id: `closing:${item.recordId}`, recordId: item.recordId, label: `${item.title} closes`, due: item.deadline, kind: 'closing' }));
  const taskItems: DueItem[] = tasks.map(task => ({ id: task.id, recordId: task.recordId, label: `${task.title} (${task.recordTitle ?? task.recordId})`, due: task.dueAt, kind: 'task', owner: task.owner }));
  const deadlineHints = dueClusters([...closings, ...taskItems.filter(item => active.some(p => p.recordId === item.recordId))], 3);
  const ownerHints = dueClusters(taskItems, 3, true).filter(cluster => cluster.owner);
  if (!enabled) return null;
  return <section className="rw-panel rw-tasks" aria-labelledby="pursuit-tasks-title">
    <div className="rw-panel-head"><h2 id="pursuit-tasks-title">Tasks</h2><div className="rw-actions"><label className="rw-check"><input type="checkbox" checked={showClosed} onChange={e => setShowClosed(e.target.checked)} />Show completed and cancelled</label><Btn size="sm" variant="secondary" disabled={!pursuits.length} onClick={() => setAdding(true)}>Add task</Btn></div></div>
    <p className="rw-note">{COMPLETION_COPY}</p>
    {(deadlineHints.length > 0 || ownerHints.length > 0) && <div className="rw-warnings" role="note" aria-label="Deadline and capacity overlaps">
      <strong>Overlapping due dates</strong>
      <ul>
        {deadlineHints.map((cluster, i) => <li key={`d${i}`}>{cluster.records} pursuits have closings or tasks between {cluster.from} and {cluster.to}: {cluster.items.map(item => item.label).join('; ')}.</li>)}
        {ownerHints.map((cluster, i) => <li key={`o${i}`}>{cluster.owner} has {cluster.items.length} tasks across {cluster.records} notices between {cluster.from} and {cluster.to}.</li>)}
      </ul>
      <p className="rw-note">Each notice’s own delivery or response label does not account for these overlaps. Check proposal capacity before committing.</p>
    </div>}
    {open.error && <p role="alert">{(open.error as Error).message}</p>}
    {open.isPending ? <p role="status">Loading tasks…</p> : !tasks.length ? <p className="rw-note">No open tasks. Tasks are created from a notice’s requirements, gaps or changes, or with Add task.</p> : <TaskTable tasks={tasks} onEdit={setEditing} />}
    {showClosed && (closed.isPending ? <p role="status">Loading closed tasks…</p> : closed.data?.length ? <><h3>Completed and cancelled</h3><TaskTable tasks={closed.data} onEdit={setEditing} /></> : <p className="rw-note">No completed or cancelled tasks.</p>)}
    {editing && <TaskEditor task={editing} onClose={() => setEditing(null)} onSaved={async () => { setEditing(null); await invalidate(); }} />}
    {adding && <TaskCreator pursuits={pursuits} onClose={() => setAdding(false)} onSaved={async () => { setAdding(false); await invalidate(); }} />}
  </section>;
}

function TaskTable({ tasks, onEdit }: { tasks: TaskRow[]; onEdit(task: TaskRow): void }) {
  return <div className="rw-table-wrap"><table className="rw-table rw-text">
    <thead><tr><th scope="col">Task</th><th scope="col">Notice</th><th scope="col">Linked to</th><th scope="col">Owner</th><th scope="col">Due</th><th scope="col">Status</th><th scope="col"><span className="sr-only">Actions</span></th></tr></thead>
    <tbody>{tasks.map(task => <tr key={task.id}>
      <td><strong>{task.title}</strong><small className="rw-note">{kindLabel(task.kind)}</small></td>
      <td>{task.recordTitle ?? task.recordId}</td>
      <td>{task.linkedType === 'requirement' ? (task.linkedText ? <>Requirement: {task.linkedText}</> : 'Requirement (not found in the current ledger)') : task.linkedType ? `${task.linkedType.replace(/_/g, ' ')}` : 'Not linked'}</td>
      <td>{task.owner || 'Unassigned'}</td>
      <td>{dueText(task.dueAt)}</td>
      <td>{task.status === 'open' ? 'Open' : task.status === 'done' ? 'Done' : 'Cancelled'}{task.completionNote && <small className="rw-note">{task.completionNote}</small>}</td>
      <td><Btn size="sm" variant="ghost" aria-label={`Update task: ${task.title}`} onClick={() => onEdit(task)}>Update</Btn></td>
    </tr>)}</tbody>
  </table></div>;
}

function TaskEditor({ task, onClose, onSaved }: { task: TaskRow; onClose(): void; onSaved(): Promise<void> }) {
  const [status, setStatus] = useState(task.status), [owner, setOwner] = useState(task.owner ?? ''), [due, setDue] = useState(task.dueAt?.slice(0, 10) ?? ''), [note, setNote] = useState(task.completionNote ?? '');
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const needsNote = status === 'done' && note.trim().length < 3;
  const save = async () => {
    setBusy(true); setError('');
    try { await reviewWrite({ op: 'task.update', taskId: task.id, recordId: task.recordId, status, owner: owner.trim() || undefined, dueAt: due || undefined, ...(note.trim() ? { completionNote: note.trim() } : {}), expectedVersion: task.version }); await onSaved(); }
    catch (e) { setError(friendly(e)); } finally { setBusy(false); }
  };
  return <Modal title={`Update task: ${task.title}`} mobileSheet onClose={() => { if (!busy) onClose(); }} footer={<div className="rw-actions"><Btn variant="secondary" disabled={busy} onClick={onClose}>Cancel</Btn><Btn variant="primary" disabled={busy || needsNote} loading={busy} onClick={() => void save()}>{busy ? 'Saving…' : 'Save task'}</Btn></div>}>
    <div className="rw-form">
      <p className="rw-note">{task.recordTitle ?? task.recordId}{task.linkedText ? ` · Requirement: ${task.linkedText}` : ''}</p>
      <label className="rw-field"><span>Status</span><Select aria-label="Task status" presentation="dropdown" searchable={false} value={status} disabled={busy} onChange={e => setStatus(e.target.value as TaskRow['status'])}><option value="open">Open</option><option value="done">Done</option><option value="cancelled">Cancelled</option></Select></label>
      <label className="rw-field"><span>Owner</span><input value={owner} maxLength={120} disabled={busy} onChange={e => setOwner(e.target.value)} /></label>
      <label className="rw-field"><span>Due</span><input type="date" value={due} disabled={busy} onChange={e => setDue(e.target.value)} /></label>
      <label className="rw-field"><span>Completion note{status === 'done' ? ' (required)' : ''}</span><textarea rows={3} maxLength={2000} value={note} disabled={busy} onChange={e => setNote(e.target.value)} placeholder="What was done, and where the supporting evidence is" /></label>
      <p className="rw-note" role="note">{COMPLETION_COPY}</p>
      {error && <p role="alert" className="rw-error">{error}</p>}
    </div>
  </Modal>;
}

function TaskCreator({ pursuits, onClose, onSaved }: { pursuits: PursuitDue[]; onClose(): void; onSaved(): Promise<void> }) {
  const [recordId, setRecordId] = useState(pursuits[0]?.recordId ?? ''), [title, setTitle] = useState(''), [kind, setKind] = useState('acquire_evidence'), [owner, setOwner] = useState(''), [due, setDue] = useState('');
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const save = async () => {
    setBusy(true); setError('');
    try { await reviewWrite({ op: 'task.create', recordId, title: title.trim(), kind, ...(owner.trim() ? { owner: owner.trim() } : {}), ...(due ? { dueAt: due } : {}), expectedVersion: 0 }); await onSaved(); }
    catch (e) { setError(friendly(e)); } finally { setBusy(false); }
  };
  return <Modal title="Add task" mobileSheet onClose={() => { if (!busy) onClose(); }} footer={<div className="rw-actions"><Btn variant="secondary" disabled={busy} onClick={onClose}>Cancel</Btn><Btn variant="primary" disabled={busy || !recordId || title.trim().length < 3} loading={busy} onClick={() => void save()}>{busy ? 'Adding…' : 'Add task'}</Btn></div>}>
    <div className="rw-form">
      <label className="rw-field"><span>Pursuit</span><Select aria-label="Pursuit" value={recordId} disabled={busy} onChange={e => setRecordId(e.target.value)}>{pursuits.map(item => <option key={item.recordId} value={item.recordId}>{item.title}</option>)}</Select></label>
      <label className="rw-field"><span>Task</span><input value={title} maxLength={300} disabled={busy} onChange={e => setTitle(e.target.value)} /></label>
      <label className="rw-field"><span>Kind</span><Select aria-label="Task kind" presentation="dropdown" searchable={false} value={kind} disabled={busy} onChange={e => setKind(e.target.value)}>{TASK_KINDS.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</Select></label>
      <label className="rw-field"><span>Owner</span><input value={owner} maxLength={120} disabled={busy} onChange={e => setOwner(e.target.value)} /></label>
      <label className="rw-field"><span>Due</span><input type="date" value={due} disabled={busy} onChange={e => setDue(e.target.value)} /></label>
      <p className="rw-note">To link a task to a specific requirement, create it from the notice’s Requirements tab. {label('mandatory')} requirements stay unresolved until evidence is reviewed.</p>
      {error && <p role="alert" className="rw-error">{error}</p>}
    </div>
  </Modal>;
}
