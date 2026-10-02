import { useEffect, useState, type ReactNode } from 'react';
import { Button } from '../../apps/dashboard/src/components/ui/Button';
import { host } from './bridge';
import { researchRetry } from './research-retry';
import { shortError } from './error-text';
import { StatusBadge, type Tone } from './host-ui';

const STATUS_TEXT: Record<string, string> = { waiting_for_user: 'Needs you', succeeded: 'Done', failed: 'Failed', running: 'Running', cancelled: 'Stopped', stopped: 'Stopped', queued: 'Queued', paused: 'Paused for update' };
const statusText = (status: string) => STATUS_TEXT[status] ?? (status.charAt(0).toUpperCase() + status.slice(1)).replace(/_/g, ' ');
const STATUS_TONE: Record<string, Tone> = { waiting_for_user: 'warning', succeeded: 'success', failed: 'error', running: 'info', queued: 'neutral', cancelled: 'neutral', stopped: 'neutral', paused: 'info' };
const PAGE = 8;

/** Saved prompts and batches, refreshed every 10 seconds while the page is visible. */
export function useCatalogState(onError: (message: string) => void) {
  const [state, setState] = useState<any>({ prompts: [], batches: [] });
  const refresh = async () => { const next=await host('catalog.state'); const tasks=await host('catalog.query',{statement: "SELECT run_id,record_id,kind,status,error,updated_at,json_extract(result,'$.name') name,json_extract(result,'$.phase') phase FROM research_tasks ORDER BY updated_at DESC LIMIT 100",parameters:[]});setState({...next,tasks:tasks.rows}); };
  useEffect(() => {
    void refresh().catch(e => onError(e.message));
    const timer = setInterval(() => { if (!document.hidden) void refresh().catch(e => onError(e.message)); }, 10000);
    return () => clearInterval(timer);
  }, []);
  return [state, refresh] as const;
}

export function BatchProgress({batches, tasks = []}: {batches:any[];tasks?:any[]}) {
  const active=batches.find(batch=>batch.status==='running');
  if(!active)return null;
  const task=tasks.find(task=>task.run_id===active.id);
  return <section className="zoer-history research-progress" role="status" aria-label="Current processing">
    <strong>{active.kind==='review'?'AI review in progress':'Document processing in progress'} · {active.completed}/{active.total} records complete</strong>
    {task&&<p>{task.phase||task.kind} · {task.name||task.record_id}</p>}
    <p className="research-note">Progress is saved, so you can leave this page.</p>
  </section>;
}

export function BatchHistory({ title, kind, batches, modelId = '', tasks = [], onChanged, onError, details }: {
  title: string; kind: 'download' | 'review'; batches: any[]; modelId?: string; tasks?: any[]; onChanged: () => Promise<void>; onError: (message: string) => void;
  /** Optional per-run panel, shown when the run's Results toggle is open. */
  details?: (batch: any) => ReactNode;
}) {
  const [busy, setBusy] = useState(false), [open, setOpen] = useState<Set<string>>(new Set()), [all, setAll] = useState(false);
  const toggle = (id: string) => { const next = new Set(open); next.has(id) ? next.delete(id) : next.add(id); setOpen(next); };
  const rows = batches.filter(batch => batch.kind === kind), shown = all ? rows : rows.slice(0, PAGE);
  const act = async (fn: () => Promise<unknown>) => { setBusy(true); try { await fn(); await onChanged(); } catch (e) { onError((e as Error).message); } finally { setBusy(false); } };
  return <section className="zoer-history" aria-label={title}>
    <h2>{title}</h2>
    {!rows.length && <p>Nothing yet.</p>}
    {shown.map(batch => { const steps = tasks.filter(task => task.run_id === batch.id).slice(0, 3); return <div key={batch.id} className="research-batch-item"><article className="research-batch">
      <div>
        <StatusBadge tone={STATUS_TONE[batch.status] ?? 'neutral'}>{statusText(batch.status)}</StatusBadge>{batch.updated_at && <time dateTime={batch.updated_at}>{new Date(batch.updated_at).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}</time>}
        <p>{batch.completed}/{batch.total} done{Number(batch.failed) ? ` · ${batch.failed} failed` : ''}</p>
        {batch.error && <p role="alert" className="doc-clamp" title={batch.error}>{shortError(batch.error)}</p>}
        {steps.length > 0 && <details className="doc-steps"><summary>Latest steps</summary>{steps.map((task, index) => <p className="research-task" key={index}><strong>{task.phase || task.kind}</strong> · {task.name || task.record_id} · {batch.status === 'paused' && task.status === 'running' ? 'Paused for update' : batch.status !== 'running' && task.status === 'running' ? 'Interrupted' : statusText(task.status)}{task.error ? ` · ${shortError(task.error)}` : ''}</p>)}</details>}
      </div>
      {batch.status === 'running'
        ? <Button variant="ghost" disabled={busy} onClick={() => void act(() => host('cancel', { id: batch.id }))}>Stop</Button>
        // Paused for a Zoer update: it resumes on its own, so there is nothing to retry.
        : batch.status === 'paused' || (kind === 'download' && batch.status === 'succeeded') ? null : <Button variant="ghost" disabled={busy} onClick={() => void act(() => host('action', (JSON.parse(batch.input||'{}').extractOnly?{actionId:'documents.extract',input:{recordIds:JSON.parse(batch.input).recordIds}}:researchRetry(batch, modelId))))}>Retry</Button>}
      {details && <Button variant="ghost" aria-expanded={open.has(batch.id)} aria-controls={`run-${batch.id}`} onClick={() => toggle(batch.id)}>{open.has(batch.id) ? 'Hide results' : 'Results'}</Button>}
    </article>{details && open.has(batch.id) && <div id={`run-${batch.id}`}>{details(batch)}</div>}</div>; })}
    {rows.length > PAGE && <Button variant="ghost" onClick={() => setAll(!all)}>{all ? 'Show fewer' : `Show ${rows.length - PAGE} older`}</Button>}
  </section>;
}
