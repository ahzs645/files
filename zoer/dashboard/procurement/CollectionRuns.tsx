import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Btn } from '@zoer/plugin-ui/controls';
import { host } from '../bridge';
import { hostHref } from '../navigation';
import { BROWSER_COLLECT_ACTION } from './browser-sites';
import { intervalText, type ScheduleRow } from './schedule-state';
import { SCHEDULES_KEY } from './ScheduleControl';
import {
  COLLECT_ACTION, DASHBOARD_SCHEDULED_ACTIONS, isLive, legacyAllSchedule, migrateAllSchedule, reenableStopped, reenableable, runState, stoppedByUpdate,
  type Preset, type RecentRun,
} from './source-schedules';
import { sourceName } from './display';

export const RUNS_KEY = ['catalog', 'procurement-recent-runs'] as const;
export const PRESETS_KEY = ['catalog', 'procurement-presets'] as const;
const COLLECT_ACTIONS = [COLLECT_ACTION, BROWSER_COLLECT_ACTION];

/** Recent runs of this plugin from Zoer's run store (`runs.recent`, S6), every 5 s. Older Zoer answers with an error. */
export function useRecentRuns() {
  return useQuery({ queryKey: RUNS_KEY, queryFn: async () => ((await host('runs.recent', { limit: 30 }))?.runs ?? []) as RecentRun[], refetchInterval: 5000, retry: false });
}
/** Saved collection presets (`presets.list`, S6). */
export function usePresets() {
  return useQuery({ queryKey: PRESETS_KEY, queryFn: async () => ((await host('presets.list', { actionId: COLLECT_ACTION }))?.presets ?? []) as Preset[], refetchInterval: 30_000, retry: false });
}

const when = (value: string | undefined) => value && Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : '';
const runSource = (run: RecentRun) => {
  const id = typeof run.input?.sourceId === 'string' ? run.input.sourceId : '';
  const what = id === 'all' ? 'All sources' : id ? sourceName(id) : 'Collection';
  return Array.isArray(run.input?.portals) ? `${what} · ${run.input.portals.length} portal${run.input.portals.length === 1 ? '' : 's'}` : Array.isArray(run.input?.sites) ? `${what} · ${run.input.sites.length} site${run.input.sites.length === 1 ? '' : 's'}` : what;
};

/**
 * Collection runs: what each recent run did or is doing (portal n of m, waiting to retry, paused for an update,
 * resume needed), with Pause, Resume and Cancel for live runs. Runs are resumable (S1): a paused run continues from
 * the portal it stopped at.
 */
export function CollectionRuns({ runs, error, loading }: { runs?: RecentRun[]; error?: Error | null; loading: boolean }) {
  const client = useQueryClient(), [busy, setBusy] = useState(''), [failure, setFailure] = useState('');
  const shown = (runs ?? []).filter(run => COLLECT_ACTIONS.includes(run.actionId)).slice(0, 8);
  const act = async (run: RecentRun, method: 'run.pause' | 'run.resume' | 'cancel') => {
    setBusy(`${method}:${run.runId}`); setFailure('');
    try { await host(method, { id: run.runId }); await client.invalidateQueries({ queryKey: RUNS_KEY }); }
    catch (e) { setFailure((e as Error).message); } finally { setBusy(''); }
  };
  return <section className="rw-panel pc-runs" aria-labelledby="pc-runs-title">
    <header className="rw-panel-head"><h2 id="pc-runs-title">Collection runs</h2><span className="rw-muted">Each run saves portal by portal; a paused or interrupted run continues where it stopped.</span></header>
    {error ? <p className="rw-muted">Run history is not available from this Zoer version.</p> : loading ? <p role="status">Loading runs…</p> : !shown.length ? <p className="rw-muted">No collection has run yet.</p> :
    <ul className="pc-run-list">{shown.map(run => {
      const state = runState(run)!;
      return <li key={run.runId} data-live={isLive(run) || undefined}>
        <div className="pc-run-main"><strong>{runSource(run)}</strong><small>{when(run.createdAt)}{run.finishedAt ? ` → ${when(run.finishedAt)}` : ''}</small></div>
        <div className="pc-run-state"><span className="pc-status" data-tone={state.tone}>{state.text}</span>{state.detail && <small title={state.detail}>{state.detail}</small>}</div>
        {(state.canPause || state.canResume || state.canCancel) && <div className="pc-run-actions">
          {state.canPause && <Btn size="sm" variant="secondary" disabled={!!busy} onClick={() => void act(run, 'run.pause')}>{busy === `run.pause:${run.runId}` ? 'Pausing…' : 'Pause'}</Btn>}
          {state.canResume && <Btn size="sm" variant="primary" disabled={!!busy} onClick={() => void act(run, 'run.resume')}>{busy === `run.resume:${run.runId}` ? 'Resuming…' : 'Resume'}</Btn>}
          {state.canCancel && <Btn size="sm" variant="ghost" disabled={!!busy} onClick={() => void act(run, 'cancel')}>{busy === `cancel:${run.runId}` ? 'Cancelling…' : 'Cancel'}</Btn>}
        </div>}
      </li>;
    })}</ul>}
    {failure && <p role="alert">{failure}</p>}
  </section>;
}

/**
 * After an update Zoer turns every schedule off ("Plugin or settings changed") so a new version never runs unattended
 * before the person looks. This says so at the top of Sources with one button to turn them on again, and offers to
 * replace the 0.33 "all sources" schedule with one schedule per source at the same interval.
 */
export function ScheduleNotice({ rows, presets, labels }: { rows?: ScheduleRow[]; presets?: Preset[]; labels: Record<string, string> }) {
  const client = useQueryClient(), [busy, setBusy] = useState(false), [error, setError] = useState(''), [message, setMessage] = useState('');
  const legacy = legacyAllSchedule(rows), stopped = reenableable(rows);
  const elsewhere = stoppedByUpdate(rows).filter(row => !DASHBOARD_SCHEDULED_ACTIONS.includes(row.actionId));
  if (!legacy && !stopped.length && !elsewhere.length && !message) return null;
  const run = async (task: () => Promise<string>) => {
    setBusy(true); setError(''); setMessage('');
    try { setMessage(await task()); await client.invalidateQueries({ queryKey: SCHEDULES_KEY }); await client.invalidateQueries({ queryKey: PRESETS_KEY }); }
    catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };
  const names = (list: ScheduleRow[]) => list.map(row => row.actionId === 'procurement.alerts' ? 'alert checks' : row.presetId ? presets?.find(preset => preset.id === row.presetId)?.name ?? 'a saved collection' : 'collection').join(', ');
  return <div className="pc-schedule-notice" role="status">
    {legacy && <div>
      <p><strong>Collection is now scheduled per source.</strong> Your earlier schedule collected every source {intervalText(legacy.intervalHours).toLowerCase()}{!legacy.enabled ? ' and is off since the update' : ''}. Each source now runs on its own, step by step, and continues after a Zoer restart.</p>
      <Btn variant="primary" disabled={busy} onClick={() => void run(async () => { await migrateAllSchedule(host, legacy, labels); return `CanadaBuys, bids&tenders and the local government websites are now each scheduled ${intervalText(legacy.intervalHours).toLowerCase()}.`; })}>{busy ? 'Saving…' : `Schedule each source ${intervalText(legacy.intervalHours).toLowerCase()}`}</Btn>
    </div>}
    {stopped.length > 0 && <div>
      <p><strong>Zoer turned off {stopped.length === 1 ? 'a schedule' : `${stopped.length} schedules`} when Procurement was updated</strong> ({names(stopped)}). It does this after every update so a new version never runs before you look.</p>
      <Btn variant="primary" disabled={busy} onClick={() => void run(async () => { const count = await reenableStopped(host, rows ?? []); return `${count} schedule${count === 1 ? '' : 's'} turned on again.`; })}>{busy ? 'Saving…' : stopped.length === 1 ? 'Turn it on again' : 'Turn them on again'}</Btn>
    </div>}
    {elsewhere.length > 0 && <p>Schedules that use your Zoer browser (BC Bid scrapes, browser sites) were turned off by the update too. Turn them on again in <a className="procurement-link" href={hostHref('#/settings/plugins')}>Zoer’s plugin settings</a>.</p>}
    {message && <p>{message}</p>}{error && <p role="alert">{error}</p>}
  </div>;
}
