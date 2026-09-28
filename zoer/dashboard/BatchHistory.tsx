import { useEffect, useState, type ReactNode } from 'react';
import { Button } from '../../apps/dashboard/src/components/ui/Button';
import { host } from './bridge';
import { researchRetry } from './research-retry';

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
    <p className="research-note">Progress is saved. You can leave this page; use the history controls to stop or resume.</p>
  </section>;
}

export function BatchHistory({ title, kind, batches, modelId = '', tasks = [], onChanged, onError, details }: {
  title: string; kind: 'download' | 'review'; batches: any[]; modelId?: string; tasks?: any[]; onChanged: () => Promise<void>; onError: (message: string) => void;
  /** Optional per-run panel, shown when the run's Results toggle is open. */
  details?: (batch: any) => ReactNode;
}) {
  const [busy, setBusy] = useState(false), [open, setOpen] = useState<Set<string>>(new Set());
  const toggle = (id: string) => { const next = new Set(open); next.has(id) ? next.delete(id) : next.add(id); setOpen(next); };
  const rows = batches.filter(batch => batch.kind === kind);
  const act = async (fn: () => Promise<unknown>) => { setBusy(true); try { await fn(); await onChanged(); } catch (e) { onError((e as Error).message); } finally { setBusy(false); } };
  return <section className="zoer-history" aria-label={title}>
    <h2>{title}</h2>
    {!rows.length && <p>Nothing yet.</p>}
    {rows.map(batch => <div key={batch.id} className="research-batch-item"><article className="research-batch">
      <div><strong className="research-status" data-status={batch.status}>{batch.status}</strong>{batch.updated_at && <time dateTime={batch.updated_at}>{new Date(batch.updated_at).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}</time>}<p>{batch.completed}/{batch.total} records complete · {batch.failed} records failed{batch.error ? <> · <span role="alert">{batch.error}</span></> : null}</p>{tasks.filter(task=>task.run_id===batch.id).slice(0,3).map((task,index)=><p className="research-task" key={index}><strong>{task.phase||task.kind}</strong> · {task.name||task.record_id} · {batch.status!=='running'&&task.status==='running'?'Interrupted':task.status}{task.error?` · ${task.error}`:''}</p>)}</div>
      {batch.status === 'running'
        ? <Button variant="ghost" disabled={busy} onClick={() => void act(() => host('cancel', { id: batch.id }))}>Stop</Button>
        : <Button variant="ghost" disabled={busy} onClick={() => void act(() => host('action', (JSON.parse(batch.input||'{}').extractOnly?{actionId:'documents.extract',input:{recordIds:JSON.parse(batch.input).recordIds}}:researchRetry(batch, modelId))))}>Retry</Button>}
      {details && <Button variant="ghost" aria-expanded={open.has(batch.id)} aria-controls={`run-${batch.id}`} onClick={() => toggle(batch.id)}>{open.has(batch.id) ? 'Hide results' : 'Results'}</Button>}
    </article>{details && open.has(batch.id) && <div id={`run-${batch.id}`}>{details(batch)}</div>}</div>)}
  </section>;
}
