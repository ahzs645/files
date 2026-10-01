import { useQuery } from '@tanstack/react-query';
import { Select } from '@zoer/plugin-ui/controls';
import { patchPluginQuery, usePluginLocation } from '../navigation';
import { INVENTORY_SQL, sourceName, sql } from '../procurement/display';
import { REVIEW_KEY, useReviewWorkspace } from './actions';
import { useActiveProfile } from './profile-context';
import { ProfilePicker } from './ProfilePicker';
import { label } from './queries';
import { Loadable, Panel, RouteLink, when } from './Home';
import { MATCH_BUCKETS, QUEUE_TEXT, READINESS_TEXT, RELEVANCE_TEXT, reviewScopeHref, type Fragment, type MatchBucket, type QueueId, type ReadinessBucket, type RelevanceBucket, type ReviewScope } from './queue';
import { insightScope, readBottlenecks, readGaps, readMatrix, readRequirementCoverage, readStale } from './home-data';
import './review.css';

const n = (value: unknown) => Number(value ?? 0).toLocaleString();
const notices = (count: number) => `${count.toLocaleString()} ${count === 1 ? 'notice' : 'notices'}`;
const KNOWN_RELEVANCE: RelevanceBucket[] = ['strong', 'possible', 'weak'];
const KNOWN_READINESS: ReadinessBucket[] = ['ready', 'conditions', 'blocker'];
const MATCH_TEXT: Record<MatchBucket, string> = { supported: 'Supported', remediable_gap: 'Remediable gap', unmet: 'Unmet', unknown: 'Unknown', not_applicable: 'Not applicable', none: 'Not matched yet' };

function Cell({ scope, relevance, readiness, count }: { scope: ReviewScope; relevance: RelevanceBucket; readiness: ReadinessBucket; count: number }) {
  const text = `${RELEVANCE_TEXT[relevance]}, ${READINESS_TEXT[readiness]}: ${notices(count)}`;
  return <RouteLink to={reviewScopeHref({ ...scope, relevance, readiness }, { view: 'table' })} className="rw-cell" label={text}><strong>{n(count)}</strong><span>{count === 1 ? 'notice' : 'notices'}</span></RouteLink>;
}

/** Every bucket that falls outside the 3×3 grid: unknown relevance, unknown readiness, or no current assessment at all. */
function unplacedLanes(scope: ReviewScope, m: { count: (relevance: RelevanceBucket, readiness: ReadinessBucket) => number; notAssessed: number }) {
  const lane = (relevance: RelevanceBucket, readiness: ReadinessBucket, name: string) => ({ name, count: m.count(relevance, readiness), href: reviewScopeHref({ ...scope, relevance, readiness }, { view: 'table' }) });
  return [
    ...KNOWN_READINESS.map(readiness => lane('unknown', readiness, `${RELEVANCE_TEXT.unknown} · ${READINESS_TEXT[readiness].split(' (')[0]}`)),
    lane('unknown', 'unknown', `${RELEVANCE_TEXT.unknown} · ${READINESS_TEXT.unknown}`),
    ...KNOWN_RELEVANCE.map(relevance => lane(relevance, 'unknown', `${RELEVANCE_TEXT[relevance]} · ${READINESS_TEXT.unknown}`)),
    { name: 'Not assessed for this profile', count: m.notAssessed, href: reviewScopeHref({ ...scope, assessed: 'none' }, { view: 'table' }) },
  ];
}

function FitMatrix({ scope, filter, profile, profileActive }: { scope: ReviewScope; filter: Fragment; profile: string | null; profileActive: boolean }) {
  const { versions } = useActiveProfile();
  const matrix = useQuery({ queryKey: [...REVIEW_KEY, 'insights', 'matrix', filter, profile], queryFn: () => readMatrix(filter, profile), refetchInterval: 60_000 });
  const versionName = (id: string | null) => { if (!id) return 'No company profile'; const v = versions.find(version => version.id === id); return v ? `${v.name} · v${v.version}` : 'Another profile version'; };
  return <Panel title="Fit and readiness" note="Categorical states, not a score or a chance of winning.">
    <Loadable query={matrix} what="the fit matrix">{m => {
      const lanes = unplacedLanes(scope, m), unplaced = lanes.reduce((sum, lane) => sum + lane.count, 0);
      const assessed = KNOWN_RELEVANCE.reduce((sum, relevance) => sum + KNOWN_READINESS.reduce((s, readiness) => s + m.count(relevance, readiness), 0), 0) + unplaced - m.notAssessed;
      if (!profileActive) return <div className="rw-empty"><p>Choose a company profile in “Assess as” above to see fit and readiness.</p></div>;
      if (assessed === 0) return <div className="rw-empty"><p>No assessments yet — triage or extract notices in Opportunities.</p></div>;
      return <>
        <div className="rw-matrix-wrap"><table className="rw-matrix">
          <caption className="sr-only">Notices by work relevance (columns) and qualification readiness (rows)</caption>
          <thead><tr><td />{KNOWN_RELEVANCE.map(relevance => <th key={relevance} scope="col">{RELEVANCE_TEXT[relevance]}</th>)}</tr></thead>
          <tbody>{KNOWN_READINESS.map(readiness => <tr key={readiness}><th scope="row">{READINESS_TEXT[readiness]}</th>{KNOWN_RELEVANCE.map(relevance => <td key={relevance} data-tone={readiness}><Cell scope={scope} relevance={relevance} readiness={readiness} count={m.count(relevance, readiness)} /></td>)}</tr>)}</tbody>
        </table></div>
        <div className="rw-lane-bar">
          <p>{n(unplaced)} not yet assessable — unknowns are not counted as zero or failed.</p>
          {unplaced > 0 && <details><summary>Show breakdown</summary><div className="rw-lane-links">{lanes.filter(lane => lane.count > 0).map(lane => <RouteLink key={lane.name} to={lane.href} className="rw-lane-link">{lane.name}: {n(lane.count)}</RouteLink>)}</div></details>}
        </div>
        {m.others.length > 0 && <p className="rw-muted">Also assessed under other profile versions: {m.others.map(o => `${versionName(o.profile)}: ${notices(o.count)}`).join('; ')}.</p>}
      </>;
    }}</Loadable>
  </Panel>;
}

function RequirementGaps({ scope, filter, profile }: { scope: ReviewScope; filter: Fragment; profile: string | null }) {
  const gaps = useQuery({ queryKey: [...REVIEW_KEY, 'insights', 'gaps', filter, profile], queryFn: () => readGaps(filter, profile), refetchInterval: 60_000 });
  if (!profile) return <Panel title="Requirement gaps" note="Current extractions by category and company match."><p className="rw-muted">Choose a company profile to see which requirements are supported, gaps or unknown.</p></Panel>;
  return <Panel title="Requirement gaps" note="Current extractions by category and company match.">
    <Loadable query={gaps} what="requirement gaps">{rows => { const categories = [...new Set(rows.map(row => String(row.category)))]; const get = (category: string, status: string) => Number(rows.find(row => row.category === category && row.status === status)?.count ?? 0); return !categories.length ? <p className="rw-muted">No current extracted requirements in this scope.</p> : <div className="rw-matrix-wrap"><table className="rw-table">
      <thead><tr><th scope="col">Category</th>{MATCH_BUCKETS.map(bucket => <th key={bucket} scope="col">{MATCH_TEXT[bucket]}</th>)}</tr></thead>
      <tbody>{categories.map(category => <tr key={category}><th scope="row">{label(category).replace(/^./, c => c.toUpperCase())}</th>{MATCH_BUCKETS.map(bucket => { const count = get(category, bucket); return <td key={bucket}>{count ? <RouteLink to={reviewScopeHref({ ...scope, reqCategory: category, match: bucket }, { view: 'table' })} label={`${category}, ${MATCH_TEXT[bucket]}: ${count} requirements`}>{n(count)}</RouteLink> : <span className="rw-muted">0</span>}</td>; })}</tr>)}</tbody>
    </table></div>; }}</Loadable>
  </Panel>;
}

const STATE_TEXT: [string, string][] = [['accepted', 'Accepted'], ['corrected', 'Corrected'], ['rejected', 'Rejected'], ['needs_clarification', 'Needs clarification'], ['proposed', 'Proposed, not reviewed'], ['ungrounded', 'Ungrounded, not reviewed']];
function ReviewCoverage({ scope, filter }: { scope: ReviewScope; filter: Fragment }) {
  const coverage = useQuery({ queryKey: [...REVIEW_KEY, 'insights', 'review-coverage', filter], queryFn: () => readRequirementCoverage(filter), refetchInterval: 60_000 });
  return <Panel title="Requirement review coverage" note="Reviewed, unreviewed and unknown are counted separately.">
    <Loadable query={coverage} what="review coverage">{c => <dl className="rw-stats">
      <div><dt>Notices with a current extraction</dt><dd>{n(c.extracted)} <span>of {notices(c.total)}</span></dd></div>
      <div><dt>Requirements unknown (not extracted)</dt><dd>{notices(Math.max(0, c.total - c.extracted))}</dd></div>
      {STATE_TEXT.map(([key, text]) => <div key={key}><dt>{text}</dt><dd>{n(c.states[key])} <span>requirements</span></dd></div>)}
      <div><dt>Unreviewed requirements</dt><dd><RouteLink to={reviewScopeHref({ source: scope.source, queue: 'requirements' })}>Open the review queue →</RouteLink></dd></div>
    </dl>}</Loadable>
  </Panel>;
}

function Bottlenecks({ source, profile, asOf }: { source: string; profile: string | null; asOf: number }) {
  const data = useQuery({ queryKey: [...REVIEW_KEY, 'insights', 'bottlenecks', source, profile, asOf], queryFn: () => readBottlenecks(source, profile, asOf), refetchInterval: 60_000 });
  return <Panel title="Queue bottlenecks" note="Open notices waiting at each step.">
    <Loadable query={data} what="bottlenecks">{b => <>
      <dl className="rw-stats">{b.queues.map(([queue, count]) => <div key={queue}><dt>{QUEUE_TEXT[queue as QueueId].title}</dt><dd>{count === null ? <span>Needs a company profile</span> : <RouteLink to={reviewScopeHref({ source: source || undefined, queue: queue as QueueId, ...(queue === 'eligibility' || queue === 'changes' || queue === 'decide' ? { profile } : {}) })}>{notices(count)}</RouteLink>}</dd></div>)}</dl>
      <h3 className="rw-subhead">Pipeline runs</h3>
      {b.runs.length ? <ul className="rw-list">{b.runs.map(row => <li key={row.stage + row.status}><span className={row.status === 'failed' ? 'rw-bad' : 'rw-muted'}>{label(row.stage)} · {row.status}: {n(row.count)}</span></li>)}</ul> : <p className="rw-muted">No queued, running or failed stage runs.</p>}
      <h3 className="rw-subhead">Open tasks</h3>
      {b.tasks.length ? <ul className="rw-list">{b.tasks.map(row => <li key={row.kind}><span className="rw-muted">{String(row.kind).replace(/_/g, ' ')}: {n(row.count)}</span></li>)}</ul> : <p className="rw-muted">No open tasks.</p>}
    </>}</Loadable>
  </Panel>;
}

function StaleDecisions({ scope, filter, profile }: { scope: ReviewScope; filter: Fragment; profile: string | null }) {
  const data = useQuery({ queryKey: [...REVIEW_KEY, 'insights', 'stale', filter, profile], refetchInterval: 60_000, queryFn: () => readStale(filter, profile) });
  return <Panel title="Stale decisions" note="Evidence changed after a decision; the earlier decision is kept until reconfirmed.">
    <Loadable query={data} what="stale decisions">{s => <>
      <p className="rw-muted">{s.decisions.length >= 50 ? 'At least 50' : n(s.decisions.length)} {s.decisions.length === 1 ? 'decision needs' : 'decisions need'} reconfirmation · {notices(s.staleAssessments)} with a stale assessment for this profile · <RouteLink to={reviewScopeHref({ source: scope.source, queue: 'changes', profile })}>Reconfirm changes →</RouteLink></p>
      {s.decisions.length > 0 && <ul className="rw-list">{s.decisions.slice(0, 8).map(row => <li key={row.id}>
        <RouteLink to={`/procurement?notice=${encodeURIComponent(row.recordId)}&tab=changes`} className="rw-item-title">{row.title || row.recordId}</RouteLink>
        <span className="rw-muted"><b className="rw-decision">{label(row.decision)}</b> · {when(row.createdAt)}{row.reason ? ` · ${row.reason}` : ''}</span>
      </li>)}</ul>}
    </>}</Loadable>
  </Panel>;
}

/** Insights: decision intelligence over current assessments for one profile version; award history stays a separate view. */
export function Insights() {
  const location = usePluginLocation(), params = new URLSearchParams(location.split('?')[1]);
  const source = params.get('source') ?? '', open = params.get('all') !== '1';
  const workspace = useReviewWorkspace(), available = workspace.data?.available === true;
  const { profileVersionId, active } = useActiveProfile();
  const asOf = Math.floor(Date.now() / 300_000) * 300_000; // five-minute as-of buckets keep query keys stable
  const inventory = useQuery({ queryKey: [...REVIEW_KEY, 'home', 'inventory'], queryFn: () => sql(INVENTORY_SQL), refetchInterval: 60_000 });
  const sources = [...new Set((inventory.data ?? []).filter(row => row.kind === 'opportunity').map(row => String(row.sourceId)))];
  const scope: ReviewScope = { source: source || undefined, open: open || undefined, profile: profileVersionId };
  const filter = insightScope(source, open, asOf);
  return <div className="rw-insights procurement-workspace">
    <header className="rw-scope" aria-label="Scope">
      <div className="rw-scope-title"><h1>Decision insights</h1><p>{open ? 'Open' : 'All saved'} notices{source ? ` from ${sourceName(source)}` : ''} · as of {when(new Date(asOf).toISOString())}</p></div>
      <div className="rw-controls">
        <label className="rw-control"><span>Source</span><Select aria-label="Source" presentation="dropdown" searchable={false} value={source} onChange={event => patchPluginQuery({ source: event.target.value || null })}><option value="">All saved sources</option>{sources.map(id => <option key={id} value={id}>{sourceName(id)}</option>)}</Select></label>
        <label className="rw-control"><span>Notices</span><Select aria-label="Notices" presentation="dropdown" searchable={false} value={open ? 'open' : 'all'} onChange={event => patchPluginQuery({ all: event.target.value === 'all' ? '1' : null })}><option value="open">Open notices</option><option value="all">All saved notices</option></Select></label>
        {available ? <ProfilePicker /> : <span className="rw-muted">{workspace.isPending ? 'Checking the review workspace…' : 'Requires the review workspace'}</span>}
      </div>
    </header>
    {workspace.isPending ? <p className="rw-muted" role="status">Checking the review workspace…</p>
      : !available ? <p className="rw-upgrade" role="status">{workspace.data?.reason ?? 'Update Zoer to use the review workspace.'} <RouteLink to="/analysis/overview">Market analysis</RouteLink> and <RouteLink to="/contract-awards">award history</RouteLink> keep working.</p>
      : <div className="rw-insights-grid">
        <FitMatrix scope={scope} filter={filter} profile={profileVersionId} profileActive={active !== null} />
        <RequirementGaps scope={scope} filter={filter} profile={profileVersionId} />
        <ReviewCoverage scope={scope} filter={filter} />
        <Bottlenecks source={source} profile={profileVersionId} asOf={asOf} />
        <StaleDecisions scope={scope} filter={filter} profile={profileVersionId} />
        <Panel title="Award history" note="Historical awards are context, not the current buyer's budget or a chance of winning."><p className="rw-muted"><RouteLink to="/contract-awards">Award history</RouteLink> and <RouteLink to="/analysis/overview">market analysis</RouteLink> show their own source coverage and exclusions.</p></Panel>
      </div>}
  </div>;
}
