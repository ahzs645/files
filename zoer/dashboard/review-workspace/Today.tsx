import { useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { host } from '../bridge';
import { sourceName } from '../procurement/display';
import { readProcurementState } from '../procurement/state-client';
import { useSchedules } from '../procurement/ScheduleControl';
import { findSchedule, scheduleState } from '../procurement/schedule-state';
import { REVIEW_KEY } from './actions';
import { RouteLink, deadlineText } from './Home';
import { reviewScopeHref } from './queue';
import { LAST_VISIT_KEY, QUIET_DAYS, SOON_DAYS, quietPursuits, readClosingSoon, readNewSince, runsSince, visitWindow, type RunRow } from './today-data';

const SHOW = 5, PHONE_SHOW = 3; // review.css hides rows after the third on phones; the "more" links cover them.
const at = (ms: number) => new Date(ms).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
const plural = (count: number, one: string, many = one + 's') => `${count.toLocaleString()} ${count === 1 ? one : many}`;

// Read once per page load so moving around the plugin keeps the same window; this visit is recorded at once.
let session: { since: number; first: boolean } | undefined;
function useVisit() {
  const [visit, setVisit] = useState(() => {
    if (!session) {
      let stored: string | null = null;
      try { stored = localStorage.getItem(LAST_VISIT_KEY); localStorage.setItem(LAST_VISIT_KEY, String(Date.now())); } catch { /* Storage blocked: every visit is a first visit. */ }
      session = visitWindow(stored, Date.now());
    }
    return session;
  });
  const markSeen = () => { const now = Date.now(); try { localStorage.setItem(LAST_VISIT_KEY, String(now)); } catch { /* Kept for this page only. */ } session = { since: now, first: false }; setVisit(session); };
  return [visit, markSeen] as const;
}

function Column({ title, count, note, children, footer }: { title: string; count: ReactNode; note: ReactNode; children: ReactNode; footer?: ReactNode }) {
  return <section className="rw-today-col" aria-label={title}>
    <h3><span className="rw-today-count">{count}</span><span>{title}</span></h3>
    <p className="rw-today-note">{note}</p>
    {children}
    {footer}
  </section>;
}
function Row({ to, title, meta, tag }: { to: string; title: string; meta: string; tag?: string }) {
  return <li><RouteLink to={to}><span className="rw-today-title">{tag && <b className="rw-today-tag">{tag}</b>}{title}</span><span className="rw-today-meta">{meta}</span></RouteLink></li>;
}
const Failed = ({ what, error, retry }: { what: string; error: Error | null; retry: () => unknown }) => <p className="rw-error" role="alert">Could not load {what}: {error?.message ?? 'no result'}. Not shown as zero. <button type="button" onClick={() => void retry()}>Retry</button></p>;

/** Today: closing within three days, new since the last visit, pursuits gone quiet, and alert checks. */
export function Today({ source, asOf }: { source: string; asOf: number }) {
  const [visit, markSeen] = useVisit();
  const state = useQuery({ queryKey: ['catalog', 'procurement-state'], queryFn: readProcurementState });
  const pursuedIds = (state.data?.pursuits ?? []).filter(item => item.stage !== 'Closed').map(item => item.recordId);
  const soon = useQuery({ queryKey: [...REVIEW_KEY, 'home', 'today-soon', source, asOf, pursuedIds], enabled: !state.isPending, queryFn: () => readClosingSoon(source, asOf, pursuedIds), refetchInterval: 60_000 });
  const runs = useQuery({ queryKey: [...REVIEW_KEY, 'home', 'today-runs', asOf], queryFn: async () => { const s = await host('state', { summary: true }); return { runs: (s?.runs ?? []) as RunRow[], truncated: s?.runsTruncated === true }; }, refetchInterval: 60_000 });
  const win = runs.data ? runsSince(runs.data.runs, visit.since, runs.data.truncated) : null;
  const fresh = useQuery({ queryKey: [...REVIEW_KEY, 'home', 'today-new', source, asOf, win?.ids], enabled: !!win, queryFn: () => readNewSince(source, win!.ids, asOf), refetchInterval: 60_000 });
  const schedules = useSchedules();
  const quiet = state.data ? quietPursuits(state.data.pursuits, asOf, source) : [];
  const sinceText = win?.narrowed ? `since ${at(win.from)}` : visit.first ? 'in the last 24 hours' : `since ${at(visit.since)}`;

  const alerts = scheduleState(findSchedule(schedules.data, 'procurement.alerts'), asOf);
  const lastCheck = runs.data?.runs.filter(run => run.actionId === 'procurement.alerts').sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
  const checkText = !runs.data ? '' : lastCheck ? `Last check ${lastCheck.status === 'succeeded' ? 'succeeded' : lastCheck.status === 'failed' ? 'failed' : lastCheck.status} ${at(Date.parse(lastCheck.completedAt ?? lastCheck.createdAt))}` : 'No check in recent run history';

  return <section className="rw-today" aria-labelledby="rw-today-title">
    <header className="rw-today-head">
      <div><h2 id="rw-today-title">Today</h2><p>{new Date(asOf).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}{source ? ` · ${sourceName(source)}` : ''}</p></div>
    </header>
    <div className="rw-today-grid">
      <Column title={`Closing within ${SOON_DAYS} days`} count={soon.data ? soon.data.total.toLocaleString() : '–'} note="Open notices, pursued and shortlisted first."
        footer={soon.data && soon.data.total > PHONE_SHOW ? <RouteLink to={reviewScopeHref({ source: source || undefined, open: true }) + '&deadline=week&sort=deadline'} className="rw-today-more">All upcoming deadlines →</RouteLink> : null}>
        {soon.isPending || state.isPending ? <p className="rw-muted" role="status">Loading…</p> : soon.isError ? <Failed what="closing notices" error={soon.error} retry={soon.refetch} /> : soon.data.rows.length === 0 ? <p className="rw-muted">Nothing saved closes in the next {SOON_DAYS} days.</p> :
          <ul className="rw-today-list">{soon.data.rows.slice(0, SHOW).map(row => <Row key={row.id} to={`/procurement?notice=${encodeURIComponent(row.id)}`} title={row.title || row.id} tag={row.pursued ? 'Pursuing' : row.shortlisted ? 'Shortlisted' : undefined}
            meta={[deadlineText(row.closing, asOf).text, row.buyer, source ? '' : sourceName(row.sourceId)].filter(Boolean).join(' · ')} />)}</ul>}
      </Column>

      <Column title="New since your last visit" count={fresh.data ? fresh.data.total.toLocaleString() : '–'} note={<>First saved {sinceText}.{fresh.data && fresh.data.total > 0 && <> <button type="button" className="rw-today-seen" onClick={markSeen}>Mark as seen</button></>}</>}
        footer={win?.narrowed ? <p className="rw-today-note">Zoer lists only recent runs, so earlier ones are not counted.</p> : null}>
        {runs.isError ? <Failed what="run history" error={runs.error} retry={runs.refetch} /> : !win || fresh.isPending ? <p className="rw-muted" role="status">Loading…</p> : fresh.isError ? <Failed what="new notices" error={fresh.error} retry={fresh.refetch} /> :
          win.ids.length === 0 ? <p className="rw-muted">No collection ran {sinceText}, so nothing new was saved.</p> : fresh.data.total === 0 ? <p className="rw-muted">{plural(win.ids.length, 'collection run')} {sinceText}; no notice was new.</p> : <>
            <ul className="rw-today-sources">{fresh.data.bySource.map(row => <li key={row.sourceId}><RouteLink to={`/procurement?source=${encodeURIComponent(row.sourceId)}`} className="rw-chip"><b>{row.count.toLocaleString()}</b> {sourceName(row.sourceId)}</RouteLink></li>)}</ul>
            {fresh.data.rows.length === 0 ? <p className="rw-muted">None of them is still open.</p> : <ul className="rw-today-list">{fresh.data.rows.slice(0, SHOW).map(row => <Row key={row.id} to={`/procurement?notice=${encodeURIComponent(row.id)}`} title={row.title || row.id}
              meta={[source ? '' : sourceName(row.sourceId), row.buyer, row.closing ? `closes ${deadlineText(row.closing, asOf).text}` : 'no deadline given'].filter(Boolean).join(' · ')} />)}</ul>}
            {fresh.data.openTotal > PHONE_SHOW && <p className="rw-today-note">{plural(fresh.data.openTotal, 'open notice')} in all; open a source above to see them.</p>}
          </>}
      </Column>

      <Column title="Pursuits gone quiet" count={state.data ? quiet.length.toLocaleString() : '–'} note={`Watching, reviewing or preparing, with no update in ${QUIET_DAYS} days.`}
        footer={quiet.length > PHONE_SHOW ? <RouteLink to="/pursuits" className="rw-today-more">All pursuits →</RouteLink> : null}>
        {state.isPending ? <p className="rw-muted" role="status">Loading…</p> : state.isError ? <Failed what="pursuits" error={state.error} retry={state.refetch} /> : quiet.length === 0 ? <p className="rw-muted">{state.data.pursuits.length ? `Every active pursuit was updated in the last ${QUIET_DAYS} days.` : 'No pursuits yet.'}</p> :
          <ul className="rw-today-list">{quiet.slice(0, SHOW).map(item => <Row key={item.recordId} to={`/pursuits?notice=${encodeURIComponent(item.recordId)}`} title={item.title || item.recordId}
            meta={[item.stage, item.idleDays === null ? 'last update unknown' : `no update for ${item.idleDays} days`].join(' · ')} />)}</ul>}
      </Column>
    </div>
    <footer className="rw-today-alerts">
      <span><b>Alerts</b> <span className="pc-status" data-tone={schedules.error ? 'warn' : alerts.tone}>{schedules.isPending ? 'Loading…' : schedules.error ? 'Schedule unknown' : alerts.status}</span></span>
      <span className="rw-muted">{[alerts.stopped ? 'Zoer stopped the alert schedule; open alert settings to see why' : alerts.next, runs.isError ? 'Run history unavailable' : checkText].filter(Boolean).join(' · ')}</span>
      <RouteLink to="/procurement?view=saved" className="rw-today-more">Alert settings →</RouteLink>
    </footer>
  </section>;
}
