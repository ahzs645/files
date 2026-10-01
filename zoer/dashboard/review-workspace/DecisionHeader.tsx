import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useQuery } from '@tanstack/react-query';
import { History } from 'lucide-react';
import { Btn, Select } from '@zoer/plugin-ui/controls';
import { ReviewModelSelector } from '@zoer/plugin-ui/analysis';
import { verdictTone } from '@bcbid/procurement-core';
import { host } from '../bridge';
import { queryClient } from '../query-client';
import { REVIEW_KEY, reviewWrite, startPipeline, useReviewInvalidate, type WriteOp } from './actions';
import { DimensionChips, toneOf } from './DimensionChips';
import { useActiveProfile } from './profile-context';
import { label, readCurrentAssessments, type AssessmentRow, type DecisionRow } from './queries';
import {
  DECISION_OPTIONS, JUDGEMENT_DIMENSIONS, JUDGEMENT_LABELS, TASK_KINDS, coverageGaps, decisionNoteRule, friendly, noteSatisfies, noticeKey, readChanges, readConflicts, readDecisions,
  readJudgements, readStageRuns, readTasks, readTriageOutput, scopeText, stageName, stageStatus, taskKindLabel, usageText, when,
  type DecisionChoice, type JudgementRow, type NoticeTabId, type NoticeTask, type RequirementFilters, type StageRunRow,
} from './notice-queries';
import './review.css';
import './notice-polish.css';

/** Cross-tab request from the suggestion card's "Match requirements" action: consumed once by RequirementMatrix. */
const requirementFilterPresets = new Map<string, Partial<RequirementFilters>>();
export function presetRequirementFilter(recordId: string, preset: Partial<RequirementFilters>) { requirementFilterPresets.set(recordId, preset); }
export function consumeRequirementFilterPreset(recordId: string): Partial<RequirementFilters> | null {
  const preset = requirementFilterPresets.get(recordId) ?? null;
  requirementFilterPresets.delete(recordId);
  return preset;
}

/** Pending/error state for one durable write, then refresh every review query. */
export function useReviewAction() {
  const invalidate = useReviewInvalidate();
  const [busy, setBusy] = useState(''), [error, setError] = useState(''), [done, setDone] = useState('');
  const run = async (name: string, op: WriteOp, success = '') => {
    setBusy(name); setError(''); setDone('');
    try { const result = await reviewWrite(op); await invalidate(); setDone(success); return result ?? true; }
    catch (e) { setError(friendly(e)); return null; } finally { setBusy(''); }
  };
  return { busy, error, done, run, setError };
}

// Pipeline runs started here keep being followed after the notice closes; their results land in the review queries.
type Launch = { runId: string; stage: string; status: string; error?: string };
const TERMINAL = ['succeeded', 'failed', 'cancelled', 'outcome_unknown'];
const launches = new Map<string, Launch[]>(), launchListeners = new Set<() => void>(), NONE: Launch[] = [];
const setLaunch = (recordId: string, launch: Launch) => { launches.set(recordId, [launch, ...(launches.get(recordId) ?? []).filter(item => item.runId !== launch.runId)].slice(0, 5)); launchListeners.forEach(listener => listener()); };
const useLaunches = (recordId: string) => useSyncExternalStore(listener => { launchListeners.add(listener); return () => { launchListeners.delete(listener); }; }, () => launches.get(recordId) ?? NONE);
async function follow(recordId: string, launch: Launch) {
  for (const deadline = Date.now() + 6 * 3_600_000; Date.now() < deadline;) {
    await new Promise(resolve => setTimeout(resolve, 2500));
    let run: any;
    try { run = (await host('state', { summary: true })).runs?.find((item: any) => item.id === launch.runId); } catch { continue; }
    if (!run) continue;
    if (run.status !== launch.status) { launch = { ...launch, status: run.status, error: run.error }; setLaunch(recordId, launch); void queryClient.invalidateQueries({ queryKey: noticeKey(recordId, 'runs') }); }
    if (TERMINAL.includes(run.status)) { void queryClient.invalidateQueries({ queryKey: REVIEW_KEY }); return; }
  }
}

const TRIAGE_LABELS: Record<string, string> = { potentially_relevant: 'Potentially relevant', outside_stated_preferences: 'Outside stated preferences', insufficient_information: 'Insufficient information' };
const Chip = ({ value, text }: { value: string; text?: string }) => <span className="rw-chip" data-tone={verdictTone(value) === 'needs_information' && value === 'unknown' ? 'neutral' : verdictTone(value)}><b>{text ?? label(value)}</b></span>;
const focusSection = (id: string) => { const el = document.getElementById(id); el?.scrollIntoView({ block: 'start', behavior: 'smooth' }); (el?.querySelector('input,textarea,select,button') as HTMLElement | null)?.focus({ preventScroll: true }); };

// Critical unknowns of the shape "Company evidence unknown for: <requirement>" repeat once per requirement and
// swamp the card; grouped into one line with a link to Requirements. Other unknown kinds stay individually listed.
const COMPANY_UNKNOWN_RE = /^Company evidence unknown for:/;
/** First `max` items always shown; the rest sit behind a "Show all" toggle so nothing is dropped, only hidden. */
function ExpandableList({ items, max = 3, label: labelFor }: { items: string[]; max?: number; label(n: number): string }) {
  const [open, setOpen] = useState(false);
  if (!items.length) return null;
  const shown = open || items.length <= max ? items : items.slice(0, max);
  return <>
    <ul className="rw-items">{shown.map((item, i) => <li key={i}>{item}</li>)}</ul>
    {items.length > max && <button type="button" className="pc-link-btn rw-nd-toggle" aria-expanded={open} onClick={() => setOpen(!open)}>{open ? 'Show fewer' : labelFor(items.length)}</button>}
  </>;
}
const STAGE_WORD: Record<string, string> = { neutral: 'Not run', running: 'Running', failed: 'Failed', partial: 'Needs review', ok: 'Current' };
// Purposeful colour (coordinator spec): succeeded = ok, failed = bad, running = info (it's AI output in flight).
const STAGE_TONE: Record<string, string> = { neutral: 'neutral', running: 'info', failed: 'bad', partial: 'warn', ok: 'ok' };
/** Old 4-tone verdict vocabulary (review.css) → the new named palette used for accents outside chips. */
const TONE_MAP: Record<string, string> = { supported: 'ok', needs_information: 'warn', blocker: 'bad', stale: 'violet', neutral: 'neutral' };
const DECISION_TONE: Record<string, string> = { pursue: 'ok', no_bid: 'bad', monitor: 'info', defer: 'neutral' };

/**
 * Decision tab: AI suggestion, human decision and pursuit stage side by side (never merged), the active
 * profile's assessment, evidence scope, stale/conflict warnings, AI stage launches, reviewer judgements, tasks.
 */
export function DecisionHeader({ recordId, pursuitStage, onTab }: { recordId: string; pursuitStage: string | null; onTab(tab: NoticeTabId): void }) {
  const { profileVersionId, active, loading } = useActiveProfile();
  const action = useReviewAction();
  const runs = useQuery({ queryKey: noticeKey(recordId, 'runs'), queryFn: () => readStageRuns(recordId), refetchInterval: query => (query.state.data ?? []).some(run => run.status === 'queued' || run.status === 'running') ? 5000 : false });
  const assessment = useQuery({ queryKey: noticeKey(recordId, 'assessment', profileVersionId), enabled: !loading, queryFn: async () => (await readCurrentAssessments([recordId], profileVersionId)).get(recordId) ?? null });
  const triage = useQuery({ queryKey: noticeKey(recordId, 'triage'), queryFn: () => readTriageOutput(recordId) });
  const decisions = useQuery({ queryKey: noticeKey(recordId, 'decisions'), queryFn: () => readDecisions(recordId) });
  const changes = useQuery({ queryKey: noticeKey(recordId, 'changes'), queryFn: () => readChanges(recordId) });
  const extract = runs.data ? stageStatus(runs.data, 'extract') : null, triaged = runs.data ? stageStatus(runs.data, 'triage') : null;
  const conflicts = useQuery({ queryKey: noticeKey(recordId, 'conflicts', extract?.current?.id), enabled: !!extract?.current, queryFn: () => readConflicts(recordId, extract!.current!.id) });
  const [taskPreset, setTaskPreset] = useState<{ kind: string; title: string } | null>(null);
  const a = assessment.data ?? null, latest = decisions.data?.[0] ?? null;
  const unacknowledged = (changes.data ?? []).filter(change => !change.acknowledgedAt).length;
  const stale = a?.freshness === 'stale' || !!latest?.needsReconfirmation || unacknowledged > 0;
  const scopeStage = extract?.current ? 'extract' : triaged?.current ? 'triage' : null;
  const gaps = coverageGaps(extract?.current?.coverage);
  const nextStep = (kind: string, title: string) => { setTaskPreset({ kind, title }); setTimeout(() => focusSection(`rw-tasks-${recordId}`), 0); };
  const suggestion = a?.suggestedAction;
  const companyUnknowns = (a?.criticalUnknowns ?? []).filter(item => COMPANY_UNKNOWN_RE.test(item));
  const otherUnknowns = (a?.criticalUnknowns ?? []).filter(item => !COMPANY_UNKNOWN_RE.test(item));
  const matchRequirements = () => { presetRequirementFilter(recordId, { match: 'none' }); onTab('requirements'); };
  return <div className="rw-nd">
    {stale && <div className="rw-nd-alert rw-nd-alert-row" data-tone="stale" role="note">
      <History aria-hidden="true" className="rw-nd-alert-icon" />
      <span className="rw-nd-alert-text"><strong>Evidence changed; reconfirm this decision</strong>{' '}
        <span className="rw-note">{[a?.freshness === 'stale' ? 'assessment predates the latest change' : '', unacknowledged ? `${unacknowledged} unacknowledged change${unacknowledged === 1 ? '' : 's'}` : '', latest?.needsReconfirmation ? `last decision (${label(latest.decision)}) needs reconfirmation${latest.staleReason ? `: ${latest.staleReason.replace(/_/g, ' ')}` : ''}` : ''].filter(Boolean).join(' · ')}</span>
      </span>
      <Btn size="sm" variant="secondary" className="rw-nd-alert-action" onClick={() => onTab('changes')}>Review changes</Btn>
    </div>}
    {(conflicts.data ?? 0) > 0 && <div className="rw-nd-alert rw-nd-alert-row" data-tone="warning" role="note"><strong>{conflicts.data} conflicting source statement{conflicts.data === 1 ? '' : 's'}</strong><span className="rw-nd-alert-text rw-note">Conflicts stay visible until the source resolves them; a working assumption does not.</span><Btn size="sm" variant="secondary" className="rw-nd-alert-action" onClick={() => onTab('requirements')}>Inspect requirements</Btn></div>}

    <section className="rw-panel rw-nd-suggest" data-tone={TONE_MAP[a ? toneOf(a.suggestedAction) : 'neutral']} aria-labelledby={`rw-suggest-${recordId}`}>
      <div className="rw-panel-head"><h3 id={`rw-suggest-${recordId}`} className="rw-nd-eyebrow">AI suggestion · not a decision</h3>{active && <span className="rw-note">for {active.name} · v{active.version}</span>}</div>
      {assessment.isPending && !loading ? <p className="rw-muted" role="status">Loading assessment…</p> : assessment.error ? <p className="rw-error" role="alert">Could not load the assessment: {(assessment.error as Error).message}</p> : a ? <>
        <p className="rw-nd-action"><Chip value={a.suggestedAction} /></p>
        <DimensionChips assessment={a} />
        <ExpandableList items={a.reasons} label={n => `Show all ${n} reasons`} />
        {(companyUnknowns.length > 0 || otherUnknowns.length > 0) && <>
          <h4 className="rw-subhead">Critical unknowns</h4>
          {companyUnknowns.length > 0 && <p className="rw-nd-unknown-group">{companyUnknowns.length} requirement{companyUnknowns.length === 1 ? '' : 's'} {companyUnknowns.length === 1 ? 'has' : 'have'} no linked company evidence. <Btn size="sm" variant="ghost" onClick={matchRequirements}>Match requirements</Btn></p>}
          <ExpandableList items={otherUnknowns} label={n => `Show all ${n} unknowns`} />
        </>}
        <p className="rw-note">Assessed {when(a.createdAt)} for {active ? `${active.name} v${active.version}` : 'no company profile'} · policy {a.policyVersion}{a.freshness === 'stale' ? ' · evidence changed since' : ''}</p>
      </> : <>
        <p className="rw-nd-action"><span className="rw-chip" data-tone="neutral"><b>Not assessed for this profile</b></span></p>
        <p className="rw-note">{active ? `No current assessment exists for ${active.name} v${active.version}. Another profile’s assessment is never shown in its place.` : 'Choose a profile in “Assess as” to assess eligibility.'}</p>
      </>}
      <div className="rw-actions">
        <Btn size="sm" variant="secondary" disabled={!!action.busy || loading} loading={action.busy === 'assess'} onClick={() => void action.run('assess', { op: 'assess', recordId, profileVersionId }, 'Assessment updated from the current evidence.')}>{a ? 'Re-assess' : 'Assess for this profile'}</Btn>
        {(suggestion === 'needs_information' || !a) && <Btn size="sm" variant="ghost" onClick={() => nextStep('acquire_evidence', 'Acquire missing evidence')}>Create evidence task</Btn>}
        {(suggestion === 'investigate' || suggestion === 'consider_partner') && <Btn size="sm" variant="ghost" onClick={() => nextStep('resolve_gap', suggestion === 'consider_partner' ? 'Confirm a partner for the remediable gaps' : 'Resolve open requirement gaps')}>Create gap task</Btn>}
        {(suggestion === 'ready_for_human_decision' || suggestion === 'decline' || suggestion === 'archive_or_monitor') && <Btn size="sm" variant="ghost" onClick={() => focusSection(`rw-decide-${recordId}`)}>Record your decision</Btn>}
        <Btn size="sm" variant="ghost" onClick={() => onTab('requirements')}>Inspect requirements</Btn>
      </div>
      {action.error && <p role="alert" className="rw-error">{action.error}</p>}{action.done && <p role="status" className="rw-note">{action.done}</p>}
    </section>

    <section className="rw-panel" aria-label="Evidence scope and status">
      <p className="rw-nd-scope-line"><strong>Evidence scope</strong> {scopeText(extract?.current?.coverage, scopeStage)}{scopeStage === 'triage' ? ' — requirements not yet extracted' : ''}</p>
      {gaps.length > 0 && <details className="rw-nd-disclosure"><summary>{gaps.length} file{gaps.length === 1 ? '' : 's'} not processed</summary><ul className="rw-items">{gaps.map((gap, i) => <li key={i}>{gap.name}: {gap.reason}{gap.critical ? ' (may hold requirements)' : ''}</li>)}</ul></details>}
      {triage.data && <div className="rw-nd-triage">
        <h4 className="rw-subhead">Triage · based on the saved notice only</h4>
        <p><Chip value={triage.data.classification} text={TRIAGE_LABELS[triage.data.classification] ?? label(triage.data.classification)} /> <Chip value={triage.data.relevance} text={`Relevance: ${label(triage.data.relevance)}`} />{triage.data.workCategory ? <span className="rw-note"> · {triage.data.workCategory}</span> : null}</p>
        {triage.data.summary && <p className="rw-note">{triage.data.summary}</p>}
        {Array.isArray(triage.data.missingInformation) && triage.data.missingInformation.length > 0 && <><p className="rw-note">Missing information:</p><ul className="rw-items">{triage.data.missingInformation.map((item: string, i: number) => <li key={i}>{item}</li>)}</ul></>}
      </div>}
    </section>

    <StagePanel recordId={recordId} runs={runs.data ?? []} loading={runs.isPending} error={runs.error as Error | null} profileVersionId={profileVersionId} />
    {profileVersionId && <Judgements recordId={recordId} profileVersionId={profileVersionId} profileName={active ? `${active.name} v${active.version}` : ''} />}
    <DecisionForm recordId={recordId} assessment={a} decisions={decisions.data ?? []} pursuitStage={pursuitStage} loading={decisions.isPending || assessment.isPending} />
    <TaskPanel recordId={recordId} preset={taskPreset} onPresetUsed={() => setTaskPreset(null)} />
  </div>;
}

function StagePanel({ recordId, runs, loading, error, profileVersionId }: { recordId: string; runs: StageRunRow[]; loading: boolean; error: Error | null; profileVersionId: string | null }) {
  const [choice, setChoice] = useState<any>(null), [force, setForce] = useState(false), [starting, setStarting] = useState(''), [problem, setProblem] = useState('');
  const mine = useLaunches(recordId), activeLaunch = mine.find(item => !TERMINAL.includes(item.status)), finished = mine.find(item => TERMINAL.includes(item.status));
  const launch = async (stage: 'triage' | 'extract') => {
    if (!choice) return;
    setStarting(stage); setProblem('');
    try {
      // The selector's choice goes through as-is: startPipeline picks hosted vs CLI from the model id.
      const run = await startPipeline({ recordIds: [recordId], stage, profileVersionId, ...(force ? { force: true } : {}) }, choice);
      if (!run?.id) throw Error('No run was returned. Check run history before retrying.');
      const item = { runId: run.id, stage, status: 'queued' };
      setLaunch(recordId, item); void follow(recordId, item);
      void queryClient.invalidateQueries({ queryKey: noticeKey(recordId, 'runs') });
    } catch (e) { setProblem(friendly(e)); } finally { setStarting(''); }
  };
  const running = !!activeLaunch || runs.some(run => !run.dryRun && (run.status === 'queued' || run.status === 'running'));
  return <section className="rw-panel" aria-labelledby={`rw-stages-${recordId}`}>
    <h3 id={`rw-stages-${recordId}`}>AI stages</h3>
    {error ? <p className="rw-error" role="alert">Could not load stage runs: {error.message}</p> : loading ? <p className="rw-muted" role="status">Loading stage runs…</p> :
      <ul className="rw-nd-stages">{(['triage', 'extract'] as const).map(stage => { const status = stageStatus(runs, stage), run = status.current ?? status.latest; return <li key={stage} data-tone={status.tone}>
        <div className="rw-nd-stage-row">
          <strong>{stageName(stage)}</strong>
          <span className="rw-chip" data-tone={STAGE_TONE[status.tone]}><b>{STAGE_WORD[status.tone]}</b></span>
          {run && <span className="rw-note">{[when(run.finishedAt ?? run.startedAt), run.model, run.quality && `quality: ${label(run.quality)}`, usageText(run.usage)].filter(Boolean).join(' · ')}</span>}
        </div>
        {status.tone !== 'ok' && <small className="rw-note">{status.note}</small>}
      </li>; })}</ul>}
    <div className="rw-nd-run-row">
      {ReviewModelSelector ? <ReviewModelSelector request={host} onChange={setChoice} disabled={!!starting} /> : <p className="rw-note">Update Zoer to choose a computer and model here; AI review keeps working meanwhile.</p>}
      <label className="rw-check"><input type="checkbox" checked={force} onChange={event => setForce(event.target.checked)} />Run again even if unchanged</label>
      <Btn size="sm" variant="secondary" disabled={!choice || !!starting} loading={starting === 'triage'} onClick={() => void launch('triage')}>Triage from notice</Btn>
      <Btn size="sm" variant="primary" disabled={!choice || !!starting} loading={starting === 'extract'} onClick={() => void launch('extract')}>Extract requirements</Btn>
    </div>
    <p className="rw-note">Triage reads only the saved notice; extraction also reads every downloaded file, then re-assesses. Neither makes a bid decision.</p>
    {running && <p role="status" className="pc-running"><span className="pc-spinner" aria-hidden="true" />{activeLaunch ? stageName(activeLaunch.stage) : 'A stage'} is running on the server. You can close this notice; results appear here when it finishes.</p>}
    {!running && finished && finished.status !== 'succeeded' && <p role="alert" className="rw-error">{stageName(finished.stage)} {finished.status.replace(/_/g, ' ')}{finished.error ? `: ${finished.error}` : ''}. Earlier results are kept.</p>}
    {problem && <p role="alert" className="rw-error">{problem}</p>}
  </section>;
}

function Judgements({ recordId, profileVersionId, profileName }: { recordId: string; profileVersionId: string; profileName: string }) {
  const judgements = useQuery({ queryKey: noticeKey(recordId, 'judgements', profileVersionId), queryFn: () => readJudgements(recordId, profileVersionId) });
  const [editing, setEditing] = useState('');
  const editingDimension = JUDGEMENT_DIMENSIONS.find(d => d.id === editing) ?? null;
  return <section className="rw-panel" aria-labelledby={`rw-judge-${recordId}`}>
    <h3 id={`rw-judge-${recordId}`}>Your judgement for {profileName || 'this profile'}</h3>
    <p className="rw-note">Recorded separately from AI output; delivery stays unknown until judged.</p>
    {judgements.isPending ? <p className="rw-muted" role="status">Loading judgements…</p> : judgements.data === null ? <p className="rw-note">Update Zoer to record delivery, response, commercial and partner judgements.</p> :
      <div className="rw-table-wrap"><table className="rw-table rw-text rw-nd-judge-table">
        <thead><tr><th>Dimension</th><th>Value</th><th>Note</th><th aria-hidden="true"></th></tr></thead>
        <tbody>{JUDGEMENT_DIMENSIONS.map(dimension => {
          const current = judgements.data?.find(row => row.dimension === dimension.id) ?? null;
          return <tr key={dimension.id}>
            <th>{dimension.name}</th>
            <td>{current ? <Chip value={current.value} text={JUDGEMENT_LABELS[current.value] ?? label(current.value)} /> : <span className="rw-chip" data-tone="neutral"><b>Not judged</b></span>}</td>
            <td className="rw-nd-judge-note" title={current ? `${current.note} — ${current.reviewer}, ${when(current.updatedAt)}` : undefined}>{current ? `${current.note} — ${current.reviewer}, ${when(current.updatedAt)}` : '—'}</td>
            <td><Btn size="sm" variant="ghost" aria-label={`Edit ${dimension.name}`} onClick={() => setEditing(editing === dimension.id ? '' : dimension.id)}>{current ? 'Edit' : 'Judge'}</Btn></td>
          </tr>;
        })}</tbody>
      </table></div>}
    {editingDimension && <JudgementEditor recordId={recordId} profileVersionId={profileVersionId} dimension={editingDimension} current={judgements.data?.find(row => row.dimension === editingDimension.id) ?? null} onClose={() => setEditing('')} />}
  </section>;
}

function JudgementEditor({ recordId, profileVersionId, dimension, current, onClose }: { recordId: string; profileVersionId: string; dimension: typeof JUDGEMENT_DIMENSIONS[number]; current: JudgementRow | null; onClose(): void }) {
  const [value, setValue] = useState(current?.value ?? dimension.values[0]), [note, setNote] = useState('');
  const action = useReviewAction();
  const save = async () => { if (await action.run('judge', { op: 'judgement.set', recordId, profileVersionId, dimension: dimension.id, value, note: note.trim(), expectedRevision: current?.revision ?? 0 } as unknown as WriteOp)) onClose(); };
  return <form className="rw-form rw-card" onSubmit={event => { event.preventDefault(); if (note.trim().length >= 3) void save(); }}>
    <label className="rw-field"><span>{dimension.name}</span><Select aria-label={dimension.name} presentation="dropdown" searchable={false} value={value} disabled={!!action.busy} onChange={event => setValue(event.target.value)}>{dimension.values.map(item => <option key={item} value={item}>{JUDGEMENT_LABELS[item] ?? label(item)}</option>)}</Select></label>
    <label className="rw-field"><span>Why (required)</span><textarea rows={2} maxLength={2000} value={note} disabled={!!action.busy} onChange={event => setNote(event.target.value)} placeholder="The basis for this judgement: capacity, schedule, partner confirmation…" /></label>
    <div className="rw-actions"><Btn size="sm" type="submit" disabled={!!action.busy || note.trim().length < 3} loading={!!action.busy}>Save judgement</Btn><Btn size="sm" variant="ghost" disabled={!!action.busy} onClick={onClose}>Cancel</Btn></div>
    {action.error && <p role="alert" className="rw-error">{action.error}</p>}
  </form>;
}

function DecisionForm({ recordId, assessment, decisions, pursuitStage, loading }: { recordId: string; assessment: AssessmentRow | null; decisions: DecisionRow[]; pursuitStage: string | null; loading: boolean }) {
  const [decision, setDecision] = useState<DecisionChoice | ''>(''), [note, setNote] = useState(''), [history, setHistory] = useState(false);
  const action = useReviewAction();
  const rule = decisionNoteRule(assessment, decision), ok = !!decision && noteSatisfies(rule, note);
  const latest = decisions[0] ?? null;
  const save = async () => { if (await action.run('decide', { op: 'decision.record', recordId, assessmentId: assessment?.id ?? null, decision: decision as DecisionChoice, note: note.trim() }, 'Decision recorded. Nothing was submitted.')) { setDecision(''); setNote(''); } };
  return <section className="rw-panel" id={`rw-decide-${recordId}`} aria-labelledby={`rw-decide-title-${recordId}`}>
    <div className="rw-panel-head">
      <h3 id={`rw-decide-title-${recordId}`}>Your decision</h3>
      <span className="rw-nd-decision-status">
        <span>{latest ? <>{label(latest.decision)} · {when(latest.createdAt)}</> : 'No decision recorded'}{latest?.needsReconfirmation && <span className="rw-chip" data-tone="stale"><b>Needs reconfirmation</b></span>}</span>
        <span>Pursuit: {pursuitStage || 'Not in pursuits'}</span>
      </span>
    </div>
    <form className="rw-form" onSubmit={event => { event.preventDefault(); if (ok) void save(); }}>
      <fieldset className="rw-nd-choices"><legend className="sr-only">Decision</legend>
        {DECISION_OPTIONS.map(([value, text]) => <label key={value} className="rw-check rw-nd-decision-option" data-tone={DECISION_TONE[value] ?? 'neutral'}><input type="radio" name={`decision-${recordId}`} value={value} checked={decision === value} disabled={!!action.busy} onChange={() => setDecision(value)} />{text}</label>)}
      </fieldset>
      <label className="rw-field"><span>Note{rule.required ? ' (required)' : ' (optional)'}</span><textarea rows={3} maxLength={4000} value={note} disabled={!!action.busy} aria-describedby={`rw-rule-${recordId}`} onChange={event => setNote(event.target.value)} placeholder="Your reasoning and any conditions" /></label>
      <p id={`rw-rule-${recordId}`} className={rule.required && !ok ? 'rw-warn' : 'rw-note'}>{rule.required ? `${rule.reason} At least 3 characters.` : assessment ? `References the assessment of ${when(assessment.createdAt)}.` : 'Choose a decision.'}</p>
      <div className="rw-actions"><Btn size="sm" type="submit" disabled={!ok || !!action.busy || loading} loading={!!action.busy}>Record decision</Btn></div>
      <p className="rw-note">Recording a decision does not submit a bid, contact the buyer or change the pursuit stage. Earlier decisions stay in the history.</p>
      {action.error && <p role="alert" className="rw-error">{action.error}</p>}{action.done && <p role="status" className="rw-note">{action.done}</p>}
    </form>
    {decisions.length > 0 && <>
      <button type="button" className="pc-link-btn rw-nd-toggle" aria-expanded={history} onClick={() => setHistory(!history)}>{history ? 'Hide' : 'Show'} decision history ({decisions.length})</button>
      {history && <ol className="rw-nd-history">{decisions.map((item, i) => <li key={item.id}><strong>{label(item.decision)}</strong> · {when(item.createdAt)} · {item.actor}{i === 0 && item.needsReconfirmation ? <span className="rw-chip" data-tone="stale"><b>Needs reconfirmation</b></span> : i > 0 ? <span className="rw-note"> (history)</span> : null}{item.note && <p className="rw-note">{item.note}</p>}{!item.assessmentId && <small className="rw-note">No assessment referenced.</small>}</li>)}</ol>}
    </>}
  </section>;
}

/** Tasks for one notice: create (owner, due, optional link) and complete/cancel open ones. */
export function TaskPanel({ recordId, preset, onPresetUsed, link }: { recordId: string; preset?: { kind: string; title: string } | null; onPresetUsed?(): void; link?: { type: string; id: string; text: string } }) {
  const tasks = useQuery({ queryKey: noticeKey(recordId, 'tasks'), queryFn: () => readTasks(recordId) });
  const [showClosed, setShowClosed] = useState(false);
  const list = (tasks.data ?? []).filter(task => !link || (task.linkedType === link.type && task.linkedId === link.id));
  const open = list.filter(task => task.status === 'open'), closed = list.filter(task => task.status !== 'open');
  return <section className="rw-panel" id={`rw-tasks-${recordId}${link ? `-${link.id}` : ''}`} aria-label={link ? 'Tasks for this item' : 'Tasks for this notice'}>
    <h3>{link ? 'Tasks for this item' : 'Tasks'}</h3>
    <TaskCreateForm recordId={recordId} preset={preset} onPresetUsed={onPresetUsed} link={link} />
    {tasks.error ? <p role="alert" className="rw-error">Could not load tasks: {(tasks.error as Error).message}</p> : tasks.isPending ? <p className="rw-muted" role="status">Loading tasks…</p>
      : !open.length ? <p className="rw-note">No open tasks{link ? ' for this item' : ''}.</p> : <ul className="rw-nd-tasks">{open.map(task => <TaskItem key={task.id} recordId={recordId} task={task} />)}</ul>}
    {closed.length > 0 && <button type="button" className="pc-link-btn rw-nd-toggle" aria-expanded={showClosed} onClick={() => setShowClosed(!showClosed)}>{showClosed ? 'Hide' : 'Show'} done and cancelled ({closed.length})</button>}
    {showClosed && <ul className="rw-nd-tasks">{closed.map(task => <TaskItem key={task.id} recordId={recordId} task={task} />)}</ul>}
  </section>;
}

function TaskCreateForm({ recordId, preset, onPresetUsed, link }: { recordId: string; preset?: { kind: string; title: string } | null; onPresetUsed?(): void; link?: { type: string; id: string; text: string } }) {
  const [kind, setKind] = useState(link?.type === 'requirement' ? 'resolve_gap' : 'acquire_evidence'), [title, setTitle] = useState(''), [owner, setOwner] = useState(''), [due, setDue] = useState('');
  const action = useReviewAction(), titleRef = useRef<HTMLInputElement>(null);
  useEffect(() => { if (preset) { setKind(preset.kind); setTitle(preset.title); onPresetUsed?.(); titleRef.current?.focus(); } }, [preset]);
  const save = async () => {
    const ok = await action.run('task', { op: 'task.create', recordId, title: title.trim(), kind, ...(link ? { linkedType: link.type, linkedId: link.id } : {}), ...(owner.trim() ? { owner: owner.trim() } : {}), ...(due ? { dueAt: due } : {}), expectedVersion: 0 }, 'Task created.');
    if (ok) { setTitle(''); setOwner(''); setDue(''); }
  };
  return <form className="rw-form" onSubmit={event => { event.preventDefault(); if (title.trim().length >= 3) void save(); }}>
    <div className="rw-row">
      <label className="rw-field"><span>Kind</span><Select aria-label="Task kind" presentation="dropdown" searchable={false} value={kind} disabled={!!action.busy} onChange={event => setKind(event.target.value)}>{TASK_KINDS.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</Select></label>
      <label className="rw-field"><span>Task</span><input ref={titleRef} value={title} maxLength={300} disabled={!!action.busy} onChange={event => setTitle(event.target.value)} placeholder={link ? `e.g. Get proof for: ${link.text.slice(0, 40)}` : 'e.g. Download the addendum'} /></label>
    </div>
    <div className="rw-row">
      <label className="rw-field"><span>Owner</span><input value={owner} maxLength={120} disabled={!!action.busy} onChange={event => setOwner(event.target.value)} placeholder="Unassigned" /></label>
      <label className="rw-field"><span>Due</span><input type="date" value={due} disabled={!!action.busy} onChange={event => setDue(event.target.value)} /></label>
      <Btn size="sm" type="submit" variant="secondary" disabled={!!action.busy || title.trim().length < 3} loading={!!action.busy}>Create task</Btn>
    </div>
    {action.error && <p role="alert" className="rw-error">{action.error}</p>}{action.done && <p role="status" className="rw-note">{action.done}</p>}
  </form>;
}

function TaskItem({ recordId, task }: { recordId: string; task: NoticeTask }) {
  const [completing, setCompleting] = useState(false), [note, setNote] = useState('');
  const action = useReviewAction();
  const update = (status: 'done' | 'cancelled') => action.run(status, { op: 'task.update', taskId: task.id, recordId, status, ...(note.trim() ? { completionNote: note.trim() } : {}), expectedVersion: task.version });
  return <li data-status={task.status}>
    <div><strong>{task.title}</strong> <span className="rw-note">{taskKindLabel(task.kind)} · {task.owner || 'Unassigned'} · {task.dueAt ? `due ${task.dueAt.slice(0, 10)}` : 'no due date'}{task.linkedType ? ` · linked ${task.linkedType}` : ''}{task.status !== 'open' ? ` · ${task.status === 'done' ? 'Done' : 'Cancelled'}` : ''}</span></div>
    {task.completionNote && <small className="rw-note">{task.completionNote}</small>}
    {task.status === 'open' && (completing ? <form className="rw-form" onSubmit={event => { event.preventDefault(); if (note.trim().length >= 3) void update('done'); }}>
      <label className="rw-field"><span>What was done (required)</span><input value={note} maxLength={2000} disabled={!!action.busy} onChange={event => setNote(event.target.value)} placeholder="And where the supporting evidence is" /></label>
      <div className="rw-actions"><Btn size="sm" type="submit" disabled={note.trim().length < 3 || !!action.busy} loading={action.busy === 'done'}>Mark done</Btn><Btn size="sm" variant="ghost" onClick={() => setCompleting(false)}>Back</Btn></div>
      <p className="rw-note">Completing a task does not satisfy a requirement until supporting evidence is added and reviewed.</p>
    </form> : <div className="rw-actions"><Btn size="sm" variant="ghost" disabled={!!action.busy} onClick={() => setCompleting(true)}>Complete</Btn><Btn size="sm" variant="ghost" disabled={!!action.busy} loading={action.busy === 'cancelled'} onClick={() => void update('cancelled')}>Cancel task</Btn></div>)}
    {action.error && <p role="alert" className="rw-error">{action.error}</p>}
  </li>;
}
