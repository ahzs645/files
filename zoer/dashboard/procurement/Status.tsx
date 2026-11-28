import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Btn } from '@zoer/plugin-ui/controls';
import { host } from '../bridge';
import { useWorkspace } from '../backend';
import { useCapabilities } from '../capabilities';
import { assertDocumentBrowserIdle } from '../document-run';
import { plainError } from '../error-text';
import { hostHref, usePluginLocation } from '../navigation';
import { StatusBadge, type Tone as BadgeTone } from '../host-ui';
import { count as n } from '../format';
import { INVENTORY_SQL, sourceName, sql } from './display';
import { PluginLink, SettingsLink } from './links';
import { scheduleLabel, type ScheduleRow } from './schedule-state';
import { useSchedules } from './ScheduleControl';
import { RUNS_KEY, useCollectionRuns, usePresets, useRecentRuns, useWorkflowRuns } from './CollectionRuns';
import { STATUS_SOURCES } from './status-data';
import { sourceSummary, type SourceSummaryInput } from './source-summary';
import { ScheduleValue } from './SourceCard';
import { BATCH_SQL, type BatchRow } from './source-health';
import { runState, type Preset } from './source-schedules';
import { batchProgress, runOutcome, runningNow, runsHref, scheduleLine, scheduleSections, runGroup, type Need, type Outcome, type RunGroup } from './overview-data';
import { useCollectionEntries, useOverviewStatus } from './overview-hooks';
import { StoppedSchedules } from './schedule-actions';
import { CoveragePanel } from '../review-workspace/CoveragePanel';
import type { StepAction } from './status-checklist';
import './status.css';

// Other pages import these from here.
export { PluginLink, SettingsLink } from './links';
export { useDocumentGap, useLastCollections, useSetupStatus } from './overview-hooks';

const TONE: Record<string, BadgeTone> = { good: 'success', warn: 'warning', busy: 'running', idle: 'neutral' };

/** Starts the one run a "Needs you" row offers: download the missing files of open BC Bid notices, or capture missing details. */
function useRunNow() {
  const client = useQueryClient(), [busy, setBusy] = useState(''), [error, setError] = useState(''), [message, setMessage] = useState('');
  const run = async (key: StepAction) => {
    setBusy(key); setError(''); setMessage('');
    try {
      await assertDocumentBrowserIdle(host, key === 'download-missing' ? 'download' : 'capture');
      if (key === 'download-missing') { await host('action', { actionId: 'documents.download.queue', input: { scope: 'open' } }); setMessage('Downloading the missing files of open BC Bid notices, soonest closing first. It shows under Running now.'); }
      else { await host('action', { actionId: 'scrape.details', input: { missing: { limit: 50 } } }); setMessage('Capturing missing or incomplete details for up to 50 open BC Bid notices. It shows under Running now.'); }
      await client.invalidateQueries({ queryKey: RUNS_KEY }); await client.invalidateQueries({ queryKey: ['catalog', 'procurement-workflow-runs'] });
    } catch (e) { setError(plainError((e as Error).message)); } finally { setBusy(''); }
  };
  return { busy, error, message, run };
}

/** Run lists now live on Operations › Runs; this stays for pages that still render it. */
export function RunLinks({ compact = false, except }: { compact?: boolean; except?: string }) {
  const location = usePluginLocation();
  if (except === '/runs' || location.split('?')[0] === '/runs') return null;
  return <p className={compact ? 'pc-run-links rw-muted' : 'rw-muted'}>Every run list is under <PluginLink to="/runs">Operations › Runs</PluginLink>.</p>;
}

/** Operations › Overview (`/status`): what needs you, what is running, the sources, schedules, coverage and last outcomes. */
export function Status() {
  const { writes, collection } = useCapabilities(), status = useOverviewStatus(), presets = usePresets(), runNow = useRunNow();
  const { overview } = status, checkPending = overview.needs.some(need => need.id === 'browsers' && need.title === 'Browser check');
  return <section className="procurement-workspace pc-status-page" aria-labelledby="pc-status-title">
    <header className="pc-status-head">
      <div><h1 id="pc-status-title">Overview</h1><p className="rw-muted">What is running, what is stuck, and what needs you.</p></div>
    </header>
    <p className="pc-ov-verdict" role="status"><StatusBadge tone={overview.needs.length ? 'warning' : overview.unknown.length ? 'neutral' : 'success'}>{overview.verdict}</StatusBadge></p>
    {runNow.error && <p role="alert" className="pc-wrap">{runNow.error}</p>}{runNow.message && <p role="status">{runNow.message}</p>}

    <section className="rw-panel" aria-labelledby="pc-ov-needs">
      <header className="rw-panel-head"><h2 id="pc-ov-needs">Needs you</h2></header>
      {overview.needs.length === 0 ? <p className="rw-muted">{overview.unknown.length ? 'Nothing so far; some checks are still loading or not reported.' : 'Nothing needs you right now.'}</p> :
        <ol className="pc-checklist">{overview.needs.map(need => <NeedRow key={need.id} need={need} rows={status.schedules.data ?? []} presets={presets.data} writes={writes} runNow={runNow} checkPending={checkPending} />)}</ol>}
      {overview.clear.length > 0 && <details className="pc-ov-clear"><summary data-zoer-disclosure="">All clear ({overview.clear.length})</summary>
        <ul className="pc-status-schedules">{overview.clear.map(step => <li key={step.id}><div className="pc-step-title"><strong>{step.title}</strong><StatusBadge tone={TONE[step.tone]} variant="dot">{step.status}</StatusBadge></div>{step.detail && <p className="rw-muted pc-wrap">{step.detail}</p>}</li>)}</ul>
      </details>}
      {overview.unknown.length > 0 && <p className="rw-muted pc-wrap">Not known yet: {overview.unknown.map(step => `${step.title} (${step.status.replace(/…$/, '').toLowerCase()})`).join(' · ')}.</p>}
    </section>

    {collection && <RunningNow />}
    {collection && <SourcesGlance rows={status.schedules.data} rowsError={!!status.schedules.error} presets={presets.data} presetsError={!!presets.error} />}
    <SchedulesPanel rows={status.schedules.data} error={status.schedules.error as Error | null} presets={presets.data} />
    <CoveragePanel />
    {collection && <LastOutcomes />}
  </section>;
}

function NeedRow({ need, rows, presets, writes, runNow, checkPending }: { need: Need; rows: ScheduleRow[]; presets?: Preset[]; writes: boolean; runNow: ReturnType<typeof useRunNow>; checkPending: boolean }) {
  const action = (item: StepAction) => {
    if (item === 'open-browser') return <a key={item} className="procurement-link" href={hostHref('#/browsers')}>Open the browser in Zoer</a>;
    if (item === 'settings-browsers') return <SettingsLink key={item} section="browsers" />;
    if (item === 'settings-schedules') return null; // The grouped list below carries its own Settings link.
    if (!writes) return null;
    // Downloads stop at a pending browser check, so starting one now would only stop there again.
    if (item === 'download-missing' && checkPending) return <span key={item} className="rw-muted">Downloads wait for the browser check above.</span>;
    const label = item === 'download-missing' ? 'Download missing files' : 'Capture missing details now';
    return <Btn key={item} size="sm" variant="secondary" disabled={!!runNow.busy} onClick={() => void runNow.run(item)}>{runNow.busy === item ? 'Starting…' : label}</Btn>;
  };
  return <li data-tone="warn">
    <span className="pc-step-mark" aria-hidden="true">!</span>
    <div className="pc-step-body">
      <div className="pc-step-title"><strong>{need.title}</strong><StatusBadge tone="warning">{need.status}</StatusBadge></div>
      {need.id !== 'schedules' && need.lines.map(line => <p key={line} className="pc-wrap">{line}</p>)}
      {need.id === 'schedules' && <StoppedSchedules rows={rows} presets={presets} writes={writes} />}
      <div className="pc-step-actions">{need.actions.map(action)}{need.owner && <PluginLink to={need.owner.to}>{`Open ${need.owner.label}`}</PluginLink>}</div>
    </div>
  </li>;
}

/** Live runs only: a run counts while its workflow run is active in Zoer's run list (never a batch left marked running). */
function RunningNow() {
  const { model } = useWorkspace(), collectionRuns = useCollectionRuns();
  const runs = useWorkflowRuns();
  const batches = useQuery({ queryKey: ['catalog', 'procurement-source-batches'], queryFn: () => sql(BATCH_SQL) as Promise<BatchRow[]>, refetchInterval: 15_000 });
  const list = runs.data === undefined ? (model?.workflowRuns ?? undefined) : runs.data;
  const progress: Record<string, string | null> = {};
  for (const run of collectionRuns.data ?? []) { const state = runState(run); if (state) progress[run.runId] = [state.text, state.detail].filter(Boolean).join(' · '); }
  for (const batch of batches.data ?? []) progress[batch.id] ??= batchProgress(batch);
  const now = runningNow(list, progress);
  return <section className="rw-panel" aria-labelledby="pc-ov-running">
    <header className="rw-panel-head"><h2 id="pc-ov-running">Running now</h2><PluginLink to="/runs">Open Operations › Runs</PluginLink></header>
    {list === undefined ? <p className="rw-muted" role="status">Loading runs…</p> : !now.known ? <p className="rw-muted">This Zoer version does not report running runs.</p> : !now.items.length ? <p className="rw-muted">Nothing running.</p> :
      <ul className="pc-status-schedules">{now.items.map(item => <li key={item.id}>
        <div className="pc-step-title"><strong>{item.label}</strong><StatusBadge tone={item.state === 'Waiting for you' ? 'warning' : 'running'} variant="dot">{item.state}</StatusBadge></div>
        <p className="rw-muted pc-wrap">{[item.progress, item.since].filter(Boolean).join(' · ')} · <PluginLink to={runsHref(item.group)}>{runListName(item.group)}</PluginLink></p>
      </li>)}</ul>}
  </section>;
}
const runListName = (group: RunGroup) => ({ collection: 'Collection runs', 'bc-bid': 'BC Bid runs', downloads: 'Download runs', extraction: 'Text extraction runs', reviews: 'AI review runs', other: 'All runs' })[group];

/**
 * One compact row per source: status, saved, last collected, next run. The words come from the same helper as the cards
 * on Operations › Sources (source-summary.ts), so both pages say the same thing. Actions live on Sources.
 */
function SourcesGlance({ rows, rowsError, presets, presetsError }: { rows?: ScheduleRow[]; rowsError: boolean; presets?: Preset[]; presetsError: boolean }) {
  const { model } = useWorkspace(), recent = useRecentRuns(), collectionRuns = useCollectionRuns(), entries = useCollectionEntries();
  const inventory = useQuery({ queryKey: ['catalog', 'procurement-inventory'], queryFn: () => sql(INVENTORY_SQL), refetchInterval: 60_000 });
  const input: SourceSummaryInput = { entries: entries.data?.entries ?? (entries.data ? [] : undefined), entriesError: !!entries.error, runs: recent.data ?? (recent.error ? [] : undefined),
    collectionRuns: collectionRuns.data, captureRuns: model?.captureRuns, schedules: rows, schedulesError: rowsError, presets, presetsError };
  const saved = (id: string) => inventory.error ? 'Unknown' : !inventory.data ? '…' : n((inventory.data ?? []).filter(row => row.sourceId === id && row.kind === 'opportunity').reduce((sum, row) => sum + Number(row.count), 0));
  return <section className="rw-panel" aria-labelledby="pc-ov-sources">
    <header className="rw-panel-head"><h2 id="pc-ov-sources">Sources at a glance</h2><PluginLink to="/sources">Open Operations › Sources</PluginLink></header>
    <table className="pc-ov-table">
      <thead><tr><th scope="col">Source</th><th scope="col">Status</th><th scope="col">Saved</th><th scope="col">Last collected</th><th scope="col">Next run</th></tr></thead>
      <tbody>{STATUS_SOURCES.map(id => { const item = sourceSummary(id, input); return <tr key={id}>
        <th scope="row"><PluginLink to={id === 'bc-bid' ? '/scraper' : '/sources'}>{sourceName(id)}</PluginLink></th>
        <td data-label="Status"><StatusBadge tone={TONE[item.status.tone] ?? 'neutral'} variant="dot">{item.status.text}</StatusBadge></td>
        <td data-label="Saved">{saved(id)}</td>
        <td data-label="Last collected">{item.last.text}{item.last.note && <small className="rw-muted pc-ov-note">{item.last.note}</small>}</td>
        <td data-label="Next run"><ScheduleValue slot={item.schedule} compact /></td>
      </tr>; })}</tbody>
    </table>
  </section>;
}

/** The one schedule list, grouped Needs review / Off / On; collapsed to "N of M on" when none needs review. */
function SchedulesPanel({ rows, error, presets }: { rows?: ScheduleRow[]; error: Error | null; presets?: Preset[] }) {
  const sections = scheduleSections(rows), name = (row: ScheduleRow) => scheduleLabel(row, presets, sourceName);
  // Needs review rows are one line each: their reasons and last runs are under Needs you.
  const group = (title: string, list: ScheduleRow[], compact = false) => list.length > 0 && <>
    <h3>{title} ({list.length})</h3>
    <ul className={`pc-status-schedules${compact ? ' pc-ov-compact' : ''}`}>{list.map((row, i) => { const line = scheduleLine(row); return <li key={`${row.actionId}:${row.presetId ?? i}`}>
      <div className="pc-step-title"><strong>{name(row)}</strong><StatusBadge tone={TONE[line.tone]} variant="dot">{line.status}</StatusBadge></div>
      {!compact && line.detail && <p className="rw-muted pc-wrap">{line.detail}</p>}
    </li>; })}</ul>
  </>;
  const body = <>{group('Needs review', sections.review, true)}{group('Off', sections.off)}{group('On', sections.on)}</>;
  return <section className="rw-panel" aria-labelledby="pc-status-schedules">
    <header className="rw-panel-head"><h2 id="pc-status-schedules">Schedules</h2><SettingsLink section="schedules" /></header>
    {error ? <p role="alert">Schedules could not be read: {plainError(error.message)}</p> : !rows ? <p role="status" className="rw-muted">Loading schedules…</p> : !rows.length ? <p className="rw-muted">No schedules saved.</p> :
      sections.review.length ? <><p className="rw-muted">{sections.summary}; {sections.review.length} need{sections.review.length === 1 ? 's' : ''} review (reasons under Needs you).</p>{body}</> :
      <details><summary data-zoer-disclosure="">{sections.summary}</summary>{body}</details>}
  </section>;
}

const BATCH_GROUPS: Record<string, RunGroup> = { download: 'downloads', extract: 'extraction' };
const LIVE_BATCH = ['running', 'paused', 'waiting_for_user', 'pending', 'queued'];
/** Last outcome of each run list, from the same reads as Runs and Sources; each links to its list. */
function LastOutcomes() {
  const { model } = useWorkspace(), { writes, ai } = useCapabilities(), collectionRuns = useCollectionRuns();
  const batches = useQuery({ queryKey: ['catalog', 'procurement-source-batches'], queryFn: () => sql(BATCH_SQL) as Promise<BatchRow[]>, refetchInterval: 15_000 });
  const runs = useWorkflowRuns();
  const runList: { id: string; status: string }[] | null | undefined = runs.data;
  // A batch left marked running after its run ended shows the run's real outcome (populations.ts "Running").
  const batchRuns = (group: RunGroup) => batches.data ? batches.data.filter(row => (BATCH_GROUPS[row.kind] ?? 'reviews') === group).map(row => {
    const run = runList?.find(item => item.id === row.id), stale = LIVE_BATCH.includes(row.status) && !!runList && !(run && !['succeeded', 'failed', 'cancelled', 'outcome_unknown'].includes(run.status));
    return { status: stale ? run?.status ?? 'outcome_unknown' : row.status, createdAt: row.updated_at, error: row.error };
  }) : batches.error ? null : undefined;
  const bcRuns = ((model?.captureRuns ?? []) as any[]).filter(run => runGroup(run.actionId) === 'bc-bid').map(run => ({ status: run.status, createdAt: run.createdAt, finishedAt: run.completedAt ?? run.finishedAt, error: run.error }));
  const rows: (Outcome | null)[] = [
    collectionRuns.data || collectionRuns.error ? runOutcome('collection', collectionRuns.error ? null : collectionRuns.data) : null,
    model ? runOutcome('bc-bid', bcRuns) : null,
    // Batches are read newest 200 first, so an empty list means "none recently", not "never".
    ...(['downloads', 'extraction', ...(writes && ai ? ['reviews'] : [])] as RunGroup[]).map(group => { const list = batchRuns(group); return list === undefined ? null : list?.length === 0 ? { ...runOutcome(group, list), status: 'None recently', detail: 'None among the 200 most recent runs.' } : runOutcome(group, list); }),
  ];
  return <section className="rw-panel" aria-labelledby="pc-ov-outcomes">
    <header className="rw-panel-head"><h2 id="pc-ov-outcomes">Last outcome by run type</h2></header>
    <ul className="pc-status-schedules">{rows.map((row, i) => !row ? <li key={i}><p className="rw-muted" role="status">Loading…</p></li> : <li key={row.group}>
      <div className="pc-step-title"><PluginLink to={runsHref(row.group)}>{row.title}</PluginLink><StatusBadge tone={TONE[row.tone]} variant="dot">{row.status}</StatusBadge></div>
      <p className="rw-muted pc-wrap">{[row.at, row.detail && plainError(row.detail), row.lastDone].filter(Boolean).join(' · ') || 'No runs recorded yet.'}</p>
    </li>)}</ul>
  </section>;
}

/** Home used to show this card; it now shows one line (review-workspace/OperationsLine.tsx). Kept as that line for older imports. */
export function StatusCard() {
  const { overview } = useOverviewStatus();
  if (!overview.needs.length) return null;
  return <p className="rw-ops-line"><PluginLink to="/status">{`Operations: ${overview.verdict} →`}</PluginLink></p>;
}

