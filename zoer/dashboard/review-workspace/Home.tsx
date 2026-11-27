import { Hint } from '../host-ui';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Building2, ChevronRight, RefreshCw } from 'lucide-react';
import { Btn, Select } from '@zoer/plugin-ui/controls';
import { navigatePlugin, patchPluginQuery, pluginHref, usePluginLocation } from '../navigation';
import { useCapabilities } from '../capabilities';
import { INVENTORY_SQL, sourceName, sql } from '../procurement/display';
import { readProcurementState } from '../procurement/state-client';
import { PURSUIT_STAGES } from '../procurement/state-contract';
import { REVIEW_KEY, useReviewWorkspace } from './actions';
import { useActiveProfile } from './profile-context';
import { ProfilePicker } from './ProfilePicker';
import { label } from './queries';
import { ACQUIRE_REASON_TEXT, QUEUES, QUEUE_TEXT, queueSql, reviewScopeHref, type QueueId } from './queue';
import { Today } from './Today';
import { SOON_DAYS } from './today-data';
import { friendlyDeadline } from './deadline-text';
import { profileState, readAttentionSummary, readDeadlines, readPolicies, readProfileNames, readQueue, readQueueExamples, readRecentDecisions, type ProfileState } from './home-data';
import { OperationsLine } from './OperationsLine';
import { count, plural, when as shortWhen } from '../format';
import './review.css';

/** One short line per queue for the compact attention row (QUEUE_TEXT's own description is the long form, kept for its title attribute). */
const QUEUE_SUMMARY: Record<QueueId, string> = {
  acquire: 'Open notices with no attachment list yet, no file saved yet, or only unreadable files.',
  requirements: 'Extracted requirements awaiting a reviewer decision.',
  eligibility: 'Unresolved eligibility or an unknown requirement match.',
  changes: 'Unacknowledged changes or decisions to reconfirm.',
  decide: 'Ready for a decision; nothing decided yet.',
};

const n = count;
/** One timestamp format (format.ts `when`); kept as an export for Insights. */
export const when = (value: unknown) => shortWhen(value);

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

/**
 * Deadline text from the core parser: a short line ("Tue, Oct 20 · 2 days left", "Today") with the precision caveat
 * ("date only; closing time not verified") and the source text in `detail`, for a tooltip.
 */
export function deadlineText(raw: unknown, asOf: number): { text: string; state: string; detail: string } {
  const { text, state, detail } = friendlyDeadline(raw, asOf);
  return { text, state, detail };
}

type RowStatus = 'pending' | 'error' | 'blocked' | 'zero' | 'active';

/** One compact row: count, title, one muted line, and the whole row is the drill-down link. Examples are opt-in via disclosure. */
function QueueRow({ queue, profile, source, asOf, available, workspacePending, onStatus }: { queue: QueueId; profile: string | null; source: string; asOf: number; available: boolean; workspacePending: boolean; onStatus: (queue: QueueId, status: RowStatus) => void }) {
  const legacy = queue === 'acquire', unavailable = queueSql(queue, profile).unavailable;
  const enabled = (legacy || available) && !unavailable;
  const key = [...REVIEW_KEY, 'home', 'queue', queue, profile, source, asOf];
  const result = useQuery({ queryKey: key, enabled, queryFn: () => readQueue(queue, profile, source, asOf), refetchInterval: 60_000 });
  const [examplesOpen, setExamplesOpen] = useState(false);
  const examples = useQuery({
    queryKey: [...key, 'examples'], enabled: enabled && examplesOpen && (result.data ?? 0) > 0,
    queryFn: () => readQueueExamples(queue, profile, source, asOf), refetchInterval: 60_000,
  });
  const text = QUEUE_TEXT[queue], profiled = queue === 'eligibility' || queue === 'changes' || queue === 'decide';
  const href = reviewScopeHref({ source: source || undefined, queue, ...(profiled ? { profile } : {}) });
  const status: RowStatus = unavailable ? 'blocked' : !enabled ? 'pending' : result.isPending ? 'pending' : result.isError ? 'error' : result.data === 0 ? 'zero' : 'active';
  const heading = `rw-queue-${queue}`;
  useEffect(() => { onStatus(queue, status); }, [queue, status, onStatus]);

  // A queue that needs a profile is covered by the page's one profile prompt.
  if (status === 'blocked' || status === 'zero') return null;

  const line = status === 'pending' ? (workspacePending ? 'Checking the review workspace…' : 'Loading…') : status === 'error' ? `Could not load: ${result.error?.message ?? 'no result'}` : QUEUE_SUMMARY[queue];
  return <li className="rw-queue-row" data-queue={queue} aria-labelledby={heading}>
    <RouteLink to={href} className="rw-queue-link" label={`${text.title}: ${status === 'active' ? n(result.data) : line}`}>
      <Hint content={text.description}><span className="rw-queue-count">{status === 'active' ? n(result.data) : '…'}</span></Hint>
      <span className="rw-queue-text"><h3 id={heading}>{text.title}</h3><p className={status === 'error' ? 'rw-bad' : 'rw-muted'}>{line}</p></span>
      <ChevronRight size={16} className="rw-queue-chevron" aria-hidden="true" />
    </RouteLink>
    {status === 'active' && <details className="rw-queue-examples" open={examplesOpen} onToggle={event => setExamplesOpen(event.currentTarget.open)}>
      <summary data-zoer-disclosure="">Show examples</summary>
      {examplesOpen && <Loadable query={examples} what="examples">{items => <ul className="rw-queue-items">{items.map(item => <li key={item.id}>
        <RouteLink to={`/procurement?notice=${encodeURIComponent(item.id)}`} className="rw-item-title">{item.title || item.id}</RouteLink>
        <Hint content={deadlineText(item.closing, asOf).detail || undefined}><span className="rw-item-meta">{[item.buyer, deadlineText(item.closing, asOf).text, item.reason ? ACQUIRE_REASON_TEXT[item.reason as keyof typeof ACQUIRE_REASON_TEXT] : ''].filter(Boolean).join(' · ')}</span></Hint>
      </li>)}{(result.data ?? 0) > items.length && <li className="rw-muted">and {n((result.data ?? 0) - items.length)} more</li>}</ul>}</Loadable>}
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
    {zeroQueues.length > 0 && <p className="rw-muted rw-queue-empty">Nothing waiting in: {zeroQueues.map(q => QUEUE_TEXT[q].title).join(' · ')}</p>}
  </Panel>;
}

/** KPI tiles: each links to the same drill-down scope as the row/cell it summarizes. */
type Tone = 'info' | 'teal' | 'violet' | 'ok' | 'warn' | 'bad';
function Tile({ href, count, title, note, tone }: { href: string; count: ReactNode; title: string; note: ReactNode; tone: Tone }) {
  return <RouteLink to={href} className={`rw-tile rw-tone-${tone}`}><span className="rw-tile-count">{count}</span><span className="rw-tile-title">{title}</span><span className="rw-tile-note">{note}</span></RouteLink>;
}
/** KPI tiles. Profile-dependent tiles show only with a chosen profile; without one the page's profile prompt stands in for them. */
function AttentionTiles({ source, profile, active, asOf, available }: { source: string; profile: string | null; active: boolean; asOf: number; available: boolean }) {
  const summary = useQuery({ queryKey: [...REVIEW_KEY, 'home', 'attention', source, profile, asOf], queryFn: () => readAttentionSummary(source, profile, asOf), refetchInterval: 60_000 });
  const scored = active && available;
  const decide = useQuery({ queryKey: [...REVIEW_KEY, 'home', 'queue', 'decide', profile, source, asOf], enabled: scored, queryFn: () => readQueue('decide', profile, source, asOf), refetchInterval: 60_000 });
  const changes = useQuery({ queryKey: [...REVIEW_KEY, 'home', 'queue', 'changes', profile, source, asOf], enabled: scored, queryFn: () => readQueue('changes', profile, source, asOf), refetchInterval: 60_000 });
  const loading = <span className="rw-muted" aria-label="Loading">…</span>, { writes } = useCapabilities();
  return <div className="rw-tiles" data-count={scored ? 4 : 1}>
    <Tile href={reviewScopeHref({ source: source || undefined, open: true })} tone="info" title={source ? `Open ${sourceName(source)} opportunities` : 'Open opportunities (all sources)'} note={writes ? 'Saved in Zoer, each counted once' : 'In this published copy, each counted once'} count={summary.data ? n(summary.data.open) : loading} />
    {scored && <>
      <Tile href={reviewScopeHref({ source: source || undefined, open: true, readiness: 'conditions', profile })} tone="warn" title="Need information" note="Needs information or investigation" count={summary.data ? n(summary.data.needInfo) : loading} />
      <Tile href={reviewScopeHref({ source: source || undefined, queue: 'decide', profile })} tone="ok" title="Ready for your decision" note="You decide each one" count={decide.data !== undefined ? n(decide.data) : loading} />
      <Tile href={reviewScopeHref({ source: source || undefined, queue: 'changes', profile })} tone="violet" title="Decisions to reconfirm" note="Evidence or scope changed" count={changes.data !== undefined ? n(changes.data) : loading} />
    </>}
  </div>;
}

/** The one profile prompt on Home, worded for the real state (no profile, an unpublished draft, or none chosen). */
function ProfilePrompt({ state }: { state: ProfileState }) {
  const { writes } = useCapabilities();
  if (state.state === 'chosen') return null;
  const [title, text] = state.state === 'unchosen' ? ['Choose a profile', 'Fit, eligibility and decisions are assessed against a company profile.']
    : state.state === 'draft-only' ? ['Publish your profile', `${state.draftName ? `“${state.draftName}”` : 'Your company profile'} is a draft. Publish it to assess fit, eligibility and decisions.`]
    : ['Create a company profile', 'Fit, eligibility and decisions are assessed against one.'];
  return <section className="rw-panel rw-profile-prompt" aria-label="Company profile">
    <Building2 aria-hidden="true" size={20} />
    <div><h2>{title}</h2><p className="rw-muted">{text}</p></div>
    {state.state === 'unchosen' ? <div className="rw-choose-profile"><ProfilePicker label={false} /></div> : writes ? <RouteLink to="/profiles" className="rw-drill">Open Setup › Profiles</RouteLink> : null}
  </section>;
}

function RecentDecisions({ source }: { source: string }) {
  const decisions = useQuery({ queryKey: [...REVIEW_KEY, 'home', 'decisions', source], refetchInterval: 60_000, queryFn: () => readRecentDecisions(source) });
  // Empty: one quiet line, not a card.
  if (decisions.data?.length === 0) return <p className="rw-muted rw-quiet-line">Recent decisions: none recorded yet.</p>;
  return <Panel title="Recent decisions">
    <Loadable query={decisions} what="decisions">{rows => rows.length === 0 ? null : <ul className="rw-list">{rows.map(row => <li key={row.id}>
      <RouteLink to={`/procurement?notice=${encodeURIComponent(row.recordId)}&tab=decision`} className="rw-item-title">{row.title || row.recordId}</RouteLink>
      <span className="rw-muted"><b className="rw-decision">{label(row.decision)}</b> · {row.actor} · {when(row.createdAt)}</span>
      {Number(row.reconfirm) === 1 && <span className="rw-chip" data-tone="stale"><b>Evidence changed; reconfirm this decision</b></span>}
      {row.note && <span className="rw-note">{row.note}</span>}
    </li>)}</ul>}</Loadable>
  </Panel>;
}

/** Days SOON_DAYS + 1 to 14: Today's "Closing within 3 days" column already lists the nearer ones, so they never repeat here. */
const LATER_TITLE = `Closing in ${SOON_DAYS + 1}–14 days`;
function Deadlines({ source, asOf }: { source: string; asOf: number }) {
  const deadlines = useQuery({ queryKey: [...REVIEW_KEY, 'home', 'deadlines', source, asOf, SOON_DAYS], refetchInterval: 60_000, queryFn: () => readDeadlines(source, asOf, 14, SOON_DAYS + 1) });
  return <Panel title={LATER_TITLE}>
    <Loadable query={deadlines} what="deadlines">{({ total, rows }) => rows.length === 0 ? <p className="rw-muted">Nothing else saved closes in the next 14 days.</p> : <>
      <ul className="rw-list">{rows.map(row => { const d = deadlineText(row.closing, asOf); return <li key={row.id}>
        <RouteLink to={`/procurement?notice=${encodeURIComponent(row.id)}`} className="rw-item-title">{row.title || row.id}</RouteLink>
        <Hint content={d.detail || undefined}><span className="rw-muted">{[d.text, row.buyer].filter(Boolean).join(' · ')}</span></Hint>
      </li>; })}</ul>
      {total > rows.length && <RouteLink to={reviewScopeHref({ source: source || undefined, open: true }) + '&sort=deadline'} className="rw-drill">{plural(total, 'open notice')}{source ? '' : ' (all sources)'} in days {SOON_DAYS + 1}–14 · all open notices by closing date →</RouteLink>}
    </>}</Loadable>
  </Panel>;
}

function PursuitSummary() {
  const state = useQuery({ queryKey: ['catalog', 'procurement-state'], queryFn: readProcurementState }), { writes } = useCapabilities();
  return <Panel title="Pursuits" note={<RouteLink to="/pursuits">Open the board</RouteLink>}>
    <Loadable query={state} what="pursuits">{({ pursuits }) => pursuits.length === 0 ? <p className="rw-muted">{writes ? 'No pursuits yet. Add a notice to the board from its detail view.' : 'No pursuits yet.'}</p> : <dl className="rw-stats rw-stats-inline">{PURSUIT_STAGES.filter(stage => pursuits.some(p => p.stage === stage)).map(stage => <div key={stage}><dt>{stage}</dt><dd>{n(pursuits.filter(p => p.stage === stage).length)}</dd></div>)}</dl>}</Loadable>
  </Panel>;
}

/** Home: what we have collected, what can be reviewed, and where to act, within one named scope. */
export function Home() {
  const location = usePluginLocation(), source = new URLSearchParams(location.split('?')[1]).get('source') ?? '';
  const workspace = useReviewWorkspace(), available = workspace.data?.available === true;
  const { profileVersionId, active, versions, loading: profilesLoading } = useActiveProfile();
  const profiles = useQuery({ queryKey: [...REVIEW_KEY, 'home', 'profiles'], enabled: available, queryFn: readProfileNames, refetchInterval: 60_000 });
  const [asOf, setAsOf] = useState(() => Date.now()), client = useQueryClient(), { surface, collection } = useCapabilities();
  const inventory = useQuery({ queryKey: [...REVIEW_KEY, 'home', 'inventory'], queryFn: () => sql(INVENTORY_SQL), refetchInterval: 60_000 });
  const policies = useQuery({ queryKey: [...REVIEW_KEY, 'home', 'policies', profileVersionId], enabled: available, queryFn: () => readPolicies(profileVersionId) });
  // One prompt for the profile chain; shown once the profile reads have answered.
  const prompt = available && !profilesLoading && profiles.data ? profileState(profiles.data, versions.length, active !== null) : { state: 'chosen' as const };
  const sources = [...new Set((inventory.data ?? []).filter(row => row.kind === 'opportunity').map(row => String(row.sourceId)))];
  const refresh = () => { setAsOf(Date.now()); void client.invalidateQueries({ queryKey: [...REVIEW_KEY, 'home'] }); };
  const policy = !available ? (workspace.isPending ? 'Checking…' : 'Requires the review workspace') : policies.isPending ? 'Loading…' : policies.isError ? 'Could not load' : policies.data?.length ? `Assessment policy: ${policies.data.map(row => `${row.policy} (${plural(Number(row.count), 'assessment')})`).join(', ')}` : 'No current assessments for this profile';
  return <div className="rw-home procurement-workspace">
    <header className="rw-scope" aria-label="Scope">
      <div className="rw-scope-title"><h1>What needs attention?</h1><p>{source ? sourceName(source) : 'All saved sources'} · as of {when(new Date(asOf).toISOString())}</p></div>
      <div className="rw-controls">
        <label className="rw-control"><span>Source</span><Select aria-label="Source" presentation="dropdown" searchable={false} value={source} onChange={event => patchPluginQuery({ source: event.target.value || null })}><option value="">All saved sources</option>{sources.map(id => <option key={id} value={id}>{sourceName(id)}</option>)}</Select></label>
        {available ? <Hint content={policy}><span><ProfilePicker /></span></Hint> : <span className="rw-muted">{workspace.isPending ? 'Checking the review workspace…' : 'Requires the review workspace'}</span>}
        {surface !== 'societyer' && <Btn size="sm" variant="secondary" className="rw-scope-refresh" aria-label="Refresh" icon={<RefreshCw size={14} />} onClick={refresh} tooltip={`As of ${when(new Date(asOf).toISOString())}`}><span className="rw-scope-refresh-label">Refresh</span></Btn>}
      </div>
    </header>
    {collection && <OperationsLine />}
    {!workspace.isPending && !available && <p className="rw-upgrade" role="status">{workspace.data?.reason ?? 'Update Zoer to use the review workspace.'} Saved notices, documents, deadlines and pursuits are still shown below.</p>}
    <Today source={source} asOf={asOf} />
    <div className="rw-home-kpis" data-prompt={prompt.state !== 'chosen' || undefined}>
      <AttentionTiles source={source} profile={profileVersionId} active={active !== null} asOf={asOf} available={available} />
      <ProfilePrompt state={prompt} />
    </div>
    {/* Two independent columns, so a long panel on one side never leaves a gap on the other. */}
    <div className="rw-home-grid">
      <div className="rw-home-main">
        <NeedsAttention profile={profileVersionId} source={source} asOf={asOf} available={available} workspacePending={workspace.isPending} />
        <Deadlines source={source} asOf={asOf} />
      </div>
      <div className="rw-home-side">
        {available && <RecentDecisions source={source} />}
        <PursuitSummary />
      </div>
    </div>
  </div>;
}
