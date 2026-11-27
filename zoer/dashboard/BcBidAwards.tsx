import { useState } from 'react';
import { Btn } from '@zoer/plugin-ui/controls';
import { Hint } from './host-ui';
import { awardHistoryState, awardProgress } from './award-progress';
import { plainError } from './error-text';
import { useCapabilities } from './capabilities';
import { activeAwardRun, startAwardHistory, stopAwardHistory, useWorkspace } from './backend';
import { isPausedForUpdate, PAUSED_FOR_UPDATE } from './model';
import { StatusPill } from '../../apps/dashboard/src/components/scraper/StatusPill';
import { formatRuntime, formatTimestamp } from '../../apps/dashboard/src/lib/formatting';

/** Award history on the BC Bid page; the state and wording come from `awardHistoryState` (award-progress.ts). */
export function AwardHistoryCard() {
  const { model } = useWorkspace();
  const { collection } = useCapabilities();
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [message, setMessage] = useState('');
  if (!model || !collection) return null;
  const active = activeAwardRun(model);
  const state = awardHistoryState(model, active);
  const act = async (fn: () => Promise<void>, done: string) => { setBusy(true); setError(''); setMessage(''); try { await fn(); setMessage(done); } catch (e) { setError(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); } };
  const lastError = !active && state.latest && !state.latest.cancelRequestedAt && state.latest.status === 'failed' ? state.latest.error : '';
  const checkpoint = state.isRecent ? model.awardRecentCheckpoint : model.awardCheckpoint;
  return <section className="zoer-history zoer-setup" aria-labelledby="bcbid-awards-title">
    <div className="zoer-setup-row">
      <div><h2 id="bcbid-awards-title">Award history</h2>
        <p role="status">{state.isRecent && !active ? 'Recent awards checked. ' : ''}{state.status} {awardProgress(checkpoint)}</p>
        {state.isRecent && model.awardCheckpoint?.version === 2 && <p>Dated history: {awardProgress(model.awardCheckpoint)}</p>}
        {lastError && <Hint content={lastError}><p role="alert" className="pc-wrap">{plainError(lastError)}</p></Hint>}</div>
      <div className="zoer-record-tools zoer-setup-actions">
        {state.primary === 'collect' && <Btn variant="primary" loading={busy} onClick={() => void act(() => startAwardHistory(), 'Started.')}>Collect award history</Btn>}
        {state.primary === 'resume' && <Btn variant="primary" loading={busy} onClick={() => void act(() => startAwardHistory(true), 'Resumed.')}>Resume award history</Btn>}
        {!active && <Btn variant="secondary" disabled={busy} onClick={() => void act(() => startAwardHistory(false, true), 'Checking the last 30 days.')}>Refresh recent awards</Btn>}
        {active && <Btn variant="secondary" disabled={busy || !!active.cancelRequestedAt} onClick={() => void act(stopAwardHistory, 'Stopping after the current request.')}>{active.cancelRequestedAt ? 'Stopping…' : 'Stop'}</Btn>}
      </div>
    </div>
    {message && <p role="status">{message}</p>}
    {error && <p role="alert">{error}</p>}
    <details><summary data-zoer-disclosure="">About award history</summary><p>Checks public awards in date ranges and saves each page. Completed ranges are skipped; oversized ranges are split into smaller periods. Resume rechecks only the unfinished range, and unchanged awards are kept. Refresh recent awards checks the last 30 days for new or changed awards without replacing the dated history. Undated awards and attachments are not collected.</p></details>
  </section>;
}

/** BC Bid runs: award history runs, in the same wording as the collection run cards. */
export function BcBidAwardRuns({ limit = 5 }: { limit?: number }) {
  const { model } = useWorkspace();
  // Only when the host returned fewer runs than exist.
  const truncated = model?.runsTruncated ? <p className="text-xs text-text-secondary">Older runs are not shown.</p> : null;
  if (!model?.awardRuns.length) return truncated;
  return <section aria-label="Award history runs" className="space-y-3">
    {truncated}
    <h2 className="text-[15px] font-semibold text-text-primary">Award history</h2>
    {model.awardRuns.slice(0, limit).map((run: any) => {
      const interrupted = run.status === 'outcome_unknown', paused = isPausedForUpdate(run);
      const status = ['succeeded', 'failed', 'cancelled'].includes(run.status) ? run.status : interrupted ? 'failed' : run.cancelRequestedAt ? 'stopping' : 'running';
      const startedAt = Date.parse(run.createdAt), completedAt = run.completedAt ? Date.parse(run.completedAt) : null;
      const progress = [model.awardCheckpoint, model.awardRecentCheckpoint].find(value => value?.runId === run.id);
      const recent = model.awardRecentCheckpoint?.runId === run.id;
      const rows = awardProgress(progress);
      const message = paused ? PAUSED_FOR_UPDATE : run.queueReason || (interrupted ? 'Interrupted before completion was confirmed. Saved awards are kept.' : plainError(run.error) || (status === 'succeeded' ? (recent ? 'Last 30 days checked.' : 'Complete.') : status === 'cancelled' ? 'Stopped by you.' : status === 'stopping' ? 'Stopping after the current request.' : 'Collecting public award history.'));
      return <article key={run.id} className="rounded-xl border border-border-subtle bg-bg-subtle p-4 space-y-2">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1"><StatusPill status={status} interrupted={interrupted} paused={paused} /><span className="text-sm font-semibold text-text-primary">{recent ? 'Recent awards' : 'Award history'}</span><span className="ml-auto text-xs text-text-tertiary">{formatTimestamp(startedAt)}</span></div>
        <div className="text-sm text-text-primary">{message}</div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-text-secondary">{rows && <span>{rows}</span>}<span>{status === 'running' || status === 'stopping' ? 'Running for' : 'Took'} {formatRuntime((completedAt ?? Date.now()) - startedAt)}</span></div>
      </article>;
    })}
    <h2 className="text-[15px] font-semibold text-text-primary">Opportunity collection</h2>
  </section>;
}
