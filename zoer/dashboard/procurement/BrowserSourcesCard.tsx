import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Btn } from '@zoer/plugin-ui/controls';
import { host } from '../bridge';
import { useWorkspace } from '../backend';
import { hostHref } from '../navigation';
import { BROWSER_COLLECT_ACTION, BROWSER_SITES, BROWSER_SOURCE_ID } from './browser-sites';
import { BROWSER_SITE_COUNT_SQL, browserSiteRows, browserSummaryText, localVisitWindow, type BrowserSiteRow } from './browser-source-overview';
import { LINK_SOURCES, ROBOTS_REASON } from './link-sources';
import { findSchedule, scheduleState } from './schedule-state';
import { useSchedules } from './ScheduleControl';
import { connectorCollectionKey } from './source-adapters';
import { connectorStatus, readConnectorCollection } from './source-overview';
import type { RecentRun } from './source-schedules';
import { RUNS_KEY } from './CollectionRuns';
import { sql } from './display';
import './browser-sources.css';

const KEY = connectorCollectionKey(BROWSER_SOURCE_ID);
const when = (value: string | undefined) => value && Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : 'Never';
const robotsOnly = () => LINK_SOURCES.filter(source => source.reason === ROBOTS_REASON);

/**
 * Sites that block plain automated requests, collected in the person's Zoer browser (`procurement.collect.browser`).
 * A site that shows a check waits for the person; the card says what to do. Schedules need a browser chosen in Zoer's
 * plugin settings, so they are shown here and changed there. `run`: the live collection run of these sites, if any.
 */
export function BrowserSourcesCard({ run }: { run?: RecentRun }) {
  const { model } = useWorkspace(), client = useQueryClient(), schedules = useSchedules();
  const health = useQuery({ queryKey: ['catalog', 'procurement-browser-sites', KEY], queryFn: () => host('catalog.workspace', { keys: [KEY] }), refetchInterval: 5000 });
  const counts = useQuery({ queryKey: ['catalog', 'procurement-browser-site-counts'], enabled: !!model, queryFn: async () => new Map((await sql(BROWSER_SITE_COUNT_SQL)).map(row => [String(row.portalId), Number(row.count)])), refetchInterval: 60_000 });
  const [busy, setBusy] = useState(''), [error, setError] = useState(''), [message, setMessage] = useState('');
  let state, stateError = '';
  try { state = health.data ? readConnectorCollection(health.data.entries?.find((entry: any) => entry.key === KEY)?.value, BROWSER_SOURCE_ID) : undefined; }
  catch (e) { state = undefined; stateError = (e as Error).message; }
  const rows = browserSiteRows(state, counts.data), status = connectorStatus(state, Date.now(), run);
  const running = !!busy || !!run, waiting = rows.filter(row => row.status === 'waiting');
  const saved = counts.error ? 'Unknown' : !counts.data ? 'Loading…' : [...counts.data.values()].reduce((sum, n) => sum + n, 0).toLocaleString();
  const schedule = findSchedule(schedules.data, BROWSER_COLLECT_ACTION), scheduled = scheduleState(schedule);
  const collect = async (sites: string[] | null, key: string) => {
    setBusy(key); setError(''); setMessage('');
    try {
      // A resumable job, one site per step: it is started here and its progress shows on this card and under Collection runs.
      await host('action', { actionId: BROWSER_COLLECT_ACTION, input: { sourceId: BROWSER_SOURCE_ID, ...(sites ? { sites } : {}) } });
      setMessage('Collection started. Each site’s status updates below; a site waiting for you needs a check completed in the Zoer browser.');
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(''); await client.invalidateQueries({ queryKey: RUNS_KEY }); await client.invalidateQueries({ queryKey: ['catalog'] }); }
  };
  const tone = busy ? 'busy' : run ? status.tone : waiting.length ? 'warn' : status.tone;
  const statusText = busy ? 'Starting' : run ? status.text : waiting.length ? 'Waiting for you' : status.text;
  return <article id="pc-src-browser-sites" className="pc-source-card pc-browser-sites" data-wide aria-label="Collect in your browser">
    <header><div><h2>Collect in your browser</h2><p>British Columbia · {BROWSER_SITES.length} sites that block automated requests</p></div><span className="pc-status" data-tone={tone}>{statusText}</span></header>
    <p className="pc-browser-lead">These sites block automated requests, so Procurement collects them in your Zoer browser, and a site may ask you to complete a check there first.</p>
    <dl className="pc-source-stats">
      <div><dt>Opportunities</dt><dd>{saved}</dd></div>
      <div><dt>Sites</dt><dd>{stateError ? `${rows.length} · status unknown` : browserSummaryText(rows)}</dd></div>
      <div><dt>Last successful collection</dt><dd>{state === undefined ? 'Unknown' : when(state?.lastSuccessAt)}</dd></div>
      <div><dt>Schedule</dt><dd>{schedules.error ? 'Unknown' : schedules.isPending ? 'Loading…' : scheduled.status}</dd></div>
    </dl>
    <div className="procurement-actions">
      <Btn variant="primary" disabled={running || !model} onClick={() => void collect(null, 'all')}>{busy === 'all' ? 'Starting…' : `Collect all ${BROWSER_SITES.length} sites`}</Btn>
      {waiting.length > 0 && waiting.length < rows.length && <Btn variant="secondary" disabled={running} onClick={() => void collect(waiting.map(row => row.site.id), 'waiting')}>{busy === 'waiting' ? 'Starting…' : `Retry ${waiting.length} waiting site${waiting.length === 1 ? '' : 's'}`}</Btn>}
      <a className="procurement-link pc-browser-open" href={hostHref('#/browsers')}>Open the Zoer browser</a>
    </div>
    {stateError && <p role="alert">Collection state could not be read: {stateError}</p>}
    {health.error && <p role="alert">Collection state could not be read: {(health.error as Error).message}</p>}
    {counts.error && <p role="alert">Saved counts per site could not be read: {(counts.error as Error).message}</p>}
    {error && <p role="alert">{error}</p>}{message && <p role="status">{message}</p>}
    {waiting.length > 0 && <div className="pc-browser-steps" role="note">
      <strong>{waiting.length === 1 ? `${waiting[0].site.label} is waiting for you` : `${waiting.length} sites are waiting for you`}</strong>
      <ol><li>Open the Zoer browser (link above, or Settings › Open saved browser at the top of Procurement).</li><li>Go to the site and complete the check you see there. Procurement never answers checks for you.</li><li>Return control to Procurement, then press Collect on that site.</li></ol>
    </div>}
    <table className="pc-rtable pc-portals pc-browser-table">
      <thead><tr><th scope="col">Site</th><th scope="col">Status</th><th scope="col">Last collected</th><th scope="col">Listed</th><th scope="col">Saved</th><th scope="col"><span className="sr-only">Action</span></th></tr></thead>
      <tbody>{rows.map(row => <SiteRow key={row.site.id} row={row} busy={busy} running={running} onCollect={() => void collect([row.site.id], row.site.id)} countsError={!!counts.error} />)}</tbody>
    </table>
    <details><summary>Scheduled collection</summary>
      {schedules.error ? <p role="alert">Schedules could not be read: {(schedules.error as Error).message}</p> : <p><span className="pc-status" data-tone={scheduled.tone}>{scheduled.status}</span>{[scheduled.next, scheduled.last].filter(Boolean).length > 0 && <> {[scheduled.next, scheduled.last].filter(Boolean).join(' · ')}</>}</p>}
      {scheduled.stopped && <p role="alert" title={scheduled.error ?? undefined}>{scheduled.stopped}</p>}
      <p className="procurement-coverage">These sites load in your Zoer browser, so their schedule is set in Zoer’s plugin settings with the browser it should use, not here. A scheduled run that meets a check leaves that site waiting for you and still collects the others. <a className="procurement-link" href={hostHref('#/settings/plugins')}>Open plugin settings</a></p>
    </details>
    <details><summary>Not collected: robots.txt forbids it ({robotsOnly().length})</summary>
      <p className="procurement-coverage">These sites’ robots.txt asks automated visitors to stay away, so Procurement does not collect them, even in your browser. Open them yourself.</p>
      <ul className="pc-link-sources">{robotsOnly().map(item => <li key={item.id}><a href={item.url} target="_blank" rel="noreferrer">{item.label} ↗</a><small>{item.region ?? 'British Columbia'}</small></li>)}</ul>
    </details>
    <details><summary>How browser collection works</summary>
      <ul className="pc-browser-notes">
        <li>Zoer reads each site’s robots.txt (through your browser when the site blocks plain requests, once a day) and obeys it, including its rules for AI crawlers: pages it disallows are never loaded and show “robots.txt disallows collection”, and page loads on a site are spaced as its Crawl-delay asks (at least 5 seconds; 10 for Chilliwack, Whistler and BC Ferries).</li>
        <li>Each site is one step of the run: a Zoer restart or update, or Pause under Collection runs, continues with the next site.</li>
        {BROWSER_SITES.filter(site => site.visitTimeUtc).map(site => <li key={site.id}>{site.label} asks automated visitors to come only between {localVisitWindow(site.visitTimeUtc!) ?? site.visitTimeUtc} your time ({site.visitTimeUtc!.replace(/^(\d{2})(\d{2})-(\d{2})(\d{2})$/, '$1:$2–$3:$4')} UTC). Outside that window it is skipped, not counted as empty.</li>)}
        <li>One page per site: the bids page as your browser shows it. Notice pages and documents stay on the site. A notice missing from a later listing is kept.</li>
        <li>The page layouts have not been confirmed against these sites yet. If a site shows “Failed” with a layout message, open it and compare; saved notices are kept.</li>
      </ul>
    </details>
  </article>;
}

function SiteRow({ row, busy, running, onCollect, countsError }: { row: BrowserSiteRow; busy: string; running: boolean; onCollect: () => void; countsError: boolean }) {
  return <tr data-problem={row.status === 'waiting' || row.status === 'failed' || undefined}>
    <th scope="row"><a href={row.site.url} target="_blank" rel="noreferrer">{row.site.label}</a><small>{row.site.aggregator ? 'Many BC local governments' : [row.site.place.municipality, row.site.place.regionalDistrict].filter(Boolean).join(' · ') || 'British Columbia'}</small></th>
    <td data-label="Status"><span className="pc-status" data-tone={row.tone}>{row.statusText}</span>{row.message && <small className="pc-portal-error" title={row.detail}>{row.message}</small>}</td>
    <td data-label="Last collected">{row.status === 'unknown' ? 'Unknown' : when(row.lastSuccessAt)}</td>
    <td data-label="Listed">{row.status === 'unknown' ? 'Unknown' : row.listed === null ? 'Not collected yet' : `${row.listed.toLocaleString()} listed`}</td>
    <td data-label="Saved">{row.saved === null ? (countsError ? 'Unknown' : '…') : row.saved.toLocaleString()}</td>
    <td className="pc-rtable-action"><Btn size="sm" variant="ghost" disabled={running} aria-label={`Collect ${row.site.label}`} onClick={onCollect}>{busy === row.site.id ? 'Starting…' : 'Collect'}</Btn></td>
  </tr>;
}
