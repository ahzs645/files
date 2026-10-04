import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { parseDeadline, deadlineState } from '@bcbid/procurement-core';
import { Btn, Modal } from '@zoer/plugin-ui/controls';
import { ReviewModelSelector } from '@zoer/plugin-ui/analysis';
import { host } from '../bridge';
import { downloadCsvWithManifest, downloadText, manifestNote } from '../export';
import { BUNDLE_MAX_NOTICES, downloadDocumentBundle, sizeText } from '../document-bundle';
import { REVIEW_KEY, startPipeline, useReviewInvalidate } from './actions';
import { toneOf } from './DimensionChips';
import { evidenceScopeOf, type RowReview } from './opportunity-queries';
import { label } from './queries';
import { hasProfileFilters, profileGate, readProfileFilterHits, readProfileRules } from './profile-filter';
import { EXPORT_COLUMNS, PIPELINE_BATCH, chunkRuns, exportJson, readExportRows, readPreflight, snapshotManifest, summarizePreflight, type PipelineStage, type SelectionSnapshot } from './selection';
import './review.css';

function Chip({ value, text, tone }: { value?: unknown; text?: string; tone?: string }) {
  return <span className="rw-chip" data-tone={tone ?? toneOf(value)}><b>{text ?? label(value)}</b></span>;
}

/**
 * One quiet line under a notice in the list: only what exists. The AI's next action and fit for the active profile,
 * the human decision (kept separate), and how much evidence was processed. Nothing renders for untouched notices,
 * so the list reads like a plain catalog until review work starts. "Not assessed" lives in the tooltip, not the row.
 */
export function ReviewLine({ review, profileText }: { review: RowReview | undefined; profileText: string }) {
  if (!review) return null;
  const { assessment: a, decision: d, evidence: e } = review, scope = evidenceScopeOf(e), items = [];
  if (a) {
    items.push(<span key="action" className="rw-chip" data-tone={a.freshness === 'stale' ? 'stale' : toneOf(a.suggestedAction)} title={`AI suggestion for ${profileText}; not a decision`}><b>{a.freshness === 'stale' ? 'Evidence changed; reconfirm' : label(a.suggestedAction)}</b></span>);
    if (a.relevance !== 'not_assessed' && a.relevance !== 'unknown') items.push(<span key="fit" className="rw-o-inline">Fit <b>{label(a.relevance)}</b></span>);
    items.push(<span key="elig" className="rw-o-inline">Eligibility <b>{label(a.eligibility)}</b></span>);
  }
  if (d) items.push(<span key="decision" className="rw-o-inline" title={d.note || undefined}>Your decision <b>{label(d.decision)}</b>{d.needsReconfirmation && <span className="rw-o-warn"> · reconfirm</span>}</span>);
  if (e.extracted || e.triaged) items.push(<span key="scope" className="rw-o-inline rw-o-muted" title={scope.detail}>{scope.label}</span>);
  else if (e.downloaded > 0) items.push(<span key="files" className="rw-o-inline rw-o-muted" title={scope.detail}>{e.usable.toLocaleString()} of {e.downloaded.toLocaleString()} file{e.downloaded === 1 ? '' : 's'} readable</span>);
  return items.length ? <div className="rw-o-line">{items}</div> : null;
}

export function EvidenceScopeCell({ review }: { review: RowReview | undefined }) {
  if (!review) return <span className="rw-o-muted">Loading…</span>;
  const scope = evidenceScopeOf(review.evidence);
  return <span className="rw-o-stack"><span className="rw-chip" data-tone={scope.tone}><b>{scope.label}</b></span><small>{scope.detail}</small></span>;
}

const STATE_TEXT = { open: 'Open', closing_today_time_unverified: 'Closing date today; time unverified', closed: 'Closed', unknown: 'Deadline unknown' } as const;
const STATE_TONE = { open: 'neutral', closing_today_time_unverified: 'needs_information', closed: 'neutral', unknown: 'neutral' } as const;
/** Deadline state from the core parser, separate from the source's status text. Precision is always stated. */
export function deadlineCell(raw: unknown, kind: string, asOf: number): { state: keyof typeof STATE_TEXT | 'award'; text: string; detail: string } {
  const text = typeof raw === 'string' ? raw.trim() : '';
  if (kind === 'award') return { state: 'award', text: text ? `Awarded ${text.slice(0, 10)}` : 'Award date not provided', detail: 'Award notice' };
  const value = parseDeadline(text || null), state = deadlineState(value, asOf);
  const detail = value.precision === 'instant' && value.iso ? new Date(value.iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
    : value.precision === 'date' ? `${value.date} · date only; time unverified` : value.precision === 'range' ? `${value.raw} · date range` : text ? `${text} (unrecognized date)` : 'Not provided';
  return { state, text: STATE_TEXT[state], detail };
}
export function DeadlineCell({ raw, kind, asOf }: { raw: unknown; kind: string; asOf: number }) {
  const cell = deadlineCell(raw, kind, asOf);
  return <span className="rw-o-stack">{cell.state === 'award' ? <span>{cell.text}</span> : <Chip text={cell.text} tone={STATE_TONE[cell.state]} />}<small>{cell.detail}</small></span>;
}

// ---- Selection bar -----------------------------------------------------------------------------------------------

/**
 * Actions for the active selection: a frozen "all matching" snapshot when one exists, otherwise the rows ticked by
 * hand. Batch processing always goes through the preflight dialog; exports always carry a manifest.
 */
export function SelectionActions({ snapshot, workspace, onError }: { snapshot: SelectionSnapshot; workspace: boolean; onError: (message: string) => void }) {
  // The dialog works on the selection as it was when opened, even if rows are ticked or filters change meanwhile.
  const [open, setOpen] = useState<{ stage: PipelineStage; snapshot: SelectionSnapshot } | null>(null), [busy, setBusy] = useState(''), [note, setNote] = useState('');
  const start = (stage: PipelineStage) => setOpen({ stage, snapshot: snapshot.origin === 'manual' ? { ...snapshot, ids: [...snapshot.ids], capturedAt: new Date().toISOString() } : snapshot });
  const download = async (format: 'json' | 'csv') => {
    setBusy(format); setNote('');
    try {
      const rows = await readExportRows(snapshot, workspace);
      const stamp = snapshot.capturedAt.slice(0, 19).replace(/[:T]/g, '-'), file = `procurement-selection-${rows.length}-${stamp}.${format}`;
      const manifest = snapshotManifest(snapshot, { file, rowsExported: rows.length, workspace });
      if (format === 'csv') downloadCsvWithManifest([...EXPORT_COLUMNS], rows.map(row => EXPORT_COLUMNS.map(key => row[key])), manifest);
      else downloadText(exportJson(manifest, rows), file, 'application/json');
      setNote(manifestNote(manifest));
    } catch (e) { onError((e as Error).message); } finally { setBusy(''); }
  };
  /** S2: the saved files of the selected notices and the selection as CSV, in one zip built and verified by Zoer. */
  const bundle = async () => {
    setBusy('zip'); setNote('');
    try {
      const result = await downloadDocumentBundle(host, snapshot.ids, { scope: snapshot.origin === 'manual' ? 'ticked notices' : 'all matching notices' });
      setNote(`Downloaded ${result.name}: ${result.documents} file${result.documents === 1 ? '' : 's'} (${sizeText(result.bytes)})${result.withoutFiles ? `; ${result.withoutFiles} notice${result.withoutFiles === 1 ? ' has' : 's have'} no saved files and ${result.withoutFiles === 1 ? 'is' : 'are'} in the CSV only` : ''}.`);
    } catch (e) { onError((e as Error).message); } finally { setBusy(''); }
  };
  const pipelineBlocker = workspace ? '' : 'Triage and extraction need the review workspace.';
  return <>
    <Btn size="sm" variant="secondary" disabled={!!pipelineBlocker} tooltip={pipelineBlocker || 'Classify from the saved notice only'} onClick={() => start('triage')}>Triage from notice</Btn>
    <Btn size="sm" variant="secondary" disabled={!!pipelineBlocker} tooltip={pipelineBlocker || 'Extract requirements and facts from the notice and readable documents'} onClick={() => start('extract')}>Extract requirements</Btn>
    <Btn size="sm" variant="secondary" disabled={!!busy} onClick={() => void download('csv')}>{busy === 'csv' ? 'Exporting…' : 'Export CSV'}</Btn>
    <Btn size="sm" variant="secondary" disabled={!!busy} onClick={() => void download('json')}>{busy === 'json' ? 'Exporting…' : 'Export JSON'}</Btn>
    <Btn size="sm" variant="secondary" disabled={!!busy || snapshot.ids.length > BUNDLE_MAX_NOTICES} tooltip={snapshot.ids.length > BUNDLE_MAX_NOTICES ? `Select at most ${BUNDLE_MAX_NOTICES} notices` : 'Saved documents of these notices and a CSV, as one zip'} onClick={() => void bundle()}>{busy === 'zip' ? 'Building zip…' : 'Download all documents'}</Btn>
    {note && <span role="status" className="rw-o-muted">{note}</span>}
    {open && <PipelinePreflight snapshot={open.snapshot} stage={open.stage} onClose={() => setOpen(null)} />}
  </>;
}

// ---- Preflight ---------------------------------------------------------------------------------------------------

const STAGE_TEXT: Record<PipelineStage, { title: string; scope: string }> = {
  triage: { title: 'Triage from notice', scope: 'Based on the saved notice only. Attachments are not read, so this is a provisional classification.' },
  extract: { title: 'Extract requirements', scope: 'Reads the saved notice and every downloaded document with usable text, in chunks, and records each requirement and fact with its source passage.' },
};

/** Preflight for a batch pipeline run: records, stage, model, evidence scope, estimated calls, reuse and limits. */
export function PipelinePreflight({ snapshot, stage, onClose }: { snapshot: SelectionSnapshot; stage: PipelineStage; onClose: () => void }) {
  const [model, setModel] = useState<any>(null), [force, setForce] = useState(false), [includeFiltered, setIncludeFiltered] = useState(false);
  const [progress, setProgress] = useState(''), [result, setResult] = useState<{ ok: boolean; text: string } | null>(null), [busy, setBusy] = useState(false);
  const invalidate = useReviewInvalidate();
  const preflight = useQuery({ queryKey: [...REVIEW_KEY, 'preflight', stage, snapshot.capturedAt, snapshot.ids.length], queryFn: () => readPreflight(snapshot.ids, stage), staleTime: 30_000 });
  // The profile's quick filters (excluded keywords, value range) are the cheap gate before any model call.
  const gateQuery = useQuery({ queryKey: [...REVIEW_KEY, 'preflight-profile-filter', snapshot.profileVersionId, snapshot.capturedAt, snapshot.ids.length], staleTime: 30_000,
    queryFn: async () => { const rules = await readProfileRules(snapshot.profileVersionId); return { rules, hits: await readProfileFilterHits(snapshot.ids, rules) }; } });
  const gate = profileGate(snapshot.ids, gateQuery.data?.hits ?? new Map(), includeFiltered), runIds = new Set(gate.run);
  const summary = preflight.data ? summarizePreflight(stage, preflight.data.filter(record => runIds.has(record.id)), force) : null;
  const runs = chunkRuns(gate.run), n = (value: number) => value.toLocaleString();
  const start = async () => {
    setBusy(true); setResult(null);
    const started: string[] = [];
    try {
      for (const [index, ids] of runs.entries()) {
        setProgress(`Starting run ${index + 1} of ${runs.length}…`);
        started.push((await startPipeline({ recordIds: ids, stage, profileVersionId: snapshot.profileVersionId, force }, model)).id);
      }
      setResult({ ok: true, text: `Started ${runs.length === 1 ? 'one run' : `${n(runs.length)} sequential runs`} for ${n(gate.run.length)} notices${gate.run.length < snapshot.ids.length ? ` (${n(snapshot.ids.length - gate.run.length)} filtered by the profile were skipped)` : ''}. Follow progress on Home and in AI workbench → Pipeline stages. Results appear as each notice finishes.` });
    } catch (e) {
      setResult({ ok: false, text: `${started.length ? `Started ${started.length} of ${runs.length} runs; ` : ''}run ${started.length + 1} could not start: ${(e as Error).message}. Nothing further was started.` });
    } finally { setBusy(false); setProgress(''); void invalidate(); }
  };
  const blocker = busy ? 'Starting…' : !snapshot.ids.length ? 'The selection is empty.' : gateQuery.isPending ? 'Checking the profile’s quick filters…' : gateQuery.isError ? `Could not check the profile’s quick filters: ${(gateQuery.error as Error).message}` : !gate.run.length ? 'Every selected notice is filtered by the profile.' : !ReviewModelSelector ? 'Update Zoer to choose a review model.' : !model ? 'Choose a computer and review model.' : preflight.isPending ? 'Reading evidence scope…' : '';
  return <Modal title={`${STAGE_TEXT[stage].title}: preflight`} mobileSheet onClose={() => { if (!busy) onClose(); }} footer={<>
    <Btn variant="ghost" disabled={busy} onClick={onClose}>{result?.ok ? 'Close' : 'Cancel'}</Btn>
    {!result?.ok && <Btn disabled={!!blocker} onClick={() => void start()}>{busy ? 'Starting…' : `Start ${runs.length === 1 ? 'run' : `${runs.length} runs`}`}</Btn>}
  </>}>
    <div className="rw-o-preflight">
      <dl>
        <div><dt>Records</dt><dd>{n(snapshot.ids.length)} notice{snapshot.ids.length === 1 ? '' : 's'} · {snapshot.origin === 'matching' ? 'frozen selection of all matching notices' : 'individually selected'} · captured {new Date(snapshot.capturedAt).toLocaleString()}{snapshot.note && <span className="rw-warn"> {snapshot.note}</span>}</dd></div>
        <div><dt>Scope</dt><dd>{snapshot.description.join(' · ') || 'All saved notices'}</dd></div>
        <div><dt>Stage</dt><dd><strong>{STAGE_TEXT[stage].title}.</strong> {STAGE_TEXT[stage].scope}</dd></div>
        <div><dt>Evidence scope</dt><dd>{preflight.isPending ? 'Reading…' : preflight.isError ? `Could not read the evidence scope: ${preflight.error.message}` : stage === 'triage' ? `All ${n(summary!.records)} use the saved notice only.` : `${n(summary!.withText)} notice${summary!.withText === 1 ? '' : 's'} with usable-text documents (${n(summary!.readableDocs)} documents) · ${n(summary!.noticeOnly)} notice-only (no usable document text)`}</dd></div>
        <div><dt>Estimated model calls</dt><dd>{summary ? <>About {n(summary.estimatedCalls)}. <span className="rw-o-muted">{stage === 'triage' ? 'One call per notice processed.' : 'One call per 12,000 characters (code points) of each readable document, plus one per notice.'} This is an estimate; chunk overlap and repair retries can add calls.</span></> : '—'}</dd></div>
        <div><dt>Reuse</dt><dd>{summary ? force ? `Re-running all ${n(summary.records)}, including ${n(preflight.data!.filter(r => r.current).length)} with a current result.` : `${n(summary.reused)} already have a current ${stage === 'triage' ? 'triage' : 'extraction'} result and will be reused unless you re-run them.` : '—'}</dd></div>
        <div><dt>Limits</dt><dd>At most {PIPELINE_BATCH} notices per run. {runs.length > 1 ? `This selection starts as ${runs.length} sequential runs.` : 'This selection fits in one run.'}</dd></div>
        <div><dt>Profile filters</dt><dd>{gateQuery.isPending ? 'Checking…' : gateQuery.isError ? 'Could not be checked; nothing starts until they can.' : !hasProfileFilters(gateQuery.data?.rules) ? `${snapshot.profileText} has no quick filters (excluded keywords or contract value range).` : gate.filtered.length ? <>{n(gate.filtered.length)} filtered by the profile{gate.kinds.keyword ? ` · ${n(gate.kinds.keyword)} excluded keyword` : ''}{gate.kinds.value ? ` · ${n(gate.kinds.value)} value out of range` : ''}. {includeFiltered ? 'They are included in this run.' : 'They are skipped, so no model calls are spent on them.'}</> : 'None of the selected notices is filtered by the profile. Unknown contract values pass.'}</dd></div>
        <div><dt>Profile</dt><dd>{stage === 'extract' ? `Assessment after extraction uses ${snapshot.profileText}.` : `Triage does not assess eligibility. Active profile: ${snapshot.profileText}.`}</dd></div>
      </dl>
      <label className="procurement-check"><input type="checkbox" checked={force} disabled={busy} onChange={event => setForce(event.target.checked)} />Re-run notices that already have a current result</label>
      {gate.filtered.length > 0 && <label className="procurement-check"><input type="checkbox" checked={includeFiltered} disabled={busy} onChange={event => setIncludeFiltered(event.target.checked)} />Include the {n(gate.filtered.length)} notice{gate.filtered.length === 1 ? '' : 's'} filtered by the profile</label>}
      {ReviewModelSelector ? <ReviewModelSelector request={host} onChange={setModel} disabled={busy} /> : <p className="rw-upgrade">Update Zoer to choose computers and models for pipeline runs.</p>}
      <p className="rw-o-muted">Nothing is submitted to buyers or portals. This only prepares review material; AI results start as proposals for your review.</p>
      {blocker && !busy && !result && <p role="status" className="rw-o-muted">{blocker}</p>}
      <p role="status" aria-live="polite">{progress}</p>
      {result && <p role={result.ok ? 'status' : 'alert'} className={result.ok ? '' : 'rw-bad'}>{result.text}</p>}
    </div>
  </Modal>;
}
