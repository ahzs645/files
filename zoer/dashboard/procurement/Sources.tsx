import { useState, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Btn, Modal, Select } from '@zoer/plugin-ui/controls';
import { host } from '../bridge';
import { useWorkspace } from '../backend';
import { hostHref, navigatePlugin } from '../navigation';
import { runProcurementAction } from './state-client';
import { PROCUREMENT_SOURCE_ADAPTERS, COLLECTION_KEY } from './source-adapters';
import { CAPABILITY_TEXT, attachmentStates, batchHealth, bcCheckpointHealth, capabilityMatrix, groupFailures, type BatchRow, type FailureTask } from './source-health';
import { CONNECTOR_SOURCES, COLLECT_ACTION, COLLECT_ALL, PORTAL_COUNT_SQL, collectTarget, collectionKey, connectorStatus, filterPortals, portalRows, portalSummary, portalSummaryText, readConnectorCollection, scheduleCovers, scheduleTargetFor, scheduledCollectInput, type ConnectorCollection, type ConnectorSource, type Tone } from './source-overview';
import { findSchedule, intervalText, scheduleState, type ScheduleRow } from './schedule-state';
import { ScheduleBadge, ScheduleControl, useSchedules } from './ScheduleControl';
import { LINK_SOURCES } from './link-sources';
import { CanadaBuysImport } from './CanadaBuysImport';
import { BrowserSourcesCard } from './BrowserSourcesCard';
import { INVENTORY_SQL, sourceName, sql } from './display';
import { shortError } from '../error-text';
import { sourceErrorText, type CollectionError } from './source-errors';

const BC_CHECKPOINTS = [['checkpoint:full', 'Current opportunities'], ['checkpoint:awards', 'Historical awards'], ['checkpoint:awards:recent', 'Recent awards']] as const;
const when = (value: unknown) => typeof value === 'string' && Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : typeof value === 'number' ? new Date(value).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : 'Never';
const label = (id: string | null) => id === 'all' ? 'all sources' : id ? CONNECTOR_SOURCES.find(source => source.id === id)?.label ?? sourceName(id) : 'an unknown source';
/** "every day for CanadaBuys", for the one-schedule-per-action notice. */
const describeCollect = (row: ScheduleRow) => `collect ${label(collectTarget(row))} ${intervalText(row.intervalHours).toLowerCase()}`;
const scrollTo = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });

function Card({ id, name, region, status, tone, stats, actions, children, wide }: { id: string; name: string; region: string; status: string; tone: Tone; stats: [string, ReactNode][]; actions: ReactNode; children?: ReactNode; wide?: boolean }) {
  return <article id={`pc-src-${id}`} className="pc-source-card" data-wide={wide || undefined} aria-label={name}>
    <header><div><h2>{name}</h2><p>{region}</p></div><span className="pc-status" data-tone={tone}>{status}</span></header>
    <dl className="pc-source-stats">{stats.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
    <div className="procurement-actions">{actions}</div>
    {children}
  </article>;
}
function Capabilities({ id }: { id: string }) {
  const adapter = PROCUREMENT_SOURCE_ADAPTERS.find(source => source.id === id);
  if (!adapter) return null;
  return <details><summary>Connector details</summary><p className="procurement-coverage">{adapter.coverage}</p><dl className="pc-detail-list">{Object.entries(adapter.capabilities).map(([name, value]) => <div key={name}><dt>{name} · {value.status}</dt><dd>{value.method}</dd></div>)}</dl>{adapter.documentation && <a className="procurement-link" href={adapter.documentation} target="_blank" rel="noreferrer">Source documentation ↗</a>}</details>;
}

type OverviewRow = { id: string; name: string; region: string; tone: Tone; status: string; saved: string; lastSuccess: string; next: ReactNode; action: ReactNode };
/** One row per source: phone shows stacked cards, desktop a table (CSS only; same markup). */
function Overview({ rows, schedule }: { rows: OverviewRow[]; schedule?: ReactNode }) {
  return <section className="rw-panel pc-overview" aria-labelledby="pc-overview-title">
    <header className="rw-panel-head"><h2 id="pc-overview-title">Sources</h2><span className="rw-muted">{rows.length} sources · saved counts are notices in Zoer, not portal totals</span>{schedule}</header>
    <table className="pc-rtable">
      <thead><tr><th scope="col">Source</th><th scope="col">Status</th><th scope="col">Saved notices</th><th scope="col">Last successful collection</th><th scope="col">Next scheduled run</th><th scope="col"><span className="sr-only">Action</span></th></tr></thead>
      <tbody>{rows.map(row => <tr key={row.id}>
        <th scope="row"><button type="button" className="pc-link-button" onClick={() => scrollTo(`pc-src-${row.id}`)}>{row.name}</button><small>{row.region}</small></th>
        <td data-label="Status"><span className="pc-status" data-tone={row.tone}>{row.status}</span></td>
        <td data-label="Saved">{row.saved}</td>
        <td data-label="Last success">{row.lastSuccess}</td>
        <td data-label="Next run">{row.next}</td>
        <td className="pc-rtable-action">{row.action}</td>
      </tr>)}</tbody>
    </table>
  </section>;
}

/** Where saved notices come from, how fresh they are, when they are collected next, and how to collect more. */
export function Sources() {
  const { model } = useWorkspace(), client = useQueryClient();
  const inventory = useQuery({ queryKey: ['catalog', 'procurement-inventory'], enabled: !!model, queryFn: () => sql(INVENTORY_SQL), refetchInterval: 60000 });
  const keys = [COLLECTION_KEY, ...BC_CHECKPOINTS.map(([key]) => key), ...CONNECTOR_SOURCES.map(source => collectionKey(source.id))];
  const health = useQuery({ queryKey: ['catalog', 'procurement-health', keys], queryFn: () => host('catalog.workspace', { keys }), refetchInterval: 5000 });
  const schedules = useSchedules();
  const [busy, setBusy] = useState(''), [error, setError] = useState(''), [message, setMessage] = useState(''), [batches, setBatches] = useState('5'), [importOpen, setImportOpen] = useState(false);
  const [scheduleFor, setScheduleFor] = useState('');
  const saved = (source: string, kind = 'opportunity') => inventory.error ? 'Unknown' : !inventory.data ? 'Loading…' : (inventory.data ?? []).filter(row => row.sourceId === source && row.kind === kind).reduce((sum, row) => sum + Number(row.count), 0).toLocaleString();
  const entries = health.data?.entries ?? [];
  const entry = (key: string) => entries.find((item: any) => item.key === key)?.value;
  const collection = entry(COLLECTION_KEY);
  const checkpoints = BC_CHECKPOINTS.map(([key, label]) => ({ key, label, ...bcCheckpointHealth(key, entry(key)) }));
  const runs = model?.runs ?? [], active = runs.find((run: any) => ['running', 'stopping'].includes(run.status)), lastGood = runs.find((run: any) => run.status === 'succeeded');
  const bcIssue = checkpoints.some(item => item.error);
  const importedAt = (inventory.data ?? []).filter(row => row.sourceId === 'canadabuys').map(row => row.importedAt).filter(Boolean).sort().at(-1);
  // Per-connector state; `undefined` while unread or unreadable (shown as unknown), `null` when never collected.
  const connectors = new Map<string, { state: ConnectorCollection | null | undefined; error?: string }>(CONNECTOR_SOURCES.map(source => {
    if (!health.data) return [source.id, { state: undefined }];
    try { return [source.id, { state: readConnectorCollection(entry(collectionKey(source.id)), source.id) }]; } catch (e) { return [source.id, { state: undefined, error: (e as Error).message }]; }
  }));
  const collectSchedule = findSchedule(schedules.data, COLLECT_ACTION), bcSchedule = findSchedule(schedules.data, 'scrape.full');
  const nextRun = (sourceId: string): ReactNode => schedules.error ? 'Unknown' : schedules.isPending ? 'Loading…' : scheduleCovers(collectSchedule, sourceId) ? <ScheduleBadge row={collectSchedule} /> : 'Not scheduled';
  const collect = async (key: string, input: Record<string, unknown>, done: string) => {
    setBusy(key); setError(''); setMessage('');
    try { await runProcurementAction(COLLECT_ACTION, input); await client.invalidateQueries({ queryKey: ['catalog'] }); setMessage(done); }
    catch (e) { setError((e as Error).message); await health.refetch(); } finally { setBusy(''); }
  };
  const collectCanadaBuys = (mode: 'resume' | 'restart') => collect('canadabuys', { sourceId: 'canadabuys', mode, maxBatches: Number(batches) }, 'CanadaBuys collection finished. Check the receipt for coverage.');

  const overview: OverviewRow[] = [
    { id: 'bc-bid', name: 'BC Bid', region: 'British Columbia · browser scraping', tone: active ? 'busy' : bcIssue ? 'warn' : lastGood ? 'good' : 'idle', status: active ? 'Scraping now' : bcIssue ? 'Needs attention' : lastGood ? 'Up to date' : 'Not scraped yet',
      saved: saved('bc-bid'), lastSuccess: when(lastGood?.completedAt ?? lastGood?.startedAt), next: schedules.error ? 'Unknown' : schedules.isPending ? 'Loading…' : bcSchedule ? <ScheduleBadge row={bcSchedule} /> : 'Not scheduled',
      action: <Btn size="sm" variant="secondary" onClick={() => navigatePlugin('/bc-bid-dashboard')}>Open BC Bid</Btn> },
    { id: 'canadabuys', name: 'CanadaBuys', region: 'Canada · official dataset', tone: busy === 'canadabuys' ? 'busy' : collection?.error ? 'warn' : collection?.lastSuccessAt ? 'good' : 'idle', status: busy === 'canadabuys' ? 'Collecting' : !health.data ? 'Status unknown' : collection?.error ? 'Needs attention' : collection?.lastSuccessAt ? 'Collected' : 'Not collected',
      saved: saved('canadabuys'), lastSuccess: health.data ? when(collection?.lastSuccessAt) : 'Unknown', next: nextRun('canadabuys'),
      action: <Btn size="sm" variant="secondary" disabled={!!busy} onClick={() => void collectCanadaBuys('resume')}>{busy === 'canadabuys' ? 'Collecting…' : 'Collect'}</Btn> },
    ...CONNECTOR_SOURCES.map((source): OverviewRow => {
      const { state } = connectors.get(source.id)!, status = connectorStatus(state), running = busy.startsWith(source.id);
      return { id: source.id, name: source.label, region: `${source.region} · ${source.portals.length} portals`, tone: running ? 'busy' : status.tone, status: running ? 'Collecting' : status.text,
        saved: saved(source.id), lastSuccess: state === undefined ? 'Unknown' : when(state?.lastSuccessAt), next: nextRun(source.id),
        action: <Btn size="sm" variant="secondary" disabled={!!busy || status.text === 'Collecting'} onClick={() => void collect(source.id, { sourceId: source.id }, `${source.label} collection finished. Check each portal below.`)}>{running ? 'Collecting…' : 'Collect'}</Btn> };
    }),
    // Saved notices from a source this version has no card for still get a row, so nothing saved goes unseen.
    ...[...new Set((inventory.data ?? []).filter(row => row.kind === 'opportunity').map(row => String(row.sourceId)))].filter(id => id !== 'bc-bid' && id !== 'canadabuys' && !CONNECTOR_SOURCES.some(source => source.id === id)).map((id): OverviewRow => ({
      id, name: sourceName(id), region: 'No collection details in this version', tone: 'idle', status: 'Saved notices only', saved: saved(id), lastSuccess: 'Not recorded', next: 'Not scheduled', action: null })),
  ];

  return <section className="procurement-workspace pc-sources" aria-label="Sources">
    {(error || health.error || inventory.error) && <p role="alert">{error || health.error?.message || inventory.error?.message}</p>}
    {message && <p role="status">{message}</p>}
    <Overview rows={overview} schedule={<div className="pc-overview-schedule"><span>Scheduled collection</span>{schedules.error ? <span className="pc-status" data-tone="warn">Unknown</span> : schedules.isPending ? <span className="pc-status">Loading…</span> : <ScheduleBadge row={collectSchedule} label={collectSchedule && collectTarget(collectSchedule) !== COLLECT_ALL ? `${scheduleState(collectSchedule).status} · ${label(collectTarget(collectSchedule))} only` : undefined} />}<Btn size="sm" variant="secondary" onClick={() => setScheduleFor(COLLECT_ALL)}>Schedule all sources</Btn></div>} />
    <div className="pc-source-grid">
      <Card id="bc-bid" name="BC Bid" region="British Columbia · browser scraping" tone={overview[0].tone} status={overview[0].status}
        stats={[['Opportunities', saved('bc-bid')], ['Awards', saved('bc-bid', 'award')], ['Last successful scrape', overview[0].lastSuccess]]}
        actions={<><Btn variant="primary" onClick={() => navigatePlugin('/bc-bid-dashboard')}>Open BC Bid</Btn><Btn variant="secondary" onClick={() => navigatePlugin('/scraper')}>Scraper</Btn><Btn variant="ghost" onClick={() => navigatePlugin('/scraper/history')}>Run history</Btn></>}>
        <details open={bcIssue}><summary>Collection checkpoints</summary><ul className="pc-checkpoints">{checkpoints.map(item => <li key={item.key}><div><strong>{item.label}</strong><span>{item.status}</span></div><p>{item.scope}{item.range ? ` · ${item.range}` : ''} · checkpoint {item.checkpointTime === 'Not recorded' ? 'not recorded' : when(item.checkpointTime)}</p>{item.error && <p role="alert" title={item.error}>{shortError(item.error)}</p>}{item.undated && <p>Undated awards are not verified.</p>}</li>)}</ul></details>
        <BcBidSchedules rows={schedules.data} error={schedules.error as Error | null} />
        <Capabilities id="bc-bid" />
      </Card>
      <Card id="canadabuys" name="CanadaBuys" region="Canada · official dataset" tone={overview[1].tone} status={overview[1].status}
        stats={[['Opportunities', saved('canadabuys')], ['Last collection', overview[1].lastSuccess], ['Last CSV import', when(importedAt)], ['Next scheduled run', nextRun('canadabuys')]]}
        actions={<><Btn variant="primary" disabled={!!busy} onClick={() => void collectCanadaBuys('resume')}>{busy === 'canadabuys' ? 'Collecting…' : 'Collect latest'}</Btn><Btn variant="secondary" onClick={() => setScheduleFor(scheduleTargetFor('canadabuys'))}>Schedule</Btn><Btn variant="ghost" onClick={() => setImportOpen(true)}>Import CSV</Btn></>}>
        <SourceError error={collection?.error} />
        <details><summary>Collection options</summary><div className="pc-collect-options"><label><span>Batches per run</span><Select aria-label="Collection batches" value={batches} onChange={e => setBatches(e.target.value)}>{[1, 5, 10, 20].map(n => <option key={n} value={n}>{n} batches</option>)}</Select></label><Btn variant="secondary" disabled={!!busy} onClick={() => void collectCanadaBuys('restart')}>Start a new snapshot</Btn></div><p className="procurement-coverage">Start a new snapshot when CanadaBuys publishes a changed dataset. Saved notices are kept.</p>
          {collection?.receipt && <><h3>Last receipt</h3><dl className="pc-detail-list">{['retrievedAt', 'importedAt', 'totalSourceRecords', 'totalRecords', 'excludedCount', 'byteCount', 'sha256'].map(key => <div key={key}><dt>{key}</dt><dd>{collection.receipt[key] ?? 'Not reported'}</dd></div>)}</dl>{collection.receipt.excluded?.length > 0 && <><p>Some notices were excluded. Find them by CSV record number in the snapshot with this SHA-256.</p><ul>{collection.receipt.excluded.map((item: any) => <li key={item.csvRecord}>CSV record {item.csvRecord}: {item.bytes.toLocaleString()} bytes · {item.reason}</li>)}</ul></>}</>}
        </details>
        <Capabilities id="canadabuys" />
      </Card>
      {CONNECTOR_SOURCES.map(source => <ConnectorCard key={source.id} source={source} state={connectors.get(source.id)!.state} stateError={connectors.get(source.id)!.error ?? (health.error ? (health.error as Error).message : undefined)}
        saved={saved(source.id)} next={nextRun(source.id)} busy={busy} enabled={!!model}
        onCollect={(portals, key, done) => void collect(key, { sourceId: source.id, ...(portals ? { portals } : {}) }, done)} onSchedule={() => setScheduleFor(scheduleTargetFor(source.id))} />)}
      <BrowserSourcesCard />
      {LINK_SOURCES.length > 0 && <LinkSources />}
    </div>
    <SourceHealth inventory={inventory.data} canadaBuysTotal={collection?.receipt?.totalSourceRecords} enabled={!!model} />
    {scheduleFor && <Modal title={`Schedule ${label(scheduleFor)}`} mobileSheet onClose={() => setScheduleFor('')}><div className="pc-schedule-sheet">
      <ScheduleControl actionId={COLLECT_ACTION} input={scheduledCollectInput(scheduleFor)} title={`Collect ${label(scheduleFor)}`} matches={row => collectTarget(row) === scheduleFor} describe={describeCollect} />
      <p className="procurement-coverage">{scheduleFor === COLLECT_ALL ? `Each scheduled run collects CanadaBuys and then ${CONNECTOR_SOURCES.map(source => source.label).join(', ')}. CanadaBuys continues the same daily file where the last run stopped (up to 20 batches of 100 notices per run) and starts over when a new file is published. A source or portal that fails is shown on its card and does not stop the others; Zoer turns the schedule off only when every source fails. BC Bid is scheduled separately. `
        : scheduleFor === 'canadabuys' ? 'Each scheduled run starts from the newest daily file and saves up to 20 batches (2,000 notices). ' : 'Each scheduled run collects every portal; one failing portal does not stop the others. '}A scheduled run waits while another run of this plugin is active. Zoer turns a schedule off after a failed run or a plugin update; it says so here.</p>
    </div></Modal>}
    {importOpen && <CanadaBuysImport onClose={() => setImportOpen(false)} onImported={() => { void client.invalidateQueries({ queryKey: ['catalog'] }); }} />}
  </section>;
}

/** A source's last error in plain words; the saved code and message stay one tap away for bug reports. */
function SourceError({ error }: { error: CollectionError | null | undefined }) {
  const explained = sourceErrorText(error);
  if (!explained) return null;
  return <div className="pc-source-error" role="alert"><p>{explained.text}</p>{explained.detail !== explained.text && <details><summary>Details</summary><p><code>{explained.detail}</code></p></details>}</div>;
}

/** BC Bid scrapes need a browser, which dashboard schedules cannot attach, so they are read here and changed in Zoer. */
function BcBidSchedules({ rows, error }: { rows?: ScheduleRow[]; error: Error | null }) {
  const items = [['scrape.full', 'Current opportunities'], ['awards.history', 'Historical awards']] as const;
  return <details><summary>Scheduled scraping</summary>
    {error ? <p role="alert">Schedules could not be read: {error.message}</p> : !rows ? <p role="status">Loading schedules…</p> : <ul className="pc-checkpoints">{items.map(([id, text]) => {
      const row = findSchedule(rows, id), state = scheduleState(row);
      return <li key={id}><div><strong>{text}</strong><span className="pc-status" data-tone={state.tone}>{state.status}</span></div>{(state.next || state.last) && <p>{[state.next, state.last].filter(Boolean).join(' · ')}</p>}{state.stopped && <p role="alert" title={state.error ?? undefined}>{state.stopped}</p>}</li>;
    })}</ul>}
    <p className="procurement-coverage">BC Bid scrapes use your Zoer browser, so they are scheduled in Zoer’s plugin settings, not here. <a className="procurement-link" href={hostHref('#/settings/plugins')}>Open plugin settings</a></p>
  </details>;
}

/** A platform with many portals: totals first, then a searchable portal list that can be narrowed to problems. */
function ConnectorCard({ source, state, stateError, saved, next, busy, enabled, onCollect, onSchedule }: {
  source: ConnectorSource; state: ConnectorCollection | null | undefined; stateError?: string; saved: string; next: ReactNode; busy: string; enabled: boolean;
  onCollect: (portals: string[] | null, key: string, done: string) => void; onSchedule: () => void;
}) {
  const counts = useQuery({ queryKey: ['catalog', 'procurement-portal-counts', source.id], enabled, queryFn: async () => new Map((await sql(PORTAL_COUNT_SQL, [source.id])).map(row => [String(row.portalId), Number(row.count)])), refetchInterval: 60_000 });
  const [query, setQuery] = useState(''), [problemsOnly, setProblemsOnly] = useState(false), [all, setAll] = useState(false);
  const rows = portalRows(source.portals, state, counts.data), summary = portalSummary(rows), status = connectorStatus(state);
  const shown = filterPortals(rows, query, problemsOnly), limit = all || query || problemsOnly ? shown.length : 8;
  const running = busy.startsWith(source.id) || status.text === 'Collecting', problems = rows.filter(row => row.problem).map(row => row.id);
  return <Card id={source.id} wide name={source.label} region={source.region} tone={running ? 'busy' : status.tone} status={running ? 'Collecting' : status.text}
    stats={[['Opportunities', saved], ['Portals', state === undefined ? `${rows.length} · status unknown` : portalSummaryText(rows)], ['Last successful collection', state === undefined ? 'Unknown' : when(state?.lastSuccessAt)], ['Next scheduled run', next]]}
    actions={<>
      <Btn variant="primary" disabled={!!busy || running} onClick={() => onCollect(null, source.id, `${source.label} collection finished. Check each portal below.`)}>{busy === source.id ? 'Collecting…' : `Collect all ${rows.length} portals`}</Btn>
      {problems.length > 0 && problems.length < rows.length && <Btn variant="secondary" disabled={!!busy || running} onClick={() => onCollect(problems, `${source.id}:problems`, `Retried ${problems.length} portals. Check their status below.`)}>{busy === `${source.id}:problems` ? 'Collecting…' : `Retry ${problems.length} problem portal${problems.length === 1 ? '' : 's'}`}</Btn>}
      <Btn variant="secondary" onClick={onSchedule}>Schedule</Btn>
    </>}>
    {stateError && <p role="alert">Collection state could not be read: {stateError}</p>}
    <SourceError error={state?.error} />
    {counts.error && <p role="alert">Saved counts per portal could not be read: {(counts.error as Error).message}</p>}
    <div className="pc-portal-tools">
      <label className="pc-portal-search"><span className="sr-only">Search portals</span><input type="search" placeholder={`Search ${rows.length} portals`} value={query} onChange={e => setQuery(e.target.value)} /></label>
      <label className="rw-check"><input type="checkbox" checked={problemsOnly} onChange={e => setProblemsOnly(e.target.checked)} />Problems only ({summary.problems})</label>
    </div>
    {shown.length === 0 ? <p className="rw-muted">{problemsOnly && !query ? 'No portal has a problem.' : 'No portal matches.'}</p> :
    <table className="pc-rtable pc-portals">
      <thead><tr><th scope="col">Portal</th><th scope="col">Status</th><th scope="col">Last collected</th><th scope="col">Last run</th><th scope="col">Saved</th><th scope="col"><span className="sr-only">Action</span></th></tr></thead>
      <tbody>{shown.slice(0, limit).map(row => <tr key={row.id} data-problem={row.problem || undefined}>
        <th scope="row"><a href={row.url} target="_blank" rel="noreferrer">{row.label}</a><small>{row.place}</small></th>
        <td data-label="Status"><span className="pc-status" data-tone={row.tone}>{row.statusText}</span>{row.errorText && <small className="pc-portal-error" title={row.error}>{row.errorText}</small>}</td>
        <td data-label="Last collected">{row.status === 'unknown' ? 'Unknown' : when(row.lastSuccessAt)}</td>
        <td data-label="Last run">{row.counts}</td>
        <td data-label="Saved">{row.saved === null ? (counts.error ? 'Unknown' : '…') : row.saved.toLocaleString()}</td>
        <td className="pc-rtable-action"><Btn size="sm" variant="ghost" disabled={!!busy || running} aria-label={`Collect ${row.label}`} onClick={() => onCollect([row.id], `${source.id}:${row.id}`, `${row.label} collected. Check its status below.`)}>{busy === `${source.id}:${row.id}` ? 'Collecting…' : 'Collect'}</Btn></td>
      </tr>)}</tbody>
    </table>}
    {shown.length > limit && <Btn size="sm" variant="ghost" onClick={() => setAll(true)}>Show all {shown.length} portals</Btn>}
    <details><summary>Connector details</summary><p className="procurement-coverage">{source.coverage}</p></details>
  </Card>;
}

/** Sites we do not collect from; people check them directly. */
function LinkSources() {
  const [query, setQuery] = useState('');
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const shown = LINK_SOURCES.filter(item => words.every(word => `${item.label} ${item.region ?? ''}`.toLowerCase().includes(word)));
  return <article id="pc-src-links" className="pc-source-card" data-wide aria-label="Check these yourself">
    <header><div><h2>Check these yourself</h2><p>{LINK_SOURCES.length} sites Zoer does not collect from. Open them to look for new notices.</p></div></header>
    {LINK_SOURCES.length > 8 && <label className="pc-portal-search"><span className="sr-only">Search sites</span><input type="search" placeholder={`Search ${LINK_SOURCES.length} sites`} value={query} onChange={e => setQuery(e.target.value)} /></label>}
    <ul className="pc-link-sources">{shown.map(item => <li key={item.id}><a href={item.url} target="_blank" rel="noreferrer">{item.label} ↗</a><small>{[item.region, item.reason].filter(Boolean).join(' · ')}</small></li>)}</ul>
  </article>;
}

const SOURCE_SQL = "CASE WHEN json_extract(r.data,'$.sourceId') IS NULL OR json_extract(r.data,'$.sourceId')='' THEN 'bc-bid' ELSE json_extract(r.data,'$.sourceId') END";
// Discovery is judged from what the saved notice holds: attachment links, or captured detail fields without links.
const ATTACHMENT_SQL = `SELECT ${SOURCE_SQL} AS sourceId, count(*) AS total,
  sum(json_extract(r.data,'$.attachments[0]') IS NULL AND json_extract(r.data,'$.detailFields[0]') IS NULL) AS notChecked,
  sum(json_extract(r.data,'$.attachments[0]') IS NULL AND json_extract(r.data,'$.detailFields[0]') IS NOT NULL) AS checkedNoLinks,
  sum(json_extract(r.data,'$.attachments[0]') IS NOT NULL) AS withLinks,
  sum((SELECT count(*) FROM documents d WHERE d.record_id=r.id AND d.status='downloaded')>0) AS withFiles,
  sum((SELECT count(*) FROM documents d WHERE d.record_id=r.id AND d.status='downloaded' AND coalesce(length(d.text),0)=0)>0) AS noText
  FROM records r WHERE r.kind='opportunity' GROUP BY sourceId`;
const BATCH_SQL = 'SELECT id, kind, status, completed, failed, total, error, updated_at FROM batches ORDER BY updated_at DESC LIMIT 200';
const FAILURE_SQL = "SELECT t.record_id, r.title, t.kind, t.status, t.error, t.updated_at, json_extract(t.result,'$.name') AS name, json_extract(t.result,'$.phase') AS phase FROM research_tasks t LEFT JOIN records r ON r.id=t.record_id WHERE t.status IN ('failed','waiting_for_user') ORDER BY t.updated_at DESC LIMIT 200";
const KIND_TEXT: Record<string, string> = { download: 'Document downloads', review: 'AI reviews' };

/** Capabilities, coverage, run outcomes and a retryable failure queue. Errors are shown as errors, never as zero. */
function SourceHealth({ inventory, canadaBuysTotal, enabled }: { inventory?: any[]; canadaBuysTotal?: unknown; enabled: boolean }) {
  const client = useQueryClient();
  const attachments = useQuery({ queryKey: ['catalog', 'procurement-source-attachments'], enabled, queryFn: () => sql(ATTACHMENT_SQL), refetchInterval: 120_000 });
  const batches = useQuery({ queryKey: ['catalog', 'procurement-source-batches'], enabled, queryFn: () => sql(BATCH_SQL) as Promise<BatchRow[]>, refetchInterval: 15_000 });
  const failures = useQuery({ queryKey: ['catalog', 'procurement-source-failures'], enabled, queryFn: () => sql(FAILURE_SQL) as Promise<FailureTask[]>, refetchInterval: 15_000 });
  const [busy, setBusy] = useState(''), [error, setError] = useState(''), [message, setMessage] = useState(''), [allFailures, setAllFailures] = useState(false);
  const saved = (source: string) => (inventory ?? []).filter(row => row.sourceId === source && row.kind === 'opportunity').reduce((sum, row) => sum + Number(row.count), 0);
  // Only a total the source itself reported counts as known; anything else stays "unknown", never zero.
  const reported = typeof canadaBuysTotal === 'number' || (typeof canadaBuysTotal === 'string' && canadaBuysTotal.trim() !== '') ? Number(canadaBuysTotal) : NaN;
  const total = (source: string) => source === 'canadabuys' && Number.isFinite(reported) ? `${reported.toLocaleString()} (last snapshot)` : 'Unknown';
  const health = batchHealth(batches.data ?? []);
  const queue = groupFailures(failures.data ?? []);
  const retryable = queue.filter(group => group.retryable && !group.waiting).map(group => group.recordId);
  const running = (batches.data ?? []).some(row => row.status === 'running');
  const retry = async (recordIds: string[], key: string) => {
    setBusy(key); setError(''); setMessage('');
    try { await host('action', { actionId: 'documents.download', input: { recordIds: recordIds.slice(0, 50), force: false } }); setMessage(`Download retry started for ${Math.min(50, recordIds.length)} notice${recordIds.length === 1 ? '' : 's'}. Successful files are not downloaded again.`); await client.invalidateQueries({ queryKey: ['catalog', 'procurement-source-batches'] }); }
    catch (e) { setError((e as Error).message); } finally { setBusy(''); }
  };
  return <section className="rw-panel rw-source-health" aria-labelledby="source-health-title">
    <h2 id="source-health-title">Source health</h2>
    <div className="rw-table-wrap"><table className="rw-table rw-text">
      <thead><tr><th scope="col">Source</th>{['List', 'Details', 'Download', 'Addenda'].map(name => <th key={name} scope="col">{name}</th>)}<th scope="col">Saved</th><th scope="col">On the portal</th></tr></thead>
      <tbody>{PROCUREMENT_SOURCE_ADAPTERS.map(adapter => <tr key={adapter.id}>
        <th scope="row">{adapter.label}</th>
        {capabilityMatrix(adapter.id, adapter.capabilities).map(cap => <td key={cap.name}><span className="rw-cap" data-status={cap.status} title={cap.method}>{CAPABILITY_TEXT[cap.status]}</span></td>)}
        <td>{inventory ? saved(adapter.id).toLocaleString() : 'Loading…'}</td>
        <td>{total(adapter.id)}</td>
      </tr>)}</tbody>
    </table></div>

    <h3>Attachment discovery</h3>
    {attachments.error ? <p role="alert">Attachment coverage could not be read: {(attachments.error as Error).message}</p> : attachments.isPending ? <p role="status">Checking saved attachment coverage…</p> :
      <div className="rw-table-wrap"><table className="rw-table rw-text">
        <thead><tr><th scope="col">Source</th>{attachmentStates({}).map(state => <th key={state.key} scope="col">{state.text}</th>)}</tr></thead>
        <tbody>{(attachments.data ?? []).map(row => <tr key={row.sourceId}><th scope="row">{PROCUREMENT_SOURCE_ADAPTERS.find(a => a.id === row.sourceId)?.label ?? row.sourceId}</th>{attachmentStates(row).map(state => <td key={state.key}>{state.count.toLocaleString()}</td>)}</tr>)}</tbody>
      </table></div>}
    <p className="rw-note">“No links found” reflects the last detail capture only.</p>

    <h3>Processing runs</h3>
    {batches.error ? <p role="alert">Run history could not be read: {(batches.error as Error).message}</p> : batches.isPending ? <p role="status">Loading run history…</p> : !health.length ? <p className="rw-note">No download or review runs yet.</p> :
      <div className="rw-table-wrap"><table className="rw-table rw-text">
        <thead><tr><th scope="col">Run type</th><th scope="col">Last attempted</th><th scope="col">Outcome</th><th scope="col">Last successful</th></tr></thead>
        <tbody>{health.map(row => <tr key={row.kind}>
          <th scope="row">{KIND_TEXT[row.kind] ?? row.kind}</th>
          <td>{when(row.attempt.updated_at)}</td>
          <td><span className="rw-cap" data-status={row.attempt.problem ? 'partial' : 'available'}>{row.attempt.statusText}</span> {row.attempt.outcome}{row.attempt.error && <small className="rw-error" title={row.attempt.error}>{shortError(row.attempt.error)}</small>}{row.problems > 1 && <small className="rw-note">{row.problems} recent runs incomplete</small>}</td>
          <td>{row.success ? `${when(row.success.updated_at)} · ${Number(row.success.completed).toLocaleString()} of ${Number(row.success.total).toLocaleString()}` : 'No successful run recorded'}</td>
        </tr>)}</tbody>
      </table></div>}

    {error && <p role="alert">{error}</p>}{message && <p role="status">{message}</p>}
    {failures.error ? <p role="alert">Failures could not be read: {(failures.error as Error).message}</p> : failures.isPending ? <p role="status">Loading failures…</p> : !queue.length ? <><h3>Failure queue</h3><p className="rw-note">Nothing failed.</p></> :
    <details className="rw-failure-queue"><summary><h3>Failure queue · {queue.length.toLocaleString()} notice{queue.length === 1 ? '' : 's'}</h3></summary>
      <div className="rw-actions"><Btn size="sm" variant="secondary" disabled={!!busy || running || !retryable.length} onClick={() => void retry(retryable, 'all')}>{busy === 'all' ? 'Starting…' : `Retry downloads for ${Math.min(50, retryable.length)} notice${retryable.length === 1 ? '' : 's'}`}</Btn>{running && <span className="rw-note">Wait for the current run to finish.</span>}</div>
      {queue.some(group => group.waiting) && <p className="rw-note">Items marked “Needs you” need the BC Bid browser check completed in Zoer before retrying.</p>}
      <ul className="rw-failures">{(allFailures ? queue : queue.slice(0, 5)).map(group => <li key={group.recordId}>
        <div><strong>{group.title}</strong><small className="rw-note">{group.recordId.replace(/^opportunity:/, '')} · {when(group.updatedAt)}</small></div>
        <ul>{group.tasks.slice(0, 2).map((task, i) => <li key={i} className="rw-clamp" title={task.error ?? undefined}>{task.status === 'waiting_for_user' ? 'Needs you' : 'Failed'} · {task.kind === 'attachment' ? (task.name ?? 'Download') : task.kind}{task.error ? `: ${shortError(task.error)}` : ''}</li>)}{group.tasks.length > 2 && <li>{group.tasks.length - 2} more</li>}</ul>
        {group.waiting ? null
          : group.retryable ? <Btn size="sm" variant="ghost" disabled={!!busy || running} onClick={() => void retry([group.recordId], group.recordId)}>{busy === group.recordId ? 'Starting…' : 'Retry'}</Btn>
          : <Btn size="sm" variant="ghost" onClick={() => navigatePlugin('/ai-review')}>Retry from AI review</Btn>}
      </li>)}</ul>
      {queue.length > 5 && <Btn size="sm" variant="ghost" onClick={() => setAllFailures(!allFailures)}>{allFailures ? 'Show fewer' : `Show all ${queue.length.toLocaleString()}`}</Btn>}
    </details>}
  </section>;
}
