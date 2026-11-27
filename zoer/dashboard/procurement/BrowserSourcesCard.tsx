import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Btn } from '@zoer/plugin-ui/controls';
import { host } from '../bridge';
import { useWorkspace } from '../backend';
import { useCapabilities } from '../capabilities';
import { hostHref } from '../navigation';
import { plainError } from '../error-text';
import { count, plural } from '../format';
import { SettingsLink } from './Status';
import { BROWSER_COLLECT_ACTION, BROWSER_SITES, BROWSER_SOURCE_ID } from './browser-sites';
import { BROWSER_SITE_COUNT_SQL, browserSiteRows, localVisitWindow } from './browser-source-overview';
import { browserText, findSchedule } from './schedule-state';
import { useSchedules } from './ScheduleControl';
import { connectorCollectionKey } from './source-adapters';
import { connectorStatus, readConnectorCollection } from './source-overview';
import { browserTableRows, lastCollectedSlot, scheduleSlot } from './source-cards';
import type { RecentRun } from './source-schedules';
import { COLLECTION_RUNS_KEY, RUNS_KEY } from './CollectionRuns';
import { HowCollected, SourceCard } from './SourceCard';
import { PortalTable } from './PortalTable';
import { sourceName, sql } from './display';
import './browser-sources.css';

const KEY = connectorCollectionKey(BROWSER_SOURCE_ID);

/**
 * Sites that block plain automated requests, collected in the person's Zoer browser (`procurement.collect.browser`),
 * in the same card shape as every other source. A site that shows a check waits for the person; the card says what to
 * do. Schedules need a browser chosen in Zoer's settings, so they are shown here and changed there. `run`: the live
 * collection run of these sites, if any. Sites whose robots.txt forbids collection are listed once, under "Check these
 * yourself".
 */
export function BrowserSourcesCard({ run }: { run?: RecentRun; phone?: boolean }) {
  const { model } = useWorkspace(), client = useQueryClient(), schedules = useSchedules(), { collection: canCollect } = useCapabilities();
  const health = useQuery({ queryKey: ['catalog', 'procurement-browser-sites', KEY], queryFn: () => host('catalog.workspace', { keys: [KEY] }), refetchInterval: 5000 });
  const counts = useQuery({ queryKey: ['catalog', 'procurement-browser-site-counts'], enabled: !!model, queryFn: async () => new Map((await sql(BROWSER_SITE_COUNT_SQL)).map(row => [String(row.portalId), Number(row.count)])), refetchInterval: 60_000 });
  const [busy, setBusy] = useState(''), [error, setError] = useState(''), [message, setMessage] = useState('');
  let state, stateError = '';
  try { state = health.data ? readConnectorCollection(health.data.entries?.find((entry: any) => entry.key === KEY)?.value, BROWSER_SOURCE_ID) : undefined; }
  catch (e) { state = undefined; stateError = (e as Error).message; }
  const sites = browserSiteRows(state, counts.data), rows = browserTableRows(sites), status = connectorStatus(state, Date.now(), run);
  const running = !!busy || !!run, waiting = sites.filter(row => row.status === 'waiting');
  const saved = counts.error ? 'Unknown' : !counts.data ? 'Loading…' : count([...counts.data.values()].reduce((sum, n) => sum + n, 0));
  const schedule = findSchedule(schedules.data, BROWSER_COLLECT_ACTION);
  const collect = async (ids: string[] | null, key: string) => {
    setBusy(key); setError(''); setMessage('');
    try {
      // A resumable job, one site per step: progress shows on this card and under Operations › Runs.
      await host('action', { actionId: BROWSER_COLLECT_ACTION, input: { sourceId: BROWSER_SOURCE_ID, ...(ids ? { sites: ids } : {}) } });
      setMessage('Collection started. Each site’s status updates below; a site waiting for you needs a check completed in the collection browser.');
    } catch (e) { setError(plainError((e as Error).message)); }
    finally { setBusy(''); await client.invalidateQueries({ queryKey: RUNS_KEY }); await client.invalidateQueries({ queryKey: COLLECTION_RUNS_KEY }); await client.invalidateQueries({ queryKey: ['catalog'] }); }
  };
  const tone = busy ? 'busy' : run ? status.tone : waiting.length ? 'warn' : status.tone;
  const statusText = busy ? 'Starting' : run ? status.text : waiting.length ? 'Waiting for you' : health.isPending ? 'Loading…' : status.text;
  const browser = schedule?.browser !== undefined ? browserText(schedule.browser) : null;
  return <SourceCard id={BROWSER_SOURCE_ID} name={sourceName(BROWSER_SOURCE_ID)} kind={`British Columbia · ${plural(BROWSER_SITES.length, 'site')} collected in your Zoer browser`}
    status={{ tone, text: statusText }} saved={saved}
    last={health.isPending ? { text: 'Loading…' } : stateError ? { text: 'Unknown' } : lastCollectedSlot(state, 'site')}
    schedule={schedules.error ? 'Unknown' : schedules.isPending ? 'Loading…' : scheduleSlot(schedule)}
    action={canCollect && <Btn variant="secondary" disabled={running || !model} onClick={() => void collect(null, 'all')}>{busy === 'all' ? 'Starting…' : 'Collect now'}</Btn>}
    options={<>
      <p className="procurement-coverage">This schedule runs in {browser ? <strong>{browser}</strong> : 'the browser chosen in Zoer’s Settings'}, so it is set there, not here. A scheduled run that meets a check leaves that site waiting for you and still collects the others. <SettingsLink section="schedules" /></p>
      {canCollect && waiting.length > 0 && waiting.length < sites.length && <Btn size="sm" variant="secondary" disabled={running} onClick={() => void collect(waiting.map(row => row.site.id), 'waiting')}>{busy === 'waiting' ? 'Starting…' : `Collect ${plural(waiting.length, 'waiting site')} again`}</Btn>}
      <a className="procurement-link" href={hostHref('#/browsers')}>Open the Zoer browser</a>
    </>}
    how={<HowCollected id={BROWSER_SOURCE_ID}><ul className="pc-browser-notes">
      <li>These sites block plain automated requests, so Procurement loads them in your Zoer browser; a site may ask you to complete a check there first. Procurement never answers checks for you.</li>
      <li>Zoer reads each site’s robots.txt (through your browser when the site blocks plain requests, once a day) and obeys it, including its rules for AI crawlers. Page loads on a site are spaced as its Crawl-delay asks (at least 5 seconds; 10 for Chilliwack, Whistler and BC Ferries).</li>
      <li>Each site is one step of the run: a Zoer restart or update, or Pause under Operations › Runs, continues with the next site.</li>
      {BROWSER_SITES.filter(site => site.visitTimeUtc).map(site => <li key={site.id}>{site.label} asks automated visitors to come only between {localVisitWindow(site.visitTimeUtc!) ?? site.visitTimeUtc} your time. Outside that window it is skipped, not counted as empty.</li>)}
      <li>One page per site: the bids page as your browser shows it. Notice pages and documents stay on the site. A notice missing from a later listing is kept.</li>
      <li>“Last collected” is the newest site collected; the source’s whole-run date is older when a run skipped a site (for example outside its visiting hours).</li>
    </ul></HowCollected>}>
    {(stateError || health.error) && <p role="alert">Collection state could not be read: {stateError || (health.error as Error).message}</p>}
    {counts.error && <p role="alert">Saved counts per site could not be read: {(counts.error as Error).message}</p>}
    {error && <p role="alert">{error}</p>}{message && <p role="status">{message}</p>}
    {waiting.length > 0 && <div className="pc-browser-steps" role="note">
      <strong>{waiting.length === 1 ? `${waiting[0].site.label} is waiting for you` : `${plural(waiting.length, 'site')} are waiting for you`}</strong>
      <ol><li>Open the Zoer browser (under Options, or Settings › Open saved browser at the top of Procurement).</li><li>Go to the site and complete the check you see there. Procurement never answers checks for you.</li><li>Return control to Procurement, then press Collect on that site.</li></ol>
    </div>}
    <PortalTable rows={rows} noun="site" known={state !== undefined} countsError={!!counts.error} disabled={running}
      starting={row => busy === row.id} onCollect={canCollect ? row => void collect([row.id], row.id) : undefined} />
  </SourceCard>;
}
