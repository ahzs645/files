import { Hint, StatusBadge } from '../host-ui';
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Btn } from '@zoer/plugin-ui/controls';
import { host } from '../bridge';
import { plainError } from '../error-text';
import { count, when } from '../format';
import { BROWSER_SOURCE_ID } from './browser-sites';
import { COLLECT_ACTION, isLive, type Preset, type RecentRun } from './source-schedules';
import { CONNECTOR_SOURCES, lastCollected, readConnectorCollection } from './source-overview';
import { connectorCollectionKey } from './source-adapters';
import { COLLECT_ACTIONS, collectionRunRow, emptyRunsText, runSourceId } from './collection-run-rows';
import { BADGE_TONE } from './source-cards';

export const RUNS_KEY = ['catalog', 'procurement-recent-runs'] as const;
export const PRESETS_KEY = ['catalog', 'procurement-presets'] as const;

/** Recent runs of this plugin from Zoer's run store (`runs.recent`, S6), every 5 s. Older Zoer answers with an error. */
export function useRecentRuns(enabled = true) {
  return useQuery({ queryKey: RUNS_KEY, queryFn: async () => ((await host('runs.recent', { limit: 30 }))?.runs ?? []) as RecentRun[], refetchInterval: 5000, retry: false, enabled });
}
export const COLLECTION_RUNS_KEY = ['catalog', 'procurement-collection-runs'] as const;
/**
 * Collection runs read by action (`runs.recent` with `actionId`), newest first: the shared 30-run list above is
 * mostly hourly download runs, so collection runs fall out of it. Older Zoer without the filter answers with an error.
 */
export function useCollectionRuns(enabled = true) {
  return useQuery({ queryKey: COLLECTION_RUNS_KEY, enabled, retry: false, refetchInterval: 5000, queryFn: async () => {
    const lists = await Promise.all(COLLECT_ACTIONS.map(actionId => host('runs.recent', { actionId, limit: 20 }).then(result => (result?.runs ?? []) as RecentRun[])));
    return lists.flat().filter(run => COLLECT_ACTIONS.includes(run.actionId)).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  } });
}
/** The host's run list (`state`: the newest 100 runs plus every active one); null when this Zoer cannot answer. */
export const readWorkflowRuns = (): Promise<{ id: string; status: string; actionId?: string }[] | null> =>
  host('state', { summary: true }).then(state => Array.isArray(state?.runs) ? state.runs : null, () => null);
export function useWorkflowRuns(enabled = true) {
  return useQuery({ queryKey: ['catalog', 'procurement-workflow-runs'], enabled, queryFn: readWorkflowRuns, refetchInterval: 30_000 });
}
/** Saved collection presets (`presets.list`, S6). */
export function usePresets() {
  return useQuery({ queryKey: PRESETS_KEY, queryFn: async () => ((await host('presets.list', { actionId: COLLECT_ACTION }))?.presets ?? []) as Preset[], refetchInterval: 30_000, retry: false });
}

const SOURCE_IDS = ['canadabuys', ...CONNECTOR_SOURCES.map(source => source.id), BROWSER_SOURCE_ID];
const STATES_KEY = ['catalog', 'procurement-collection-states'] as const;
const readState = (value: unknown, sourceId: string) => { try { return readConnectorCollection(value, sourceId); } catch { return undefined; } };
const SHOWN = 10;

/**
 * Collection runs (Operations › Runs): one line per run in the shared run words, saying what it collected (source,
 * portals done of total, opportunities saved) and when, with details on expand and Pause, Resume and Stop for live runs.
 * It reads collection runs by action itself (`useCollectionRuns`), so a caller's newest-30 list of every action cannot
 * leave it empty; `runs` passed in are merged in (older Zoer without the action filter).
 */
export function CollectionRuns({ runs }: { runs?: RecentRun[]; error?: Error | null; loading?: boolean } = {}) {
  const client = useQueryClient(), own = useCollectionRuns();
  const [busy, setBusy] = useState(''), [failure, setFailure] = useState(''), [all, setAll] = useState(false);
  const states = useQuery({ queryKey: STATES_KEY, queryFn: () => host('catalog.workspace', { keys: SOURCE_IDS.map(connectorCollectionKey) }), refetchInterval: 15_000 });
  const merged = [...new Map([...(own.data ?? []), ...(runs ?? [])].filter(run => COLLECT_ACTIONS.includes(run.actionId)).map(run => [run.runId, run])).values()]
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  const stateOf = new Map(SOURCE_IDS.map(id => [id, states.data ? readState(states.data.entries?.find((entry: any) => entry.key === connectorCollectionKey(id))?.value, id) : undefined]));
  const act = async (run: RecentRun, method: 'run.pause' | 'run.resume' | 'cancel') => {
    setBusy(`${method}:${run.runId}`); setFailure('');
    try { await host(method, { id: run.runId }); await client.invalidateQueries({ queryKey: RUNS_KEY }); await client.invalidateQueries({ queryKey: COLLECTION_RUNS_KEY }); }
    catch (e) { setFailure(plainError((e as Error).message)); } finally { setBusy(''); }
  };
  const lastAt = [...stateOf.values()].map(state => lastCollected(state).at).filter((at): at is string => !!at).sort().at(-1) ?? null;
  const pending = own.isPending && !merged.length, unavailable = !!own.error && !merged.length;
  const shown = all ? merged : merged.slice(0, SHOWN);
  return <section className="rw-panel pc-runs" aria-labelledby="pc-runs-title">
    <header className="rw-panel-head"><h2 id="pc-runs-title">Collection runs</h2><span className="rw-muted">Each run saves portal by portal; a stopped or interrupted run continues where it stopped.</span></header>
    {unavailable ? <p className="rw-muted">Collection run history is not available from this Zoer version.{lastAt ? ` Last collection ${when(lastAt)}.` : ''}</p>
      : pending ? <p role="status">Loading runs…</p> : !merged.length ? <p className="rw-muted">{emptyRunsText(lastAt)}</p> :
    <ul className="pc-run-list pc-run-lines">{shown.map(run => {
      const row = collectionRunRow(run, { state: stateOf.get(runSourceId(run)) });
      return <li key={run.runId} data-live={isLive(run) || undefined}>
        <details>
          <summary data-zoer-disclosure=""><span className="pc-run-what"><StatusBadge tone={BADGE_TONE[row.tone]}>{row.word}</StatusBadge><strong>{row.title}</strong>{row.parts.length > 0 && <span className="pc-run-parts">{row.parts.join(' · ')}</span>}</span><time dateTime={run.createdAt}>{row.when}</time></summary>
          <ul className="pc-run-details">{row.details.map(line => <li key={line}>{line}</li>)}{row.error && <li><Hint content={row.error}><span className="pc-wrap">{plainError(row.error)}</span></Hint></li>}</ul>
        </details>
        {(row.canPause || row.canResume || row.canCancel) && <div className="pc-run-actions">
          {row.canPause && <Btn size="sm" variant="ghost" disabled={!!busy} onClick={() => void act(run, 'run.pause')}>{busy === `run.pause:${run.runId}` ? 'Pausing…' : 'Pause'}</Btn>}
          {row.canResume && <Btn size="sm" variant="ghost" disabled={!!busy} onClick={() => void act(run, 'run.resume')}>{busy === `run.resume:${run.runId}` ? 'Resuming…' : 'Resume'}</Btn>}
          {row.canCancel && <Btn size="sm" variant="ghost" disabled={!!busy} onClick={() => void act(run, 'cancel')}>{busy === `cancel:${run.runId}` ? 'Stopping…' : 'Stop'}</Btn>}
        </div>}
      </li>;
    })}</ul>}
    {merged.length > SHOWN && <Btn size="sm" variant="ghost" onClick={() => setAll(!all)}>{all ? 'Show fewer' : `Show ${count(merged.length - SHOWN)} older`}</Btn>}
    {failure && <p role="alert">{failure}</p>}
  </section>;
}
