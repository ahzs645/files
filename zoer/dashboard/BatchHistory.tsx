import { useEffect, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Button } from '../../apps/dashboard/src/components/ui/Button';
import { host } from './bridge';
import { researchRetry, verificationRetry } from './research-retry';
import { processingRetry } from './document-processing';
import { assertDocumentBrowserIdle, downloadRunState, downloadRunTitle, retryableRuns, runInput, runScopeKey, type DownloadRunState, type RunFileStats } from './document-run';
import { refreshAfterChange } from './backend';
import { plainError, shortError } from './error-text';
import { StatusBadge, type Tone, Hint } from './host-ui';
import { count, plural, when } from './format';
import { useDownloadRuns, useRunFileStats, type RunInfo } from './use-download-runs';
import { VERIFICATION_TASKS_SQL, groupVerificationRuns, verificationFileText, verificationRuns, type VerificationRun, type VerificationTask } from './verification-runs';

const PAGE = 8;

/** Saved prompts and batches, refreshed every 10 seconds while the page is visible. */
export function useCatalogState(onError: (message: string) => void) {
  const state = useQuery({ queryKey: ['procurement', 'catalog-state'], queryFn: async () => {
    const [next, tasks, verifications] = await Promise.all([host('catalog.state'), host('catalog.query', {statement: "SELECT id,run_id,record_id,kind,status,error,updated_at,json_extract(result,'$.transferId') transferId,json_extract(result,'$.receivedBytes') receivedBytes,json_extract(result,'$.expectedBytes') expectedBytes,json_extract(result,'$.resumeAt') resumeAt,json_extract(result,'$.name') name,json_extract(result,'$.phase') phase FROM research_tasks ORDER BY updated_at DESC LIMIT 100",parameters:[]}),
      // Saved-original checks have no batch; read them apart so download tasks cannot crowd them out.
      host('catalog.query', {statement: VERIFICATION_TASKS_SQL, parameters: []}).catch(() => ({rows: []}))]);
    return {...next,tasks:tasks.rows,verifications:verifications.rows as VerificationTask[]};
  }, refetchInterval: query => query.state.data?.batches?.some((batch:any) => batch.status === 'running')
    || query.state.data?.verifications?.some((task: VerificationTask) => task.status === 'running') ? 3000 : 10000 });
  useEffect(() => { if (state.error) onError(state.error.message); }, [state.error, onError]);
  const refresh = async () => { try { await state.refetch({ throwOnError: true }); } catch (e) { onError((e as Error).message); } };
  // Keep cached batches visible when switching Download / Files / History.
  return [{ ...(state.data ?? { prompts: [], batches: [], tasks: [], verifications: [] as VerificationTask[] }), loaded: state.data !== undefined, loadError: state.error?.message }, refresh] as const;
}

const VERIFICATION_STATUS: Record<VerificationRun['status'], string> = { running: 'Checking', failed: 'Differs or failed', stopped: 'Stopped', succeeded: 'Matches' };
const VERIFICATION_TONE: Record<VerificationRun['status'], Tone> = { running: 'running', failed: 'error', stopped: 'neutral', succeeded: 'success' };

/** Saved-original checks, repeats of the same check shown once, with each file's phase and bytes while it transfers. */
export function VerificationHistory({ tasks, onChanged, onError }: { tasks: readonly VerificationTask[]; onChanged: () => Promise<void>; onError: (message: string) => void }) {
  const groups = groupVerificationRuns(verificationRuns(tasks)).slice(0, PAGE);
  const [busy, setBusy] = useState(false);
  const act = async (fn: () => Promise<unknown>) => { setBusy(true); try { await fn(); await onChanged(); } catch (e) { onError(plainError((e as Error).message)); } finally { setBusy(false); } };
  if (!groups.length) return null;
  return <section className="zoer-history" aria-label="Saved-original checks">
    <h2>Saved-original checks</h2>
    {groups.map(({ latest: run, count: times }) => <div key={run.runId} className="research-batch-item"><article className="research-batch"><div>
      <p className="pc-run-line"><StatusBadge tone={VERIFICATION_TONE[run.status]}>{VERIFICATION_STATUS[run.status]}</StatusBadge>
        <span>{count(run.files.filter(file => file.status === 'succeeded').length)} of {plural(run.files.length, 'file')} match</span>
        <span className="rw-muted">{times > 1 ? `Checked ${count(times)} times · latest ` : ''}<time dateTime={run.updatedAt}>{when(run.updatedAt)}</time></span></p>
      {run.files.map(file => <p className="research-task" key={file.id} aria-live={file.status === 'running' ? 'polite' : undefined}>
        <strong>{file.name || file.record_id}</strong> · {file.status === 'failed' ? shortError(verificationFileText(file)) : verificationFileText(file)}</p>)}
    </div>
    {run.status === 'running'
      ? <Button variant="ghost" disabled={busy} onClick={() => void act(async () => { await host('cancel', { id: run.runId }); void refreshAfterChange(); })}>Stop</Button>
      : <Hint action content="Download these files again and compare them with the saved originals"><Button variant="ghost" disabled={busy || !run.files.some(file => file.source_id)} onClick={() => void act(async () => {
          const started = await host('action', verificationRetry(run.files.flatMap(file => file.source_id ? [file.source_id] : []), run.files.find(file => file.browserSessionId)?.browserSessionId));
          void refreshAfterChange(); return started; })}>Check again</Button></Hint>}
    </article></div>)}
  </section>;
}

/** "1 text extractions failed" (a host message) in correct English. */
const singular = (text: string) => text.replace(/(^|[^\d,.])1 (text extractions|files|notices|records|opportunities)\b/g, (_, before: string, noun: string) =>
  `${before}1 ${({ 'text extractions': 'text extraction', files: 'file', notices: 'notice', records: 'record', opportunities: 'opportunity' } as Record<string, string>)[noun]}`);
const STEP_TEXT: Record<string, string> = { succeeded: 'Saved', failed: 'Failed', waiting_for_user: 'Browser check', running: 'Running', skipped: 'Skipped', interrupted: 'Interrupted', queued: 'Queued', retry_scheduled: 'Waiting to retry', deferred: 'Deferred' };

/** What a run did, in its own units: files saved and opportunities complete for downloads, items for the others. */
export function runSummary(batch: any, stats: RunFileStats | undefined, extraction: boolean): string {
  const input = runInput(batch), done = Number(batch.completed) || 0, total = Number(batch.total) || 0, failed = Number(batch.failed) || 0;
  if (extraction) return `${count(done)} of ${plural(total, 'file')} read${failed ? ` · ${count(failed)} failed` : ''}`;
  if (batch.kind === 'review') return `${count(done)} of ${plural(total, 'opportunity', 'opportunities')} reviewed${failed ? ` · ${count(failed)} failed` : ''}`;
  const files = stats ? `${plural(stats.saved, 'file')} saved` : '';
  // A queue run's batch counts opportunities whose every linked file is saved, across the whole scope.
  const notices = input.queueScope ? `${count(done)} of ${count(total)} opportunities complete` : `${count(done)} of ${plural(total, 'opportunity', 'opportunities')} done${failed ? ` · ${count(failed)} failed` : ''}`;
  return [files, notices].filter(Boolean).join(' · ');
}

export function BatchHistory({ title, kind, batches, modelId = '', tasks = [], onChanged, onError, details, browserBusy = false, links: _links = true }: {
  browserBusy?: boolean;
  /** Kept for callers; run lists link to each other from Operations › Runs' kind filter. */ links?: boolean; title: string; kind: 'download' | 'review'; batches: any[]; modelId?: string; tasks?: any[]; onChanged: () => Promise<void>; onError: (message: string) => void;
  /** Optional per-run panel, shown when the run's Results toggle is open. */
  details?: (batch: any) => ReactNode;
}) {
  const [busy, setBusy] = useState(false), [open, setOpen] = useState<Set<string>>(new Set()), [all, setAll] = useState(false);
  const toggle = (id: string) => { const next = new Set(open); next.has(id) ? next.delete(id) : next.add(id); setOpen(next); };
  const rows = batches.filter(batch => batch.kind === kind), shown = all ? rows : rows.slice(0, PAGE);
  const runs = useDownloadRuns(kind === 'download' && rows.length > 0);
  const fileRuns = kind === 'download' ? shown.filter(batch => !runInput(batch).extractOnly).map(batch => batch.id) : [];
  const stats = useRunFileStats(fileRuns, shown.some(batch => batch.status === 'running'));
  const now = Date.now();
  const stateOf = (batch: any): DownloadRunState => downloadRunState(batch, { run: runs.get(batch.id) as RunInfo | undefined, runs: [...runs.values()], stats: stats.data?.get(batch.id), now, downloads: kind === 'download' && !runInput(batch).extractOnly });
  // Only the newest run of each scope can be retried: older stopped runs are superseded, not five Retry buttons.
  const retryable = retryableRuns(rows, batch => runScopeKey(batch, runs.get(batch.id)?.actionId), stateOf);
  const act = async (fn: () => Promise<unknown>) => { setBusy(true); try { await fn(); await onChanged(); } catch (e) { onError(plainError((e as Error).message)); } finally { setBusy(false); } };
  return <section className="zoer-history" aria-label={title}>
    <h2>{title}</h2>
    {!rows.length && <p>Nothing yet.</p>}
    {shown.map(batch => {
      const input = runInput(batch), extraction = input.extractOnly === true, needsBrowser = kind === 'download' && !extraction;
      const run = runs.get(batch.id), state = stateOf(batch), steps = tasks.filter(task => task.run_id === batch.id).slice(0, 5);
      const heading = kind === 'review' ? null : extraction ? (input.pendingOnly ? 'Files waiting for text' : `Read again · ${plural(Array.isArray(input.recordIds) ? input.recordIds.length : 0, 'opportunity', 'opportunities')}`) : downloadRunTitle(batch, run?.actionId);
      const detail = singular(state.detail), retry = retryable.has(batch.id);
      return <div key={batch.id} className="research-batch-item"><article className="research-batch">
      <div>
        <p className="pc-run-line"><StatusBadge tone={state.tone}>{state.state}</StatusBadge>{heading && <strong>{heading}</strong>}
          <span>{runSummary(batch, stats.data?.get(batch.id), extraction)}</span>
          {batch.updated_at && <time dateTime={batch.updated_at}>{when(batch.updated_at)}</time>}</p>
        {detail && (state.active ? <p role="status" className="pc-run-detail pc-wrap">{detail}</p>
          : <Hint content={batch.error && batch.error !== detail ? batch.error : undefined}><p className="pc-run-detail pc-wrap" data-tone={state.tone}>{detail}</p></Hint>)}
        {steps.length > 0 && <details className="doc-steps"><summary data-zoer-disclosure="">Steps</summary>{steps.map((task, index) => <p className="research-task" key={index}><strong>{task.phase || task.kind}</strong> · {task.name || task.record_id} · {state.state === 'Paused for update' && task.status === 'running' ? 'Paused for update' : !state.active && task.status === 'running' ? 'Interrupted' : STEP_TEXT[task.status] ?? task.status}{task.error ? ` · ${shortError(task.error)}` : ''}{task.updated_at ? ` · ${when(task.updated_at)}` : ''}</p>)}</details>}
      </div>
      {state.active && state.state !== 'Paused for update'
        ? <Button variant="ghost" disabled={busy} onClick={() => void act(async () => { await host('cancel', { id: batch.id }); void refreshAfterChange(); })}>Stop</Button>
        : retry ? <Button variant="ghost" disabled={busy || (needsBrowser && browserBusy)} onClick={() => void act(async () => { if (needsBrowser) await assertDocumentBrowserIdle(host); const started = await host('action', extraction ? processingRetry(batch) : researchRetry(batch, modelId, run?.actionId)); void refreshAfterChange(); return started; })}>Retry</Button> : null}
      {details && <Button variant="ghost" aria-expanded={open.has(batch.id)} aria-controls={`run-${batch.id}`} onClick={() => toggle(batch.id)}>{open.has(batch.id) ? 'Hide results' : 'Results'}</Button>}
    </article>{details && open.has(batch.id) && <div id={`run-${batch.id}`}>{details(batch)}</div>}</div>; })}
    {rows.length > PAGE && <Button variant="ghost" onClick={() => setAll(!all)}>{all ? 'Show fewer' : `Show ${count(rows.length - PAGE)} older`}</Button>}
  </section>;
}
