import { Hint } from '../host-ui';
import { useCapabilities } from '../capabilities';
import { useState, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Btn, Modal, Select } from '@zoer/plugin-ui/controls';
import { buttonClassName } from '@zoer/plugin-ui/button';
import { host } from '../bridge';
import { useWorkspace } from '../backend';
import { PluginLink, SettingsLink, useDocumentGap } from './Status';
import { paged } from './status-data';
import { COLLECTION_KEY } from './source-adapters';
import { ATTACHMENT_SQL, FAILED_FILES_SQL, failedFiles, failureSummary } from './source-health';
import { CONNECTOR_SOURCES, COLLECT_ACTION, PORTAL_COUNT_SQL, portalRows, type ConnectorSource } from './source-overview';
import { SOURCE_SUMMARY_KEYS, bcCheckpoints, sourceSummary, type SourceSummary, type SourceSummaryInput } from './source-summary';
import { SCHEDULES_KEY, ScheduleControl, useSchedules } from './ScheduleControl';
import { liveRunFor, runRetryPreset, saveSourceSchedule, sourceSchedule, type RecentRun } from './source-schedules';
import { COLLECTION_RUNS_KEY, PRESETS_KEY, RUNS_KEY, useCollectionRuns, usePresets, useRecentRuns } from './CollectionRuns';
import { LINK_SOURCES, type LinkSource } from './link-sources';
import { CanadaBuysImport } from './CanadaBuysImport';
import { BrowserSourcesCard } from './BrowserSourcesCard';
import { HowCollected, SourceCard } from './SourceCard';
import { PortalTable } from './PortalTable';
import { canadaBuysReceipt, checkpointStatus, checkpointText, collectionErrorText, connectorTableRows, operationsLine } from './source-cards';
import { INVENTORY_SQL, sourceName, sql } from './display';
import { count, plural, when } from '../format';
import { BROWSER_SOURCE_ID } from './browser-sites';
import { sourceErrorText, type CollectionError } from './source-errors';
import { PublisherReviewQueue } from './PublisherReviewQueue';

const PUBLISHER_SWEEP = 'procurement.publisher.sweep';
const label = (id: string | null) => id === 'all' ? 'all sources' : id === 'canadabuys' ? 'CanadaBuys' : id ? CONNECTOR_SOURCES.find(source => source.id === id)?.label ?? sourceName(id) : 'an unknown source';

/** Operations › Sources: one card per source (saved opportunities, last collected, next run, one action), nothing else. */
export function Sources() {
  const { model } = useWorkspace(), client = useQueryClient();
  const { collection: canCollect } = useCapabilities();
  const inventory = useQuery({ queryKey: ['catalog', 'procurement-inventory'], enabled: !!model, queryFn: () => sql(INVENTORY_SQL), refetchInterval: 60000 });
  const keys = SOURCE_SUMMARY_KEYS;
  const health = useQuery({ queryKey: ['catalog', 'procurement-health', keys], queryFn: () => host('catalog.workspace', { keys }), refetchInterval: 5000 });
  const schedules = useSchedules(), presets = usePresets(), recent = useRecentRuns(), collectionRuns = useCollectionRuns();
  const runs: RecentRun[] | undefined = recent.data;
  // Collection runs come from their own by-action list; the shared newest-30 list is mostly download runs.
  const sourceRuns: RecentRun[] | undefined = collectionRuns.data || runs ? [...new Map([...(collectionRuns.data ?? []), ...(runs ?? [])].map(run => [run.runId, run])).values()] : undefined;
  // Status, last collected and next run come from the one helper Operations › Overview uses too.
  const summaryInput: SourceSummaryInput = { entries: health.data?.entries ?? (health.data ? [] : undefined), entriesError: !!health.error, runs, collectionRuns: collectionRuns.data, captureRuns: model?.captureRuns,
    schedules: schedules.data, schedulesError: !!schedules.error, presets: presets.data, presetsError: !!presets.error };
  const summary = (id: string) => sourceSummary(id, summaryInput);
  const [busy, setBusy] = useState(''), [error, setError] = useState(''), [message, setMessage] = useState(''), [batches, setBatches] = useState('5'), [importOpen, setImportOpen] = useState(false);
  const [scheduleFor, setScheduleFor] = useState('');
  const savedCount = (source: string, kind = 'opportunity') => (inventory.data ?? []).filter(row => row.sourceId === source && row.kind === kind).reduce((sum, row) => sum + Number(row.count), 0);
  const saved = (source: string, kind = 'opportunity') => inventory.error ? 'Unknown' : !inventory.data ? 'Loading…' : count(savedCount(source, kind));
  const entries = health.data?.entries ?? [];
  const entry = (key: string) => entries.find((item: any) => item.key === key)?.value;
  const collection = entry(COLLECTION_KEY);
  const checkpoints = bcCheckpoints(summaryInput), bc = summary('bc-bid');
  const importedAt = (inventory.data ?? []).filter(row => row.sourceId === 'canadabuys').map(row => row.importedAt).filter(Boolean).sort().at(-1);
  const scheduleOf = (sourceId: string) => sourceSchedule(schedules.data, presets.data, sourceId);
  /** Starts a run and returns at once: collection is a resumable job; its progress shows on the source and under Operations › Runs. */
  const start = async (key: string, begin: () => Promise<unknown>, done: string) => {
    setBusy(key); setError(''); setMessage('');
    try { await begin(); setMessage(done); await client.invalidateQueries({ queryKey: RUNS_KEY }); await client.invalidateQueries({ queryKey: COLLECTION_RUNS_KEY }); }
    catch (e) { setError((e as Error).message); await health.refetch(); } finally { setBusy(''); }
  };
  const collect = (key: string, input: Record<string, unknown>, what: string) => start(key, () => host('action', { actionId: COLLECT_ACTION, input }), `${what} collection started. Progress shows on its card and under Operations › Runs; you can leave this page.`);
  const collectCanadaBuys = (mode: 'resume' | 'restart') => collect('canadabuys', { sourceId: 'canadabuys', mode, maxBatches: Number(batches) }, 'CanadaBuys');
  const live = (sourceId: string) => liveRunFor(sourceRuns, sourceId);
  const canadaBuysRun = live('canadabuys');

  const canadaBuys = summary('canadabuys');
  const receipt = canadaBuysReceipt(collection?.receipt);
  const extraSources = [...new Set((inventory.data ?? []).filter(row => row.kind === 'opportunity').map(row => String(row.sourceId)))].filter(id => id !== 'bc-bid' && id !== 'canadabuys' && id !== BROWSER_SOURCE_ID && !CONNECTOR_SOURCES.some(source => source.id === id));

  return <section className="procurement-workspace pc-sources" aria-label="Sources">
    <OperationsLine />
    {(error || health.error || inventory.error) && <p role="alert">{error || health.error?.message || inventory.error?.message}</p>}
    {message && <p role="status">{message}</p>}
    <div className="pc-source-list">
      <SourceCard id="bc-bid" name="BC Bid" kind="British Columbia · collected in the collection browser" status={bc.status}
        saved={<>{saved('bc-bid')}{inventory.data && <small>{plural(savedCount('bc-bid', 'award'), 'award')}</small>}</>}
        last={bc.last} schedule={bc.schedule}
        action={<PluginLink to="/scraper" className={buttonClassName('secondary', 'md')}>Open BC Bid</PluginLink>}
        options={<>
          <h3>Saved progress</h3>
          <ul className="pc-checkpoints">{checkpoints.map(item => { const state = checkpointStatus(item.status); return <li key={item.key}><div><strong>{checkpointText(item)}</strong><span data-tone={state.tone}>{state.text}</span></div>{item.undated && <p>Undated awards are not verified.</p>}</li>; })}</ul>
          <p className="procurement-coverage">BC Bid collection runs in your Zoer collection browser, so its schedules are set in Zoer’s Settings with that browser. <SettingsLink section="schedules" /></p>
          {canCollect && <>
            <h3>Linked publisher checks</h3>
            <p className="procurement-coverage">Scheduled checks match saved publisher records by buyer, bid number and intake or lot. Uncertain results appear below.</p>
            <div className="procurement-actions"><Btn size="sm" variant="secondary" disabled={!!busy || runs?.some(run => run.actionId === PUBLISHER_SWEEP && ['queued', 'running', 'waiting_for_user'].includes(run.status))} onClick={() => void start('publisher-sweep', () => host('action', { actionId: PUBLISHER_SWEEP, input: { catalogOnly: true } }), 'Publisher check started. Progress shows in Zoer’s run history.')}>Match publisher notices</Btn></div>
            <ScheduleControl actionId={PUBLISHER_SWEEP} title="Publisher check schedule" input={{ catalogOnly: true }} />
            <PublisherReviewQueue />
          </>}
        </>}
        how={<HowCollected id="bc-bid"><p className="procurement-coverage">Collection times describe saved snapshots.</p></HowCollected>}>
        {checkpoints.filter(item => item.error).slice(0, 1).map(item => <Hint key={item.key} content={item.error}><p className="pc-source-error pc-wrap" role="alert">{item.label}: {collectionErrorText(item.error)}</p></Hint>)}
      </SourceCard>
      <SourceCard id="canadabuys" name="CanadaBuys" kind="Canada · official open-data file" status={busy === 'canadabuys' ? { tone: 'busy', text: 'Starting' } : canadaBuys.status} saved={saved('canadabuys')}
        last={canadaBuys.last} schedule={canadaBuys.schedule}
        action={canCollect && <Btn variant="secondary" disabled={!!busy || !!canadaBuysRun} onClick={() => void collectCanadaBuys('resume')}>{busy === 'canadabuys' ? 'Starting…' : 'Collect now'}</Btn>}
        options={<>
          <div className="procurement-actions">{canCollect && <Btn size="sm" variant="secondary" onClick={() => setScheduleFor('canadabuys')}>Schedule</Btn>}<Btn size="sm" variant="ghost" onClick={() => setImportOpen(true)}>Import CSV</Btn></div>
          {importedAt && <p className="procurement-coverage">Last CSV import {when(importedAt)}.</p>}
          {canCollect && <><div className="pc-collect-options"><label><span>Batches per run</span><Select aria-label="Collection batches" value={batches} onChange={e => setBatches(e.target.value)}>{[1, 5, 10, 20].map(n => <option key={n} value={n}>{n} batches</option>)}</Select></label><Btn size="sm" variant="secondary" disabled={!!busy || !!canadaBuysRun} onClick={() => void collectCanadaBuys('restart')}>Start a new snapshot</Btn></div>
            <p className="procurement-coverage">Start a new snapshot when CanadaBuys publishes a changed file. Saved opportunities are kept.</p></>}
          {receipt.length > 0 && <><h3>Last file</h3><dl className="pc-detail-list">{receipt.map(([name, value]) => <div key={name}><dt>{name}</dt><dd>{value}</dd></div>)}</dl>
            {typeof collection.receipt.sha256 === 'string' && <Hint content={collection.receipt.sha256}><p className="procurement-coverage">SHA-256 checksum recorded (hover or tap to see it).</p></Hint>}
            {collection.receipt.excluded?.length > 0 && <><p className="procurement-coverage">Some rows were excluded. Find them by CSV record number in the file with this checksum.</p><ul>{collection.receipt.excluded.map((item: any) => <li key={item.csvRecord}>CSV record {item.csvRecord}: {count(item.bytes)} bytes · {item.reason}</li>)}</ul></>}</>}
        </>}
        how={<HowCollected id="canadabuys" />}>
        <SourceError error={collection?.error} />
      </SourceCard>
      {CONNECTOR_SOURCES.map(source => { const item = summary(source.id); return <ConnectorCard key={source.id} source={source} summary={item} stateError={item.stateError ?? (health.error ? (health.error as Error).message : undefined)}
        saved={saved(source.id)} busy={busy} enabled={!!model} canCollect={canCollect} run={live(source.id)} loading={health.isPending}
        onCollect={(portals, key, what) => void collect(key, { sourceId: source.id, ...(portals ? { portals } : {}) }, what)}
        onRetry={problems => void start(`${source.id}:problems`, () => runRetryPreset(host, source.id, source.label, problems), `Collecting ${plural(problems.length, 'problem portal')} of ${source.label} again. Progress shows on its card.`)}
        onSchedule={() => setScheduleFor(source.id)} />; })}
      <BrowserSourcesCard run={live(BROWSER_SOURCE_ID)} />
      {/* Saved opportunities from a source this version has no card for still get one, so nothing saved goes unseen. */}
      {extraSources.map(id => <SourceCard key={id} id={id} name={sourceName(id)} kind="No collection details in this version" status={{ tone: 'idle', text: 'Saved opportunities only' }} saved={saved(id)}
        last={{ text: 'Not recorded' }} schedule="Not scheduled" action={null} how={<p className="procurement-coverage">This plugin version does not collect this source.</p>} />)}
    </div>
    {LINK_SOURCES.length > 0 && <LinkSources />}
    <AttachmentDiscovery enabled={!!model} />
    <p className="pc-sources-foot"><PluginLink to="/runs?kind=collection">Collection runs →</PluginLink></p>
    {scheduleFor && <Modal fit title={`Schedule ${label(scheduleFor)}`} mobileSheet onClose={() => setScheduleFor('')}><div className="pc-schedule-sheet">
      <ScheduleControl actionId={COLLECT_ACTION} title={`Collect ${label(scheduleFor)}`} row={scheduleOf(scheduleFor) ?? null}
        onSave={async (enabled, hours) => { await saveSourceSchedule(host, scheduleFor, label(scheduleFor), enabled, hours); await client.invalidateQueries({ queryKey: PRESETS_KEY }); await client.invalidateQueries({ queryKey: SCHEDULES_KEY }); }} />
      <p className="procurement-coverage">{scheduleFor === 'canadabuys' ? 'Each scheduled run imports the whole daily file, a few minutes at a time; it continues the same file where it stopped and starts over when CanadaBuys publishes a new one. '
        : `Each scheduled run collects every portal, one at a time, as each site’s robots.txt and Zoer’s pacing allow. A portal that asks to slow down is retried later in the same run; one failing portal does not stop the others. `}Each source has its own schedule (a saved collection in Zoer). A scheduled run waits while another run of this plugin is active. Updated Zoer hosts preserve schedules through compatible plugin updates. A failed run or a change to the scheduled action, permissions or settings turns the schedule off until you review it.</p>
    </div></Modal>}
    {importOpen && <CanadaBuysImport onClose={() => setImportOpen(false)} onImported={() => { void client.invalidateQueries({ queryKey: ['catalog'] }); }} />}
  </section>;
}

/**
 * The page's one line about operations, with the shared counts (schedule summary, document gap, failure queue): the full
 * state and the "Turn on" actions live on Operations › Overview; failed downloads open in Opportunities › Files.
 */
function OperationsLine() {
  const { model } = useWorkspace(), schedules = useSchedules(), gap = useDocumentGap(!!model);
  const failures = useQuery({ queryKey: ['catalog', 'procurement-source-failed-files'], enabled: !!model, refetchInterval: 60_000, queryFn: async () => failureSummary(failedFiles(await paged(FAILED_FILES_SQL, []))) });
  const parts = operationsLine({ schedules: schedules.data, missingFiles: gap.data ? gap.data.links - gap.data.saved : undefined, failedFiles: failures.data?.files });
  if (!parts.length) return null;
  return <p className="pc-ops-line">{parts.map((part, i) => <span key={part.text}>{i > 0 && ' · '}{part.to ? <PluginLink to={part.to}>{part.text}</PluginLink> : part.text}</span>)}<span className="pc-ops-link"><PluginLink to="/status">Operations overview →</PluginLink></span></p>;
}

/** A source's last error in plain words; the saved code and message stay one tap away for bug reports. */
function SourceError({ error }: { error: CollectionError | null | undefined }) {
  const explained = sourceErrorText(error);
  if (!explained) return null;
  return <div className="pc-source-error" role="alert"><p>{explained.text}</p>{explained.detail !== explained.text && <details><summary data-zoer-disclosure="">Details</summary><p><code>{explained.detail}</code></p></details>}</div>;
}

/** A platform with many portals: the same card as every source, with its portal table collapsed unless a portal has a problem. */
function ConnectorCard({ source, summary, stateError, saved, busy, enabled, canCollect, run, loading, onCollect, onRetry, onSchedule }: {
  source: ConnectorSource; summary: SourceSummary; stateError?: string; saved: string; busy: string; enabled: boolean; canCollect: boolean; run?: RecentRun; loading: boolean;
  onCollect: (portals: string[] | null, key: string, what: string) => void; onRetry: (portals: string[]) => void; onSchedule: () => void;
}) {
  const counts = useQuery({ queryKey: ['catalog', 'procurement-portal-counts', source.id], enabled, queryFn: async () => new Map((await sql(PORTAL_COUNT_SQL, [source.id])).map(row => [String(row.portalId), Number(row.count)])), refetchInterval: 60_000 });
  const state = summary.state, rows = portalRows(source.portals, state, counts.data), status = summary.status;
  const running = busy.startsWith(source.id) || !!run, problems = rows.filter(row => row.problem).map(row => row.id), starting = busy.startsWith(source.id);
  return <SourceCard id={source.id} name={source.label} kind={source.region} status={starting ? { tone: 'busy', text: 'Starting' } : loading && !run ? { tone: 'idle', text: 'Loading…' } : status}
    saved={saved} last={loading ? { text: 'Loading…' } : summary.last} schedule={summary.schedule}
    action={canCollect && <Btn variant="secondary" disabled={!!busy || running} onClick={() => onCollect(null, source.id, source.label)}>{busy === source.id ? 'Starting…' : 'Collect now'}</Btn>}
    options={canCollect && <div className="procurement-actions">
      {problems.length > 0 && problems.length < rows.length && <Btn size="sm" variant="secondary" disabled={!!busy || running} onClick={() => onRetry(problems)}>{busy === `${source.id}:problems` ? 'Starting…' : `Collect ${plural(problems.length, 'problem portal')} again`}</Btn>}
      <Btn size="sm" variant="secondary" onClick={onSchedule}>Schedule</Btn>
    </div>}
    how={<HowCollected id={source.id} coverage={source.coverage} />}>
    {stateError && <p role="alert">Collection state could not be read: {stateError}</p>}
    <SourceError error={state?.error} />
    {counts.error && <p role="alert">Saved counts per portal could not be read: {(counts.error as Error).message}</p>}
    <PortalTable rows={connectorTableRows(rows)} noun="portal" known={state !== undefined} countsError={!!counts.error} disabled={!!busy || running}
      starting={row => busy === `${source.id}:${row.id}`} onCollect={canCollect ? row => onCollect([row.id], `${source.id}:${row.id}`, row.label) : undefined} />
  </SourceCard>;
}

/** Why a site is listed here, grouped: robots.txt first, then layouts not built yet, then sites that post elsewhere. */
const linkGroup = (item: LinkSource) => /robots\.txt/i.test(item.reason ?? '') ? 'Their robots.txt forbids collection'
  : /posts on|external platform/i.test(item.reason ?? '') ? 'They post their bids elsewhere'
  : /nothing open/i.test(item.reason ?? '') ? 'Nothing open yet to check a reader against' : 'Their page layout is not supported yet';
const LINK_GROUPS = ['Their robots.txt forbids collection', 'Their page layout is not supported yet', 'They post their bids elsewhere', 'Nothing open yet to check a reader against'];

/** Sites we do not collect from; people check them directly. Listed once, grouped by reason, collapsed. */
function LinkSources() {
  const [query, setQuery] = useState('');
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const shown = LINK_SOURCES.filter(item => words.every(word => `${item.label} ${item.region ?? ''} ${item.reason ?? ''}`.toLowerCase().includes(word)));
  return <details id="pc-src-links" className="pc-source-card pc-source-extra">
    <summary data-zoer-disclosure=""><h2>Check these yourself</h2><span className="rw-muted">{plural(LINK_SOURCES.length, 'site')} Zoer does not collect from</span></summary>
    <p className="procurement-coverage">Open them to look for new opportunities.</p>
    {LINK_SOURCES.length > 8 && <label className="pc-portal-search"><span className="sr-only">Search sites</span><input type="search" placeholder={`Search ${plural(LINK_SOURCES.length, 'site')}`} value={query} onChange={e => setQuery(e.target.value)} /></label>}
    {LINK_GROUPS.map(group => { const items = shown.filter(item => linkGroup(item) === group); return items.length > 0 && <section key={group} aria-label={group}>
      <h3>{group} ({count(items.length)})</h3>
      <ul className="pc-link-sources">{items.map(item => <li key={item.id}><a href={item.url} target="_blank" rel="noreferrer"><span>{item.label} ↗</span><small>{[item.region, item.reason].filter(Boolean).join(' · ')}</small></a></li>)}</ul>
    </section>; })}
  </details>;
}

const ATTACHMENT_COLUMNS: [string, string, string][] = [
  ['notChecked', 'Not checked', 'No attachment list saved and no file downloaded (the same rule as the Acquire evidence queue).'],
  ['checkedNoLinks', 'No files', 'Checked; the opportunity lists no attachment links.'],
  ['withLinks', 'Links saved', 'At least one attachment link is saved.'],
  ['withFiles', 'Downloaded', 'At least one file is downloaded.'],
  ['noText', 'No text', 'A file is downloaded but no usable text was extracted from it.'],
];
/** Attachment discovery per source (opportunities, open and closed), collapsed: what each source's notices link to. */
function AttachmentDiscovery({ enabled }: { enabled: boolean }) {
  const [open, setOpen] = useState(false);
  const attachments = useQuery({ queryKey: ['catalog', 'procurement-source-attachments'], enabled: enabled && open, queryFn: () => sql(ATTACHMENT_SQL), refetchInterval: 120_000 });
  const name = (id: string): ReactNode => id === 'bc-bid' ? 'BC Bid' : CONNECTOR_SOURCES.find(source => source.id === id)?.label ?? sourceName(id);
  return <details className="pc-source-card pc-source-extra" onToggle={event => setOpen((event.currentTarget as HTMLDetailsElement).open)}>
    <summary data-zoer-disclosure=""><h2>Attachment discovery</h2><span className="rw-muted">Opportunities per source by what their attachments reached</span></summary>
    {attachments.error ? <p role="alert">Attachment coverage could not be read: {(attachments.error as Error).message}</p> : attachments.isPending ? <p role="status">Checking saved attachment coverage…</p> :
      <div className="rw-table-wrap"><table className="rw-table rw-text">
        <thead><tr><th scope="col">Source</th>{ATTACHMENT_COLUMNS.map(([key, text, hint]) => <th key={key} scope="col"><Hint content={hint}><span>{text}</span></Hint></th>)}</tr></thead>
        <tbody>{(attachments.data ?? []).map(row => <tr key={row.sourceId}><th scope="row">{name(String(row.sourceId))}</th>{ATTACHMENT_COLUMNS.map(([key]) => <td key={key}>{count(Number(row[key]) || 0)}</td>)}</tr>)}</tbody>
      </table></div>}
    <p className="rw-note">Counts are opportunities (each source keeps its own copies of BC Bid notices), open and closed.</p>
  </details>;
}
