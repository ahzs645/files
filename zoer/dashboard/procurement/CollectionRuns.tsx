import { Hint } from '../host-ui';
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Btn } from '@zoer/plugin-ui/controls';
import { host } from '../bridge';
import { plainError } from '../error-text';
import { RunLinks, SettingsLink } from './Status';
import { BROWSER_COLLECT_ACTION } from './browser-sites';
import { intervalText, scheduleLabel, stopReason, type ScheduleRow } from './schedule-state';
import { SCHEDULES_KEY } from './ScheduleControl';
import {
  COLLECT_ACTION, isLive, legacyAllSchedule, migrateAllSchedule, reenableStopped, reenableable, runState, stoppedSchedules,
  type Preset, type RecentRun,
} from './source-schedules';
import { sourceName } from './display';

export const RUNS_KEY = ['catalog', 'procurement-recent-runs'] as const;
export const PRESETS_KEY = ['catalog', 'procurement-presets'] as const;
const COLLECT_ACTIONS = [COLLECT_ACTION, BROWSER_COLLECT_ACTION];

/** Recent runs of this plugin from Zoer's run store (`runs.recent`, S6), every 5 s. Older Zoer answers with an error. */
export function useRecentRuns(enabled = true) {
  return useQuery({ queryKey: RUNS_KEY, queryFn: async () => ((await host('runs.recent', { limit: 30 }))?.runs ?? []) as RecentRun[], refetchInterval: 5000, retry: false, enabled });
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
    catch (e) { setFailure(plainError((e as Error).message)); } finally { setBusy(''); }
  };
  return <section className="rw-panel pc-runs" aria-labelledby="pc-runs-title">
    <header className="rw-panel-head"><h2 id="pc-runs-title">Collection runs</h2><span className="rw-muted">Each run saves portal by portal; a paused or interrupted run continues where it stopped.</span></header>
    <RunLinks compact except="/sources" />
    {error ? <p className="rw-muted">Run history is not available from this Zoer version.</p> : loading ? <p role="status">Loading runs…</p> : !shown.length ? <p className="rw-muted">No collection has run yet.</p> :
    <ul className="pc-run-list">{shown.map(run => {
      const state = runState(run)!;
      return <li key={run.runId} data-live={isLive(run) || undefined}>
        <div className="pc-run-main"><strong>{runSource(run)}</strong><small>{when(run.createdAt)}{run.finishedAt ? ` → ${when(run.finishedAt)}` : ''}</small></div>
        <div className="pc-run-state"><span className="pc-status" data-tone={state.tone}>{state.text}</span>{state.detail && <Hint content={state.detail}><small className="pc-wrap">{plainError(state.detail)}</small></Hint>}</div>
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
 * Schedules Zoer stopped, counted the same way as Status, Home and the Sources header (every row Zoer lists). Ones this
 * page can turn back on get one button; browser schedules and restored ones open Zoer's Settings › Schedules. Also
 * offers to replace the 0.33 "all sources" schedule with one schedule per source at the same interval.
 */
export function ScheduleNotice({ rows, presets, labels }: { rows?: ScheduleRow[]; presets?: Preset[]; labels: Record<string, string> }) {
  const client = useQueryClient(), [busy, setBusy] = useState(false), [error, setError] = useState(''), [message, setMessage] = useState('');
  const legacy = legacyAllSchedule(rows), stopped = stoppedSchedules(rows), here = reenableable(rows);
  const elsewhere = stopped.filter(row => !here.includes(row) && row !== legacy);
  if (!legacy && !stopped.length && !message) return null;
  const run = async (task: () => Promise<string>) => {
    setBusy(true); setError(''); setMessage('');
    try { setMessage(await task()); await client.invalidateQueries({ queryKey: SCHEDULES_KEY }); await client.invalidateQueries({ queryKey: PRESETS_KEY }); }
    catch (e) { setError(plainError((e as Error).message)); } finally { setBusy(false); }
  };
  const name = (row: ScheduleRow) => scheduleLabel(row, presets, id => labels[id] ?? sourceName(id));
  return <div className="pc-schedule-notice" role="status">
    {legacy && <div>
      <p><strong>Collection is now scheduled per source.</strong> Your earlier schedule collected every source {intervalText(legacy.intervalHours).toLowerCase()}{!legacy.enabled ? ' and is currently off' : ''}. Each source now runs on its own, step by step, and continues after a Zoer restart.</p>
      <Btn variant="primary" disabled={busy} onClick={() => void run(async () => { await migrateAllSchedule(host, legacy, labels); return `CanadaBuys, bids&tenders and the local government websites are now each scheduled ${intervalText(legacy.intervalHours).toLowerCase()}.`; })}>{busy ? 'Saving…' : `Schedule each source ${intervalText(legacy.intervalHours).toLowerCase()}`}</Btn>
    </div>}
    {stopped.length > 0 && <div className="pc-schedule-stopped-list">
      <p><strong>{stopped.length === 1 ? '1 schedule is paused and needs your review' : `${stopped.length} schedules are paused and need your review`}</strong> ({stopped.length} of {(rows ?? []).length}). They do not run until they are on again.</p>
      <details><summary data-zoer-disclosure="">{`Why each one stopped (${stopped.map(name).join(', ')})`}</summary>
        <ul className="pc-schedule-reasons">{stopped.map((row, i) => <li key={`${row.actionId}:${row.presetId ?? i}`}><strong>{name(row)}</strong> <Hint content={row.error}><span className="pc-wrap">{stopReason(row.error ?? '')}</span></Hint></li>)}</ul>
      </details>
      <div className="procurement-actions">
        {here.length > 0 && <Btn variant="primary" disabled={busy} onClick={() => void run(async () => { const count = await reenableStopped(host, rows ?? []); return `${count} schedule${count === 1 ? '' : 's'} turned on again.`; })}>{busy ? 'Saving…' : here.length === 1 ? `Turn ${name(here[0])} on again` : `Turn ${here.length} on again`}</Btn>}
        {elsewhere.length > 0 && <SettingsLink section="schedules">{`Turn on ${elsewhere.length === 1 ? name(elsewhere[0]) : `the other ${elsewhere.length}`} in Settings › Schedules`}</SettingsLink>}
      </div>
      {elsewhere.length > 0 && <p className="rw-muted">BC Bid scrapes and browser sites need their browser, so they are turned on in Zoer’s Settings.</p>}
    </div>}
    {message && <p>{message}</p>}{error && <p role="alert">{error}</p>}
  </div>;
}
