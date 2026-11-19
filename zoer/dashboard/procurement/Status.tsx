import { useState, type MouseEvent, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Btn } from '@zoer/plugin-ui/controls';
import { host } from '../bridge';
import { useWorkspace } from '../backend';
import { useCapabilities } from '../capabilities';
import { assertDocumentBrowserIdle } from '../document-run';
import { plainError } from '../error-text';
import { hostHref, hostSettingsHref, navigatePlugin, pluginHref } from '../navigation';
import { useNarrowScreen } from '../mobile';
import { sourceName } from './display';
import { browserText, findSchedule, scheduleLabel, scheduleState, type ScheduleRow } from './schedule-state';
import { useScheduleBrowsers, useSchedules } from './ScheduleControl';
import { RUNS_KEY, usePresets, useRecentRuns } from './CollectionRuns';
import { DOCUMENT_GAP_KEY, LAST_COLLECTION_KEYS, lastCollectionText, lastCollections, readDocumentGap, type DocumentGap } from './status-data';
import { setupChecklist, type SetupStep, type StepAction } from './status-checklist';
import { friendlyDeadline } from '../review-workspace/deadline-text';
import './status.css';

const n = (value: number) => value.toLocaleString();
const follow = (to: string) => (event: MouseEvent) => { if (!event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey) { event.preventDefault(); navigatePlugin(to); } };
/** In-plugin link with a real href (new tab works) and host navigation on a plain click. */
export function PluginLink({ to, children, className = 'procurement-link' }: { to: string; children: ReactNode; className?: string }) {
  return <a className={className} href={pluginHref(to)} onClick={follow(to)}>{children}</a>;
}
/** Zoer's plugin Settings window, opened at its Browsers or Schedules section. Hidden outside Zoer. */
export function SettingsLink({ section, children, className = 'procurement-link' }: { section: 'browsers' | 'schedules'; children?: ReactNode; className?: string }) {
  const href = hostSettingsHref(section);
  if (!href) return null;
  return <a className={className} href={href}>{children ?? (section === 'browsers' ? 'Open Settings › Browsers' : 'Open Settings › Schedules')}</a>;
}

/** The document gap, shared by Status and Home (one cached read; heavy, so refreshed every two minutes). */
export function useDocumentGap(enabled = true) {
  const schedules = useSchedules(), { data: browsers } = useScheduleBrowsers(enabled);
  const downloads = findSchedule(schedules.data, 'documents.download.missing');
  const browserId = (downloads?.enabled ? downloads.browser?.id ?? downloads.body?.resources?.browserSessionId : undefined)
    ?? (browsers?.downloadsUseCollection ? browsers.collection?.id : browsers?.downloads?.id ?? browsers?.collection?.id)
    ?? '';
  return useQuery({ queryKey: [...DOCUMENT_GAP_KEY, browserId], enabled: enabled && !schedules.isPending,
    queryFn: () => readDocumentGap(Date.now(), browserId), staleTime: 60_000, refetchInterval: 120_000 });
}
/** Last successful collection per source (the same helper Sources uses). */
export function useLastCollections() {
  const { model } = useWorkspace(), recent = useRecentRuns();
  const entries = useQuery({ queryKey: ['catalog', 'procurement-status', 'collections'], queryFn: () => host('catalog.workspace', { keys: LAST_COLLECTION_KEYS }), refetchInterval: 30_000 });
  return lastCollections(entries.data?.entries, recent.data ?? (recent.error ? [] : undefined), model?.captureRuns);
}
/** The checklist from today's reads; shared by Status and Home's card. */
export function useSetupStatus() {
  const { collection } = useCapabilities();
  const schedules = useSchedules(), browsers = useScheduleBrowsers(), gap = useDocumentGap(collection);
  const checklist = setupChecklist({ browsers: browsers.data, rows: schedules.data, gap: gap.data });
  return { schedules, gap, checklist };
}

/** Runs "Keep documents current" or "Capture missing details" now; on a host without them, says so plainly. */
function useRunNow() {
  const client = useQueryClient(), [busy, setBusy] = useState(''), [error, setError] = useState(''), [message, setMessage] = useState('');
  const run = async (key: StepAction) => {
    setBusy(key); setError(''); setMessage('');
    try {
      await assertDocumentBrowserIdle(host, key === 'keep-documents' ? 'download' : 'capture');
      if (key === 'keep-documents') { await host('action', { actionId: 'documents.download.missing', input: {} }); setMessage('Keeping documents current: missing files of open notices download now, soonest closing first. Progress shows under Documents › History.'); }
      else { await host('action', { actionId: 'scrape.details', input: { missing: { limit: 50 } } }); setMessage('Capturing missing or incomplete details for up to 50 open BC Bid notices. Progress shows under BC Bid › Runs.'); }
      await client.invalidateQueries({ queryKey: RUNS_KEY });
    } catch (e) { setError(plainError((e as Error).message)); } finally { setBusy(''); }
  };
  return { busy, error, message, run };
}

function StepActions({ step, runNow, writes }: { step: SetupStep; runNow: ReturnType<typeof useRunNow>; writes: boolean }) {
  return <div className="pc-step-actions">{step.actions.map(action => {
    if (action === 'settings-browsers') return <SettingsLink key={action} section="browsers" />;
    if (action === 'settings-schedules') return <SettingsLink key={action} section="schedules" />;
    if (action === 'open-browser') return <a key={action} className="procurement-link" href={hostHref('#/browsers')}>Open the Zoer browser</a>;
    if (!writes || step.tone === 'good') return null;
    const label = action === 'keep-documents' ? 'Keep documents current now' : 'Capture missing details now';
    return <Btn key={action} size="sm" variant="secondary" disabled={!!runNow.busy} onClick={() => void runNow.run(action)}>{runNow.busy === action ? 'Starting…' : label}</Btn>;
  })}</div>;
}

/** One place to see whether BC Bid keeps itself current, and what still needs the person. */
export function Status() {
  const { writes } = useCapabilities(), { schedules, gap, checklist } = useSetupStatus(), presets = usePresets(), runNow = useRunNow();
  const last = useLastCollections(), phone = useNarrowScreen('(max-width: 640px)');
  return <section className="procurement-workspace pc-status-page" aria-labelledby="pc-status-title">
    <header className="pc-status-head">
      <div><h1 id="pc-status-title">Status</h1><p className="rw-muted">Is collection running, and what still needs you?</p></div>
      <span className="pc-status" data-tone={checklist.needs ? 'warn' : 'good'}>{checklist.verdict}</span>
    </header>
    {runNow.error && <p role="alert" className="pc-wrap">{runNow.error}</p>}{runNow.message && <p role="status">{runNow.message}</p>}
    <section className="rw-panel" aria-labelledby="pc-setup-title">
      <header className="rw-panel-head"><h2 id="pc-setup-title">Setup checklist</h2></header>
      <ol className="pc-checklist">{checklist.steps.map(step => <li key={step.id} data-tone={step.tone}>
        <span className="pc-step-mark" aria-hidden="true">{step.tone === 'good' ? '✓' : step.tone === 'warn' ? '!' : '·'}</span>
        <div className="pc-step-body">
          <div className="pc-step-title"><strong>{step.title}</strong><span className="pc-status" data-tone={step.tone}>{step.status}</span></div>
          {step.detail && <p className="pc-wrap">{step.detail}</p>}
          <StepActions step={step} runNow={runNow} writes={writes} />
        </div>
      </li>)}</ol>
    </section>

    <section className="rw-panel" aria-labelledby="pc-status-schedules">
      <header className="rw-panel-head"><h2 id="pc-status-schedules">Schedules</h2><span className="rw-muted">The same list as Zoer’s Settings › Schedules</span><SettingsLink section="schedules" /></header>
      {schedules.error ? <p role="alert">Schedules could not be read: {plainError((schedules.error as Error).message)}</p> : !schedules.data ? <p role="status" className="rw-muted">Loading schedules…</p> : !schedules.data.length ? <p className="rw-muted">No schedules saved.</p> :
        <ul className="pc-status-schedules">{schedules.data.map((row, i) => <ScheduleItem key={`${row.actionId}:${row.presetId ?? i}`} row={row} name={scheduleLabel(row, presets.data, sourceName)} />)}</ul>}
    </section>

    <div className="pc-status-grid">
      <section className="rw-panel" aria-labelledby="pc-status-collections">
        <header className="rw-panel-head"><h2 id="pc-status-collections">Last successful collection</h2><PluginLink to="/sources">Sources</PluginLink></header>
        <dl className="pc-status-list">{last.map(item => <div key={item.id}><dt>{item.name}</dt><dd>{lastCollectionText(item)}</dd></div>)}</dl>
      </section>
      <section className="rw-panel" aria-labelledby="pc-status-runs">
        <header className="rw-panel-head"><h2 id="pc-status-runs">Run lists</h2></header>
        <RunLinks />
      </section>
    </div>

    <DocumentGapPanel gap={gap.data} error={gap.error as Error | null} phone={phone} />
  </section>;
}

function ScheduleItem({ row, name }: { row: ScheduleRow; name: string }) {
  // Only browser schedules name a browser; plain-HTTP collection has none, so it shows no browser line.
  const bound = !!row.body?.resources?.browserSessionId;
  const browser = row.browser ? `${browserText(row.browser)}${row.browser.missing ? ' (no longer exists; choose another in Settings)' : row.browser.ready === false ? ' (not ready)' : ''}` : bound ? row.browser === null ? 'Its saved browser no longer exists; choose another in Settings' : 'A saved browser (named in Settings)' : null;
  const state = scheduleState(row);
  return <li>
    <div className="pc-step-title"><strong>{name}</strong><span className="pc-status" data-tone={state.tone}>{state.status}</span></div>
    <p className="rw-muted pc-wrap">{[browser && `Browser: ${browser}`, state.next, state.last].filter(Boolean).join(' · ')}</p>
    {state.retrying && <p className="pc-wrap">{state.retrying}</p>}
    {state.stopped && <p className="pc-wrap" role="note">{state.stopped}</p>}
    {(state.stopped || state.retrying) && state.error && <details><summary data-zoer-disclosure="">Zoer’s message</summary><p className="pc-wrap">{plainError(state.error)}</p></details>}
  </li>;
}

/** Where each kind of run is listed; the three lists link to each other. */
export function RunLinks({ compact = false, except }: { compact?: boolean; except?: string }) {
  const links: [string, string, string][] = [
    ['/sources#pc-runs-title', 'Collection runs', 'CanadaBuys, bids&tenders, local government and browser sites'],
    ['/scraper/history', 'BC Bid runs', 'Scrapes, details and award history'],
    ['/documents?tab=history', 'Download history', 'Attachment downloads'],
  ];
  if (compact) return <p className="pc-run-links rw-muted">Other run lists: {links.filter(([to]) => to.split('#')[0] !== except).map(([to, label], i) => <span key={to}>{i > 0 && ' · '}<PluginLink to={to.split('#')[0]}>{label}</PluginLink></span>)}</p>;
  return <ul className="pc-status-list pc-run-link-list">{links.map(([to, label, note]) => <li key={to}><PluginLink to={to.split('#')[0]}>{label}</PluginLink><small className="rw-muted">{note}</small></li>)}</ul>;
}

function DocumentGapPanel({ gap, error, phone }: { gap?: DocumentGap; error: Error | null; phone: boolean }) {
  const [all, setAll] = useState(false);
  const cells: [string, number | undefined, string][] = [
    ['Open notices', gap?.open, ''], ['With attachment links', gap?.withLinks, ''], ['Every file saved', gap?.fullySaved, 'good'],
    ['Files never tried', gap?.never, 'warn'], ['Files failed', gap?.failed, 'warn'], ['Files waiting for a browser check', gap?.waiting, 'warn'], ['No links yet (needs details)', gap?.noLinks, ''], ['Links saved, details still needed', gap?.detailsWithLinks, 'warn'], ['No public files on BC Bid', gap?.noFiles, ''],
  ];
  const shown = all ? gap?.notices ?? [] : (gap?.notices ?? []).slice(0, phone ? 4 : 8);
  return <section className="rw-panel" aria-labelledby="pc-status-gap">
    <header className="rw-panel-head"><h2 id="pc-status-gap">Documents of open BC Bid notices</h2><PluginLink to="/documents?tab=history">Download history</PluginLink></header>
    {error ? <p role="alert">The document gap could not be read: {plainError(error.message)}</p> : !gap ? <p role="status" className="rw-muted">Counting saved files…</p> : <>
      <dl className="pc-gap-grid">{cells.map(([label, value, tone]) => <div key={label} data-tone={tone && value ? tone : undefined}><dt>{label}</dt><dd>{value === undefined ? '–' : n(value)}</dd></div>)}</dl>
      <p className="rw-muted pc-wrap">{n(gap.saved)} of {n(gap.links)} attachment files saved. Counts are files linked from open notices; a notice is complete when every linked file is saved.</p>
      {gap.reasons.length > 0 && <><h3>Why files are missing</h3><ul className="pc-gap-reasons">{gap.reasons.slice(0, 6).map(reason => <li key={reason.text}><strong>{n(reason.count)}</strong><span className="pc-wrap">{reason.text}</span></li>)}</ul></>}
      {gap.notices.length > 0 && <><h3>Closing soonest with missing files</h3>
        <ul className="pc-gap-notices">{shown.map(notice => { const missing = notice.links.filter(link => link.state !== 'saved'); return <li key={notice.id}>
          <PluginLink to={`/procurement?notice=${encodeURIComponent(notice.id)}&tab=evidence`} className="rw-item-title">{notice.title}</PluginLink>
          <small className="rw-muted">{[notice.closing ? friendlyDeadline(notice.closing, Date.now()).text : 'Closing date not recorded', `${missing.length} of ${notice.links.length} files missing`].join(' · ')}</small>
        </li>; })}</ul>
        {gap.notices.length > shown.length && <Btn size="sm" variant="ghost" onClick={() => setAll(true)}>Show all {n(gap.notices.length)}</Btn>}
      </>}
    </>}
  </section>;
}

/** Home's compact status: the checklist verdict, schedules and documents in three lines, and the way to Status. */
export function StatusCard() {
  const { checklist } = useSetupStatus();
  const pick = (id: string) => checklist.steps.find(step => step.id === id);
  const lines = ['schedules', 'download-browser', 'browser-check', 'documents', 'details'].map(pick).filter((step): step is SetupStep => !!step && (step.tone === 'warn' || step.id === 'schedules' || step.id === 'documents')).slice(0, 4);
  return <section className="rw-panel pc-status-card" aria-label="Status">
    <header><h2>Status</h2><p><PluginLink to="/status">Open Status</PluginLink></p></header>
    <p><span className="pc-status" data-tone={checklist.needs ? 'warn' : 'good'}>{checklist.verdict}</span></p>
    <ul className="rw-list">{lines.map(step => <li key={step.id}><strong>{step.title}</strong> <span className="rw-muted">{step.status}</span></li>)}</ul>
  </section>;
}
