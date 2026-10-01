import { useEffect, useMemo, useRef, useState, type ComponentType, type KeyboardEvent } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Download, FileText, FileWarning, RefreshCw, X } from 'lucide-react';
import { Btn, Modal, Select } from '@zoer/plugin-ui/controls';
import * as Controls from '@zoer/plugin-ui/controls';
import { host } from '../bridge';
import { setStar } from '../backend';
import { patchPluginQuery, usePluginLocation } from '../navigation';
import { deadlineLabel, safeSourceUrl, sourceId } from './catalog';
import { PURSUIT_STAGES, type PursuitStage } from './state-contract';
import { readProcurementState, runProcurementAction, saveProcurementState } from './state-client';
import { shortDate, sourceName, sql } from './display';
import { AiResult, LabelChips } from './AiResult';
import { CATEGORY_PROMPT, CATEGORY_PROMPT_NAME, ago, buyerValue, coverageText, documentCounts, documentSummary, hasUsableText, latestEvidence, latestReview, verdictText, verdictTone } from './ai';
import { useReviewWorkspace } from '../review-workspace/actions';
import { label } from '../review-workspace/queries';
import { DecisionHeader } from '../review-workspace/DecisionHeader';
import { RequirementMatrix } from '../review-workspace/RequirementMatrix';
import { EvidenceInspector } from '../review-workspace/EvidenceInspector';
import { ChangesPanel } from '../review-workspace/ChangesPanel';
import { ReviewActivity } from '../review-workspace/ReviewActivity';
import { LEGACY_TABS, NOTICE_TABS, coverageGaps, headerMoney, noticeKey, readChanges, readExtractionSpans, readExtractions, readFacts, readStageRuns, resolveNoticeTab, scopeText, stageStatus, when, type NoticeTabId } from '../review-workspace/notice-queries';
import './notice.css';

/** Route values: `decision|requirements|evidence|changes|activity|ai`; old `overview`/`documents` still open their tab. */
export type NoticeTab = NoticeTabId | 'overview' | 'documents';
type Cite = { documentId: string; quote: string };
const TAB_NAMES: Record<NoticeTabId, string> = { decision: 'Decision', requirements: 'Requirements', evidence: 'Evidence', changes: 'Changes', activity: 'Activity', ai: 'Ask AI' };

/**
 * One notice with several distinct truths: AI suggestion, human decision and pursuit stage (Decision), requirement
 * ledger (Requirements), files and source text (Evidence), changes, activity, and the earlier Ask AI results.
 * Side panel on wide screens, a sheet otherwise. The tab is route-backed (`tab`) when opened with `?notice=<id>`.
 */
export function NoticeView({ id, layout, onClose, initialTab = 'decision' }: { id: string; layout: 'panel' | 'dialog'; onClose(): void; initialTab?: NoticeTab }) {
  const client = useQueryClient();
  const detail = useQuery({ queryKey: ['catalog', 'procurement-detail', id], queryFn: () => host('catalog.record', { id }) });
  const state = useQuery({ queryKey: ['catalog', 'procurement-state'], queryFn: readProcurementState });
  const workspace = useReviewWorkspace(), available = !!workspace.data?.available;
  const location = usePluginLocation(), params = new URLSearchParams(location.split('?')[1] ?? ''), routed = params.get('notice') === id;
  const [localTab, setLocalTab] = useState<string>(initialTab), [cite, setCite] = useState<Cite>();
  const [busy, setBusy] = useState(''), [error, setError] = useState('');
  useEffect(() => { setLocalTab(initialTab); setCite(undefined); setError(''); }, [id]);
  const tab = resolveNoticeTab(routed ? params.get('tab') ?? initialTab : localTab, available);
  const setTab = (next: NoticeTabId) => routed ? patchPluginQuery({ tab: next === 'decision' ? null : next }, 'replace') : setLocalTab(next);
  const close = () => { if (routed && params.get('tab')) patchPluginQuery({ tab: null }, 'replace'); onClose(); };
  const changes = useQuery({ queryKey: noticeKey(id, 'changes'), enabled: available, queryFn: () => readChanges(id) });
  const record = detail.data?.record, data = record?.data ?? {};
  const source = sourceId(data), award = record?.kind === 'award';
  const documents: any[] = detail.data?.documents ?? [], reviews: any[] = detail.data?.reviews ?? [];
  const pursuit = state.data?.pursuits.find(item => item.recordId === id);
  const url = safeSourceUrl(data.detailUrl || data.sourceUrl);
  const refresh = () => client.invalidateQueries({ queryKey: ['catalog'] });
  const act = async (name: string, fn: () => Promise<unknown>) => {
    setBusy(name); setError('');
    try { await fn(); await refresh(); } catch (e) { setError((e as Error).message); } finally { setBusy(''); }
  };
  const setStage = (stage: PursuitStage | '') => act('pursuit', async () => { if (stage) await saveProcurementState({ operation: 'pursuit.upsert', recordId: id, sourceId: source, stage, notes: pursuit?.notes ?? '', expectedVersion: pursuit?.version ?? 0 }); });
  const showCitation = (documentId: string, quote: string) => { setCite({ documentId, quote }); setTab('evidence'); };
  const title = record?.title ?? 'Notice';
  const pendingChanges = (changes.data ?? []).filter(change => !change.acknowledgedAt).length;
  const tabs = (available ? NOTICE_TABS : LEGACY_TABS).map(value => [value, value === 'evidence' && documents.length ? `${TAB_NAMES[value]} · ${documents.length}` : value === 'ai' && reviews.length ? `${TAB_NAMES[value]} · ${reviews.length}` : value === 'changes' && pendingChanges ? `${TAB_NAMES[value]} · ${pendingChanges} new` : TAB_NAMES[value]] as const);
  const tabKeys = (event: KeyboardEvent<HTMLDivElement>) => {
    const index = tabs.findIndex(([value]) => value === tab), n = tabs.length;
    const next = event.key === 'ArrowRight' ? (index + 1) % n : event.key === 'ArrowLeft' ? (index - 1 + n) % n : event.key === 'Home' ? 0 : event.key === 'End' ? n - 1 : -1;
    if (next < 0) return;
    event.preventDefault(); setTab(tabs[next][0]);
    (event.currentTarget.querySelectorAll<HTMLElement>('[role=tab]')[next])?.focus();
  };
  const head = <div className="pc-notice-head">
    <p className="pc-notice-meta">{sourceName(source)} · {award ? 'Award' : 'Opportunity'}{data.externalId || data.opportunityId ? ` · ${data.externalId || data.opportunityId}` : ''}{url && <> · <a className="procurement-link" href={url} target="_blank" rel="noopener noreferrer">Open on {sourceName(source)} ↗</a></>}</p>
    {record && <div className="pc-notice-actions">
      <Btn size="sm" variant="secondary" disabled={!!busy} aria-pressed={!!data.starred} onClick={() => void act('star', () => setStar(record.kind, award ? data.importKey : data.sourceKey, !data.starred))}>{busy === 'star' ? 'Saving…' : data.starred ? '★ Shortlisted' : '☆ Shortlist'}</Btn>
      <label className="pc-notice-stage"><span className="sr-only">Pursuit stage</span><Select aria-label="Pursuit stage" presentation="dropdown" searchable={false} value={pursuit?.stage ?? ''} disabled={!!busy || state.isPending || !!state.error} onChange={event => void setStage(event.target.value as PursuitStage)}><option value="" disabled>{busy === 'pursuit' ? 'Saving…' : 'Add to pursuits'}</option>{PURSUIT_STAGES.map(stage => <option key={stage} value={stage}>Pursuit: {stage}</option>)}</Select></label>
    </div>}
    <div className="pc-notice-tabs" role="tablist" aria-label="Notice sections" onKeyDown={tabKeys}>
      {tabs.map(([value, text]) =>
        <button key={value} id={`notice-tab-${id}-${value}`} type="button" role="tab" aria-selected={tab === value} aria-controls={`notice-panel-${id}`} tabIndex={tab === value ? 0 : -1} onClick={() => setTab(value)}>{text}</button>)}
    </div>
  </div>;
  const body = <div className="pc-notice-body" role="tabpanel" id={`notice-panel-${id}`} aria-labelledby={`notice-tab-${id}-${tab}`}>
    {detail.isPending && <p role="status">Loading notice…</p>}
    {detail.error && <p role="alert">{detail.error.message}</p>}
    {error && <p role="alert">{error}</p>}
    {record && tab === 'decision' && <div className="pc-notice-section">
      {available ? <DecisionHeader recordId={id} pursuitStage={pursuit?.stage ?? null} onTab={setTab} /> : !workspace.isPending && <p className="rw-upgrade" role="note">{workspace.data?.reason ?? 'Update Zoer to use the review workspace. Existing search, pursuits, documents and AI review keep working.'} Requirements, changes and decisions appear here once it is available.</p>}
      {available && <h3 className="pc-notice-subhead">Notice</h3>}
      <Overview id={id} record={record} reviews={reviews} documents={documents} tags={detail.data.tags ?? []} onTab={setTab} onSaved={refresh} workspace={available} />
    </div>}
    {record && tab === 'requirements' && <RequirementMatrix recordId={id} />}
    {record && tab === 'evidence' && <div className="pc-notice-section">
      {available && <EvidenceInventory id={id} documents={documents} attachments={data.attachments} onShowDocument={documentId => setCite({ documentId, quote: '' })} />}
      <Documents id={id} source={source} documents={documents} cite={cite} onRefresh={refresh} />
    </div>}
    {record && tab === 'changes' && <ChangesPanel recordId={id} onTab={setTab} />}
    {record && tab === 'activity' && <ReviewActivity recordId={id} documents={documents} />}
    {record && tab === 'ai' && <Ai id={id} reviews={reviews} documents={documents} onCite={showCitation} onRefresh={refresh} />}
  </div>;
  if (layout === 'dialog') return <Modal title={title} mobileSheet size="wide" onClose={close} headerContent={<div className="pc-notice" data-layout="dialog">{head}</div>}><div className="pc-notice" data-layout="dialog">{body}</div></Modal>;
  return <aside className="pc-notice" data-layout="panel" aria-label={`Notice: ${title}`}>
    <div className="pc-notice-titlebar"><h2>{title}</h2><button type="button" className="pc-icon-btn" aria-label="Close notice" onClick={close}><X aria-hidden="true" className="h-4 w-4" /></button></div>
    {head}{body}
  </aside>;
}

/** Budget from extracted facts (buyer budget / estimated value only) when the review workspace has a current extraction. */
function useFactMoney(id: string, enabled: boolean) {
  const runs = useQuery({ queryKey: noticeKey(id, 'runs'), enabled, queryFn: () => readStageRuns(id) });
  const run = runs.data ? stageStatus(runs.data, 'extract').current : null;
  const facts = useQuery({ queryKey: noticeKey(id, 'facts', run?.id), enabled: enabled && !!run, queryFn: () => readFacts(id, run!.id) });
  return run && facts.data ? headerMoney(facts.data, true) : null;
}

/** File inventory, extraction versions, omitted material and cited passages (the review workspace's view of the documents). */
function EvidenceInventory({ id, documents, attachments, onShowDocument }: { id: string; documents: any[]; attachments: unknown; onShowDocument(documentId: string): void }) {
  const extractions = useQuery({ queryKey: noticeKey(id, 'extractions'), queryFn: () => readExtractions(id) });
  const runs = useQuery({ queryKey: noticeKey(id, 'runs'), queryFn: () => readStageRuns(id) });
  const [open, setOpen] = useState(''), [inspect, setInspect] = useState<{ type: 'requirement' | 'fact'; id: string } | null>(null);
  const spans = useQuery({ queryKey: noticeKey(id, 'extraction-spans', open), enabled: !!open, queryFn: () => readExtractionSpans(open) });
  const current = runs.data ? stageStatus(runs.data, 'extract').current : null, triaged = runs.data ? stageStatus(runs.data, 'triage').current : null;
  const gaps = coverageGaps(current?.coverage), limitations: string[] = Array.isArray(current?.coverage?.limitations) ? current!.coverage.limitations.map(String) : [];
  const extracted = new Set((extractions.data ?? []).map(item => item.documentId).filter(Boolean));
  const notExtracted = documents.filter(doc => doc.status === 'downloaded' && !extracted.has(doc.id));
  return <section className="rw-panel" aria-label="Evidence inventory">
    <h3>Evidence inventory</h3>
    <dl className="rw-summary">
      <div><dt>Files</dt><dd>{documentSummary(documentCounts(documents, attachments))}</dd></div>
      <div><dt>AI scope</dt><dd>{scopeText(current?.coverage, current ? 'extract' : triaged ? 'triage' : null)}</dd></div>
      {gaps.length > 0 && <div><dt>Omitted material</dt><dd><ul>{gaps.map((gap, i) => <li key={i}>{gap.name}: {gap.reason}</li>)}</ul></dd></div>}
      {limitations.length > 0 && <div><dt>Limitations</dt><dd>{limitations.join('; ')}</dd></div>}
    </dl>
    {extractions.isPending ? <p className="rw-muted" role="status">Loading extracted text versions…</p> : extractions.error ? <p className="rw-error" role="alert">Could not load extracted text versions: {(extractions.error as Error).message}</p>
      : !extractions.data?.length ? <p className="rw-note">No immutable text versions yet. They are frozen when triage or extraction runs.</p>
      : <ul className="rw-nd-extractions">{extractions.data.map(item => <li key={item.id}>
        <div><strong>{item.sourceKind === 'notice' ? 'Saved notice text' : item.name}</strong> <span className="rw-note">{item.status === 'unreadable' ? 'Saved; no usable text extracted' : label(item.status)} · {item.codePoints.toLocaleString()} characters · extracted {when(item.createdAt)} · {item.extractorVersion}</span></div>
        {item.limitations.length > 0 && <small className="rw-note">{item.limitations.join('; ')}</small>}
        <div className="rw-actions">
          {(item.spans ?? 0) > 0 && <button type="button" className="pc-link-btn" aria-expanded={open === item.id} onClick={() => setOpen(open === item.id ? '' : item.id)}>{open === item.id ? 'Hide' : 'Show'} {item.spans} cited passage{item.spans === 1 ? '' : 's'}</button>}
          {item.documentId && documents.some(doc => doc.id === item.documentId) && <button type="button" className="pc-link-btn" onClick={() => onShowDocument(item.documentId!)}>Show file below</button>}
        </div>
        {open === item.id && (spans.isPending ? <p className="rw-muted" role="status">Loading passages…</p> : spans.error ? <p className="rw-error" role="alert">{(spans.error as Error).message}</p>
          : <ul className="rw-nd-passages">{(spans.data ?? []).map(span => <li key={span.id}><button type="button" onClick={() => setInspect({ type: span.targetType as 'requirement' | 'fact', id: span.targetId })}>“{span.quote.length > 220 ? `${span.quote.slice(0, 220)}…` : span.quote}”</button><small className="rw-note">{[span.targetType, span.page != null ? `page ${span.page}` : '', span.heading, span.alignment === 'unverified' ? 'quote not found in source' : ''].filter(Boolean).join(' · ')}</small></li>)}</ul>)}
      </li>)}</ul>}
    {notExtracted.length > 0 && <p className="rw-note">Saved but not yet in an extracted version: {notExtracted.map(doc => doc.name).join(', ')}.</p>}
    {inspect && <EvidenceInspector recordId={id} target={inspect} onClose={() => setInspect(null)} />}
  </section>;
}

function Overview({ id, record, reviews, documents, tags, onTab, onSaved, workspace }: { id: string; record: any; reviews: any[]; documents: any[]; tags: string[]; onTab(tab: NoticeTabId): void; onSaved(): void; workspace: boolean }) {
  const data = record.data, award = record.kind === 'award';
  const review = latestReview(reviews), verdict = latestEvidence(reviews, 'bid-no-bid');
  const when = shortDate(award ? data.awardDate : data.closingAt ?? data.closingDate, Date.now(), !award);
  const contract = award && typeof data.contractValue === 'number' ? new Intl.NumberFormat(undefined, { style: 'currency', currency: data.currency || 'CAD', maximumFractionDigits: 0 }).format(data.contractValue) : '';
  const factMoney = useFactMoney(id, workspace && !award);
  // Extracted facts win over the legacy review: only buyer budget / estimated value may fill the budget line.
  const budget = award ? null : factMoney ? { label: factMoney.headline.length === 1 ? factMoney.headline[0].label : factMoney.headline.length ? 'Buyer budget / estimated value' : 'Budget', text: factMoney.headline.length ? factMoney.headline.map(line => factMoney.headline.length > 1 ? `${line.label}: ${line.text}` : line.text).join('; ') : factMoney.text, ai: true, others: factMoney.others.map(line => ({ label: line.label, text: line.text })) } : buyerValue(review);
  const [editing, setEditing] = useState(false), [draft, setDraft] = useState(tags.join(', ')), [saving, setSaving] = useState(false), [error, setError] = useState('');
  const [more, setMore] = useState(false);
  const description = String(data.sourceDescriptionText || data.descriptionText || data.opportunityDescription || '');
  const facts: [string, string, string?][] = [
    [award ? 'Awarded' : 'Closes', !award && when.tone === 'passed' ? `Closed ${when.text}` : when.text, award ? undefined : when.tone],
    ...(budget ? [[budget.label, budget.text, budget.ai ? 'ai' : undefined] as [string, string, string?], ...budget.others.map(o => [o.label, o.text, 'ai'] as [string, string, string?])] : [['Contract value', contract || 'Not disclosed'] as [string, string]]),
    ['Buyer', String(data.issuedBy || data.issuingOrganization || 'Not provided')],
    ...(award ? [['Supplier', String(data.successfulSupplier || 'Not provided')] as [string, string]] : [['Status', String(data.status || 'Not provided')] as [string, string]]),
    ['Type', String(data.type || data.opportunityType || 'Not provided')],
    ['Documents', documentSummary(documentCounts(documents, data.attachments))],
  ];
  const saveTags = async (next = draft.split(',')) => {
    setSaving(true); setError('');
    try { await host('catalog.tags', { id, tags: [...new Set(next.map(t => t.trim()).filter(Boolean))] }); setEditing(false); onSaved(); }
    catch (e) { setError((e as Error).message); } finally { setSaving(false); }
  };
  return <div className="pc-notice-section">
    <dl className="pc-facts">{facts.map(([label, text, tone]) => <div key={label} data-tone={tone}><dt>{label}{tone === 'ai' ? <span aria-hidden="true"> ✦</span> : null}</dt><dd title={label === 'Closes' ? deadlineLabel(data.closingAt ?? data.closingDate) : undefined}>{text}</dd></div>)}</dl>
    {review ? <section className="pc-card" aria-label="AI summary">
      <header><h3>AI summary</h3><span className="pc-card-links">{(review.result.labels ?? []).some((label: string) => !tags.includes(label)) && <button type="button" className="pc-link-btn" disabled={saving} onClick={() => void saveTags([...tags, ...(review.result.labels ?? [])])}>Save as tags</button>}<button type="button" className="pc-link-btn" onClick={() => onTab('ai')}>Details</button></span></header>
      <p>{review.result.summary}</p><LabelChips labels={review.result.labels ?? []} />
      <p className="pc-card-meta">{[review.model, ago(review.created_at), coverageText(review)].filter(Boolean).join(' · ')}</p>
    </section> : <section className="pc-card pc-card-empty" aria-label="AI summary"><header><h3>No AI summary yet</h3></header><p>Summarize this notice and its documents, and tag it with AI categories.</p><Btn size="sm" onClick={() => onTab('ai')}>Summarize &amp; categorize</Btn></section>}
    {verdict && <section className="pc-card" aria-label="Bid or no-bid"><header><h3>Bid / no-bid</h3><span className="pc-card-meta">{ago(verdict.created_at)}</span></header><p className="pc-verdict" data-verdict={verdictTone(verdict.result.fields?.recommendation)}>{verdictText(verdict.result.fields?.recommendation)}</p><p>{verdict.result.summary}</p></section>}
    {description && <section className="pc-description"><p data-clamped={!more && description.length > 600 || undefined}>{description}</p>{description.length > 600 && <button type="button" className="pc-link-btn" onClick={() => setMore(!more)}>{more ? 'Show less' : 'Show more'}</button>}</section>}
    <section className="pc-tags" aria-label="Your tags"><h3>Your tags</h3>
      {editing ? <div className="pc-tag-editor"><input aria-label="Tags, comma-separated" value={draft} onChange={e => setDraft(e.target.value)} placeholder="e.g. shortlist-q4, partner: Dominion" /><Btn size="sm" disabled={saving} onClick={() => void saveTags()}>{saving ? 'Saving…' : 'Save'}</Btn><Btn size="sm" variant="ghost" onClick={() => { setEditing(false); setDraft(tags.join(', ')); }}>Cancel</Btn></div>
        : <div className="pc-tag-list">{tags.map(tag => <span key={tag} className="pc-tag">{tag}</span>)}<button type="button" className="pc-link-btn" onClick={() => setEditing(true)}>{tags.length ? 'Edit' : 'Add tags'}</button></div>}
      {error && <p role="alert">{error}</p>}</section>
    {(data.sourceFileName || data.importedAt) && <p className="procurement-coverage">Imported {shortDate(data.importedAt).text}{data.sourceFileName ? ` from ${data.sourceFileName}` : ''}</p>}
  </div>;
}

const isPdf = (doc: any) => doc?.status === 'downloaded' && (/pdf/i.test(doc.media_type ?? '') || /\.pdf$/i.test(doc.name ?? ''));
const size = (bytes: number) => bytes > 1048576 ? `${(bytes / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;

// Zoer 2026-09-26+ draws PDF pages itself; older hosts and the sandboxed build fall back to the browser viewer.
const HostPdfPreview = (Controls as Record<string, unknown>).PdfPreview as ComponentType<{ url: string; label: string; className?: string; onError?(error: Error): void }> | undefined;
const coarse = () => typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;

function Documents({ id, source, documents, cite, onRefresh }: { id: string; source: string; documents: any[]; cite?: Cite; onRefresh(): void }) {
  const readable = documents.filter(hasUsableText), saved = documents.filter(doc => doc.status === 'downloaded');
  const [selected, setSelected] = useState<string>(cite?.documentId ?? readable[0]?.id ?? saved[0]?.id ?? documents[0]?.id ?? '');
  const initialMode = (doc: any) => isPdf(doc) && (HostPdfPreview || !coarse()) ? 'pdf' : 'text';
  const [mode, setMode] = useState<'pdf' | 'text'>(cite ? 'text' : initialMode(documents.find(item => item.id === selected)));
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [message, setMessage] = useState('');
  useEffect(() => { if (cite) { setSelected(cite.documentId); setMode(cite.quote ? 'text' : initialMode(documents.find(item => item.id === cite.documentId))); } }, [cite]);
  const doc = documents.find(item => item.id === selected);
  const choose = (value: string) => { setSelected(value); setMode(initialMode(documents.find(item => item.id === value))); };
  const getAttachments = async () => {
    setBusy(true); setError(''); setMessage('');
    try { await runProcurementAction('documents.download', { recordIds: [id] }); setMessage('Attachments downloaded.'); onRefresh(); }
    catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };
  if (!documents.length) return <div className="pc-notice-section"><div className="pc-card pc-card-empty"><header><h3>No documents yet</h3></header>
    {source === 'bc-bid' ? <><p>Download this notice’s attachments to read them here and include them in AI reviews.</p><Btn size="sm" disabled={busy} onClick={() => void getAttachments()}>{busy ? 'Downloading…' : 'Get attachments'}</Btn></> : <p>Document download is only available for BC Bid notices. Open the notice on {sourceName(source)} to read its files.</p>}
    {error && <p role="alert">{error}</p>}{message && <p role="status">{message}</p>}</div></div>;
  const detail = (item: any) => item.status === 'downloaded' ? `${size(item.bytes ?? 0)}${hasUsableText(item) ? '' : ' · Saved; no usable text extracted'}` : 'Couldn’t download this file';
  return <div className="pc-docs">
    <div className="pc-doc-bar">
      {documents.length > 1
        ? <label className="pc-doc-picker"><span className="sr-only">Document</span><Select aria-label="Document" presentation="dropdown" searchable={false} value={selected} onChange={event => choose(event.target.value)}
            optionDetails={Object.fromEntries(documents.map(item => [item.id, { icon: item.status === 'downloaded' ? <FileText aria-hidden="true" className="h-4 w-4" /> : <FileWarning aria-hidden="true" className="h-4 w-4" />, description: detail(item) }]))}>
            {documents.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</Select></label>
        : <span className="pc-doc-name"><FileText aria-hidden="true" className="h-4 w-4" />{doc?.name}</span>}
      {doc && isPdf(doc) && <span className="pc-preview-modes" role="group" aria-label="Preview as"><button type="button" aria-pressed={mode === 'pdf'} onClick={() => setMode('pdf')}>PDF</button><button type="button" aria-pressed={mode === 'text'} onClick={() => setMode('text')}>Text</button></span>}
      <span className="pc-doc-tools">
        {doc?.status === 'downloaded' && <Btn size="sm" variant="ghost" aria-label={`Download ${doc.name}`} tooltip="Download" icon={<Download aria-hidden="true" className="h-4 w-4" />} onClick={() => void host('catalog.download', { id: doc.id, name: doc.name }).catch(e => setError(e.message))}><span className="sr-only">Download</span></Btn>}
        {source === 'bc-bid' && <Btn size="sm" variant="ghost" aria-label="Get attachments again" tooltip="Get attachments again" disabled={busy} icon={<RefreshCw aria-hidden="true" className={`h-4 w-4${busy ? ' animate-spin' : ''}`} />} onClick={() => void getAttachments()}><span className="sr-only">Get attachments again</span></Btn>}
      </span>
    </div>
    {error && <p role="alert">{error}</p>}{message && <p role="status" className="pc-card-meta">{message}</p>}
    {doc && (doc.status !== 'downloaded'
      ? <div className="pc-doc-failed"><FileWarning aria-hidden="true" className="h-5 w-5" /><div><p><strong>{doc.name}</strong> couldn’t be read.</p><p className="pc-card-meta">{doc.error || 'The download failed.'}</p>{doc.url && safeSourceUrl(doc.url) && <a className="procurement-link" href={safeSourceUrl(doc.url)!} target="_blank" rel="noopener noreferrer">Open the original ↗</a>}</div></div>
      : mode === 'pdf' && isPdf(doc) ? <PdfPreview doc={doc} onFallback={() => setMode('text')} /> : <TextPreview doc={doc} quote={cite && cite.documentId === doc.id ? cite.quote : ''} />)}
  </div>;
}

function PdfPreview({ doc, onFallback }: { doc: any; onFallback(): void }) {
  const [url, setUrl] = useState(''), [error, setError] = useState('');
  useEffect(() => {
    let live = true; setUrl(''); setError('');
    host('catalog.preview', { id: doc.id }).then(result => { if (live) setUrl(result.url); })
      .catch(() => { if (live) { setError('PDF preview needs a newer version of Zoer. Showing the extracted text instead.'); onFallback(); } });
    return () => { live = false; };
  }, [doc.id]);
  if (error) return <p role="status">{error}</p>;
  if (!url) return <p role="status" className="pc-preview-loading">Loading preview…</p>;
  if (HostPdfPreview) return <HostPdfPreview url={url} label={`Preview of ${doc.name}`} className="pc-doc-view" onError={onFallback} />;
  // Older hosts: the browser's viewer, with its toolbar hidden where supported.
  return <iframe className="pc-doc-view pc-pdf" title={`Preview of ${doc.name}`} src={`${url}#toolbar=0&navpanes=0&view=FitH`} />;
}

function TextPreview({ doc, quote }: { doc: any; quote: string }) {
  const text = useQuery({ queryKey: ['catalog', 'procurement-document-text', doc.id], queryFn: async () => String((await sql('SELECT text FROM documents WHERE id=?', [doc.id]))[0]?.text ?? '') });
  const mark = useRef<HTMLElement>(null);
  const parts = useMemo(() => {
    const value = text.data ?? '', needle = quote.trim();
    if (!needle) return [value];
    // Quotes can differ in trailing whitespace or punctuation; fall back to their opening words.
    const found = [needle, needle.slice(0, 40)].map(part => [value.indexOf(part), part.length]).find(([index]) => index >= 0);
    if (!found) return [value];
    const [index, length] = found;
    return [value.slice(0, index), value.slice(index, index + length), value.slice(index + length)];
  }, [text.data, quote]);
  const box = useRef<HTMLDivElement>(null);
  // Scroll only the text box, so the page and its toolbar stay put.
  useEffect(() => { const el = mark.current, container = box.current; if (el && container) container.scrollTop = el.offsetTop - container.clientHeight / 3; }, [parts]);
  if (text.isPending) return <p role="status" className="pc-preview-loading">Loading text…</p>;
  if (text.error) return <p role="alert">{text.error.message}</p>;
  if (!text.data) return <p className="pc-card pc-card-empty">Saved; no usable text extracted. AI reviews can’t read this file. Scanned PDFs need OCR; use PDF or Download to read it.</p>;
  return <div className="pc-text pc-doc-view" ref={box}>{quote && parts.length === 1 && <p role="status" className="pc-card-meta">The quoted passage wasn’t found verbatim in this version.</p>}<pre>{parts[0]}{parts.length > 1 && <mark ref={mark}>{parts[1]}</mark>}{parts[2]}</pre></div>;
}

const ACTIONS: [string, string][] = [['summary', 'Summarize & categorize'], ['requirements', 'Mandatory requirements'], ['bid-no-bid', 'Bid / no-bid'], ['amendments', 'What changed in addenda?']];

function Ai({ id, reviews, documents, onCite, onRefresh }: { id: string; reviews: any[]; documents: any[]; onCite(documentId: string, quote: string): void; onRefresh(): void }) {
  const models = useQuery({ queryKey: ['procurement-models'], queryFn: () => host('models'), staleTime: 60_000 });
  const ready = (models.data?.models ?? []).filter((model: any) => model.authReady);
  const [modelId, setModelId] = useState('');
  useEffect(() => { if (!modelId && ready.length) setModelId(ready.some((m: any) => m.id === models.data.activeModelProfileId) ? models.data.activeModelProfileId : ready[0].id); }, [models.data]);
  const [running, setRunning] = useState(''), [error, setError] = useState(''), [question, setQuestion] = useState('');
  const lifecycle = useRef<AbortController | null>(null);
  useEffect(() => { const controller = new AbortController(); lifecycle.current = controller; return () => controller.abort(); }, []);
  const docNames = Object.fromEntries(documents.map(doc => [doc.id, doc.name]));
  const readable = documents.filter(hasUsableText).length, textless = documents.filter(doc => doc.status === 'downloaded' && !hasUsableText(doc)).length;
  const run = async (action: string) => {
    if (running || !modelId) return;
    setRunning(action); setError('');
    const cli = /^(codex|opencode|claude):/.test(modelId), computer = cli ? { computerId: modelId.slice(modelId.indexOf(':') + 1) } : {};
    try {
      if (action === 'summary') {
        const saved = await host('catalog.state');
        let prompt = saved.prompts?.find((item: any) => item.name === CATEGORY_PROMPT_NAME);
        if (!prompt) prompt = await host('catalog.prompts', { name: CATEGORY_PROMPT_NAME, prompt: CATEGORY_PROMPT });
        await runProcurementAction(cli ? 'records.review.cli' : 'records.review', { recordIds: [id], promptId: prompt.id, includeDocuments: true, force: true, ...computer }, lifecycle.current?.signal, { modelProfileId: modelId });
      } else {
        await runProcurementAction(cli ? 'records.evidence.cli' : 'records.evidence', { recordIds: [id], mode: action, ...(action === 'question' ? { question: question.trim() } : {}), ...computer }, lifecycle.current?.signal, { modelProfileId: modelId });
        if (action === 'question') setQuestion('');
      }
      onRefresh();
    } catch (e) { setError((e as Error).message); } finally { setRunning(''); }
  };
  const sorted = [...reviews].sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
  return <div className="pc-notice-section">
    <section className="pc-card pc-ask" aria-label="Ask AI about this notice">
      <header><h3>Ask about this notice</h3><label className="pc-ask-model"><span className="sr-only">Model</span><Select aria-label="Model" presentation="dropdown" searchable={false} value={modelId} disabled={!!running || !ready.length} onChange={e => setModelId(e.target.value)}>{!ready.length && <option value="">No ready model</option>}{ready.map((model: any) => <option key={model.id} value={model.id}>{model.name || model.id}</option>)}</Select></label></header>
      <p className="pc-card-meta">{readable ? `Uses the notice and ${readable} document${readable === 1 ? '' : 's'} with usable text.` : textless ? 'Based on the saved notice only; no saved document has usable text.' : 'Based on the saved notice only; no documents are downloaded yet.'}{textless && readable ? ` ${textless} saved file${textless === 1 ? ' has' : 's have'} no usable text and ${textless === 1 ? 'is' : 'are'} not read.` : ''}</p>
      <div className="pc-ask-actions">{ACTIONS.map(([action, label]) => <Btn key={action} size="sm" variant={action === 'summary' ? 'primary' : 'secondary'} disabled={!!running || !modelId} onClick={() => void run(action)}>{running === action ? 'Running…' : label}</Btn>)}</div>
      <form className="pc-ask-question" onSubmit={event => { event.preventDefault(); if (question.trim()) void run('question'); }}>
        <input aria-label="Question about this notice" maxLength={1000} value={question} disabled={!!running} onChange={e => setQuestion(e.target.value)} placeholder="Ask a question, e.g. “Is a professional engineer’s seal required?”" />
        <Btn size="sm" type="submit" disabled={!!running || !modelId || !question.trim()}>{running === 'question' ? 'Asking…' : 'Ask'}</Btn>
      </form>
      {!models.isPending && !ready.length && <p className="pc-card-meta">Set up a model profile, or start a Codex or OpenCode computer, to use AI here.</p>}
      {running && <p role="status" className="pc-running"><span className="pc-spinner" aria-hidden="true" />Running on the server. You can close this notice; the result will be saved here.</p>}
      {error && <p role="alert">{error}</p>}
    </section>
    {!sorted.length && <p className="procurement-coverage">No AI results yet.</p>}
    {sorted.map(review => <AiResult key={review.id} review={review} onCite={onCite} docNames={docNames} />)}
    {sorted.length > 0 && <p className="procurement-coverage">AI results can be wrong or incomplete. Check the cited documents and the official notice before you bid.</p>}
  </div>;
}

