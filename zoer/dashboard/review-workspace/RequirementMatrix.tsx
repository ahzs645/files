import { useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Btn, Select } from '@zoer/plugin-ui/controls';
import { GATE_ORIGINS, REQUIREMENT_MATCHES, REQUIREMENT_STRENGTHS, deadlineState, parseDeadline } from '@bcbid/procurement-core';
import { EvidenceInspector } from './EvidenceInspector';
import { TaskPanel, consumeRequirementFilterPreset, useReviewAction } from './DecisionHeader';
import { useActiveProfile } from './profile-context';
import { label } from './queries';
import {
  NO_FILTERS, effectiveFact, factValueText, fieldName, filterRequirements, headerMoney, noticeKey, readFacts, readProfileEvidence, readRequirements, readStageRuns, readTasks, requirementCounts,
  reviewStateOf, stageStatus, when, type FactRow, type RequirementFilters, type RequirementRow,
} from './notice-queries';
import './review.css';

const REVIEW_STATES = ['proposed', 'ungrounded', 'accepted', 'corrected', 'rejected', 'needs_clarification'];
const STATE_TEXT: Record<string, string> = { proposed: 'Proposed', ungrounded: 'Ungrounded', accepted: 'Accepted', corrected: 'Corrected', rejected: 'Rejected', needs_clarification: 'Needs clarification' };
const ORIGINS: Record<string, string> = { buyer_mandatory: 'Buyer requirement', internal_policy: 'Our internal policy', reviewer_preference: 'Reviewer preference' };
const DEADLINE_TEXT: Record<string, string> = { open: 'open', closing_today_time_unverified: 'closing date today; time unverified', closed: 'passed', unknown: 'state unknown' };

// Purposeful colour per category (never in place of the label): a requirement's strength, grounding, review
// state and match status each carry their own meaning, so each gets its own explicit tone rather than the
// generic verdict mapping above. Unmapped/unrecognized values stay neutral grey, never green.
const TChip = ({ tone, text }: { tone: string; text: string }) => <span className="rw-chip" data-tone={tone}><b>{text}</b></span>;
const STRENGTH_TONE: Record<string, string> = { mandatory: 'warn', preferred: 'info', conditional: 'warn', informational: 'neutral' };
const GROUNDING_TONE: Record<string, string> = { exact: 'ok', normalized_mapped: 'info', unverified: 'bad' };
const REVIEW_STATE_TONE: Record<string, string> = { proposed: 'neutral', ungrounded: 'bad', accepted: 'ok', corrected: 'teal', rejected: 'bad', needs_clarification: 'warn' };
const MATCH_TONE: Record<string, string> = { supported: 'ok', remediable_gap: 'warn', unmet: 'bad', unknown: 'neutral', not_applicable: 'neutral' };

/**
 * Requirements tab: every requirement of the current extract run (no cap), with reviewer state and the match
 * for the active profile only, filters with honest counts, an inline match editor and per-item tasks; then
 * the extracted facts (money partitioned by kind/currency/basis, dates with precision, explicit statuses).
 */
export function RequirementMatrix({ recordId }: { recordId: string }) {
  const { profileVersionId, active, loading } = useActiveProfile();
  const runs = useQuery({ queryKey: noticeKey(recordId, 'runs'), queryFn: () => readStageRuns(recordId) });
  const status = runs.data ? stageStatus(runs.data, 'extract') : null, run = status?.current ?? null;
  const requirements = useQuery({ queryKey: noticeKey(recordId, 'requirements', run?.id, profileVersionId), enabled: !!run && !loading, queryFn: () => readRequirements(recordId, run!.id, profileVersionId) });
  const facts = useQuery({ queryKey: noticeKey(recordId, 'facts', run?.id), enabled: !!run, queryFn: () => readFacts(recordId, run!.id) });
  const tasks = useQuery({ queryKey: noticeKey(recordId, 'tasks'), queryFn: () => readTasks(recordId) });
  // A preset from the Decision tab's "Match requirements" button (e.g. match=none) is consumed once on mount.
  const [filters, setFilters] = useState<RequirementFilters>(() => ({ ...NO_FILTERS, ...consumeRequirementFilterPreset(recordId) }));
  const [inspect, setInspect] = useState<{ type: 'requirement' | 'fact'; id: string } | null>(null);
  if (runs.isPending) return <p className="rw-muted" role="status">Loading requirements…</p>;
  if (runs.error) return <p className="rw-error" role="alert">Could not load stage runs: {(runs.error as Error).message}</p>;
  const rows = requirements.data ?? [], shown = filterRequirements(rows, filters), counts = requirementCounts(rows);
  const filtered = Object.values(filters).some(Boolean);
  const set = (key: keyof RequirementFilters) => (event: { target: { value: string } }) => setFilters({ ...filters, [key]: event.target.value });
  return <div className="rw-nd">
    {!run ? <div className="rw-callout rw-nd-empty"><p><strong>No requirement ledger has been extracted.</strong> This does not mean the notice has no requirements. Run “Extract requirements” on the Decision tab after downloading the documents.</p>{status && status.tone !== 'neutral' && <p className="rw-note">{status.note}</p>}</div> : <>
      <section className="rw-panel" aria-label="Requirements">
        <div className="rw-panel-head"><h3>Requirements</h3><span className="rw-note">{requirements.data ? counts.text : ''}</span></div>
        <p className="rw-note">From {when(run.finishedAt ?? run.startedAt)}{run.model ? ` · ${run.model}` : ''} · {active ? `matches for ${active.name} v${active.version} only` : 'choose a profile to record matches'}</p>
        {(status?.tone === 'failed' || status?.tone === 'partial' || status?.tone === 'running') && <p className="rw-warn">{status.note}</p>}
        <div className="rw-nd-filters" role="group" aria-label="Filter requirements">
          <Select aria-label="Type" presentation="dropdown" searchable={false} value={filters.strength} onChange={set('strength')}><option value="">All types</option>{REQUIREMENT_STRENGTHS.map(s => <option key={s} value={s}>{label(s)}</option>)}</Select>
          <Select aria-label="Review state" presentation="dropdown" searchable={false} value={filters.review} onChange={set('review')}><option value="">All review states</option>{REVIEW_STATES.map(s => <option key={s} value={s}>{STATE_TEXT[s]}</option>)}</Select>
          <Select aria-label="Match" presentation="dropdown" searchable={false} value={filters.match} disabled={!profileVersionId} onChange={set('match')}><option value="">All matches</option><option value="none">No match recorded</option>{REQUIREMENT_MATCHES.map(s => <option key={s} value={s}>{label(s)}</option>)}</Select>
          <Select aria-label="Grounding" presentation="dropdown" searchable={false} value={filters.grounding} onChange={set('grounding')}><option value="">All grounding</option>{['exact', 'normalized_mapped', 'unverified'].map(s => <option key={s} value={s}>{label(s)}</option>)}</Select>
          {filtered && <Btn size="sm" variant="ghost" onClick={() => setFilters(NO_FILTERS)}>Clear filters</Btn>}
        </div>
        {filtered && requirements.data && <p className="rw-note" role="status">Showing {shown.length.toLocaleString()} of {rows.length.toLocaleString()}.</p>}
        {requirements.isPending ? <p className="rw-muted" role="status">Loading requirements…</p> : requirements.error ? <p className="rw-error" role="alert">Could not load requirements: {(requirements.error as Error).message}</p>
          : !rows.length ? <p className="rw-note">The extraction returned no requirements. That is zero extracted items, not a verified absence of obligations.</p>
          : !shown.length ? <p className="rw-note">No requirements match these filters.</p>
          : <ol className="rw-nd-reqs">{shown.map(row => <RequirementItem key={row.id} recordId={recordId} row={row} profileVersionId={profileVersionId} openTasks={(tasks.data ?? []).filter(task => task.status === 'open' && task.linkedType === 'requirement' && task.linkedId === row.id).length} onInspect={() => setInspect({ type: 'requirement', id: row.id })} />)}</ol>}
      </section>
      <Facts facts={facts.data} loading={facts.isPending} error={facts.error as Error | null} onInspect={id => setInspect({ type: 'fact', id })} />
    </>}
    {inspect && <EvidenceInspector recordId={recordId} target={inspect} onClose={() => setInspect(null)} />}
  </div>;
}

function RequirementItem({ recordId, row, profileVersionId, openTasks, onInspect }: { recordId: string; row: RequirementRow; profileVersionId: string | null; openTasks: number; onInspect(): void }) {
  const [panel, setPanel] = useState<'' | 'match' | 'task'>('');
  const state = reviewStateOf(row), text = state === 'corrected' && row.reviewValue ? (typeof row.reviewValue === 'string' ? row.reviewValue : row.reviewValue.text ?? row.text) : row.text;
  const source = [row.sourceName, row.page != null ? `page ${row.page}` : '', row.heading].filter(Boolean).join(' · ');
  return <li data-state={state}>
    <button type="button" className="rw-nd-req-text" onClick={onInspect} aria-label={`Inspect requirement ${row.ordinal}: ${text}`}><span className="rw-nd-ordinal">{row.ordinal}</span><span>{text}</span></button>
    <div className="rw-chips">
      <TChip tone={STRENGTH_TONE[row.strength] ?? 'neutral'} text={label(row.strength)} />
      <span className="rw-chip"><b>{row.category}</b></span>
      <TChip tone={REVIEW_STATE_TONE[state] ?? 'neutral'} text={STATE_TEXT[state] ?? state} />
      <TChip tone={GROUNDING_TONE[row.grounding] ?? 'neutral'} text={label(row.grounding)} />
      {profileVersionId && (row.match ? <TChip tone={MATCH_TONE[row.match.status] ?? 'neutral'} text={`Match: ${label(row.match.status)}`} /> : <span className="rw-chip" data-tone="neutral"><b>No match recorded</b></span>)}
      {row.conflicts.length > 0 && <TChip tone="bad" text="Conflicting" />}
      {openTasks > 0 && <span className="rw-chip"><b>{openTasks} open task{openTasks === 1 ? '' : 's'}</b></span>}
    </div>
    <p className="rw-note">{[`Who: ${row.actor || 'not stated'}`, `When: ${row.requiredBy || 'not stated'}`, row.conditionText ? `Condition: ${row.conditionText}` : '', row.lotId ? `Lot ${row.lotId}` : '', source ? `Source: ${source}` : row.grounding === 'unverified' ? 'Quote not found in source' : ''].filter(Boolean).join(' · ')}</p>
    {row.match && <p className="rw-note">{ORIGINS[row.match.origin] ?? row.match.origin} · {row.match.rationale}{row.match.remediable != null ? ` · ${row.match.remediable ? 'remediable' : 'not remediable'}` : ''} · {row.match.reviewer}, {when(row.match.updatedAt)}</p>}
    <div className="rw-actions">
      <Btn size="sm" variant="ghost" onClick={onInspect}>Evidence &amp; review</Btn>
      {profileVersionId && <Btn size="sm" variant="ghost" aria-expanded={panel === 'match'} onClick={() => setPanel(panel === 'match' ? '' : 'match')}>{row.match ? 'Edit match' : 'Record match'}</Btn>}
      <Btn size="sm" variant="ghost" aria-expanded={panel === 'task'} onClick={() => setPanel(panel === 'task' ? '' : 'task')}>Tasks</Btn>
    </div>
    {panel === 'match' && profileVersionId && <MatchEditor recordId={recordId} row={row} profileVersionId={profileVersionId} onClose={() => setPanel('')} />}
    {panel === 'task' && <TaskPanel recordId={recordId} link={{ type: 'requirement', id: row.id, text: row.text }} />}
  </li>;
}

function MatchEditor({ recordId, row, profileVersionId, onClose }: { recordId: string; row: RequirementRow; profileVersionId: string; onClose(): void }) {
  const evidence = useQuery({ queryKey: noticeKey(recordId, 'profile-evidence', profileVersionId), queryFn: () => readProfileEvidence(profileVersionId), staleTime: Infinity });
  const [status, setStatus] = useState(row.match?.status ?? 'unknown'), [origin, setOrigin] = useState(row.match?.origin ?? 'buyer_mandatory');
  const [linked, setLinked] = useState<string[]>(row.match?.companyEvidence ?? []), [rationale, setRationale] = useState(row.match?.rationale ?? ''), [remediable, setRemediable] = useState(row.match?.remediable == null ? '' : row.match.remediable ? 'yes' : 'no');
  const action = useReviewAction();
  const ok = rationale.trim().length >= 3;
  const save = async () => { if (await action.run('match', { op: 'match.set', requirementId: row.id, profileVersionId, status: status as any, origin: origin as any, companyEvidenceIds: linked, rationale: rationale.trim(), remediable: remediable === '' ? null : remediable === 'yes', expectedRevision: row.matchRevision }, 'Match saved; the assessment was recomputed.')) onClose(); };
  return <form className="rw-form rw-card" onSubmit={event => { event.preventDefault(); if (ok) void save(); }}>
    <div className="rw-row">
      <label className="rw-field"><span>Match</span><Select aria-label="Match status" presentation="dropdown" searchable={false} value={status} disabled={!!action.busy} onChange={event => setStatus(event.target.value)}>{REQUIREMENT_MATCHES.map(s => <option key={s} value={s}>{label(s)}</option>)}</Select></label>
      <label className="rw-field"><span>Origin</span><Select aria-label="Requirement origin" presentation="dropdown" searchable={false} value={origin} disabled={!!action.busy} onChange={event => setOrigin(event.target.value)}>{GATE_ORIGINS.map(s => <option key={s} value={s}>{ORIGINS[s]}</option>)}</Select></label>
      <label className="rw-field"><span>Remediable</span><Select aria-label="Remediable" presentation="dropdown" searchable={false} value={remediable} disabled={!!action.busy} onChange={event => setRemediable(event.target.value)}><option value="">Unknown</option><option value="yes">Yes, can be fixed before it is due</option><option value="no">No</option></Select></label>
    </div>
    <fieldset className="rw-fieldset"><legend>Company evidence</legend>
      {evidence.isPending ? <p className="rw-muted" role="status">Loading profile evidence…</p> : evidence.error ? <p className="rw-error" role="alert">{(evidence.error as Error).message}</p>
        : !evidence.data?.length ? <p className="rw-note">This profile version lists no evidence. Add credentials, insurance or references in Profiles and publish a new version.</p>
        : evidence.data.map(item => <label key={item.id} className="rw-check"><input type="checkbox" checked={linked.includes(item.id)} disabled={!!action.busy} onChange={event => setLinked(event.target.checked ? [...linked, item.id] : linked.filter(id => id !== item.id))} />{item.capability}{item.holder ? ` · ${item.holder}` : ''} · {item.verification.replace(/_/g, ' ')}{item.expiresAt ? ` · expires ${item.expiresAt}` : ''}</label>)}
    </fieldset>
    <label className="rw-field"><span>Rationale (required)</span><textarea rows={2} maxLength={4000} value={rationale} disabled={!!action.busy} onChange={event => setRationale(event.target.value)} placeholder="Why this evidence does or does not meet the requirement" /></label>
    <p className="rw-note">Missing company evidence is “unknown”, not “unmet”, unless a reviewed contradiction exists. A partner possibility is not a confirmed capability.</p>
    <div className="rw-actions"><Btn size="sm" type="submit" disabled={!ok || !!action.busy} loading={!!action.busy}>Save match</Btn><Btn size="sm" variant="ghost" disabled={!!action.busy} onClick={onClose}>Cancel</Btn></div>
    {action.error && <p role="alert" className="rw-error">{action.error}</p>}
  </form>;
}

function FactButton({ fact, children, onInspect }: { fact: FactRow; children: ReactNode; onInspect(id: string): void }) {
  return <button type="button" className="rw-nd-fact" onClick={() => onInspect(fact.id)}>{children}<span className="rw-chips">{fact.reviewState ? <TChip tone={REVIEW_STATE_TONE[fact.reviewState] ?? 'neutral'} text={STATE_TEXT[fact.reviewState] ?? fact.reviewState} /> : fact.grounding === 'unverified' ? <TChip tone="bad" text="Ungrounded" /> : null}</span></button>;
}

function Facts({ facts, loading, error, onInspect }: { facts: FactRow[] | undefined; loading: boolean; error: Error | null; onInspect(id: string): void }) {
  if (loading) return <p className="rw-muted" role="status">Loading facts…</p>;
  if (error) return <p className="rw-error" role="alert">Could not load facts: {error.message}</p>;
  const list = facts ?? [], money = headerMoney(list, true);
  const dates = list.filter(fact => fact.semanticType === 'date'), rest = list.filter(fact => fact.semanticType !== 'date' && !fact.semanticType.startsWith('money:'));
  const moneyStatus = list.filter(fact => fact.semanticType.startsWith('money:') && fact.status !== 'stated');
  return <section className="rw-panel" aria-label="Extracted facts">
    <h3>Facts</h3>
    <h4 className="rw-subhead">Buyer budget or estimated value</h4>
    {money.headline.length ? <ul className="rw-nd-facts">{money.headline.map(line => <li key={line.key}><button type="button" className="rw-nd-fact" onClick={() => onInspect(line.factIds[0])}><span>{line.label}</span><strong>{line.text}</strong></button></li>)}</ul> : <p className="rw-note">{money.text}</p>}
    {money.others.length > 0 && <><h4 className="rw-subhead">Other amounts (listed separately, never a budget)</h4><ul className="rw-nd-facts">{money.others.map(line => <li key={line.key}><button type="button" className="rw-nd-fact" onClick={() => onInspect(line.factIds[0])}><span>{line.label}</span><strong>{line.text}</strong></button></li>)}</ul></>}
    {moneyStatus.length > 0 && <ul className="rw-nd-facts">{moneyStatus.map(fact => <li key={fact.id}><FactButton fact={fact} onInspect={onInspect}><span>{fieldName(fact.fieldKey)}</span><strong>{label(fact.status)}</strong></FactButton></li>)}</ul>}
    {dates.length > 0 && <><h4 className="rw-subhead">Dates</h4><ul className="rw-nd-facts">{dates.map(fact => { const shown = effectiveFact(fact) ?? fact, raw = typeof shown.value?.raw === 'string' ? shown.value.raw : null, state = fact.fieldKey === 'closing_date' && raw ? deadlineState(parseDeadline(raw), Date.now()) : null;
      return <li key={fact.id}><FactButton fact={fact} onInspect={onInspect}><span>{fieldName(fact.fieldKey)}</span><strong>{factValueText(shown)}{state ? ` · ${DEADLINE_TEXT[state]}` : ''}</strong></FactButton></li>; })}</ul></>}
    {rest.length > 0 && <><h4 className="rw-subhead">Other facts</h4><ul className="rw-nd-facts">{rest.map(fact => <li key={fact.id}><FactButton fact={fact} onInspect={onInspect}><span>{fieldName(fact.fieldKey)}</span><strong>{factValueText(effectiveFact(fact) ?? fact)}</strong></FactButton></li>)}</ul></>}
    {!list.length && <p className="rw-note">No facts were extracted. Unlisted fields are not reviewed, not “none”.</p>}
    <p className="rw-note">Rejected values stay in the history but are not used. “Not found in reviewed material” is not the same as “not required”.</p>
  </section>;
}
