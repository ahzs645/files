import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronRight, RefreshCw } from 'lucide-react';
import { Btn, Select } from '@zoer/plugin-ui/controls';
import { deadlineState, parseDeadline } from '@bcbid/procurement-core';
import { navigatePlugin, patchPluginQuery, pluginHref, usePluginLocation } from '../navigation';
import { INVENTORY_SQL, sourceName, sql } from '../procurement/display';
import { readProcurementState } from '../procurement/state-client';
import { PURSUIT_STAGES } from '../procurement/state-contract';
import { REVIEW_KEY, useReviewWorkspace } from './actions';
import { useActiveProfile } from './profile-context';
import { ProfilePicker } from './ProfilePicker';
import { label } from './queries';
import { ACQUIRE_REASON_TEXT, QUEUES, QUEUE_TEXT, queueSql, reviewScopeHref, type QueueId } from './queue';
import { readAttentionSummary, readCoverage, readDeadlines, readPolicies, readQueue, readRecentDecisions, readReviewCoverage, readSourceHealth } from './home-data';
import './review.css';

/** One short line per queue for the compact attention row (QUEUE_TEXT's own description is the long form, kept for its title attribute). */
const QUEUE_SUMMARY: Record<QueueId, string> = {
  acquire: 'Missing links, downloads, or usable text.',
  requirements: 'Extracted requirements awaiting a reviewer decision.',
  eligibility: 'Unresolved eligibility or an unknown requirement match.',
  changes: 'Unacknowledged changes or decisions to reconfirm.',
  decide: 'Ready for a decision; nothing decided yet.',
};

const n = (value: unknown) => Number(value ?? 0).toLocaleString();
export const when = (value: unknown) => typeof value === 'string' && Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : 'Not recorded';
const plural = (count: number, one: string, many = one + 's') => `${count.toLocaleString()} ${count === 1 ? one : many}`;

/** In-plugin link: a real href for new tabs, host navigation for plain clicks. */
export function RouteLink({ to, children, className, label: aria }: { to: string; children: ReactNode; className?: string; label?: string }) {
  return <a href={pluginHref(to)} className={className} aria-label={aria} onClick={event => { if (!event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey) { event.preventDefault(); navigatePlugin(to); } }}>{children}</a>;
}
export function Panel({ title, note, children, className }: { title: string; note?: ReactNode; children: ReactNode; className?: string }) {
  return <section className={`rw-panel${className ? ' ' + className : ''}`} aria-label={title}><header><h2>{title}</h2>{note && <p>{note}</p>}</header>{children}</section>;
}
/** Explicit loading and error states: a failed read never renders as zero. */
export function Loadable<T>({ query, children, what }: { query: { isPending: boolean; isError: boolean; error: Error | null; data: T | undefined; refetch: () => unknown }; children: (data: T) => ReactNode; what: string }) {
  if (query.isPending) return <p className="rw-muted" role="status">Loading {what}…</p>;
  if (query.isError || query.data === undefined) return <p className="rw-error" role="alert">Could not load {what}: {query.error?.message ?? 'no result'}. Counts are not shown as zero. <button type="button" onClick={() => void query.refetch()}>Retry</button></p>;
  return <>{children(query.data)}</>;
}

/** Deadline text from the core parser: precision is explicit and a date-only deadline today stays "time unverified". */
export function deadlineText(raw: unknown, asOf: number): { text: string; state: string } {
  const value = parseDeadline(typeof raw === 'string' ? raw : null), state = deadlineState(value, asOf);
  if (value.precision === 'unknown') return { text: typeof raw === 'string' && raw.trim() ? `${raw} (unrecognized date)` : 'Deadline not provided', state };
  if (state === 'closing_today_time_unverified') return { text: `${value.date} · closing date today; time unverified`, state };
  if (value.precision === 'instant' && value.iso) {
    const days = Math.ceil((Date.parse(value.iso) - asOf) / 86_400_000);
    return { text: `${new Date(value.iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}${state === 'open' ? ` · ${days <= 1 ? 'within a day' : `${days} days left`}` : ''}`, state };
  }
  return { text: `${value.date} · ${value.precision === 'range' ? 'date range; time unverified' : 'date only; time unverified'}`, state };
}

type RowStatus = 'pending' | 'error' | 'blocked' | 'zero' | 'active';

/** One compact row: count, title, one muted line, and the whole row is the drill-down link. Examples are opt-in via disclosure. */
function QueueRow({ queue, profile, source, asOf, available, workspacePending, onStatus }: { queue: QueueId; profile: string | null; source: string; asOf: number; available: boolean; workspacePending: boolean; onStatus: (queue: QueueId, status: RowStatus) => void }) {
  const legacy = queue === 'acquire', unavailable = queueSql(queue, profile).unavailable;
  const enabled = (legacy || available) && !unavailable;
  const result = useQuery({ queryKey: [...REVIEW_KEY, 'home', 'queue', queue, profile, source, asOf], enabled, queryFn: () => readQueue(queue, profile, source, asOf), refetchInterval: 60_000 });
  const text = QUEUE_TEXT[queue], profiled = queue === 'eligibility' || queue === 'changes' || queue === 'decide';
  const href = reviewScopeHref({ source: source || undefined, queue, ...(profiled ? { profile } : {}) });
  const status: RowStatus = unavailable ? 'blocked' : !enabled ? 'pending' : result.isPending ? 'pending' : result.isError ? 'error' : result.data?.total === 0 ? 'zero' : 'active';
  const heading = `rw-queue-${queue}`;
  useEffect(() => { onStatus(queue, status); }, [queue, status, onStatus]);

  if (status === 'blocked') return <li className="rw-queue-row rw-queue-row--note" data-queue={queue} aria-labelledby={heading}>
    <span className="rw-queue-dash" aria-hidden="true">–</span>
    <div><h3 id={heading}>{text.title}</h3><p className="rw-muted">Choose a profile to resolve eligibility</p></div>
  </li>;
  if (status === 'zero') return null;

  const line = status === 'pending' ? (workspacePending ? 'Checking the review workspace…' : 'Loading…') : status === 'error' ? `Could not load: ${result.error?.message ?? 'no result'}` : QUEUE_SUMMARY[queue];
  return <li className="rw-queue-row" data-queue={queue} aria-labelledby={heading}>
    <RouteLink to={href} className="rw-queue-link" label={`${text.title}: ${status === 'active' ? n(result.data!.total) : line}`}>
      <span className="rw-queue-count" title={text.description}>{status === 'active' ? n(result.data!.total) : '–'}</span>
      <span className="rw-queue-text"><h3 id={heading}>{text.title}</h3><p className={status === 'error' ? 'rw-bad' : 'rw-muted'}>{line}</p></span>
      <ChevronRight size={16} className="rw-queue-chevron" aria-hidden="true" />
    </RouteLink>
    {status === 'active' && result.data!.items.length > 0 && <details className="rw-queue-examples">
      <summary>Show examples</summary>
      <ul className="rw-queue-items">{result.data!.items.map(item => <li key={item.id}>
        <RouteLink to={`/procurement?notice=${encodeURIComponent(item.id)}`} className="rw-item-title">{item.title || item.id}</RouteLink>
        <span className="rw-item-meta">{[item.buyer, deadlineText(item.closing, asOf).text, item.reason ? ACQUIRE_REASON_TEXT[item.reason as keyof typeof ACQUIRE_REASON_TEXT] : ''].filter(Boolean).join(' · ')}</span>
      </li>)}{result.data!.total > result.data!.items.length && <li className="rw-muted">and {n(result.data!.total - result.data!.items.length)} more</li>}</ul>
    </details>}
  </li>;
}

/** Needs your attention: one row per queue; groups with nothing to review collapse into a single line at the bottom. */
function NeedsAttention({ profile, source, asOf, available, workspacePending }: { profile: string | null; source: string; asOf: number; available: boolean; workspacePending: boolean }) {
  const [status, setStatus] = useState<Partial<Record<QueueId, RowStatus>>>({});
  const onStatus = useCallback((queue: QueueId, s: RowStatus) => setStatus(prev => prev[queue] === s ? prev : { ...prev, [queue]: s }), []);
  const zeroQueues = QUEUES.filter(q => status[q] === 'zero');
  return <Panel title="Needs your attention" className="rw-attention">
    <ol className="rw-queues">{QUEUES.map(queue => <QueueRow key={queue} queue={queue} profile={profile} source={source} asOf={asOf} available={available} workspacePending={workspacePending} onStatus={onStatus} />)}</ol>
    {zeroQueues.length > 0 && <p className="rw-muted rw-queue-empty">Nothing to review: {zeroQueues.map(q => QUEUE_TEXT[q].title.toLowerCase()).join(', ')}</p>}
  </Panel>;
}

/** KPI tiles: each links to the same drill-down scope as the row/cell it summarizes. */
type Tone = 'info' | 'teal' | 'violet' | 'ok' | 'warn' | 'bad';
function Tile({ href, count, title, note, tone }: { href: string; count: ReactNode; title: string; note: ReactNode; tone: Tone }) {
  return <RouteLink to={href} className={`rw-tile rw-tone-${tone}`}><span className="rw-tile-count">{count}</span><span className="rw-tile-title">{title}</span><span className="rw-tile-note">{note}</span></RouteLink>;
}
function AttentionTiles({ source, profile, active, asOf, available }: { source: string; profile: string | null; active: boolean; asOf: number; available: boolean }) {
  const summary = useQuery({ queryKey: [...REVIEW_KEY, 'home', 'attention', source, profile, asOf], queryFn: () => readAttentionSummary(source, profile, asOf), refetchInterval: 60_000 });
  const decide = useQuery({ queryKey: [...REVIEW_KEY, 'home', 'queue', 'decide', profile, source, asOf], enabled: available, queryFn: () => readQueue('decide', profile, source, asOf), refetchInterval: 60_000 });
  const changes = useQuery({ queryKey: [...REVIEW_KEY, 'home', 'queue', 'changes', profile, source, asOf], enabled: available, queryFn: () => readQueue('changes', profile, source, asOf), refetchInterval: 60_000 });
  const dash = <span className="rw-muted">–</span>;
  return <div className="rw-tiles">
    <Tile href={reviewScopeHref({ source: source || undefined, open: true })} tone="info" title="Open opportunities" note="Saved in Zoer" count={summary.data ? n(summary.data.open) : dash} />
    <Tile href={active ? reviewScopeHref({ source: source || undefined, open: true, readiness: 'conditions', profile }) : '/profiles'} tone="warn" title="Need information" note={active ? 'Needs information or investigation' : 'Choose a profile'} count={active ? (summary.data ? n(summary.data.needInfo) : dash) : dash} />
    <Tile href={reviewScopeHref({ source: source || undefined, queue: 'decide', profile })} tone="ok" title="Ready for your decision" note="Nothing is approved automatically" count={!available ? dash : decide.data ? n(decide.data.total) : dash} />
    <Tile href={reviewScopeHref({ source: source || undefined, queue: 'changes', profile })} tone="violet" title="Decisions to reconfirm" note="Evidence or scope changed" count={!available ? dash : changes.data ? n(changes.data.total) : dash} />
  </div>;
}

/** A stage row: label, "x / y", and a thin bar — no bar when the denominator is unknown or zero. */
function CovRow({ name, value, of, tone = 'info' }: { name: string; value: number; of?: number; tone?: Tone }) {
  const ratio = of ? Math.min(1, value / of) : null;
  return <div className={`rw-cov-row rw-tone-${tone}`}>
    <div className="rw-cov-label"><span>{name}</span><span>{of === undefined ? <>{n(value)} <span className="rw-muted">· source total unknown</span></> : `${n(value)} / ${n(of)}`}</span></div>
    {ratio !== null && <div className="rw-cov-bar"><div style={{ width: `${ratio * 100}%` }} /></div>}
  </div>;
}
function Coverage({ source, profile, available }: { source: string; profile: string | null; available: boolean }) {
  const legacy = useQuery({ queryKey: [...REVIEW_KEY, 'home', 'coverage', source], queryFn: () => readCoverage(source), refetchInterval: 60_000 });
  const review = useQuery({ queryKey: [...REVIEW_KEY, 'home', 'review-coverage', source, profile], enabled: available, queryFn: () => readReviewCoverage(source, profile), refetchInterval: 60_000 });
  return <Panel title="Coverage" note={<RouteLink to="/documents">Documents</RouteLink>}>
    <Loadable query={legacy} what="coverage">{c => { const saved = Number(c.saved ?? 0); return <div className="rw-cov">
      <CovRow name="Saved notices" value={saved} />
      {Number(c.unchecked ?? 0) > 0 && <CovRow name="Attachments not checked" value={c.unchecked} of={saved} tone="warn" />}
      <CovRow name="With attachment links" value={c.linked} of={saved} />
      <CovRow name="With downloaded files" value={c.withFiles} of={saved} tone="teal" />
      <CovRow name="Files readable by AI" value={c.usable} of={c.files} tone="teal" />
      {available && (review.isPending ? <p className="rw-muted">Loading review stages…</p> : review.isError || !review.data ? <p className="rw-error">Could not load review stages: {review.error?.message}</p> : <>
        <CovRow name="Triaged" value={review.data.triaged} of={saved} tone="violet" />
        <CovRow name="Requirements extracted" value={review.data.extracted} of={saved} tone="violet" />
        <CovRow name={profile ? 'Assessed for this profile' : 'Assessed (no profile)'} value={review.data.assessed} of={saved} tone="ok" />
      </>)}
    </div>; }}</Loadable>
  </Panel>;
}

const BATCH_KINDS: Record<string, string> = { download: 'Document downloads', review: 'AI reviews', 'document-review': 'Document reviews', 'document-synthesis': 'Document synthesis', 'record-review': 'Notice reviews', 'host-action': 'Review pipeline', 'procurement-extract': 'Requirement extraction', 'procurement-triage': 'Notice triage' };
function SourceHealth({ inventory }: { inventory: any[] | undefined }) {
  const health = useQuery({ queryKey: [...REVIEW_KEY, 'home', 'source-health'], queryFn: readSourceHealth, refetchInterval: 30_000 });
  const sources = new Map<string, { count: number; importedAt: string | null }>();
  for (const row of inventory ?? []) if (row.kind === 'opportunity') sources.set(row.sourceId, { count: Number(row.count), importedAt: row.importedAt ?? null });
  return <Panel title="Source health" note={<RouteLink to="/sources">Sources</RouteLink>}>
    {sources.size > 0 && <ul className="rw-list">{[...sources].map(([id, s]) => <li key={id}><strong>{sourceName(id)}</strong> <span className="rw-muted">{plural(s.count, 'saved notice')}{s.importedAt ? ` · last import ${when(s.importedAt)}` : ''}</span></li>)}</ul>}
    <Loadable query={health} what="batch history">{kinds => kinds.length === 0 ? <p className="rw-muted">No batches recorded yet.</p> : <ul className="rw-list">{kinds.map(k => <li key={k.kind}>
      <strong>{BATCH_KINDS[k.kind] ?? k.kind}</strong>
      <span className="rw-muted">Last succeeded: {k.succeeded ? when(k.succeeded) : 'no successful run recorded'}{k.running ? ` · ${k.running} running` : ''}</span>
      {k.partial && <details className="rw-queue-examples"><summary className="rw-warn">Partial run {when(k.partial.at)}: {n(k.partial.completed)}/{n(k.partial.total)} succeeded</summary><p className="rw-muted">{n(k.partial.failed)} failed of {n(k.partial.total)}. Saved results are kept.</p></details>}
      {k.failed && <details className="rw-queue-examples"><summary className="rw-bad">Failed attempt {when(k.failed.at)}</summary><p className="rw-muted">{k.failed.error || 'No error message recorded.'} Earlier saved results are kept.</p></details>}
    </li>)}</ul>}</Loadable>
  </Panel>;
}

function RecentDecisions({ source }: { source: string }) {
  const decisions = useQuery({ queryKey: [...REVIEW_KEY, 'home', 'decisions', source], refetchInterval: 60_000, queryFn: () => readRecentDecisions(source) });
  return <Panel title="Recent decisions">
    <Loadable query={decisions} what="decisions">{rows => rows.length === 0 ? <p className="rw-muted">No human decisions recorded yet.</p> : <ul className="rw-list">{rows.map(row => <li key={row.id}>
      <RouteLink to={`/procurement?notice=${encodeURIComponent(row.recordId)}&tab=decision`} className="rw-item-title">{row.title || row.recordId}</RouteLink>
      <span className="rw-muted"><b className="rw-decision">{label(row.decision)}</b> · {row.actor} · {when(row.createdAt)}</span>
      {Number(row.reconfirm) === 1 && <span className="rw-chip" data-tone="stale"><b>Evidence changed; reconfirm this decision</b></span>}
      {row.note && <span className="rw-note">{row.note}</span>}
    </li>)}</ul>}</Loadable>
  </Panel>;
}

function Deadlines({ source, asOf }: { source: string; asOf: number }) {
  const deadlines = useQuery({ queryKey: [...REVIEW_KEY, 'home', 'deadlines', source, asOf], refetchInterval: 60_000, queryFn: () => readDeadlines(source, asOf) });
  return <Panel title="Closing in the next 14 days">
    <Loadable query={deadlines} what="deadlines">{({ total, rows }) => {
      if (rows.length === 0) return <p className="rw-muted">Nothing saved closes in the next 14 days.</p>;
      // Date-only deadlines falling today share one group header instead of repeating the caveat on every row.
      const dated = rows.map(row => ({ row, d: deadlineText(row.closing, asOf) }));
      const today = dated.filter(item => item.d.state === 'closing_today_time_unverified'), later = dated.filter(item => item.d.state !== 'closing_today_time_unverified');
      const item = ({ row, d }: typeof dated[number], dateOnly: boolean) => <li key={row.id}>
        <RouteLink to={`/procurement?notice=${encodeURIComponent(row.id)}`} className="rw-item-title">{row.title || row.id}</RouteLink>
        <span className="rw-muted">{[row.buyer, dateOnly ? null : d.text].filter(Boolean).join(' · ')}</span>
      </li>;
      return <>
        {today.length > 0 && <><h3 className="rw-group-title">Closes today (time unverified)</h3><ul className="rw-list">{today.map(entry => item(entry, true))}</ul></>}
        {later.length > 0 && <>{today.length > 0 && <h3 className="rw-group-title">Later</h3>}<ul className="rw-list">{later.map(entry => item(entry, false))}</ul></>}
        {total > rows.length && <RouteLink to={reviewScopeHref({ source: source || undefined, open: true }) + '&sort=deadline'} className="rw-drill">{plural(total, 'notice')} in the next 14 days · see all →</RouteLink>}
      </>;
    }}</Loadable>
  </Panel>;
}

function PursuitSummary() {
  const state = useQuery({ queryKey: ['catalog', 'procurement-state'], queryFn: readProcurementState });
  return <Panel title="Pursuits" note={<RouteLink to="/pursuits">Open the board</RouteLink>}>
    <Loadable query={state} what="pursuits">{({ pursuits }) => pursuits.length === 0 ? <p className="rw-muted">No pursuits yet. Add a notice to the board from its detail view.</p> : <dl className="rw-stats rw-stats-inline">{PURSUIT_STAGES.map(stage => <div key={stage}><dt>{stage}</dt><dd>{n(pursuits.filter(p => p.stage === stage).length)}</dd></div>)}</dl>}</Loadable>
  </Panel>;
}

/** Home: what we have collected, what can be reviewed, and where to act, within one named scope. */
export function Home() {
  const location = usePluginLocation(), source = new URLSearchParams(location.split('?')[1]).get('source') ?? '';
  const workspace = useReviewWorkspace(), available = workspace.data?.available === true;
  const { profileVersionId, active } = useActiveProfile();
  const [asOf, setAsOf] = useState(() => Date.now()), client = useQueryClient();
  const inventory = useQuery({ queryKey: [...REVIEW_KEY, 'home', 'inventory'], queryFn: () => sql(INVENTORY_SQL), refetchInterval: 60_000 });
  const policies = useQuery({ queryKey: [...REVIEW_KEY, 'home', 'policies', profileVersionId], enabled: available, queryFn: () => readPolicies(profileVersionId) });
  const sources = [...new Set((inventory.data ?? []).filter(row => row.kind === 'opportunity').map(row => String(row.sourceId)))];
  const refresh = () => { setAsOf(Date.now()); void client.invalidateQueries({ queryKey: [...REVIEW_KEY, 'home'] }); };
  const policy = !available ? (workspace.isPending ? 'Checking…' : 'Requires the review workspace') : policies.isPending ? 'Loading…' : policies.isError ? 'Could not load' : policies.data?.length ? `Assessment policy: ${policies.data.map(row => `${row.policy} (${plural(Number(row.count), 'assessment')})`).join(', ')}` : 'No current assessments for this profile';
  return <div className="rw-home procurement-workspace">
    <header className="rw-scope" aria-label="Scope">
      <div className="rw-scope-title"><h1>What needs attention?</h1><p>{source ? sourceName(source) : 'All saved sources'} · as of {when(new Date(asOf).toISOString())}</p></div>
      <div className="rw-controls">
        <label className="rw-control"><span>Source</span><Select aria-label="Source" presentation="dropdown" searchable={false} value={source} onChange={event => patchPluginQuery({ source: event.target.value || null })}><option value="">All saved sources</option>{sources.map(id => <option key={id} value={id}>{sourceName(id)}</option>)}</Select></label>
        {available ? <span title={policy}><ProfilePicker /></span> : <span className="rw-muted">{workspace.isPending ? 'Checking the review workspace…' : 'Requires the review workspace'}</span>}
        <Btn size="sm" variant="secondary" icon={<RefreshCw size={14} />} onClick={refresh} tooltip={`As of ${when(new Date(asOf).toISOString())}`}>Refresh</Btn>
      </div>
    </header>
    {!workspace.isPending && !available && <p className="rw-upgrade" role="status">{workspace.data?.reason ?? 'Update Zoer to use the review workspace.'} Saved notices, documents, deadlines and pursuits are still shown below.</p>}
    <AttentionTiles source={source} profile={profileVersionId} active={active !== null} asOf={asOf} available={available} />
    {/* Two independent columns, so a long panel on one side never leaves a gap on the other. */}
    <div className="rw-home-grid">
      <div className="rw-home-main">
        <NeedsAttention profile={profileVersionId} source={source} asOf={asOf} available={available} workspacePending={workspace.isPending} />
        <Deadlines source={source} asOf={asOf} />
      </div>
      <div className="rw-home-side">
        <Coverage source={source} profile={profileVersionId} available={available} />
        {available && <RecentDecisions source={source} />}
        <PursuitSummary />
        <SourceHealth inventory={inventory.data} />
      </div>
    </div>
  </div>;
}
