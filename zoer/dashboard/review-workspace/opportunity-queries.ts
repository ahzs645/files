import { MONEY_KIND_LABELS, SUGGESTED_ACTIONS, partitionMoney, type Money, type MoneyKind } from '@bcbid/procurement-core';
import { sql } from '../procurement/display';
import { parseExcludeTerms } from '../procurement/exclude';
import { CELL_TEXT, formatFactValue } from './evidence-queries';
import { json, label, placeholders, readCurrentAssessments, readLatestDecisions, type AssessmentRow, type DecisionRow } from './queries';
import { QUEUE_TEXT, READINESS_TEXT, RELEVANCE_TEXT, acquireParts, and, assessmentScope, fitSql, readReviewScope, recordColumns, reviewPredicate, type Fragment, type ReadinessBucket, type RelevanceBucket, type ReviewScope } from './queue';

/**
 * Review-table filters for the Opportunities catalog. They extend the shared queue.ts scope (queue, relevance,
 * readiness, assessed=none, open, reqCategory/match, profile) so Home/Insights drill-downs and these filters are one
 * SQL predicate over the whole catalog, never a filter over the loaded page.
 *
 * Extra URL parameters:
 * - `gap`         unchecked | notdownloaded | notext | triage | extract   (evidence gap)
 * - `eligibility` supported_for_reviewed_requirements | unresolved | blocker | not_assessed
 * - `action`      one suggested next action (investigate, needs_information, …)
 * - `decision`    pursue | no_bid | monitor | defer | none   (latest human decision)
 * - `assessed`    yes (has a current assessment for the profile); `none` is handled by queue.ts
 */
export const EVIDENCE_GAPS = ['unchecked', 'notdownloaded', 'notext', 'triage', 'extract'] as const;
export type EvidenceGap = typeof EVIDENCE_GAPS[number];
export const GAP_TEXT: Record<EvidenceGap, string> = {
  unchecked: 'Attachment discovery not checked', notdownloaded: 'Attachment links not downloaded', notext: 'Saved; no usable text extracted',
  triage: 'Not triaged', extract: 'Requirements not extracted',
};
export const ELIGIBILITY_FILTERS = ['supported_for_reviewed_requirements', 'unresolved', 'blocker', 'not_assessed'] as const;
export const DECISION_FILTERS = ['pursue', 'no_bid', 'monitor', 'defer', 'none'] as const;
export const ACTION_FILTERS = SUGGESTED_ACTIONS;

export interface OpportunityFilters { gap?: EvidenceGap; eligibility?: string; action?: string; decision?: string; assessedYes?: boolean }
/** Every URL parameter the review filters own (cleared together by "Clear filters"). */
export const REVIEW_PARAMS = ['queue', 'relevance', 'readiness', 'assessed', 'open', 'reqCategory', 'match', 'profile', 'gap', 'eligibility', 'action', 'decision'] as const;

const oneOf = (values: readonly string[], value: string | null) => value !== null && values.includes(value) ? value : undefined;
export function readOpportunityFilters(params: URLSearchParams): { scope: ReviewScope; filters: OpportunityFilters } {
  const scope = readReviewScope(params);
  const filters: OpportunityFilters = {};
  const gap = oneOf(EVIDENCE_GAPS, params.get('gap')); if (gap) filters.gap = gap as EvidenceGap;
  const eligibility = oneOf(ELIGIBILITY_FILTERS, params.get('eligibility')); if (eligibility) filters.eligibility = eligibility;
  const action = oneOf(ACTION_FILTERS, params.get('action')); if (action) filters.action = action;
  const decision = oneOf(DECISION_FILTERS, params.get('decision')); if (decision) filters.decision = decision;
  if (params.get('assessed') === 'yes') filters.assessedYes = true;
  return { scope, filters };
}

/** The profile every review column and filter uses: a `profile` link parameter wins over the reader's active profile. */
export const effectiveProfile = (scope: ReviewScope, active: string | null) => scope.profile !== undefined ? scope.profile : active;

/** Filters that read review-workspace tables (and so need them to exist). */
export function needsWorkspace(scope: ReviewScope, filters: OpportunityFilters) {
  return !!(scope.queue && scope.queue !== 'acquire') || !!(scope.relevance || scope.readiness || scope.assessed || scope.reqCategory || scope.match)
    || !!(filters.gap === 'triage' || filters.gap === 'extract' || filters.eligibility || filters.action || filters.decision || filters.assessedYes);
}

const LATEST_DECISION = 'd.created_at=(SELECT max(x.created_at) FROM procurement_decisions x WHERE x.record_id=d.record_id)';

/** One predicate per extra filter, over unaliased `records` (as buildProcurementQuery uses it). */
export function opportunityFilterSql(filters: OpportunityFilters, profileVersionId: string | null, alias = ''): Fragment {
  const id = recordColumns(alias).id, assessed = assessmentScope(profileVersionId), p = acquireParts(alias);
  const parts: Fragment[] = [];
  if (filters.gap === 'unchecked') parts.push({ sql: p.unchecked, parameters: [] });
  if (filters.gap === 'notdownloaded') parts.push({ sql: p.notDownloaded, parameters: [] });
  if (filters.gap === 'notext') parts.push({ sql: p.noText, parameters: [] });
  if (filters.gap === 'triage') parts.push({ sql: `${id} NOT IN (SELECT record_id FROM procurement_stage_runs WHERE stage='triage' AND is_current=1)`, parameters: [] });
  if (filters.gap === 'extract') parts.push({ sql: `${id} NOT IN (SELECT record_id FROM procurement_stage_runs WHERE stage='extract' AND is_current=1)`, parameters: [] });
  if (filters.eligibility) parts.push({ sql: `${id} IN (SELECT record_id FROM procurement_assessments WHERE ${assessed.sql} AND eligibility=?)`, parameters: [...assessed.parameters, filters.eligibility] });
  if (filters.action) parts.push({ sql: `${id} IN (SELECT record_id FROM procurement_assessments WHERE ${assessed.sql} AND suggested_action=?)`, parameters: [...assessed.parameters, filters.action] });
  if (filters.assessedYes) parts.push({ sql: `${id} IN (SELECT record_id FROM procurement_assessments WHERE ${assessed.sql})`, parameters: assessed.parameters });
  if (filters.decision === 'none') parts.push({ sql: `${id} NOT IN (SELECT record_id FROM procurement_decisions)`, parameters: [] });
  else if (filters.decision) parts.push({ sql: `${id} IN (SELECT d.record_id FROM procurement_decisions d WHERE d.decision=? AND ${LATEST_DECISION})`, parameters: [filters.decision] });
  return and(...parts);
}

/**
 * The complete review WHERE fragment for the Opportunities table, matrix and snapshots. The source filter is left to
 * buildProcurementQuery (it already applies `source`), so queue.ts gets the scope without it.
 */
export function opportunityPredicate(scope: ReviewScope, filters: OpportunityFilters, options: { profileVersionId: string | null; asOf?: number; workspace: boolean }): Fragment & { unavailable?: string } {
  if (!options.workspace && needsWorkspace(scope, filters)) return { sql: '0=1', parameters: [], unavailable: 'These review filters need the review workspace. Update Zoer, or clear the review filters.' };
  const profile = effectiveProfile(scope, options.profileVersionId);
  const shared = reviewPredicate({ ...scope, source: undefined }, { profileVersionId: options.profileVersionId, asOf: options.asOf });
  const result = and(shared, opportunityFilterSql(filters, profile));
  return shared.unavailable ? { ...result, unavailable: shared.unavailable } : result;
}

/** Order by work fit for the profile (strong, possible, weak, unknown, then not assessed), then recently updated. */
export function fitOrderSql(profileVersionId: string | null): Fragment {
  const assessed = assessmentScope(profileVersionId, 'a');
  return { sql: `coalesce((SELECT min(CASE a.relevance WHEN 'strong' THEN 0 WHEN 'possible' THEN 1 WHEN 'weak' THEN 2 ELSE 3 END) FROM procurement_assessments a WHERE a.record_id=records.id AND ${assessed.sql}),4), updated_at DESC, id`, parameters: assessed.parameters };
}

const KIND_TEXT: Record<string, string> = { opportunity: 'Opportunities', award: 'Awards' };
const DECISION_TEXT: Record<string, string> = { none: 'No human decision recorded' };
/** Plain-language list of the active filters; used for empty states, frozen selections and export manifests. */
export function describeFilters(params: URLSearchParams, profileText: string, sourceLabel: (id: string) => string = id => id): string[] {
  const out: string[] = [], get = (key: string) => params.get(key) ?? '';
  const { scope, filters } = readOpportunityFilters(params);
  if (get('search')) out.push(`Search: “${get('search')}”`);
  if (get('source')) out.push(`Source: ${sourceLabel(get('source'))}`);
  if (KIND_TEXT[get('kind')]) out.push(`Type: ${KIND_TEXT[get('kind')]}`);
  if (get('deadline') === 'week') out.push('Closing in 7 days');
  if (get('shortlist') === '1') out.push('Shortlisted');
  for (const key of ['region', 'category', 'buyer', 'supplier', 'classification']) if (get(key)) out.push(`${key[0].toUpperCase()}${key.slice(1)}: ${get(key)}`);
  if (get('aiLabel')) out.push(`AI category: ${get('aiLabel')}`);
  const exclude = parseExcludeTerms(get('exclude'));
  if (exclude.length) out.push(`Excluding: ${exclude.join(', ')}`);
  if (get('hidden') === 'include') out.push('Including hidden notices'); else if (get('hidden') === 'only') out.push('Hidden notices only');
  if (scope.queue) out.push(`Queue: ${QUEUE_TEXT[scope.queue].title}`);
  if (scope.open) out.push('Open opportunities only');
  if (scope.relevance) out.push(`Work fit: ${RELEVANCE_TEXT[scope.relevance as RelevanceBucket]}`);
  if (scope.readiness) out.push(`Readiness: ${READINESS_TEXT[scope.readiness as ReadinessBucket]}`);
  if (scope.assessed === 'none') out.push('Not assessed for this profile');
  if (filters.assessedYes) out.push('Assessed for this profile');
  if (scope.reqCategory || scope.match) out.push(`Requirement ${scope.reqCategory ?? 'any category'} with match ${scope.match ?? 'any'}`);
  if (filters.gap) out.push(`Evidence gap: ${GAP_TEXT[filters.gap]}`);
  if (filters.eligibility) out.push(`Eligibility: ${label(filters.eligibility)}`);
  if (filters.action) out.push(`Next action: ${label(filters.action)}`);
  if (filters.decision) out.push(`Decision: ${DECISION_TEXT[filters.decision] ?? label(filters.decision)}`);
  out.push(`Profile: ${profileText}`);
  return out;
}

/** Removable chips for active review filters: [URL keys cleared together, text]. */
export function reviewChips(params: URLSearchParams, profileText: (id: string | null) => string): [string[], string][] {
  const { scope, filters } = readOpportunityFilters(params), out: [string[], string][] = [];
  if (scope.queue) out.push([['queue'], `Queue: ${QUEUE_TEXT[scope.queue].title}`]);
  if (scope.open) out.push([['open'], 'Open opportunities only']);
  if (scope.relevance) out.push([['relevance'], `Work fit: ${RELEVANCE_TEXT[scope.relevance as RelevanceBucket]}`]);
  if (scope.readiness) out.push([['readiness'], `Readiness: ${READINESS_TEXT[scope.readiness as ReadinessBucket]}`]);
  if (scope.assessed === 'none') out.push([['assessed'], 'Not assessed for this profile']);
  if (filters.assessedYes) out.push([['assessed'], 'Assessed for this profile']);
  if (scope.reqCategory || scope.match) out.push([['reqCategory', 'match'], `Requirement: ${scope.reqCategory ?? 'any category'} · match ${scope.match === 'none' ? 'not recorded' : label(scope.match ?? 'any')}`]);
  if (filters.gap) out.push([['gap'], GAP_TEXT[filters.gap]]);
  if (filters.eligibility) out.push([['eligibility'], `Eligibility: ${label(filters.eligibility)}`]);
  if (filters.action) out.push([['action'], `Next action: ${label(filters.action)}`]);
  if (filters.decision) out.push([['decision'], `Decision: ${DECISION_TEXT[filters.decision] ?? label(filters.decision)}`]);
  if (scope.profile !== undefined) out.push([['profile'], `Profile from link: ${profileText(scope.profile)}`]);
  return out;
}

/** Every URL filter as a plain object (manifest "filters"); view/page/notice state is left out. */
export function filterObject(params: URLSearchParams): Record<string, string> {
  const skip = new Set(['view', 'page', 'after', 'before', 'notice', 'tab', 'ids', 'savedSearch']);
  return Object.fromEntries([...params].filter(([key, value]) => !skip.has(key) && value !== ''));
}

// ---- Row review columns ------------------------------------------------------------------------------------------

export interface EvidenceFacts {
  /** Attachment discovery ran (attachments captured, even empty) or a document row exists. */
  discoveryChecked: boolean; hasLinks: boolean; downloaded: number; usable: number;
  triaged: boolean; extracted: boolean;
  /** Documents processed by the current extraction (coverage.processed); null when not recorded. */
  processed: number | null; quality: string | null; route: string | null;
}
export interface EvidenceScope { label: string; detail: string; tone: 'supported' | 'needs_information' | 'neutral' }

/** INTERFACE-SPEC §3 wording for what evidence a notice's review is based on. Unknowns are named, never zero. */
export function evidenceScopeOf(e: EvidenceFacts): EvidenceScope {
  const docs = (n: number) => `${n.toLocaleString()} document${n === 1 ? '' : 's'}`;
  const label = e.extracted ? e.processed === null ? 'Extracted · document count not recorded' : e.processed > 0 ? `Extracted from notice + ${docs(e.processed)}` : 'Extracted from the saved notice only'
    : e.triaged ? 'Based on the saved notice only' : 'Not processed';
  const detail = !e.discoveryChecked ? 'Attachment discovery not checked'
    : e.downloaded === 0 ? e.hasLinks ? 'Attachment links not downloaded' : 'No public attachment links found in this check'
    : e.usable === 0 ? 'Saved; no usable text extracted'
    : `${e.usable.toLocaleString()} of ${e.downloaded.toLocaleString()} downloaded file${e.downloaded === 1 ? '' : 's'} with usable text`;
  return { label: e.quality === 'needs_review' ? `${label} · needs review` : label, detail, tone: e.extracted && e.usable > 0 ? 'supported' : e.extracted || e.triaged ? 'needs_information' : 'neutral' };
}

export interface RowReview { assessment: AssessmentRow | null; decision: DecisionRow | null; evidence: EvidenceFacts }
const EMPTY: EvidenceFacts = { discoveryChecked: false, hasLinks: false, downloaded: 0, usable: 0, triaged: false, extracted: false, processed: null, quality: null, route: null };

export const EVIDENCE_COUNTS_SQL = (count: number) => {
  const r = recordColumns('r');
  return `SELECT r.id, CASE WHEN ${r.field('attachments')} IS NULL AND r.id NOT IN (SELECT record_id FROM documents) THEN 0 ELSE 1 END AS discoveryChecked, CASE WHEN ${r.field('attachments[0]')} IS NULL THEN 0 ELSE 1 END AS hasLinks, (SELECT count(*) FROM documents d WHERE d.record_id=r.id AND d.status='downloaded') AS downloaded, (SELECT count(*) FROM documents d WHERE d.record_id=r.id AND d.status='downloaded' AND length(d.text)>0) AS usable FROM records r WHERE r.id IN (${placeholders(count)})`;
};
export const STAGE_SQL = (count: number) => `SELECT s.record_id AS id, s.stage, s.quality, json_extract(s.output,'$.route') AS route, coalesce(json_extract(s.coverage,'$.processed'), json_extract(b.coverage,'$.processed')) AS processed FROM procurement_stage_runs s LEFT JOIN procurement_bundles b ON b.id=s.bundle_id WHERE s.is_current=1 AND s.stage IN ('triage','extract') AND s.record_id IN (${placeholders(count)})`;

/** Review columns for one page of rows (≤150 ids per statement), always for exactly one profile version. */
export async function readRowReview(ids: string[], profileVersionId: string | null, workspace: boolean): Promise<Map<string, RowReview>> {
  const out = new Map<string, RowReview>(ids.map(id => [id, { assessment: null, decision: null, evidence: { ...EMPTY } }]));
  if (!ids.length) return out;
  for (let i = 0; i < ids.length; i += 150) {
    const chunk = ids.slice(i, i + 150);
    for (const row of await sql(EVIDENCE_COUNTS_SQL(chunk.length), chunk)) {
      const e = out.get(row.id)!.evidence;
      Object.assign(e, { discoveryChecked: Number(row.discoveryChecked) === 1, hasLinks: Number(row.hasLinks) === 1, downloaded: Number(row.downloaded ?? 0), usable: Number(row.usable ?? 0) });
    }
    if (workspace) for (const row of await sql(STAGE_SQL(chunk.length), chunk)) {
      const e = out.get(row.id)!.evidence;
      if (row.stage === 'triage') { e.triaged = true; e.route = typeof row.route === 'string' && row.route ? row.route : e.route; }
      if (row.stage === 'extract') { e.extracted = true; e.quality = row.quality ?? null; e.processed = row.processed === null || row.processed === undefined ? null : Number(row.processed); }
    }
  }
  if (!workspace) return out;
  const [assessments, decisions] = await Promise.all([readCurrentAssessments(ids, profileVersionId), readLatestDecisions(ids)]);
  for (const [id, value] of out) { value.assessment = assessments.get(id) ?? null; value.decision = decisions.get(id) ?? null; }
  return out;
}

// ---- Fit matrix --------------------------------------------------------------------------------------------------

export const MATRIX_COLUMNS = ['strong', 'possible', 'weak'] as const;
export const MATRIX_ROWS = ['ready', 'conditions', 'blocker'] as const;
export type MatrixCell = { key: string; relevance?: RelevanceBucket; readiness?: ReadinessBucket; assessed?: 'none' };
/** Nine categorical cells plus a separate lane: relevance unknown, readiness unknown, not assessed (lanes can overlap). */
export const MATRIX_CELLS: MatrixCell[] = [
  ...MATRIX_ROWS.flatMap(readiness => MATRIX_COLUMNS.map(relevance => ({ key: `${readiness}_${relevance}`, relevance, readiness }))),
  { key: 'relevance_unknown', relevance: 'unknown' }, { key: 'readiness_unknown', readiness: 'unknown' }, { key: 'not_assessed', assessed: 'none' },
];

/**
 * Counts for every matrix cell in one statement. Each count is `base AND fitSql(cell)`, the exact predicate the
 * table applies after a drill-down (relevance/readiness/assessed parameters), so a count and its rows cannot differ.
 * With `decisions`, also counts notices in each cell that have a human decision (an optional badge only).
 */
export function matrixCountsSql(base: Fragment, profileVersionId: string | null, decisions = false): Fragment {
  const columns: string[] = [], parameters: (string | number)[] = [];
  for (const cell of MATRIX_CELLS) {
    const fit = fitSql(cell, profileVersionId);
    columns.push(`sum(CASE WHEN ${fit.sql} THEN 1 ELSE 0 END) AS ${cell.key}`); parameters.push(...fit.parameters);
    if (decisions) { columns.push(`sum(CASE WHEN ${fit.sql} AND id IN (SELECT record_id FROM procurement_decisions) THEN 1 ELSE 0 END) AS ${cell.key}_decided`); parameters.push(...fit.parameters); }
  }
  return { sql: `SELECT count(*) AS total, ${columns.join(', ')} FROM records WHERE ${base.sql}`, parameters: [...parameters, ...base.parameters] };
}

/** Drill-down location for a cell: the current filters, the cell's relevance/readiness/assessed, table view, first page. */
export function matrixCellHref(params: URLSearchParams, cell: MatrixCell): string {
  const next = new URLSearchParams(params);
  for (const key of ['view', 'page', 'relevance', 'readiness', 'assessed', 'notice', 'tab', 'ids']) next.delete(key);
  if (cell.relevance) next.set('relevance', cell.relevance);
  if (cell.readiness) next.set('readiness', cell.readiness);
  if (cell.assessed) next.set('assessed', cell.assessed);
  return '/procurement' + (next.size ? '?' + next : '');
}

// ---- Compare -----------------------------------------------------------------------------------------------------

export interface CompareExtras { mandatory: number; unresolved: number | null; budgets: BudgetFact[]; extracted: boolean }
export interface BudgetFact { recordId: string; kind: string; value: any; state: string }
/**
 * Mandatory requirement counts (rejected requirements excluded) and, for a profile, how many are not yet supported or
 * not applicable. Budget facts are the buyer budget / estimated value kinds only; insurance limits never qualify.
 */
export async function readCompareExtras(ids: string[], profileVersionId: string | null): Promise<Map<string, CompareExtras>> {
  const out = new Map<string, CompareExtras>(ids.map(id => [id, { mandatory: 0, unresolved: profileVersionId ? 0 : null, budgets: [], extracted: false }]));
  if (!ids.length) return out;
  const list = placeholders(ids.length), current = "s.stage='extract' AND s.is_current=1";
  const [requirements, budgets, runs] = await Promise.all([
    sql(`SELECT q.record_id AS recordId, count(*) AS mandatory, sum(CASE WHEN coalesce(m.status,'') IN ('supported','not_applicable') THEN 0 ELSE 1 END) AS unresolved FROM procurement_requirements q JOIN procurement_stage_runs s ON s.id=q.stage_run_id LEFT JOIN procurement_matches m ON m.requirement_id=q.id AND m.profile_version_id=? WHERE ${current} AND q.strength='mandatory' AND q.id NOT IN (SELECT target_id FROM procurement_review_state WHERE target_type='requirement' AND state='rejected') AND q.record_id IN (${list}) GROUP BY q.record_id`, [profileVersionId ?? '', ...ids]),
    sql(`SELECT f.record_id AS recordId, f.semantic_type AS semanticType, f.value, f.grounding, rs.state AS reviewState, rs.value AS reviewValue FROM procurement_facts f JOIN procurement_stage_runs s ON s.id=f.stage_run_id LEFT JOIN procurement_review_state rs ON rs.target_type='fact' AND rs.target_id=f.id WHERE ${current} AND f.status='stated' AND f.semantic_type IN ('money:buyer_budget','money:buyer_estimated_value') AND f.record_id IN (${list}) ORDER BY f.record_id, f.id`, ids),
    sql(`SELECT DISTINCT record_id AS recordId FROM procurement_stage_runs WHERE stage='extract' AND is_current=1 AND record_id IN (${list})`, ids),
  ]);
  for (const row of runs) out.get(row.recordId)!.extracted = true;
  for (const row of requirements) Object.assign(out.get(row.recordId)!, { mandatory: Number(row.mandatory ?? 0), unresolved: profileVersionId ? Number(row.unresolved ?? 0) : null });
  for (const row of budgets) {
    if (row.reviewState === 'rejected') continue;
    const corrected = row.reviewState === 'corrected' && row.reviewValue != null;
    out.get(row.recordId)!.budgets.push({ recordId: row.recordId, kind: String(row.semanticType).slice('money:'.length), value: json(corrected ? row.reviewValue : row.value, null), state: row.reviewState ?? (row.grounding === 'unverified' ? 'ungrounded' : 'proposed') });
  }
  return out;
}

/** Budget text: buyer budget / estimated value only (never insurance or security), each with its own kind and basis. */
export function budgetText(extras: CompareExtras | undefined): string[] {
  if (!extras) return ['Loading…'];
  if (!extras.budgets.length) return [extras.extracted ? 'Budget not found in reviewed material' : 'Not extracted yet'];
  const items = extras.budgets.map(fact => ({ ...(fact.value ?? {}), kind: fact.kind as MoneyKind, durationMonths: null, state: fact.state, lower: fact.value?.lower ?? null, upper: fact.value?.upper ?? null, currency: fact.value?.currency ?? null, basis: fact.value?.basis ?? 'unknown', taxBasis: fact.value?.taxBasis ?? 'unknown', raw: fact.value?.raw ?? null } as Money & { state: string }));
  return partitionMoney(items).flatMap(group => group.items.map(item => `${MONEY_KIND_LABELS[group.kind] ?? group.kind}: ${formatFactValue(`money:${group.kind}`, item)} · ${CELL_TEXT[item.state as keyof typeof CELL_TEXT] ?? label(item.state)}`));
}
