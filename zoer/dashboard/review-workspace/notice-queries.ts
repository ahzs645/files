import { codePointLength, codePointToUtf16, HEADLINE_MONEY_KINDS, MONEY_BASIS_LABELS, partitionMoney, summarizeMoney, validateSpan, type Money, type MoneyKind } from '@bcbid/procurement-core';
import { sql } from '../procurement/display';
import { json, label, type AssessmentRow, type DecisionRow } from './queries';

/**
 * Notice detail reads (CONTRACT §2 tables through the SELECT-only bridge) and the pure rules the notice tabs
 * share. SQL here avoids `word(` forms other than the bridge's allowed functions, so no `AND (`/`FROM (`.
 */
// `review-workspace` is actions.ts REVIEW_KEY, spelled out so this module stays free of React Query (unit-testable).
export const noticeKey = (recordId: string, ...parts: unknown[]) => ['review-workspace', 'notice', recordId, ...parts];

/** Every row of a SELECT, 200 per bridge call. Callers order by immutable or time-ordered columns. */
export async function readPages(statement: string, parameters: (string | number)[] = []): Promise<any[]> {
  const rows: any[] = [];
  for (let offset = 0; ; offset += 200) {
    const page = await sql(`${statement} LIMIT 200 OFFSET ?`, [...parameters, offset]);
    rows.push(...page);
    if (page.length < 200) return rows;
  }
}

export const when = (value: unknown) => typeof value === 'string' && Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : 'date not recorded';
export const friendly = (e: unknown) => { const message = (e as Error)?.message ?? String(e); return /^Conflict:/i.test(message) ? 'Someone else changed this; reload and review it.' : message; };
const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString()} ${n === 1 ? one : many}`;

// ---- Tabs ----
export const NOTICE_TABS = ['decision', 'requirements', 'evidence', 'changes', 'activity', 'ai'] as const;
export type NoticeTabId = typeof NOTICE_TABS[number];
/** Tabs that exist without the review workspace (the earlier Overview / Documents / AI). */
export const LEGACY_TABS: NoticeTabId[] = ['decision', 'evidence', 'ai'];
const OLD_TABS: Record<string, NoticeTabId> = { overview: 'decision', summary: 'decision', documents: 'evidence', files: 'evidence', ask: 'ai' };
/** Route value → tab. Old links (`documents`, `overview`) keep working; unavailable tabs fall back to Decision. */
export function resolveNoticeTab(value: unknown, available: boolean): NoticeTabId {
  const raw = typeof value === 'string' ? value.toLowerCase() : '';
  const tab = (NOTICE_TABS as readonly string[]).includes(raw) ? raw as NoticeTabId : OLD_TABS[raw] ?? 'decision';
  return available || LEGACY_TABS.includes(tab) ? tab : 'decision';
}

// ---- Stage runs ----
export interface StageRunRow {
  id: string; runId: string; stage: string; stageKey: string; bundleId: string | null; templateId: string; templateVersion: number; model: string | null;
  status: string; quality: string | null; isCurrent: boolean; summary: string | null; coverage: any; usage: any; issues: any[]; error: string | null;
  startedAt: string; finishedAt: string | null; dryRun: boolean;
}
export async function readStageRuns(recordId: string): Promise<StageRunRow[]> {
  const rows = await readPages('SELECT id, run_id AS runId, stage, stage_key AS stageKey, bundle_id AS bundleId, template_id AS templateId, template_version AS templateVersion, model, status, quality, is_current AS isCurrent, summary, coverage, usage, issues, error, started_at AS startedAt, finished_at AS finishedAt FROM procurement_stage_runs WHERE record_id=? ORDER BY started_at DESC, id', [recordId]);
  return rows.map(row => ({ ...row, templateVersion: Number(row.templateVersion), isCurrent: Number(row.isCurrent) === 1, coverage: json(row.coverage, null), usage: json(row.usage, null), issues: json(row.issues, []), dryRun: /^Test run:/.test(String(row.summary ?? '')) }));
}
/** Current triage output (classification, reasons, missing information) for the Decision tab. */
export async function readTriageOutput(recordId: string): Promise<any | null> {
  const [row] = await sql("SELECT output FROM procurement_stage_runs WHERE record_id=? AND stage='triage' AND is_current=1 ORDER BY started_at DESC LIMIT 1", [recordId]);
  return row ? json(row.output, null) : null;
}

const STAGE_NAMES: Record<string, string> = { triage: 'Triage from notice', extract: 'Requirement extraction', consolidate: 'Consolidation', assess: 'Assessment', changes: 'Change review', question: 'Question' };
export const stageName = (stage: string) => STAGE_NAMES[stage] ?? stage;

export interface StageStatus { current: StageRunRow | null; latest: StageRunRow | null; running: boolean; tone: 'neutral' | 'running' | 'failed' | 'partial' | 'ok'; note: string }
/**
 * Latest run vs the current (trusted) run of one stage. Test runs never count. A failed or partial newer run
 * never hides the earlier current result, and says so with the earlier result's date.
 */
export function stageStatus(runs: StageRunRow[], stage: string): StageStatus {
  const real = runs.filter(run => run.stage === stage && !run.dryRun);
  const latest = real[0] ?? null, current = real.find(run => run.isCurrent) ?? null;
  const dated = (run: StageRunRow) => when(run.finishedAt ?? run.startedAt);
  if (!latest) return { current, latest, running: false, tone: 'neutral', note: 'Not run yet' };
  if (latest.status === 'queued' || latest.status === 'running') return { current, latest, running: true, tone: 'running', note: `${latest.status === 'queued' ? 'Queued' : 'Running'} since ${when(latest.startedAt)}${current ? `; current result from ${dated(current)} stays until it finishes` : ''}` };
  if (latest !== current && (latest.status === 'failed' || latest.status === 'cancelled')) {
    const what = latest.status === 'cancelled' ? 'Latest run was cancelled' : 'Review failed validation';
    return { current, latest, running: false, tone: 'failed', note: current ? `${what}; earlier result retained with its date (${dated(current)}).` : `${what} (${dated(latest)}); no earlier result.${latest.error ? ` ${latest.error}` : ''}` };
  }
  if (!current) return { current, latest, running: false, tone: 'neutral', note: `Latest run ${latest.status} (${dated(latest)}); no current result.` };
  const problems = current.issues.length;
  if (current.quality && current.quality !== 'valid' || problems) return { current, latest, running: false, tone: 'partial', note: `Completed with ${problems ? plural(problems, 'validation issue') : label(current.quality)} (${dated(current)}); items stay proposed for review.` };
  return { current, latest, running: false, tone: 'ok', note: `Current result from ${dated(current)}${current.model ? ` · ${current.model}` : ''}` };
}

export function usageText(usage: any): string {
  if (!usage || typeof usage !== 'object' || usage.known === false) return 'usage unknown';
  const n = (...keys: string[]) => keys.map(key => usage[key]).find(value => typeof value === 'number' && Number.isFinite(value)) as number | undefined;
  const input = n('inputTokens', 'input_tokens', 'promptTokens'), output = n('outputTokens', 'output_tokens', 'completionTokens'), total = n('totalTokens', 'total_tokens'), calls = n('calls', 'requests'), cost = n('costUsd', 'cost_usd', 'cost');
  const parts = [input != null && output != null ? `${input.toLocaleString()} in / ${output.toLocaleString()} out tokens` : total != null ? `${total.toLocaleString()} tokens` : '', calls != null ? plural(calls, 'call') : '', cost != null ? `$${cost.toFixed(2)}` : ''].filter(Boolean);
  return parts.length ? parts.join(' · ') : 'usage unknown';
}

// ---- Coverage / scope ----
/** Separate denominators (IMPLEMENTATION-PLAN §6). Unknown totals stay unknown; the notice-only scope is named. */
export function scopeText(coverage: any, stage: 'triage' | 'extract' | null): string {
  if (!stage) return 'No AI stage has run for this notice.';
  if (stage === 'triage') return 'Based on the saved notice only';
  if (!coverage || typeof coverage !== 'object') return 'Requirement extraction scope was not recorded; source completeness unknown';
  const num = (value: unknown) => typeof value === 'number' && Number.isFinite(value) ? value : null;
  const discovered = num(coverage.discovered), downloaded = num(coverage.downloaded) ?? 0, usable = num(coverage.usableText), processed = num(coverage.processed);
  const files = (n: number) => plural(n, 'file');
  const parts = [
    discovered == null ? `${files(downloaded)} downloaded (discovered total unknown)` : `${downloaded} of ${discovered} discovered file${discovered === 1 ? '' : 's'} downloaded`,
    usable == null ? 'usable text unknown' : `${usable} contain${usable === 1 ? 's' : ''} usable text`,
    processed == null ? 'processed count unknown' : `${processed} processed for requirements`,
    coverage.sourceCompleteness === 'checked_public_scope' ? 'public source scope checked' : 'source completeness unknown',
  ];
  if (!downloaded && !processed) parts.unshift('Notice text only');
  return parts.join('; ');
}
export const coverageGaps = (coverage: any): { name: string; reason: string; critical: boolean }[] =>
  Array.isArray(coverage?.missing) ? coverage.missing.filter((m: any) => m && typeof m === 'object').map((m: any) => ({ name: String(m.name ?? m.id ?? 'Unnamed source'), reason: String(m.reason ?? 'not processed'), critical: m.critical !== false })) : [];

// ---- Requirements and facts ----
export interface MatchRow { status: string; origin: string; companyEvidence: string[]; rationale: string; remediable: boolean | null; reviewer: string; revision: number; updatedAt: string }
export interface RequirementRow {
  id: string; lotId: string | null; stageRunId: string; ordinal: number; text: string; strength: string; category: string; actor: string | null; requiredBy: string | null; conditionText: string | null;
  grounding: string; supersedes: string[]; conflicts: string[]; reviewState: string | null; reviewValue: any; revision: number; spanCount: number; sourceName: string | null; page: number | null; heading: string | null;
  match: MatchRow | null; matchRevision: number;
}
const firstSpan = (type: string, column: string) => `(SELECT ${column} FROM procurement_spans p LEFT JOIN procurement_extractions e ON e.id=p.extraction_id WHERE p.target_type='${type}' AND p.target_id=x.id ORDER BY p.start_cp LIMIT 1)`;
const spanColumns = (type: string) => `(SELECT count(*) FROM procurement_spans p WHERE p.target_type='${type}' AND p.target_id=x.id) AS spanCount, ${firstSpan(type, 'e.name')} AS sourceName, ${firstSpan(type, 'p.page')} AS page, ${firstSpan(type, 'p.heading')} AS heading`;

/** Every requirement of one stage run (no cap), with reviewer state and the match for exactly one profile version. */
export async function readRequirements(recordId: string, stageRunId: string, profileVersionId: string | null): Promise<RequirementRow[]> {
  const rows = await readPages(`SELECT x.id, x.lot_id AS lotId, x.stage_run_id AS stageRunId, x.ordinal, x.text, x.strength, x.category, x.actor, x.required_by AS requiredBy, x.condition_text AS conditionText, x.grounding, x.supersedes, x.conflicts, s.state AS reviewState, s.value AS reviewValue, coalesce(s.revision,0) AS revision, m.status AS matchStatus, m.origin AS matchOrigin, m.company_evidence AS matchEvidence, m.rationale AS matchRationale, m.remediable AS matchRemediable, m.reviewer AS matchReviewer, coalesce(m.revision,0) AS matchRevision, m.updated_at AS matchUpdatedAt, ${spanColumns('requirement')} FROM procurement_requirements x LEFT JOIN procurement_review_state s ON s.target_type='requirement' AND s.target_id=x.id LEFT JOIN procurement_matches m ON m.requirement_id=x.id AND m.profile_version_id=? WHERE x.record_id=? AND x.stage_run_id=? ORDER BY x.ordinal, x.id`, [profileVersionId ?? '', recordId, stageRunId]);
  return rows.map(row => ({
    id: row.id, lotId: row.lotId, stageRunId: row.stageRunId, ordinal: Number(row.ordinal), text: String(row.text ?? ''), strength: row.strength, category: row.category, actor: row.actor, requiredBy: row.requiredBy, conditionText: row.conditionText,
    grounding: row.grounding, supersedes: json(row.supersedes, []), conflicts: json(row.conflicts, []), reviewState: row.reviewState ?? null, reviewValue: json(row.reviewValue, null), revision: Number(row.revision ?? 0),
    spanCount: Number(row.spanCount ?? 0), sourceName: row.sourceName ?? null, page: row.page == null ? null : Number(row.page), heading: row.heading ?? null, matchRevision: Number(row.matchRevision ?? 0),
    match: row.matchStatus ? { status: row.matchStatus, origin: row.matchOrigin, companyEvidence: json(row.matchEvidence, []), rationale: row.matchRationale ?? '', remediable: row.matchRemediable == null ? null : Number(row.matchRemediable) === 1, reviewer: row.matchReviewer, revision: Number(row.matchRevision), updatedAt: row.matchUpdatedAt } : null,
  }));
}

export interface FactRow {
  id: string; lotId: string | null; stageRunId: string; fieldKey: string; semanticType: string; status: string; value: any; grounding: string;
  reviewState: string | null; reviewValue: any; revision: number; spanCount: number; sourceName: string | null; page: number | null; heading: string | null;
}
export async function readFacts(recordId: string, stageRunId: string): Promise<FactRow[]> {
  const rows = await readPages(`SELECT x.id, x.lot_id AS lotId, x.stage_run_id AS stageRunId, x.field_key AS fieldKey, x.semantic_type AS semanticType, x.status, x.value, x.grounding, s.state AS reviewState, s.value AS reviewValue, coalesce(s.revision,0) AS revision, ${spanColumns('fact')} FROM procurement_facts x LEFT JOIN procurement_review_state s ON s.target_type='fact' AND s.target_id=x.id WHERE x.record_id=? AND x.stage_run_id=? ORDER BY x.field_key, x.id`, [recordId, stageRunId]);
  return rows.map(row => ({ ...row, value: json(row.value, null), reviewState: row.reviewState ?? null, reviewValue: json(row.reviewValue, null), revision: Number(row.revision ?? 0), spanCount: Number(row.spanCount ?? 0), page: row.page == null ? null : Number(row.page) }));
}

/** Reviewer state shown for a machine item: a human state wins; otherwise grounded items are proposed, unaligned ones ungrounded. */
export const reviewStateOf = (item: { reviewState: string | null; grounding: string }) => item.reviewState ?? (item.grounding === 'unverified' ? 'ungrounded' : 'proposed');

export interface RequirementFilters { strength: string; review: string; match: string; grounding: string }
export const NO_FILTERS: RequirementFilters = { strength: '', review: '', match: '', grounding: '' };
/** `match: 'none'` = no match recorded for the active profile. Empty filter values match everything. */
export function filterRequirements(rows: RequirementRow[], f: RequirementFilters): RequirementRow[] {
  return rows.filter(row => (!f.strength || row.strength === f.strength) && (!f.review || reviewStateOf(row) === f.review)
    && (!f.match || (f.match === 'none' ? !row.match : row.match?.status === f.match)) && (!f.grounding || row.grounding === f.grounding));
}
export function requirementCounts(rows: RequirementRow[]) {
  const mandatory = rows.filter(row => row.strength === 'mandatory').length, ungrounded = rows.filter(row => row.grounding === 'unverified').length;
  return { total: rows.length, mandatory, ungrounded, text: `${plural(rows.length, 'requirement')}; ${mandatory.toLocaleString()} mandatory; ${ungrounded.toLocaleString()} ungrounded` };
}

// ---- Money and fact values ----
/** The value a fact carries after review: rejected facts drop out; corrections apply like the host's assess op. */
export function effectiveFact(fact: FactRow): FactRow | null {
  if (fact.reviewState === 'rejected') return null;
  if (fact.reviewState !== 'corrected') return fact;
  const value = fact.reviewValue, patch = value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).every(key => key === 'value' || key === 'status');
  return patch ? { ...fact, ...value } : { ...fact, value };
}
const isMoneyKind = (kind: string): kind is MoneyKind => ['buyer_budget', 'buyer_estimated_value', 'award_value', 'insurance_limit', 'bid_security', 'funding_program_amount', 'internal_cost_estimate'].includes(kind);
const finite = (value: unknown) => typeof value === 'number' && Number.isFinite(value) ? value : null;
export function moneyOf(fact: FactRow): (Money & { factId: string }) | null {
  const kind = fact.semanticType.startsWith('money:') ? fact.semanticType.slice(6) : '';
  if (!isMoneyKind(kind) || fact.status !== 'stated' || !fact.value || typeof fact.value !== 'object') return null;
  const v = fact.value;
  return { factId: fact.id, kind, lower: finite(v.lower), upper: finite(v.upper), currency: typeof v.currency === 'string' && v.currency ? v.currency : null, basis: ['total_contract', 'annual', 'per_unit'].includes(v.basis) ? v.basis : 'unknown', taxBasis: ['inclusive', 'exclusive'].includes(v.taxBasis) ? v.taxBasis : 'unknown', raw: typeof v.raw === 'string' ? v.raw : null, durationMonths: null, lotId: fact.lotId };
}
const amount = (n: number, currency: string | null) => currency && /^[A-Z]{3}$/.test(currency) ? new Intl.NumberFormat(undefined, { style: 'currency', currency, maximumFractionDigits: 2, minimumFractionDigits: 0 }).format(n) : `${n.toLocaleString()} (currency not stated)`;
export function moneyText(m: Pick<Money, 'lower' | 'upper' | 'currency' | 'basis' | 'taxBasis' | 'raw'>): string {
  const { lower, upper, currency } = m;
  const range = lower != null && upper != null ? (lower === upper ? amount(lower, currency) : `${amount(lower, currency)} – ${amount(upper, currency)}`) : upper != null ? `up to ${amount(upper, currency)}` : lower != null ? `at least ${amount(lower, currency)}` : m.raw ? `“${m.raw}” (amount not parsed)` : 'Amount not stated';
  const tax = m.taxBasis === 'inclusive' ? ', tax included' : m.taxBasis === 'exclusive' ? ', tax excluded' : '';
  return `${range} · ${MONEY_BASIS_LABELS[m.basis] ?? 'basis not stated'}${tax}`;
}
export interface MoneyLine { key: string; label: string; text: string; factIds: string[] }
/**
 * Header budget/value from buyer_budget / buyer_estimated_value facts only, one line per kind/currency/basis
 * partition (never merged). Insurance limits, bid security, awards and grants are listed separately.
 */
export function headerMoney(facts: FactRow[], reviewed: boolean) {
  const effective = facts.map(effectiveFact).filter((f): f is FactRow => !!f);
  const money = effective.map(moneyOf).filter((m): m is Money & { factId: string } => !!m);
  const lines = (items: typeof money): MoneyLine[] => partitionMoney(items).map(group => {
    const summary = summarizeMoney(group), single = group.items.length === 1;
    const text = single ? moneyText(group.items[0]) : summary.min != null && summary.max != null ? `${summary.min === summary.max ? amount(summary.min, group.currency) : `${amount(summary.min, group.currency)} – ${amount(summary.max, group.currency)}`} across ${group.items.length} statements` : `${group.items.length} statements; amounts not parsed`;
    return { key: group.key, label: summary.label, text, factIds: group.items.map(item => item.factId) };
  });
  const headline = lines(money.filter(m => (HEADLINE_MONEY_KINDS as readonly string[]).includes(m.kind)));
  const others = lines(money.filter(m => !(HEADLINE_MONEY_KINDS as readonly string[]).includes(m.kind)));
  const budgetFacts = effective.filter(f => f.semanticType === 'money:buyer_budget' || f.semanticType === 'money:buyer_estimated_value' || f.fieldKey === 'budget' || f.fieldKey === 'estimated_value');
  const text = headline.length ? '' : !reviewed ? 'Not reviewed' : money.some(m => m.kind === 'insurance_limit') ? 'Budget not found; insurance limit listed separately'
    : budgetFacts.some(f => f.status === 'explicitly_absent') ? 'Budget explicitly not disclosed' : budgetFacts.some(f => f.status === 'conflicting') ? 'Conflicting budget statements' : 'Budget not found in reviewed material';
  return { headline, others, text };
}

const DATE_PRECISION: Record<string, string> = { instant: 'date and time', date: 'date only; time unverified', range: 'date range', unknown: 'precision unknown' };
/** Plain text for any fact value; statuses other than `stated` read as their label, never as an empty value. */
export function factValueText(fact: FactRow): string {
  if (fact.status !== 'stated') return label(fact.status);
  const v = fact.value;
  if (fact.semanticType.startsWith('money:')) { const m = moneyOf(fact); return m ? moneyText(m) : 'Amount not parsed'; }
  if (v && typeof v === 'object' && !Array.isArray(v)) {
    if (typeof v.raw === 'string') return `${v.raw}${v.precision ? ` (${DATE_PRECISION[v.precision] ?? v.precision})` : ''}`;
    if (typeof v.value === 'string' || typeof v.value === 'number') return String(v.value);
    return Object.entries(v).filter(([, value]) => value != null && value !== '').map(([key, value]) => `${key}: ${typeof value === 'object' ? JSON.stringify(value) : value}`).join(' · ') || 'Value not recorded';
  }
  return v == null || v === '' ? 'Value not recorded' : String(v);
}
export const FIELD_NAMES: Record<string, string> = { closing_date: 'Closing date', budget: 'Budget', estimated_value: 'Estimated value', insurance_limit: 'Insurance limit', bid_security: 'Bid security', contract_duration: 'Contract duration', site_visit: 'Site visit', questions_deadline: 'Questions deadline', buyer: 'Buyer', location: 'Location', other: 'Other' };
export const fieldName = (key: string) => FIELD_NAMES[key] ?? key.replace(/_/g, ' ');

// ---- Evidence passage ----
export interface Passage { before: string; match: string; after: string; clippedStart: boolean; clippedEnd: boolean }
/**
 * Split extraction text around a code-point span [start,end) with ±`context` code points (or the full text).
 * Returns null for offsets that do not fit the text. Surrogate pairs (emoji) are never cut.
 */
export function passageParts(text: string, start: number | null, end: number | null, context = 600, full = false): Passage | null {
  const total = codePointLength(text);
  if (start == null || end == null || !Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end <= start || end > total) return null;
  const from = full ? 0 : Math.max(0, start - context), to = full ? total : Math.min(total, end + context);
  let [a, b, c, d] = [from, start, end, to].map(cp => codePointToUtf16(text, cp));
  // Clipped context starts and ends on whitespace (within 40 characters) so it never opens mid-word;
  // windows shorter than that are left exact.
  if (a > 0 && b - a > 40) { const space = text.slice(a, Math.min(b, a + 40)).search(/\s/); if (space >= 0) a += space + 1; }
  if (d < text.length && d - c > 40) { const space = text.slice(Math.max(c, d - 40), d).search(/\s\S*$/); if (space >= 0) d = Math.max(c, d - 40) + space; }
  return { before: text.slice(a, b), match: text.slice(b, c), after: text.slice(c, d), clippedStart: from > 0, clippedEnd: to < total };
}

export interface SpanRow { id: string; extractionId: string; textSha256: string; startCp: number | null; endCp: number | null; quote: string; page: number | null; heading: string | null; alignment: string }
export interface ExtractionRow { id: string; recordId: string; documentId: string | null; sourceKind: string; name: string; sha256: string; extractorVersion: string; text?: string; textSha256: string; codePoints: number; status: string; limitations: string[]; createdAt: string; spans?: number }

/** Why a span cannot be highlighted, in reader words; null when it can. Never a dead link. */
export function spanProblem(span: SpanRow | null, extraction: ExtractionRow | null | undefined, recordId: string, grounding?: string): string | null {
  if (!span) return grounding === 'unverified' ? 'Quote not found in source; candidate kept as ungrounded.' : 'No source passage was recorded for this item.';
  if (span.alignment === 'unverified' || span.startCp == null || span.endCp == null) return 'Quote not found in source; candidate kept as ungrounded.';
  if (!extraction) return 'The extracted text this passage points to is not in the catalog (it may have been removed by a restore).';
  if (span.textSha256 !== extraction.textSha256) return 'This passage points to a different version of the extracted text, so it is not highlighted.';
  if (typeof extraction.text !== 'string') return 'The extracted text could not be read.';
  if (!validateSpan({ recordId, extractionId: span.extractionId, textSha256: span.textSha256, start: span.startCp, end: span.endCp, quote: span.quote }, { recordId: extraction.recordId, extractionId: extraction.id, textSha256: extraction.textSha256, text: extraction.text }))
    return 'The recorded offsets do not reproduce the quote in this text, so it is not highlighted.';
  return null;
}

/** sha256 hex of UTF-8 text, or null where Web Crypto is unavailable (insecure context). */
export async function sha256Hex(text: string): Promise<string | null> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) return null;
  const digest = await subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

export interface InspectorItem {
  type: 'requirement' | 'fact'; id: string; recordId: string; stageRunId: string; grounding: string; reviewState: string | null; reviewValue: any; revision: number;
  requirement?: RequirementRow; fact?: FactRow; run: { model: string | null; templateId: string; templateVersion: number; finishedAt: string | null; isCurrent: boolean } | null;
}
export interface ReviewEventRow { id: string; targetType: string; targetId: string; event: string; reason: string; correction: any; reviewer: string; revision: number; occurredAt: string }

export async function readInspectorItem(recordId: string, target: { type: 'requirement' | 'fact'; id: string }): Promise<InspectorItem | null> {
  const requirement = target.type === 'requirement';
  const [row] = requirement
    ? await sql('SELECT x.id, x.lot_id AS lotId, x.stage_run_id AS stageRunId, x.ordinal, x.text, x.strength, x.category, x.actor, x.required_by AS requiredBy, x.condition_text AS conditionText, x.grounding, x.supersedes, x.conflicts, s.state AS reviewState, s.value AS reviewValue, coalesce(s.revision,0) AS revision FROM procurement_requirements x LEFT JOIN procurement_review_state s ON s.target_type=\'requirement\' AND s.target_id=x.id WHERE x.id=? AND x.record_id=?', [target.id, recordId])
    : await sql('SELECT x.id, x.lot_id AS lotId, x.stage_run_id AS stageRunId, x.field_key AS fieldKey, x.semantic_type AS semanticType, x.status, x.value, x.grounding, s.state AS reviewState, s.value AS reviewValue, coalesce(s.revision,0) AS revision FROM procurement_facts x LEFT JOIN procurement_review_state s ON s.target_type=\'fact\' AND s.target_id=x.id WHERE x.id=? AND x.record_id=?', [target.id, recordId]);
  if (!row) return null;
  const [run] = await sql('SELECT model, template_id AS templateId, template_version AS templateVersion, finished_at AS finishedAt, is_current AS isCurrent FROM procurement_stage_runs WHERE id=?', [row.stageRunId]);
  const base = { reviewState: row.reviewState ?? null, reviewValue: json(row.reviewValue, null), revision: Number(row.revision ?? 0) };
  return {
    type: target.type, id: row.id, recordId, stageRunId: row.stageRunId, grounding: row.grounding, ...base,
    run: run ? { ...run, templateVersion: Number(run.templateVersion), isCurrent: Number(run.isCurrent) === 1 } : null,
    ...(requirement
      ? { requirement: { ...row, ...base, ordinal: Number(row.ordinal), supersedes: json(row.supersedes, []), conflicts: json(row.conflicts, []), spanCount: 0, sourceName: null, page: null, heading: null, match: null, matchRevision: 0 } }
      : { fact: { ...row, ...base, value: json(row.value, null), spanCount: 0, sourceName: null, page: null, heading: null } }),
  };
}
export async function readSpans(targetType: string, targetId: string): Promise<SpanRow[]> {
  const rows = await readPages('SELECT id, extraction_id AS extractionId, text_sha256 AS textSha256, start_cp AS startCp, end_cp AS endCp, quote, page, heading, alignment FROM procurement_spans WHERE target_type=? AND target_id=? ORDER BY start_cp, id', [targetType, targetId]);
  return rows.map(row => ({ ...row, startCp: row.startCp == null ? null : Number(row.startCp), endCp: row.endCp == null ? null : Number(row.endCp), page: row.page == null ? null : Number(row.page) }));
}
export async function readReviewEvents(targetType: string, targetId: string): Promise<ReviewEventRow[]> {
  const rows = await readPages('SELECT id, target_type AS targetType, target_id AS targetId, event, reason, correction, reviewer, revision, occurred_at AS occurredAt FROM procurement_review_events WHERE target_type=? AND target_id=? ORDER BY revision DESC, occurred_at DESC', [targetType, targetId]);
  return rows.map(row => ({ ...row, correction: json(row.correction, null), revision: Number(row.revision) }));
}
const EXTRACTION_COLUMNS = 'id, record_id AS recordId, document_id AS documentId, source_kind AS sourceKind, name, sha256, extractor_version AS extractorVersion, text_sha256 AS textSha256, code_points AS codePoints, status, limitations, created_at AS createdAt';
/** One immutable extraction including its text (the passage source). */
export async function readExtraction(recordId: string, extractionId: string): Promise<ExtractionRow | null> {
  const [row] = await sql(`SELECT ${EXTRACTION_COLUMNS}, text FROM procurement_extractions WHERE id=? AND record_id=?`, [extractionId, recordId]);
  return row ? { ...row, text: String(row.text ?? ''), codePoints: Number(row.codePoints), limitations: json(row.limitations, []) } : null;
}
/** Extraction inventory for the Evidence tab (no text), with how many cited passages point into each. */
export async function readExtractions(recordId: string): Promise<ExtractionRow[]> {
  const rows = await readPages(`SELECT ${EXTRACTION_COLUMNS}, (SELECT count(*) FROM procurement_spans p WHERE p.extraction_id=procurement_extractions.id) AS spans FROM procurement_extractions WHERE record_id=? ORDER BY created_at DESC, id`, [recordId]);
  return rows.map(row => ({ ...row, codePoints: Number(row.codePoints), spans: Number(row.spans ?? 0), limitations: json(row.limitations, []) }));
}
/** Passages cited from one extraction by the current runs, for the Evidence tab. */
export async function readExtractionSpans(extractionId: string): Promise<(SpanRow & { targetType: string; targetId: string })[]> {
  const rows = await readPages("SELECT p.id, p.target_type AS targetType, p.target_id AS targetId, p.extraction_id AS extractionId, p.text_sha256 AS textSha256, p.start_cp AS startCp, p.end_cp AS endCp, p.quote, p.page, p.heading, p.alignment FROM procurement_spans p WHERE p.extraction_id=? AND p.target_type IN ('requirement','fact') ORDER BY p.start_cp, p.id", [extractionId]);
  return rows.map(row => ({ ...row, startCp: row.startCp == null ? null : Number(row.startCp), endCp: row.endCp == null ? null : Number(row.endCp) }));
}
/** The document's current saved version, to say when the reviewed text came from an older file. */
export async function readDocumentVersion(documentId: string): Promise<{ name: string; sha256: string | null; updatedAt: string } | null> {
  const [row] = await sql('SELECT name, sha256, updated_at AS updatedAt FROM documents WHERE id=?', [documentId]);
  return row ?? null;
}

// ---- Decisions, tasks, changes, activity ----
export async function readDecisions(recordId: string): Promise<DecisionRow[]> {
  const rows = await readPages('SELECT id, record_id AS recordId, assessment_id AS assessmentId, decision, note, actor, needs_reconfirmation AS needsReconfirmation, stale_reason AS staleReason, created_at AS createdAt FROM procurement_decisions WHERE record_id=? ORDER BY created_at DESC, id', [recordId]);
  return rows.map(row => ({ ...row, needsReconfirmation: Number(row.needsReconfirmation) === 1 }));
}
export interface NoticeTask { id: string; title: string; kind: string; linkedType: string | null; linkedId: string | null; owner: string | null; dueAt: string | null; status: 'open' | 'done' | 'cancelled'; completionNote: string | null; version: number; createdAt: string; updatedAt: string }
export async function readTasks(recordId: string): Promise<NoticeTask[]> {
  const rows = await readPages('SELECT id, title, kind, linked_type AS linkedType, linked_id AS linkedId, owner, due_at AS dueAt, status, completion_note AS completionNote, version, created_at AS createdAt, updated_at AS updatedAt FROM procurement_tasks WHERE record_id=? ORDER BY created_at DESC, id', [recordId]);
  return rows.map(row => ({ ...row, version: Number(row.version) }));
}
export interface ChangeRow { id: string; kind: string; detail: any; detectedAt: string; acknowledgedAt: string | null; acknowledgedBy: string | null }
export async function readChanges(recordId: string): Promise<ChangeRow[]> {
  const rows = await readPages('SELECT id, kind, detail, detected_at AS detectedAt, acknowledged_at AS acknowledgedAt, acknowledged_by AS acknowledgedBy FROM procurement_changes WHERE record_id=? ORDER BY detected_at DESC, id', [recordId]);
  return rows.map(row => ({ ...row, detail: json(row.detail, {}) }));
}
export type AssessmentHistoryRow = AssessmentRow & { isCurrent: boolean };
/** Every assessment of the record under every profile, for history (the Decision tab uses readCurrentAssessments). */
export async function readAssessmentHistory(recordId: string): Promise<AssessmentHistoryRow[]> {
  const rows = await readPages('SELECT id, record_id AS recordId, profile_version_id AS profileVersionId, policy_version AS policyVersion, as_of AS asOf, freshness, relevance, eligibility, delivery, response, commercial, suggested_action AS suggestedAction, gates, critical_unknowns AS criticalUnknowns, reasons, is_current AS isCurrent, created_at AS createdAt FROM procurement_assessments WHERE record_id=? ORDER BY created_at DESC, id', [recordId]);
  return rows.map(row => ({ ...row, isCurrent: Number(row.isCurrent) === 1, gates: json(row.gates, []), criticalUnknowns: json(row.criticalUnknowns, []), reasons: json(row.reasons, []) }));
}
export async function readRecordEvents(recordId: string) {
  const [record] = await sql('SELECT updated_at AS updatedAt, (SELECT count(*) FROM record_history h WHERE h.record_id=records.id) AS captures FROM records WHERE id=?', [recordId]);
  const reviews = await readPages('SELECT id, prompt_id AS promptId, model, status, created_at AS createdAt FROM reviews WHERE record_id=? ORDER BY created_at DESC, id', [recordId]);
  const matches = await readPages('SELECT x.requirement_id AS requirementId, x.profile_version_id AS profileVersionId, x.status, x.origin, x.rationale, x.reviewer, x.revision, x.updated_at AS updatedAt, q.text AS requirementText FROM procurement_matches x LEFT JOIN procurement_requirements q ON q.id=x.requirement_id WHERE x.record_id=? ORDER BY x.updated_at DESC', [recordId]);
  const events = await readPages("SELECT x.id, x.target_type AS targetType, x.target_id AS targetId, x.event, x.reason, x.correction, x.reviewer, x.revision, x.occurred_at AS occurredAt, coalesce(q.text, f.field_key) AS targetText FROM procurement_review_events x LEFT JOIN procurement_requirements q ON x.target_type='requirement' AND q.id=x.target_id LEFT JOIN procurement_facts f ON x.target_type='fact' AND f.id=x.target_id WHERE x.record_id=? ORDER BY x.occurred_at DESC, x.id", [recordId]);
  return { updatedAt: record?.updatedAt ?? null, captures: Number(record?.captures ?? 0), reviews, matches, events };
}
/** Company evidence of one published profile version (`data.evidence[]`), for linking to a match. */
export async function readProfileEvidence(profileVersionId: string): Promise<{ id: string; capability: string; kind: string; holder: string | null; verification: string; expiresAt: string | null }[]> {
  const [row] = await sql('SELECT data FROM procurement_profile_versions WHERE id=?', [profileVersionId]);
  const data = json<any>(row?.data, {});
  return (Array.isArray(data?.evidence) ? data.evidence : []).filter((e: any) => e && typeof e.id === 'string').map((e: any) => ({ id: e.id, capability: String(e.capability ?? e.name ?? e.id), kind: String(e.kind ?? 'other'), holder: e.holder ?? null, verification: String(e.verification ?? 'unknown'), expiresAt: e.expiresAt ?? null }));
}

// ---- Decision rule ----
export const DECISION_OPTIONS = [['pursue', 'Pursue'], ['no_bid', 'No bid'], ['monitor', 'Monitor'], ['defer', 'Defer']] as const;
export type DecisionChoice = typeof DECISION_OPTIONS[number][0];
/**
 * When a human decision needs a note (mirrors and extends the host rule): no assessment behind it, eligibility
 * not supported (including overriding a blocker), a decline suggestion, or proceeding on stale evidence or
 * critical unknowns. The host rejects notes under 3 characters in these cases.
 */
export function decisionNoteRule(assessment: Pick<AssessmentRow, 'eligibility' | 'suggestedAction' | 'freshness' | 'criticalUnknowns'> | null, decision: DecisionChoice | ''): { required: boolean; reason: string } {
  if (!decision) return { required: false, reason: '' };
  if (!assessment) return { required: true, reason: 'No assessment for this profile backs this decision. Explain its basis.' };
  const proceeding = decision === 'pursue';
  if (assessment.eligibility === 'blocker') return { required: true, reason: decision === 'no_bid' ? 'Eligibility has a blocker. Note the reviewed basis for not bidding.' : 'You are overriding a confirmed blocker. Explain why.' };
  if (assessment.suggestedAction === 'decline' && decision !== 'no_bid') return { required: true, reason: 'The suggestion is to decline. Explain why you are not.' };
  if (assessment.eligibility !== 'supported_for_reviewed_requirements') return { required: true, reason: `Eligibility is “${label(assessment.eligibility)}”. Explain the basis for this decision.` };
  if (assessment.suggestedAction === 'decline') return { required: true, reason: 'Note the reviewed basis for this decision.' };
  if (proceeding && assessment.freshness === 'stale') return { required: true, reason: 'Evidence changed after this assessment. Explain why you are proceeding.' };
  if (proceeding && assessment.criticalUnknowns?.length) return { required: true, reason: 'Critical information is still unknown. Explain why you are proceeding.' };
  return { required: false, reason: '' };
}
export const noteSatisfies = (rule: { required: boolean }, note: string) => !rule.required || note.trim().length >= 3;

export const TASK_KINDS: [string, string][] = [['acquire_evidence', 'Acquire evidence'], ['resolve_gap', 'Resolve a gap'], ['reconfirm_change', 'Reconfirm a change'], ['decide', 'Make a decision'], ['other', 'Other']];
export const taskKindLabel = (kind: string) => TASK_KINDS.find(([id]) => id === kind)?.[1] ?? kind;

const CHANGE_TEXT: Record<string, string> = {
  document_added: 'Document added', document_modified: 'Document changed',
  document_missing_in_check: 'Document not found in the latest check (missing in a check is not the same as removed)',
  notice_modified: 'Notice details changed', profile_published: 'Company profile published a new version',
};
export const changeKindText = (kind: string) => CHANGE_TEXT[kind] ?? kind.replace(/_/g, ' ');

export interface ActivityItem { at: string | null; kind: string; title: string; detail?: string }
/** Newest first; undated items last (their order is kept). */
export function mergeActivity(items: ActivityItem[]): ActivityItem[] {
  const time = (item: ActivityItem) => { const t = item.at ? Date.parse(item.at) : NaN; return Number.isFinite(t) ? t : -Infinity; };
  return items.map((item, index) => ({ item, index })).sort((a, b) => time(b.item) - time(a.item) || a.index - b.index).map(({ item }) => item);
}

// ---- Reviewer judgements (delivery / response / commercial / partner scenario for one profile version) ----
export const JUDGEMENT_DIMENSIONS: { id: 'delivery' | 'response' | 'commercial' | 'partner_scenario'; name: string; values: string[] }[] = [
  { id: 'delivery', name: 'Delivery feasibility', values: ['feasible', 'conditional', 'not_feasible', 'unknown'] },
  { id: 'response', name: 'Response time', values: ['sufficient', 'tight', 'insufficient', 'unknown'] },
  { id: 'commercial', name: 'Commercial practicality', values: ['assessable', 'information_needed', 'outside_policy', 'unknown'] },
  { id: 'partner_scenario', name: 'Partner scenario', values: ['confirmed_allowed', 'not_confirmed'] },
];
export const JUDGEMENT_LABELS: Record<string, string> = { confirmed_allowed: 'Partner confirmed and allowed', not_confirmed: 'Partner not confirmed' };
export interface JudgementRow { dimension: string; value: string; note: string; reviewer: string; revision: number; updatedAt: string }
/** Reviewer judgements for one record and profile version; null when this Zoer has no judgements table yet. */
export async function readJudgements(recordId: string, profileVersionId: string): Promise<JudgementRow[] | null> {
  try {
    const rows = await sql('SELECT dimension, value, note, reviewer, revision, updated_at AS updatedAt FROM procurement_judgements WHERE record_id=? AND profile_version_id=? ORDER BY dimension', [recordId, profileVersionId]);
    return rows.map(row => ({ ...row, revision: Number(row.revision ?? 0) }));
  } catch { return null; }
}

/** Conflicting source statements in one extract run (facts marked conflicting, requirements with conflict links). */
export async function readConflicts(recordId: string, stageRunId: string): Promise<number> {
  const [row] = await sql("SELECT (SELECT count(*) FROM procurement_facts WHERE record_id=? AND stage_run_id=? AND status='conflicting') AS facts, (SELECT count(*) FROM procurement_requirements WHERE record_id=? AND stage_run_id=? AND conflicts<>'[]') AS requirements", [recordId, stageRunId, recordId, stageRunId]);
  return Number(row?.facts ?? 0) + Number(row?.requirements ?? 0);
}
