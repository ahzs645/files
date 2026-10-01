import { useQuery } from '@tanstack/react-query';
import { History } from 'lucide-react';
import { Btn } from '@zoer/plugin-ui/controls';
import { useReviewAction } from './DecisionHeader';
import { useActiveProfile } from './profile-context';
import { label } from './queries';
import { changeKindText, noticeKey, readAssessmentHistory, readChanges, readDecisions, when, type ChangeRow, type NoticeTabId } from './notice-queries';
import './review.css';

const human = (key: string) => key.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/_/g, ' ').replace(/^./, c => c.toUpperCase());
const show = (value: unknown): string => value == null || value === '' ? 'Not recorded' : typeof value === 'string' ? value : typeof value === 'number' || typeof value === 'boolean' ? String(value)
  : Array.isArray(value) ? value.map(show).join(', ') : Object.entries(value as object).filter(([, v]) => v != null && v !== '').map(([k, v]) => `${human(k)}: ${show(v)}`).join(' · ');
const HIDDEN = new Set(['before', 'after', 'previousProfileVersionIds', 'assessmentIds', 'profileVersionId', 'profileId']);
// document_added/document_modified/notice_modified carry full sha256 hex digests, not human diff text;
// truncate them like EvidenceInspector's "file <sha>" convention rather than dumping 64 hex characters.
const SHA_KEYS = new Set(['sha256', 'previousSha256', 'textSha256']);
const showValue = (key: string, value: unknown): string => SHA_KEYS.has(key) && typeof value === 'string' ? value.slice(0, 12) : show(value);

function ChangeDetail({ change }: { change: ChangeRow }) {
  const d = change.detail && typeof change.detail === 'object' ? change.detail : {};
  const hasDiff = 'before' in d || 'after' in d;
  const rest = Object.entries(d).filter(([key, value]) => !HIDDEN.has(key) && value != null && value !== '');
  return <div className="rw-nd-change-detail">
    {change.kind === 'profile_published' && <p className="rw-note">Version {show(d.version)} published; {Array.isArray(d.assessmentIds) ? d.assessmentIds.length : 0} assessment{Array.isArray(d.assessmentIds) && d.assessmentIds.length === 1 ? '' : 's'} of this notice made with an earlier version became stale. Extraction was not rerun.</p>}
    {change.kind === 'document_missing_in_check' && <p className="rw-note">Missing in a check is not the same as removed: the portal may have hidden it or the check may have been partial. Requirements from this document stay until a removal is confirmed.</p>}
    {hasDiff && <div className="rw-nd-diff"><div><h5>Before</h5><p>{show(d.before)}</p></div><div><h5>After</h5><p>{show(d.after)}</p></div></div>}
    {rest.length > 0 && <dl className="rw-summary">{rest.map(([key, value]) => <div key={key}><dt>{human(key)}</dt><dd>{showValue(key, value)}</dd></div>)}</dl>}
  </div>;
}

/** Changes tab: source/profile changes with before/after, affected assessments and decisions, acknowledge and reconfirm. */
export function ChangesPanel({ recordId, onTab }: { recordId: string; onTab(tab: NoticeTabId): void }) {
  const { profileVersionId, active } = useActiveProfile();
  const changes = useQuery({ queryKey: noticeKey(recordId, 'changes'), queryFn: () => readChanges(recordId) });
  const assessments = useQuery({ queryKey: noticeKey(recordId, 'assessment-history'), queryFn: () => readAssessmentHistory(recordId) });
  const decisions = useQuery({ queryKey: noticeKey(recordId, 'decisions'), queryFn: () => readDecisions(recordId) });
  const action = useReviewAction();
  const staleAssessments = (assessments.data ?? []).filter(item => item.isCurrent && item.freshness === 'stale');
  const latest = decisions.data?.[0], reconfirm = decisions.data?.filter(item => item.needsReconfirmation) ?? [];
  const pending = (changes.data ?? []).filter(change => !change.acknowledgedAt);
  const toDecision = () => { onTab('decision'); setTimeout(() => { const el = document.getElementById(`rw-decide-${recordId}`); el?.scrollIntoView({ block: 'start' }); (el?.querySelector('input') as HTMLElement | null)?.focus({ preventScroll: true }); }, 50); };
  if (changes.isPending) return <p className="rw-muted" role="status">Loading changes…</p>;
  if (changes.error) return <p className="rw-error" role="alert">Could not load changes: {(changes.error as Error).message}</p>;
  return <div className="rw-nd">
    {(staleAssessments.length > 0 || reconfirm.length > 0) && <section className="rw-panel" aria-label="Affected assessments and decisions">
      <div className="rw-nd-alert rw-nd-alert-row" data-tone="stale" role="note"><History aria-hidden="true" className="rw-nd-alert-icon" /><strong>Evidence changed; reconfirm this decision</strong></div>
      <ul className="rw-items">
        {staleAssessments.map(item => <li key={item.id}>Assessment of {when(item.createdAt)} ({item.profileVersionId === profileVersionId ? active ? `${active.name} v${active.version}` : 'this profile' : item.profileVersionId ? 'another profile version' : 'no profile'}): {label(item.suggestedAction)}, now stale.</li>)}
        {reconfirm.map(item => <li key={item.id}>Decision “{label(item.decision)}” of {when(item.createdAt)} needs reconfirmation{item.staleReason ? ` (${item.staleReason.replace(/_/g, ' ')})` : ''}.</li>)}
      </ul>
      <ol className="rw-nd-steps">
        <li>Review each change below and acknowledge it.</li>
        <li>Re-assess against the current evidence. <Btn size="sm" variant="secondary" disabled={!!action.busy} loading={action.busy === 'assess'} onClick={() => void action.run('assess', { op: 'assess', recordId, profileVersionId }, 'Re-assessed. Now record a new decision.')}>Re-assess{active ? ` for ${active.name} v${active.version}` : ' (no profile)'}</Btn></li>
        <li>Record a new decision; earlier decisions stay in the history. <Btn size="sm" variant="secondary" onClick={toDecision}>Record a new decision</Btn></li>
      </ol>
      {latest && !latest.needsReconfirmation && reconfirm.length > 0 && <p className="rw-note">Your latest decision is current; older decisions remain flagged as history.</p>}
      {action.error && <p role="alert" className="rw-error">{action.error}</p>}{action.done && <p role="status" className="rw-note">{action.done}</p>}
    </section>}
    <section className="rw-panel" aria-label="Changes">
      <div className="rw-panel-head"><h3>Changes</h3><span className="rw-note">{pending.length} unacknowledged of {(changes.data ?? []).length}</span></div>
      {!changes.data?.length ? <p className="rw-note">No changes have been detected for this notice. Changes are compared between extraction runs; this is not proof the source never changed.</p>
        : <ul className="rw-nd-changes">{changes.data.map(change => <ChangeItem key={change.id} change={change} />)}</ul>}
      <p className="rw-note">Acknowledging records that you have seen a change. It does not re-assess, and it does not change a decision.</p>
    </section>
  </div>;
}

function ChangeItem({ change }: { change: ChangeRow }) {
  const action = useReviewAction();
  return <li data-acknowledged={!!change.acknowledgedAt || undefined}>
    <div className="rw-panel-head"><strong>{changeKindText(change.kind)}</strong><span className="rw-note">Detected {when(change.detectedAt)}</span></div>
    <ChangeDetail change={change} />
    {change.acknowledgedAt ? <p className="rw-note">Acknowledged by {change.acknowledgedBy ?? 'someone'} · {when(change.acknowledgedAt)}</p>
      : <div className="rw-actions"><Btn size="sm" variant="secondary" disabled={!!action.busy} loading={!!action.busy} onClick={() => void action.run('ack', { op: 'change.acknowledge', changeId: change.id })}>Acknowledge</Btn></div>}
    {action.error && <p role="alert" className="rw-error">{action.error}</p>}
  </li>;
}
