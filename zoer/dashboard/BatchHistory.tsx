import { useEffect, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Button } from '../../apps/dashboard/src/components/ui/Button';
import { host } from './bridge';
import { researchRetry } from './research-retry';
import { processingRetry } from './document-processing';
import { assertDocumentBrowserIdle, batchPause, retryTimeText } from './document-run';
import { refreshAfterChange, useWorkspace } from './backend';
import { plainError, shortError } from './error-text';
import { RunLinks } from './procurement/Status';
import { StatusBadge, type Tone, Hint } from './host-ui';

const STATUS_TEXT: Record<string, string> = { waiting_for_user: 'Waiting for you', succeeded: 'Done', failed: 'Failed', running: 'Running', cancelled: 'Stopped', stopped: 'Stopped', queued: 'Queued', paused: 'Paused for update', retry_scheduled: 'Waiting to retry' };
const statusText = (status: string) => STATUS_TEXT[status] ?? (status.charAt(0).toUpperCase() + status.slice(1)).replace(/_/g, ' ');
const STATUS_TONE: Record<string, Tone> = { waiting_for_user: 'warning', succeeded: 'success', failed: 'error', running: 'info', queued: 'neutral', cancelled: 'neutral', stopped: 'neutral', paused: 'info', retry_scheduled: 'warning' };
const PAGE = 8;

/** Saved prompts and batches, refreshed every 10 seconds while the page is visible. */
export function useCatalogState(onError: (message: string) => void) {
  const state = useQuery({ queryKey: ['procurement', 'catalog-state'], queryFn: async () => {
    const [next, tasks] = await Promise.all([host('catalog.state'), host('catalog.query', {statement: "SELECT id,run_id,record_id,kind,status,error,updated_at,json_extract(result,'$.transferId') transferId,json_extract(result,'$.receivedBytes') receivedBytes,json_extract(result,'$.expectedBytes') expectedBytes,json_extract(result,'$.name') name,json_extract(result,'$.phase') phase FROM research_tasks ORDER BY updated_at DESC LIMIT 100",parameters:[]})]);
    return {...next,tasks:tasks.rows};
  }, refetchInterval: query => query.state.data?.batches?.some((batch:any) => batch.status === 'running') ? 3000 : 10000 });
  useEffect(() => { if (state.error) onError(state.error.message); }, [state.error, onError]);
  const refresh = async () => { try { await state.refetch({ throwOnError: true }); } catch (e) { onError((e as Error).message); } };
  // Keep cached batches visible when switching Download / Files / History.
  return [{ ...(state.data ?? { prompts: [], batches: [], tasks: [] }), loadError: state.error?.message }, refresh] as const;
}

export function BatchHistory({ title, kind, batches, modelId = '', tasks = [], onChanged, onError, details, browserBusy = false, links = true }: {
  browserBusy?: boolean;
  /** Links to the other run lists (download history only). */ links?: boolean; title: string; kind: 'download' | 'review'; batches: any[]; modelId?: string; tasks?: any[]; onChanged: () => Promise<void>; onError: (message: string) => void;
  /** Optional per-run panel, shown when the run's Results toggle is open. */
  details?: (batch: any) => ReactNode;
}) {
  const [busy, setBusy] = useState(false), [open, setOpen] = useState<Set<string>>(new Set()), [all, setAll] = useState(false);
  const { model } = useWorkspace();
  const toggle = (id: string) => { const next = new Set(open); next.has(id) ? next.delete(id) : next.add(id); setOpen(next); };
  const rows = batches.filter(batch => batch.kind === kind), shown = all ? rows : rows.slice(0, PAGE);
  const act = async (fn: () => Promise<unknown>) => { setBusy(true); try { await fn(); await onChanged(); } catch (e) { onError(plainError((e as Error).message)); } finally { setBusy(false); } };
  return <section className="zoer-history" aria-label={title}>
    <h2>{title}</h2>
    {kind === 'download' && links && <RunLinks compact except="/documents?tab=history" />}
    {!rows.length && <p>Nothing yet.</p>}
    {shown.map(batch => { const input = JSON.parse(batch.input || '{}'), needsBrowser = kind === 'download' && !input.extractOnly; const steps = tasks.filter(task => task.run_id === batch.id).slice(0, 3);
      // A paused batch is an update pause, a scheduled automatic retry (stoppable), or left over from a run that ended.
      const pause = batchPause(batch, model?.workflowRuns), status = pause?.state === 'ended' ? 'stopped' : pause?.state === 'retry' ? 'retry_scheduled' : batch.status, error = pause ? pause.error : batch.error;
      return <div key={batch.id} className="research-batch-item"><article className="research-batch">
      <div>
        <StatusBadge tone={STATUS_TONE[status] ?? 'neutral'}>{statusText(status)}</StatusBadge>{batch.updated_at && <time dateTime={batch.updated_at}>{new Date(batch.updated_at).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}</time>}
        <p>{batch.completed}/{batch.total} done{Number(batch.failed) ? ` · ${batch.failed} failed` : ''}</p>
        {error && <Hint content={error}><p role="alert" className="doc-clamp pc-wrap">{plainError(error)}</p></Hint>}
        {pause?.state === 'retry' && <p role="status">Nothing is {needsBrowser ? 'downloading' : 'running'}. Zoer retries automatically{retryTimeText(pause.retryAt) && ` at ${retryTimeText(pause.retryAt)}`}; Stop ends the wait and keeps what is saved.</p>}
        {steps.length > 0 && <details className="doc-steps"><summary data-zoer-disclosure="">Latest steps</summary>{steps.map((task, index) => <p className="research-task" key={index}><strong>{task.phase || task.kind}</strong> · {task.name || task.record_id} · {status === 'paused' && task.status === 'running' ? 'Paused for update' : status !== 'running' && task.status === 'running' ? 'Interrupted' : statusText(task.status)}{task.error ? ` · ${shortError(task.error)}` : ''}</p>)}</details>}
      </div>
      {status === 'running' || status === 'retry_scheduled'
        ? <Button variant="ghost" disabled={busy} onClick={() => void act(async () => { await host('cancel', { id: batch.id }); void refreshAfterChange(); })}>Stop</Button>
        // Paused for a Zoer update: it resumes on its own, so there is nothing to retry.
        : status === 'paused' || (kind === 'download' && status === 'succeeded') ? null : <Button variant="ghost" disabled={busy || (needsBrowser && browserBusy)} onClick={() => void act(async () => { if (needsBrowser) await assertDocumentBrowserIdle(host); const started = await host('action', input.extractOnly ? processingRetry(batch) : researchRetry(batch, modelId)); void refreshAfterChange(); return started; })}>Retry</Button>}
      {details && <Button variant="ghost" aria-expanded={open.has(batch.id)} aria-controls={`run-${batch.id}`} onClick={() => toggle(batch.id)}>{open.has(batch.id) ? 'Hide results' : 'Results'}</Button>}
    </article>{details && open.has(batch.id) && <div id={`run-${batch.id}`}>{details(batch)}</div>}</div>; })}
    {rows.length > PAGE && <Button variant="ghost" onClick={() => setAll(!all)}>{all ? 'Show fewer' : `Show ${rows.length - PAGE} older`}</Button>}
  </section>;
}
