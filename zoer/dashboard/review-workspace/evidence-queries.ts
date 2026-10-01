import { MONEY_BASIS_LABELS, MONEY_KIND_LABELS, type MoneyBasis, type MoneyKind } from '@bcbid/procurement-core';
import { sql } from '../procurement/display';
import { json, placeholders } from './queries';
import { recordColumns, type Fragment } from './queue';

/**
 * Evidence cell grid (INTERFACE-SPEC §2 Evidence): rows are notices with a current extraction, columns are named fact
 * fields. A cell's state is derived here in JS; each problem filter has an SQL twin with the same meaning, applied to
 * the whole catalog (never the loaded page). Both are tested against each other on the host's real SQL reader.
 */
export const GRID_FIELDS = ['closing_date', 'budget', 'estimated_value', 'insurance_limit', 'bid_security', 'contract_duration', 'questions_deadline', 'site_visit'] as const;
export type GridField = typeof GRID_FIELDS[number];
export const FIELD_TEXT: Record<GridField, string> = {
  closing_date: 'Closing date', budget: 'Buyer budget', estimated_value: 'Estimated value', insurance_limit: 'Insurance limit', bid_security: 'Bid security',
  contract_duration: 'Contract duration', questions_deadline: 'Questions deadline', site_visit: 'Site visit',
};
export const GRID_PAGE = 50;

export const CELL_STATES = ['proposed', 'accepted', 'corrected', 'rejected', 'needs_clarification', 'outdated', 'ungrounded', 'not_reviewed', 'not_found', 'conflicting', 'not_applicable'] as const;
export type CellState = typeof CELL_STATES[number];
export const CELL_TEXT: Record<CellState, string> = {
  proposed: 'Proposed', accepted: 'Accepted', corrected: 'Corrected', rejected: 'Rejected', needs_clarification: 'Needs clarification', outdated: 'Outdated',
  ungrounded: 'Ungrounded', not_reviewed: 'Material not reviewed', not_found: 'Not found in reviewed material', conflicting: 'Conflicting', not_applicable: 'Not applicable',
};
/** Tone per state (grey unknown, amber needs information, green human-accepted, red rejected/conflict, violet stale). */
export const CELL_TONE: Record<CellState, 'supported' | 'needs_information' | 'blocker' | 'stale' | 'neutral'> = {
  proposed: 'neutral', accepted: 'supported', corrected: 'supported', rejected: 'blocker', needs_clarification: 'needs_information', outdated: 'stale',
  ungrounded: 'needs_information', not_reviewed: 'neutral', not_found: 'neutral', conflicting: 'blocker', not_applicable: 'neutral',
};

/** Global field-problem filters. Each is "the notice has at least one cell (in scope) with this problem". */
export const PROBLEMS = ['ungrounded', 'conflicting', 'not_found', 'unreviewed', 'not_reviewed', 'needs_clarification', 'rejected', 'outdated'] as const;
export type Problem = typeof PROBLEMS[number];
export const PROBLEM_TEXT: Record<Problem, { title: string; description: string }> = {
  ungrounded: { title: 'Ungrounded', description: 'A stated value whose quote was not found in the source text, not yet reviewed.' },
  conflicting: { title: 'Conflicting', description: 'More than one distinct stated value for the same field and lot (rejected values excluded).' },
  not_found: { title: 'Not found', description: 'Not found in reviewed material. This is not proof the field does not exist.' },
  unreviewed: { title: 'Awaiting review', description: 'A grounded proposed value with no reviewer decision yet.' },
  not_reviewed: { title: 'Material not reviewed', description: 'The extraction reported that the relevant material was not reviewed.' },
  needs_clarification: { title: 'Needs clarification', description: 'A reviewer asked for clarification.' },
  rejected: { title: 'Rejected', description: 'A reviewer rejected an extracted value.' },
  outdated: { title: 'Outdated', description: 'A file changed or arrived after these values were extracted; re-extract and reconfirm.' },
};

export interface FactRow { id: string; recordId: string; lotId: string | null; fieldKey: string; semanticType: string; status: string; value: unknown; grounding: string; reviewState: string | null; reviewValue: unknown }
export interface Cell { field: GridField; state: CellState; value: string; factId: string | null; problems: Set<Problem>; lots: number; count: number }

const CLAIMS = new Set(['stated', 'explicitly_absent']);
const sqlText = (value: unknown) => value === null || value === undefined ? '' : String(value);
/** Comparable value (mirrors VALUE_KEY_SQL): money by bounds + currency, everything else by its raw text, lower-cased. */
export function valueKey(semanticType: string, value: unknown): string {
  const v: any = value;
  if (semanticType.startsWith('money:')) return `${sqlText(v?.lower)}|${sqlText(v?.upper)}|${String(v?.currency ?? '').toUpperCase()}`;
  const raw = v && typeof v === 'object' && !Array.isArray(v) && v.raw !== undefined && v.raw !== null ? v.raw : v;
  return (raw === null || raw === undefined ? '' : typeof raw === 'object' ? JSON.stringify(raw) : String(raw)).toLowerCase();
}
const VALUE_KEY_SQL = "CASE WHEN f.semantic_type LIKE 'money:%' THEN coalesce(json_extract(f.value,'$.lower'),'')||'|'||coalesce(json_extract(f.value,'$.upper'),'')||'|'||upper(coalesce(json_extract(f.value,'$.currency'),'')) ELSE lower(coalesce(json_extract(f.value,'$.raw'),json_extract(f.value,'$'),'')) END";

/** Problems present in one cell (same semantics as `problemSql`). */
export function cellProblems(facts: FactRow[], runStale: boolean): Set<Problem> {
  const out = new Set<Problem>();
  if (runStale) out.add('outdated');
  const perLot = new Map<string, Set<string>>();
  for (const f of facts) {
    if (f.status === 'conflicting') out.add('conflicting');
    if (f.status === 'stated' && f.reviewState !== 'rejected') { const lot = f.lotId ?? ''; perLot.set(lot, (perLot.get(lot) ?? new Set()).add(valueKey(f.semanticType, f.value))); }
    if (CLAIMS.has(f.status) && !f.reviewState) out.add(f.grounding === 'unverified' ? 'ungrounded' : 'unreviewed');
    if (f.status === 'not_reviewed') out.add('not_reviewed');
    if (f.reviewState === 'rejected') out.add('rejected');
    if (f.reviewState === 'needs_clarification') out.add('needs_clarification');
  }
  if ([...perLot.values()].some(values => values.size > 1)) out.add('conflicting');
  if (facts.every(f => f.status === 'not_found_in_reviewed_material')) out.add('not_found');
  return out;
}

const n = (value: unknown) => typeof value === 'number' && Number.isFinite(value) ? value.toLocaleString(undefined, { maximumFractionDigits: 2 }) : null;
/** Display text for a fact value. Money keeps its own kind, currency and basis; nothing is converted or merged. */
export function formatFactValue(semanticType: string, value: unknown): string {
  const v: any = value;
  if (v === null || v === undefined || v === '') return 'Value not recorded';
  if (semanticType.startsWith('money:') && typeof v === 'object') {
    const lower = n(v.lower), upper = n(v.upper);
    const amount = lower && upper && lower !== upper ? `${lower}–${upper}` : lower ?? upper;
    if (!amount) return v.raw ? String(v.raw) : 'Amount not stated';
    const kind = MONEY_KIND_LABELS[semanticType.slice(6) as MoneyKind];
    return `${v.currency ?? 'Currency not stated'} ${amount} · ${MONEY_BASIS_LABELS[v.basis as MoneyBasis] ?? 'basis not stated'}${kind && !['buyer_budget', 'buyer_estimated_value', 'insurance_limit', 'bid_security'].includes(semanticType.slice(6)) ? ` (${kind})` : ''}`;
  }
  if (typeof v === 'object') return v.raw ? `${v.raw}${v.precision === 'date' ? ' (date only)' : v.precision === 'unknown' ? ' (unrecognized date)' : ''}` : JSON.stringify(v);
  return String(v);
}

/** One cell: a primary state plus every problem, the representative fact the inspector opens, and never a blank value. */
export function deriveCell(field: GridField, facts: FactRow[], runStale: boolean): Cell {
  const problems = cellProblems(facts, runStale), lots = new Set(facts.map(f => f.lotId ?? '')).size;
  const rank = (f: FactRow) => (f.reviewState === 'rejected' ? 4 : 0) + (f.reviewState === 'accepted' || f.reviewState === 'corrected' ? 0 : 1) + (f.lotId ? 2 : 0);
  const rep = [...facts].sort((a, b) => rank(a) - rank(b))[0] ?? null;
  const base = { field, problems, lots, count: facts.length, factId: rep?.id ?? null };
  if (!rep) return { ...base, state: runStale ? 'outdated' : 'not_found', value: CELL_TEXT.not_found };
  // A correction may be a `{value, status?}` patch (write-actions.ts `review.append`, as EvidenceInspector.tsx
  // sends it) or the bare replacement value itself; effectiveFact() in notice-queries.ts accepts either shape
  // and so must this, or a patch-shaped correction shows as raw JSON instead of its formatted value.
  const reviewValue = rep.reviewValue as any;
  const isPatch = reviewValue && typeof reviewValue === 'object' && !Array.isArray(reviewValue) && Object.keys(reviewValue).every(key => key === 'value' || key === 'status');
  const shown = rep.reviewState !== 'corrected' || reviewValue == null ? rep.value : isPatch ? (('value' in reviewValue) ? reviewValue.value : rep.value) : reviewValue;
  const status = rep.reviewState === 'corrected' && isPatch && reviewValue.status !== undefined ? reviewValue.status : rep.status;
  const value = status === 'not_found_in_reviewed_material' ? CELL_TEXT.not_found : status === 'not_reviewed' ? CELL_TEXT.not_reviewed : status === 'not_applicable' ? CELL_TEXT.not_applicable
    : status === 'explicitly_absent' && rep.reviewState !== 'corrected' ? `Stated as none${shown && typeof shown === 'object' && (shown as any).raw ? `: ${(shown as any).raw}` : ''}`
    : status === 'conflicting' ? 'Conflicting values in source' : formatFactValue(rep.semanticType, shown);
  const conflictText = problems.has('conflicting') ? `${new Set(facts.filter(f => f.status === 'stated' && f.reviewState !== 'rejected').map(f => valueKey(f.semanticType, f.value))).size || 'Several'} different values` : '';
  const state: CellState = problems.has('outdated') ? 'outdated' : problems.has('conflicting') ? 'conflicting'
    : rep.reviewState === 'accepted' || rep.reviewState === 'corrected' || rep.reviewState === 'rejected' || rep.reviewState === 'needs_clarification' ? rep.reviewState
    : rep.status === 'not_applicable' ? 'not_applicable' : rep.status === 'not_found_in_reviewed_material' ? 'not_found' : rep.status === 'not_reviewed' ? 'not_reviewed'
    : rep.grounding === 'unverified' ? 'ungrounded' : 'proposed';
  return { ...base, state, value: conflictText && state === 'conflicting' ? `${conflictText} · e.g. ${value}` : value };
}

// ---- SQL ---------------------------------------------------------------------------------------------------------

const quoted = (fields: readonly string[]) => fields.map(field => `'${field.replace(/'/g, "''")}'`).join(',');
export const isGridField = (value: unknown): value is GridField => GRID_FIELDS.includes(value as GridField);
const CURRENT_FACTS = (fields: readonly string[]) => `SELECT f.record_id FROM procurement_facts f JOIN procurement_stage_runs s ON s.id=f.stage_run_id WHERE s.stage='extract' AND s.is_current=1 AND f.field_key IN (${quoted(fields)})`;
const REVIEWED = (state?: string) => `SELECT target_id FROM procurement_review_state WHERE target_type='fact'${state ? ` AND state='${state}'` : ''}`;
/** Notices with a current extraction (the grid's row set). */
export const EXTRACTED = (alias = 'r') => `${recordColumns(alias).id} IN (SELECT record_id FROM procurement_stage_runs WHERE stage='extract' AND is_current=1)`;

/**
 * Records whose current extraction is outdated: marked stale, or a readable downloaded file whose current
 * version had no extraction when that run started (a file changed or arrived after the values were read).
 * The host flags stale assessments, not stage runs, so the file comparison carries this state.
 */
const OUTDATED_RECORDS = "SELECT s.record_id FROM procurement_stage_runs s WHERE s.stage='extract' AND s.is_current=1 AND s.quality='stale' UNION SELECT s.record_id FROM procurement_stage_runs s JOIN documents d ON d.record_id=s.record_id WHERE s.stage='extract' AND s.is_current=1 AND d.status='downloaded' AND length(d.text)>0 AND NOT EXISTS (SELECT e.id FROM procurement_extractions e WHERE e.record_id=d.record_id AND e.document_id=d.id AND e.sha256=d.sha256 AND e.created_at<=s.started_at)";

/** Record-level SQL twin of `cellProblems` over one field (or every grid field). No parameters. */
export function problemSql(problem: Problem, field?: GridField, alias = 'r'): string {
  const id = recordColumns(alias).id, fields = field ? [field] : GRID_FIELDS, facts = CURRENT_FACTS(fields);
  switch (problem) {
    case 'ungrounded': return `${id} IN (${facts} AND f.status IN ('stated','explicitly_absent') AND f.grounding='unverified' AND f.id NOT IN (${REVIEWED()}))`;
    case 'unreviewed': return `${id} IN (${facts} AND f.status IN ('stated','explicitly_absent') AND f.grounding<>'unverified' AND f.id NOT IN (${REVIEWED()}))`;
    case 'not_reviewed': return `${id} IN (${facts} AND f.status='not_reviewed')`;
    case 'rejected': return `${id} IN (${facts} AND f.id IN (${REVIEWED('rejected')}))`;
    case 'needs_clarification': return `${id} IN (${facts} AND f.id IN (${REVIEWED('needs_clarification')}))`;
    case 'outdated': return `${id} IN (${OUTDATED_RECORDS})`;
    case 'conflicting': return `CASE WHEN ${id} IN (${facts} AND f.status='conflicting') OR ${id} IN (${facts} AND f.status='stated' AND f.id NOT IN (${REVIEWED('rejected')}) GROUP BY f.record_id, f.field_key, coalesce(f.lot_id,'') HAVING count(DISTINCT ${VALUE_KEY_SQL})>1) THEN 1 ELSE 0 END=1`;
    case 'not_found': return `${id} NOT IN (${facts} AND f.status<>'not_found_in_reviewed_material' GROUP BY f.record_id HAVING count(DISTINCT f.field_key)=${fields.length})`;
  }
}
export const isProblem = (value: unknown): value is Problem => PROBLEMS.includes(value as Problem);

export interface GridScope { problem?: Problem; field?: GridField }
export const gridWhere = (scope: GridScope, alias = 'r') => [EXTRACTED(alias), scope.problem ? problemSql(scope.problem, scope.field, alias) : ''].filter(Boolean).join(' AND ');

/** Global counts: all extracted notices plus notices per problem, for the field in scope (or every field). */
export function problemCountsSql(field?: GridField): string {
  return `SELECT count(*) AS total, ${PROBLEMS.map(problem => `sum(CASE WHEN ${problemSql(problem, field)} THEN 1 ELSE 0 END) AS ${problem}`).join(', ')} FROM records r WHERE ${EXTRACTED()}`;
}

export type Cursor = { after?: string; before?: string };
/** Keyset page by record id (stable order). `before` reads backwards and is reversed. Fetches one extra row to detect more. */
export function gridPageSql(scope: GridScope, cursor: Cursor, size = GRID_PAGE): Fragment {
  const r = recordColumns('r'), where = gridWhere(scope), back = !!cursor.before && !cursor.after;
  const key = cursor.after ?? cursor.before;
  return {
    sql: `SELECT r.id, ${r.title} AS title, ${r.buyer} AS buyer, CASE WHEN r.id IN (${OUTDATED_RECORDS}) THEN 1 ELSE 0 END AS staleRuns, (SELECT max(s.finished_at) FROM procurement_stage_runs s WHERE s.record_id=r.id AND s.stage='extract' AND s.is_current=1) AS extractedAt FROM records r WHERE ${where}${key ? ` AND r.id${back ? '<' : '>'}?` : ''} ORDER BY r.id${back ? ' DESC' : ''} LIMIT ?`,
    parameters: [...(key ? [key] : []), size + 1],
  };
}
export const FACTS_SQL = (count: number) => `SELECT f.id, f.record_id AS recordId, f.lot_id AS lotId, f.field_key AS fieldKey, f.semantic_type AS semanticType, f.status, f.value, f.grounding, rs.state AS reviewState, rs.value AS reviewValue FROM procurement_facts f JOIN procurement_stage_runs s ON s.id=f.stage_run_id LEFT JOIN procurement_review_state rs ON rs.target_type='fact' AND rs.target_id=f.id WHERE s.stage='extract' AND s.is_current=1 AND f.field_key IN (${quoted(GRID_FIELDS)}) AND f.record_id IN (${placeholders(count)}) AND f.id>? ORDER BY f.id LIMIT 200`;
export const REQUIREMENT_COUNTS_SQL = (count: number) => `SELECT q.record_id AS recordId, sum(CASE WHEN q.strength='mandatory' THEN 1 ELSE 0 END) AS mandatory, sum(CASE WHEN q.strength='mandatory' AND q.id NOT IN (SELECT target_id FROM procurement_review_state WHERE target_type='requirement') THEN 1 ELSE 0 END) AS unreviewed, sum(CASE WHEN q.strength='mandatory' AND q.grounding='unverified' THEN 1 ELSE 0 END) AS ungrounded FROM procurement_requirements q JOIN procurement_stage_runs s ON s.id=q.stage_run_id WHERE s.stage='extract' AND s.is_current=1 AND q.id NOT IN (SELECT target_id FROM procurement_review_state WHERE target_type='requirement' AND state='rejected') AND q.record_id IN (${placeholders(count)}) GROUP BY q.record_id`;

export interface GridRow { id: string; title: string; buyer: string; stale: boolean; extractedAt: string | null; cells: Cell[]; mandatory: number; unreviewed: number; ungrounded: number }
export interface GridPage { rows: GridRow[]; hasNext: boolean; hasPrevious: boolean }

export async function readGridPage(scope: GridScope, cursor: Cursor, size = GRID_PAGE, read: typeof sql = sql): Promise<GridPage> {
  const page = gridPageSql(scope, cursor, size), back = !!cursor.before && !cursor.after;
  let rows = await read(page.sql, page.parameters);
  const more = rows.length > size;
  rows = rows.slice(0, size); if (back) rows.reverse();
  const ids = rows.map(row => String(row.id)), facts = new Map<string, FactRow[]>(), requirements = new Map<string, any>();
  if (ids.length) {
    let after = '';
    for (;;) {
      const chunk = await read(FACTS_SQL(ids.length), [...ids, after]);
      for (const row of chunk) { const list = facts.get(row.recordId) ?? []; list.push({ ...row, value: json(row.value, null), reviewValue: json(row.reviewValue, null) }); facts.set(row.recordId, list); }
      if (chunk.length < 200) break;
      after = String(chunk.at(-1)!.id);
    }
    for (const row of await read(REQUIREMENT_COUNTS_SQL(ids.length), ids)) requirements.set(row.recordId, row);
  }
  return {
    hasNext: back ? true : more, hasPrevious: back ? more : !!cursor.after,
    rows: rows.map(row => {
      const list = facts.get(row.id) ?? [], stale = Number(row.staleRuns ?? 0) > 0, q = requirements.get(row.id);
      return { id: row.id, title: row.title, buyer: row.buyer, stale, extractedAt: row.extractedAt ?? null, mandatory: Number(q?.mandatory ?? 0), unreviewed: Number(q?.unreviewed ?? 0), ungrounded: Number(q?.ungrounded ?? 0),
        cells: GRID_FIELDS.map(field => deriveCell(field, list.filter(f => f.fieldKey === field), stale)) };
    }),
  };
}

export const EVIDENCE_EXPORT_LIMIT = 2000;
/** CSV header for an evidence export: value + state per field; money currency/basis stay separate columns. */
export const evidenceExportHeader = () => ['recordId', 'title', 'buyer', 'extractedAt', ...GRID_FIELDS.flatMap(field => [`${field}.value`, `${field}.state`, `${field}.problems`]), 'mandatoryRequirements', 'mandatoryUnreviewed'];
export const evidenceExportRow = (row: GridRow) => [row.id, row.title, row.buyer, row.extractedAt, ...row.cells.flatMap(cell => [cell.value, CELL_TEXT[cell.state], [...cell.problems].join(' ')]), row.mandatory, row.unreviewed];
