import { useEffect, useId, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties } from 'react';
import { useQuery } from '@tanstack/react-query';
import { X } from 'lucide-react';
import { Btn, ModalSurface, Select } from '@zoer/plugin-ui/controls';
import { REQUIREMENT_STRENGTHS, MONEY_BASES, MONEY_KIND_LABELS, parseDeadline, parseMoney, verdictTone } from '@bcbid/procurement-core';
import { host } from '../bridge';
import { REVIEW_KEY, type WriteOp } from './actions';
import { useReviewAction } from './DecisionHeader';
import { label } from './queries';
import {
  factValueText, fieldName, moneyOf, moneyText, noticeKey, passageParts, readDocumentVersion, readExtraction, readInspectorItem, readReviewEvents, readSpans, reviewStateOf, sha256Hex, spanProblem, when,
  type FactRow, type InspectorItem, type ReviewEventRow,
} from './notice-queries';
import '../procurement/notice.css';
import './review.css';

const WIDE = '(min-width: 900px)';
const useWide = () => useSyncExternalStore(listener => { if (typeof matchMedia !== 'function') return () => {}; const query = matchMedia(WIDE); query.addEventListener('change', listener); return () => query.removeEventListener('change', listener); }, () => typeof matchMedia === 'function' && matchMedia(WIDE).matches, () => true);
// The dialog is portaled to <body>: size it inline (plugin CSS can't reach it) and re-enter the plugin's CSS scope inside.
const surface: CSSProperties = { position: 'fixed', margin: 0, padding: 0, border: 'none', maxWidth: '100vw', height: '100dvh', maxHeight: '100dvh', background: 'var(--surface-primary)', color: 'var(--text-primary)', overflow: 'hidden' };
const SIDE: CSSProperties = { ...surface, inset: '0 0 0 auto', width: 'min(1120px, 94vw)', borderLeft: '1px solid var(--border-default)', boxShadow: '-12px 0 40px rgba(0,0,0,.2)' };
const SHEET: CSSProperties = { ...surface, inset: 0, width: '100vw' };

const EVENTS: Record<string, string> = { accept: 'Accepted', reject: 'Rejected', correct: 'Corrected', request_clarification: 'Marked needs clarification', reconfirm: 'Reconfirmed' };
const STATES: Record<string, string> = { proposed: 'Proposed', ungrounded: 'Ungrounded', accepted: 'Accepted', corrected: 'Corrected', rejected: 'Rejected', needs_clarification: 'Needs clarification', outdated: 'Outdated' };
const stateChip = (state: string) => <span className="rw-chip" data-tone={state === 'proposed' ? 'neutral' : verdictTone(state)}><b>{STATES[state] ?? label(state)}</b></span>;
const correctionText = (value: unknown) => value == null ? '' : typeof value === 'string' ? value : typeof value === 'object' ? Object.entries(value as object).filter(([key, v]) => v != null && v !== '' && key !== 'basis' && key !== 'supportingReference').map(([key, v]) => `${key}: ${typeof v === 'object' ? JSON.stringify(v) : v}`).join(' · ') : String(value);

/**
 * One extracted requirement or fact: its value and interpretation, the AI's original, the append-only review
 * history and actions, beside the immutable source passage highlighted by code-point span (or the named reason
 * no passage can be shown). Side panel on wide screens, full-screen sheet otherwise; Escape closes and focus returns.
 */
export function EvidenceInspector({ recordId, target, onClose }: { recordId: string; target: { type: 'requirement' | 'fact'; id: string }; onClose(): void }) {
  const wide = useWide(), titleId = useId(), titleRef = useRef<HTMLHeadingElement>(null);
  const item = useQuery({ queryKey: noticeKey(recordId, 'inspect', target.type, target.id), queryFn: () => readInspectorItem(recordId, target) });
  const events = useQuery({ queryKey: noticeKey(recordId, 'events', target.type, target.id), queryFn: () => readReviewEvents(target.type, target.id) });
  const title = target.type === 'requirement' ? 'Review extracted requirement' : `Review extracted value${item.data?.fact ? `: ${fieldName(item.data.fact.fieldKey)}` : ''}`;
  return <ModalSurface onClose={onClose} initialFocusRef={titleRef} aria-labelledby={titleId} style={wide ? SIDE : SHEET}>
    <div className="bcbid-native rw-inspector" data-layout={wide ? 'side' : 'sheet'}>
      <header className="rw-inspector-head">
        <h2 id={titleId} ref={titleRef} tabIndex={-1}>{title}</h2>
        <button type="button" className="pc-icon-btn" aria-label="Close evidence inspector" onClick={onClose}><X aria-hidden="true" className="h-4 w-4" /></button>
      </header>
      {item.isPending ? <p className="rw-muted rw-inspector-pad" role="status">Loading…</p>
        : item.error ? <p className="rw-error rw-inspector-pad" role="alert">Could not load this item: {(item.error as Error).message}</p>
        : !item.data ? <p className="rw-note rw-inspector-pad" role="alert">This item is no longer in the catalog for this notice.</p>
        : <div className="rw-inspector-body">
          <Claim item={item.data} events={events.data ?? []} eventsLoading={events.isPending} />
          <Source recordId={recordId} item={item.data} />
        </div>}
    </div>
  </ModalSurface>;
}

function Claim({ item, events, eventsLoading }: { item: InspectorItem; events: ReviewEventRow[]; eventsLoading: boolean }) {
  const state = reviewStateOf(item), req = item.requirement, fact = item.fact;
  return <section className="rw-inspector-claim" aria-label="Extracted value and review">
    <div className="rw-chips">{stateChip(state)}<span className="rw-chip" data-tone={item.grounding === 'unverified' ? 'needs_information' : 'neutral'}><b>{label(item.grounding)}</b></span>{item.run && !item.run.isCurrent && <span className="rw-chip" data-tone="stale"><b>From an earlier run</b></span>}</div>
    {req && <>
      <p className="rw-inspector-value">{state === 'corrected' ? correctionText(item.reviewValue?.text ?? item.reviewValue) : req.text}</p>
      <dl className="rw-summary">
        <div><dt>Type</dt><dd>{label(req.strength)} · {req.category}</dd></div>
        <div><dt>Who must meet it</dt><dd>{req.actor || 'Not stated'}</dd></div>
        <div><dt>When</dt><dd>{req.requiredBy || 'Not stated'}</dd></div>
        {req.conditionText && <div><dt>Condition</dt><dd>{req.conditionText}</dd></div>}
        {req.lotId && <div><dt>Lot</dt><dd>{req.lotId}</dd></div>}
        {req.conflicts.length > 0 && <div><dt>Conflicts</dt><dd>Conflicts with {req.conflicts.length} other item{req.conflicts.length === 1 ? '' : 's'}; stays visible until resolved.</dd></div>}
      </dl>
    </>}
    {fact && <>
      <p className="rw-inspector-value">{factValueText(state === 'corrected' ? correctedFact(fact, item.reviewValue) : fact)}</p>
      <dl className="rw-summary">
        <div><dt>Field</dt><dd>{fieldName(fact.fieldKey)}</dd></div>
        <div><dt>Interpretation</dt><dd>{fact.semanticType.startsWith('money:') ? `${(MONEY_KIND_LABELS as Record<string, string>)[fact.semanticType.slice(6)] ?? fact.semanticType.slice(6)}; never merged with other amount types` : fact.semanticType}</dd></div>
        <div><dt>Status</dt><dd>{label(fact.status)}{fact.status === 'not_found_in_reviewed_material' ? ' (not the same as “not required”)' : ''}</dd></div>
      </dl>
    </>}
    <div className="rw-card">
      <h4 className="rw-subhead">AI original{state === 'corrected' ? ' (kept unchanged)' : ''}</h4>
      <p className="rw-note">{req ? req.text : fact ? factValueText(fact) : ''}</p>
      <small className="rw-note">{item.run ? [item.run.templateId && `${item.run.templateId} v${item.run.templateVersion}`, item.run.model, item.run.finishedAt && when(item.run.finishedAt)].filter(Boolean).join(' · ') : 'Stage run not found'}. A model output is not a verified fact.</small>
    </div>
    <ReviewActions item={item} state={state} />
    <h4 className="rw-subhead">Reviewer history</h4>
    {eventsLoading ? <p className="rw-muted" role="status">Loading history…</p> : !events.length ? <p className="rw-note">No reviews yet. The item stays {STATES[state]?.toLowerCase() ?? state} until someone reviews it.</p>
      : <ol className="rw-nd-history">{events.map(event => <li key={event.id}><strong>{EVENTS[event.event] ?? event.event}</strong> · {event.reviewer} · {when(event.occurredAt)} · revision {event.revision}
        {event.correction != null && <p className="rw-note">Corrected to: {correctionText(event.correction?.value ?? event.correction)}</p>}
        {event.reason && <p className="rw-note">{event.reason}</p>}</li>)}</ol>}
  </section>;
}

function correctedFact(fact: FactRow, value: any): FactRow {
  const patch = value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).every(key => key === 'value' || key === 'status');
  return patch ? { ...fact, ...value } : { ...fact, value };
}

type Mode = '' | 'accept' | 'correct' | 'reject' | 'request_clarification';
function ReviewActions({ item, state }: { item: InspectorItem; state: string }) {
  const [mode, setMode] = useState<Mode>(''), [reason, setReason] = useState(''), [value, setValue] = useState(''), [strength, setStrength] = useState(item.requirement?.strength ?? 'mandatory');
  const [basis, setBasis] = useState<'reference' | 'assertion'>('reference'), [reference, setReference] = useState(''), [moneyBasis, setMoneyBasis] = useState('unknown'), [problem, setProblem] = useState('');
  const action = useReviewAction();
  const fact = item.fact, money = fact?.semanticType.startsWith('money:'), date = fact?.semanticType === 'date';
  const open = (next: Mode) => { setMode(next); setReason(''); setProblem(''); if (next === 'correct') { setValue(item.requirement ? item.requirement.text : fact ? (money ? moneyOf(fact)?.raw ?? '' : typeof fact.value?.raw === 'string' ? fact.value.raw : typeof fact.value === 'string' ? fact.value : '') : ''); setMoneyBasis(fact && money ? moneyOf(fact)?.basis ?? 'unknown' : 'unknown'); } };
  const reasonNeeded = mode === 'correct' || mode === 'reject' || mode === 'request_clarification' || (mode === 'accept' && item.grounding === 'unverified');
  const ready = !!mode && (!reasonNeeded || reason.trim().length >= 3) && (mode !== 'correct' || (value.trim().length > 0 && (basis === 'assertion' || reference.trim().length >= 3)));
  const submit = async () => {
    setProblem('');
    let correction: unknown;
    if (mode === 'correct') {
      if (item.requirement) correction = { text: value.trim(), strength, basis: basis === 'assertion' ? 'operator_assertion' : 'supporting_reference', supportingReference: basis === 'reference' ? reference.trim() : null };
      else if (money) { const parsed = parseMoney(value.trim()); if (!parsed) { setProblem('Enter an amount such as “CAD 75,000” or “$50,000 to $80,000”.'); return; } const { isMaximum: _, ...rest } = parsed; correction = { value: { ...rest, basis: moneyBasis } }; }
      else if (date) correction = { value: { raw: value.trim(), precision: parseDeadline(value.trim()).precision } };
      else correction = { value: value.trim() };
    }
    const why = [reason.trim(), mode === 'correct' ? (basis === 'assertion' ? 'Basis: operator assertion (no supporting reference).' : `Supporting reference: ${reference.trim()}`) : ''].filter(Boolean).join('\n');
    const event = mode === 'request_clarification' ? 'request_clarification' : mode as 'accept' | 'reject' | 'correct';
    const ok = await action.run(mode, { op: 'review.append', targetType: item.type, targetId: item.id, event, reason: why, ...(mode === 'correct' ? { correction } : {}), expectedRevision: item.revision } as WriteOp, 'Review saved. The AI original and the source stay unchanged.');
    if (ok) setMode('');
  };
  return <div className="rw-inspector-actions">
    <div className="rw-actions" role="group" aria-label="Review this item">
      <Btn size="sm" variant={mode === 'accept' ? 'primary' : 'secondary'} disabled={!!action.busy} onClick={() => open('accept')}>Accept</Btn>
      <Btn size="sm" variant={mode === 'correct' ? 'primary' : 'secondary'} disabled={!!action.busy} onClick={() => open('correct')}>Correct</Btn>
      <Btn size="sm" variant={mode === 'reject' ? 'primary' : 'secondary'} disabled={!!action.busy} onClick={() => open('reject')}>Reject</Btn>
      <Btn size="sm" variant={mode === 'request_clarification' ? 'primary' : 'secondary'} disabled={!!action.busy} onClick={() => open('request_clarification')}>Mark needs clarification</Btn>
    </div>
    {mode && <form className="rw-form rw-card" onSubmit={event => { event.preventDefault(); if (ready) void submit(); }}>
      {mode === 'accept' && <p className="rw-note">{item.grounding === 'unverified' ? 'The quote was not found in the source. Say what you checked to accept it anyway.' : 'Accepting confirms the extraction matches the source. It does not mark the requirement as met.'}</p>}
      {mode === 'correct' && <>
        <label className="rw-field"><span>Corrected {item.requirement ? 'requirement' : 'value'}</span>{item.requirement ? <textarea rows={3} value={value} onChange={event => setValue(event.target.value)} /> : <input value={value} onChange={event => setValue(event.target.value)} placeholder={money ? 'e.g. CAD 75,000 excluding tax' : date ? 'e.g. 2026-10-15 14:00 Pacific' : ''} />}</label>
        {item.requirement && <label className="rw-field"><span>Type</span><Select aria-label="Requirement type" presentation="dropdown" searchable={false} value={strength} onChange={event => setStrength(event.target.value)}>{REQUIREMENT_STRENGTHS.map(s => <option key={s} value={s}>{label(s)}</option>)}</Select></label>}
        {money && <label className="rw-field"><span>Amount basis</span><Select aria-label="Amount basis" presentation="dropdown" searchable={false} value={moneyBasis} onChange={event => setMoneyBasis(event.target.value)}>{MONEY_BASES.map(b => <option key={b} value={b}>{b === 'unknown' ? 'Basis not stated' : b.replace(/_/g, ' ')}</option>)}</Select></label>}
        {money && value.trim() && <p className="rw-note">Reads as: {(() => { const parsed = parseMoney(value.trim()); return parsed ? moneyText({ ...parsed, basis: moneyBasis as any }) : 'not recognised as an amount'; })()}</p>}
        <fieldset className="rw-nd-choices"><legend className="rw-sub">Support for this correction</legend>
          <label className="rw-check"><input type="radio" name={`basis-${item.id}`} checked={basis === 'reference'} onChange={() => setBasis('reference')} />Supporting reference</label>
          <label className="rw-check"><input type="radio" name={`basis-${item.id}`} checked={basis === 'assertion'} onChange={() => setBasis('assertion')} />Operator assertion (no reference)</label>
        </fieldset>
        {basis === 'reference' && <label className="rw-field"><span>Reference (required)</span><input value={reference} maxLength={500} onChange={event => setReference(event.target.value)} placeholder="e.g. Addendum 2, section 4.1, page 3" /></label>}
      </>}
      <label className="rw-field"><span>{mode === 'request_clarification' ? 'What needs clarifying' : 'Reason'}{reasonNeeded ? ' (required)' : ' (optional)'}</span><textarea rows={2} maxLength={2000} value={reason} onChange={event => setReason(event.target.value)} /></label>
      <div className="rw-actions"><Btn size="sm" type="submit" disabled={!ready || !!action.busy} loading={!!action.busy}>Save review</Btn><Btn size="sm" variant="ghost" disabled={!!action.busy} onClick={() => setMode('')}>Cancel</Btn></div>
      {problem && <p role="alert" className="rw-error">{problem}</p>}
    </form>}
    {action.error && <p role="alert" className="rw-error">{action.error}</p>}{action.done && <p role="status" className="rw-note">{action.done}</p>}
    {(state === 'ungrounded' || item.requirement?.conflicts.length || item.fact?.status === 'conflicting') && <p className="rw-note">Bulk acceptance is not offered for ungrounded or conflicting items; review each one here.</p>}
  </div>;
}

function Source({ recordId, item }: { recordId: string; item: InspectorItem }) {
  const spans = useQuery({ queryKey: noticeKey(recordId, 'spans', item.type, item.id), queryFn: () => readSpans(item.type, item.id) });
  const [index, setIndex] = useState(0), [full, setFull] = useState(false);
  const span = spans.data?.[index] ?? null, locatable = !!span && span.alignment !== 'unverified' && span.startCp != null;
  const extraction = useQuery({ queryKey: [...REVIEW_KEY, 'extraction', recordId, span?.extractionId], enabled: !!span?.extractionId, staleTime: Infinity, queryFn: () => readExtraction(recordId, span!.extractionId) });
  const fingerprint = useQuery({ queryKey: [...REVIEW_KEY, 'extraction-sha', span?.extractionId], enabled: !!extraction.data?.text && /^[0-9a-f]{64}$/i.test(extraction.data.textSha256), staleTime: Infinity, queryFn: async () => { const hash = await sha256Hex(extraction.data!.text!); return hash == null ? 'unchecked' : hash.toLowerCase() === extraction.data!.textSha256.toLowerCase() ? 'verified' : 'mismatch'; } });
  const version = useQuery({ queryKey: [...REVIEW_KEY, 'document-version', extraction.data?.documentId], enabled: !!extraction.data?.documentId, queryFn: () => readDocumentVersion(extraction.data!.documentId!) });
  const problem = spans.data ? spanProblem(span, extraction.data, recordId, item.grounding) : null;
  const parts = useMemo(() => !problem && extraction.data?.text && span ? passageParts(extraction.data.text, span.startCp, span.endCp, 600, full) : null, [problem, extraction.data, span, full]);
  const box = useRef<HTMLDivElement>(null), mark = useRef<HTMLElement>(null);
  useEffect(() => { const el = mark.current, container = box.current; if (el && container) container.scrollTop = el.offsetTop - container.clientHeight / 3; }, [parts]);
  const notFound = item.fact && item.fact.status !== 'stated' && !spans.data?.length;
  return <section className="rw-inspector-source" aria-label="Source passage">
    <div className="rw-panel-head"><h3>Source passage</h3>
      {(spans.data?.length ?? 0) > 1 && <span className="rw-actions"><Btn size="sm" variant="ghost" disabled={index === 0} onClick={() => { setIndex(index - 1); setFull(false); }}>Previous</Btn><span className="rw-note">Passage {index + 1} of {spans.data!.length}</span><Btn size="sm" variant="ghost" disabled={index >= spans.data!.length - 1} onClick={() => { setIndex(index + 1); setFull(false); }}>Next</Btn></span>}
    </div>
    {spans.isPending || (locatable && extraction.isPending) ? <p className="rw-muted" role="status">Loading source…</p>
      : spans.error ? <p className="rw-error" role="alert">Could not load source passages: {(spans.error as Error).message}</p>
      : extraction.error ? <p className="rw-error" role="alert">Could not read the extracted text: {(extraction.error as Error).message}</p>
      : <>
        {extraction.data && <dl className="rw-summary rw-inspector-meta">
          <div><dt>Source</dt><dd>{extraction.data.sourceKind === 'notice' ? 'Saved notice text' : extraction.data.name}{extraction.data.sourceKind === 'document' && extraction.data.documentId && <> · <button type="button" className="pc-link-btn" onClick={() => void host('catalog.download', { id: extraction.data!.documentId, name: extraction.data!.name }).catch(() => undefined)}>Download original</button></>}</dd></div>
          <div><dt>Version</dt><dd>Extracted {when(extraction.data.createdAt)} · {extraction.data.extractorVersion} · file {extraction.data.sha256.slice(0, 12)}{version.data && version.data.sha256 && version.data.sha256 !== extraction.data.sha256 ? <span className="rw-warn"> · the saved file changed after this text was extracted</span> : null}</dd></div>
          {(span?.page != null || span?.heading) && <div><dt>Location</dt><dd>{[span?.page != null ? `Page ${span.page}` : '', span?.heading ?? ''].filter(Boolean).join(' · ')}</dd></div>}
          <div><dt>Text check</dt><dd>{extraction.data.status !== 'readable' ? `${label(extraction.data.status)} extraction · ` : ''}{fingerprint.data === 'verified' ? 'Text fingerprint verified' : fingerprint.data === 'mismatch' ? <span className="rw-warn">Text fingerprint does not match; treat the highlight with care</span> : 'Fingerprint not checked in this browser'}</dd></div>
          {extraction.data.limitations.length > 0 && <div><dt>Limitations</dt><dd>{extraction.data.limitations.join('; ')}</dd></div>}
        </dl>}
        {notFound ? <p className="rw-callout">{label(item.fact!.status)}: there is no passage to show. This describes the reviewed material only; it is not proof that the item does not exist.</p>
          : problem ? <div className="rw-callout rw-inspector-problem"><p><strong>{problem}</strong></p>{span?.quote && <blockquote className="rw-inspector-quote">Quoted by the model: “{span.quote}”</blockquote>}{extraction.data?.sourceKind === 'document' && <p className="rw-note">Review the original file for tables, drawings or scans the text extraction may not include.</p>}</div>
          : parts && <>
            <div className="pc-text rw-inspector-text" ref={box} tabIndex={0} aria-label="Extracted text around the passage"><pre>{parts.clippedStart && '… '}{parts.before}<mark ref={mark}>{parts.match}</mark>{parts.after}{parts.clippedEnd && ' …'}</pre></div>
            <div className="rw-actions">{(parts.clippedStart || parts.clippedEnd || full) && <Btn size="sm" variant="ghost" onClick={() => setFull(!full)}>{full ? 'Show the passage in context' : 'Show full text'}</Btn>}<span className="rw-note">{label(span!.alignment)}. An exact quote supports traceability; its interpretation still needs review.</span></div>
          </>}
      </>}
  </section>;
}
