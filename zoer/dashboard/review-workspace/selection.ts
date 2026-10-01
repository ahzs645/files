import { useSyncExternalStore } from 'react';
import { deadlineState, parseDeadline } from '@bcbid/procurement-core';
import { exportManifest, toCsv, type ExportManifest } from '../export';
import { sql } from '../procurement/display';
import { evidenceScopeOf, readRowReview } from './opportunity-queries';
import { label, placeholders } from './queries';
import { recordColumns, type Fragment } from './queue';

/**
 * Selections for batch work and exports. A "select all matching" snapshot is a frozen list of record ids captured
 * page by page at one moment, with the filter description; later catalog or filter changes never alter it.
 */
export const SNAPSHOT_LIMIT = 5000;
/** Host limit for one `procurement.pipeline` run. */
export const PIPELINE_BATCH = 50;
/** Extraction chunk size in code points (host pipeline: ≈12k code points per model call). */
export const CHUNK_CODE_POINTS = 12_000;

export interface SelectionSnapshot {
  ids: string[]; capturedAt: string; origin: 'matching' | 'manual';
  /** Plain-language filters at capture time. */
  description: string[]; filters: Record<string, string>;
  profileVersionId: string | null; profileText: string;
  /** Matching rows counted at capture (null for a manual selection). */
  matching: number | null;
  /** More rows matched than SNAPSHOT_LIMIT, or the catalog changed during capture; the reason is stated. */
  truncated: boolean; note: string | null;
}

/** Freeze every id matching `where` (over unaliased `records`) with keyset pages of 200; never silently truncated. */
export async function captureSnapshot(where: Fragment, meta: Pick<SelectionSnapshot, 'description' | 'filters' | 'profileVersionId' | 'profileText'>, options: { limit?: number; now?: () => Date; read?: typeof sql } = {}): Promise<SelectionSnapshot> {
  const read = options.read ?? sql, limit = options.limit ?? SNAPSHOT_LIMIT;
  const [count] = await read(`SELECT count(*) AS total FROM records WHERE ${where.sql}`, where.parameters);
  const matching = Number(count?.total ?? 0), ids: string[] = [];
  let after = '';
  while (ids.length < limit) {
    const rows = await read(`SELECT id FROM records WHERE ${where.sql} AND id>? ORDER BY id LIMIT 200`, [...where.parameters, after]);
    ids.push(...rows.map(row => String(row.id)).slice(0, limit - ids.length));
    if (rows.length < 200) break;
    after = String(rows.at(-1)!.id);
  }
  const note = matching > limit ? `${matching.toLocaleString()} notices matched; the selection holds the first ${limit.toLocaleString()} by record id. Narrow the filters to include the rest.`
    : ids.length !== matching ? `The catalog changed while the selection was captured: ${matching.toLocaleString()} matched when counted, ${ids.length.toLocaleString()} were captured.` : null;
  return { ...meta, ids, capturedAt: (options.now?.() ?? new Date()).toISOString(), origin: 'matching', matching, truncated: !!note && matching > ids.length, note };
}

export function manualSnapshot(ids: string[], meta: Pick<SelectionSnapshot, 'description' | 'filters' | 'profileVersionId' | 'profileText'>, now = new Date()): SelectionSnapshot {
  return { ...meta, ids: [...ids], capturedAt: now.toISOString(), origin: 'manual', description: ['Individually selected notices', ...meta.description.filter(line => line.startsWith('Profile:'))], matching: null, truncated: false, note: null };
}

/** Split ids into sequential pipeline runs of at most PIPELINE_BATCH records. */
export function chunkRuns<T>(ids: T[], size = PIPELINE_BATCH): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < ids.length; i += size) out.push(ids.slice(i, i + size));
  return out;
}

export type PipelineStage = 'triage' | 'extract';
/** Model calls for one readable document: one per started 12,000 code points. */
export const callsForText = (codePoints: number) => codePoints > 0 ? Math.ceil(codePoints / CHUNK_CODE_POINTS) : 0;

export interface PreflightRecord { id: string; readableDocs: number; calls: number; current: boolean }
export interface Preflight { records: number; withText: number; noticeOnly: number; readableDocs: number; estimatedCalls: number; reused: number; runs: number }
/**
 * Pure estimate. Triage: one call per notice (notice only). Extract: per notice, one call per 12,000 code points of
 * each readable document plus one for the notice. Records with a current result are reused unless `force`, so they
 * add no calls. Chunk overlap and repair retries can add calls, so this is always shown as an estimate.
 */
export function summarizePreflight(stage: PipelineStage, records: PreflightRecord[], force: boolean): Preflight {
  const withText = records.filter(record => record.readableDocs > 0).length;
  const reused = force ? 0 : records.filter(record => record.current).length;
  const estimatedCalls = records.reduce((sum, record) => sum + (!force && record.current ? 0 : stage === 'triage' ? 1 : record.calls + 1), 0);
  return { records: records.length, withText: stage === 'triage' ? 0 : withText, noticeOnly: stage === 'triage' ? records.length : records.length - withText, readableDocs: records.reduce((sum, r) => sum + r.readableDocs, 0), estimatedCalls, reused, runs: chunkRuns(records).length };
}

/** Readable documents (downloaded with text) per record, with the same per-document call arithmetic in SQL. */
export const PREFLIGHT_DOCS_SQL = (count: number) => `SELECT record_id AS id, count(*) AS docs, sum((length(text)+${CHUNK_CODE_POINTS - 1})/${CHUNK_CODE_POINTS}) AS calls FROM documents WHERE status='downloaded' AND length(text)>0 AND record_id IN (${placeholders(count)}) GROUP BY record_id`;
export const PREFLIGHT_CURRENT_SQL = (count: number) => `SELECT DISTINCT record_id AS id FROM procurement_stage_runs WHERE stage=? AND is_current=1 AND record_id IN (${placeholders(count)})`;

export async function readPreflight(ids: string[], stage: PipelineStage, read: typeof sql = sql): Promise<PreflightRecord[]> {
  const records = new Map<string, PreflightRecord>(ids.map(id => [id, { id, readableDocs: 0, calls: 0, current: false }]));
  for (let i = 0; i < ids.length; i += 150) {
    const chunk = ids.slice(i, i + 150);
    const [docs, current] = await Promise.all([read(PREFLIGHT_DOCS_SQL(chunk.length), chunk), read(PREFLIGHT_CURRENT_SQL(chunk.length), [stage, ...chunk])]);
    for (const row of docs) Object.assign(records.get(row.id)!, { readableDocs: Number(row.docs ?? 0), calls: Number(row.calls ?? 0) });
    for (const row of current) records.get(row.id)!.current = true;
  }
  return [...records.values()];
}

// ---- Export ------------------------------------------------------------------------------------------------------

export const EXPORT_COLUMNS = ['id', 'kind', 'title', 'buyer', 'sourceId', 'sourceStatus', 'deadline', 'deadlineState', 'workFit', 'eligibility', 'delivery', 'response', 'commercial', 'nextAction', 'assessmentFreshness', 'assessmentId', 'profileVersionId', 'humanDecision', 'decisionAt', 'decisionNeedsReconfirmation', 'evidenceScope', 'evidenceDetail', 'downloadedFiles', 'filesWithUsableText', 'sourceUrl'] as const;
export type ExportRow = Record<typeof EXPORT_COLUMNS[number], string | number | boolean | null>;

export type SnapshotManifest = ExportManifest & { capturedAt: string; selection: 'matching' | 'manual'; description: string[]; profileVersion: { id: string | null; text: string }; counts: { selected: number; matchingAtCapture: number | null; exported: number }; reviewColumns: 'included' | 'omitted: review workspace unavailable' };

/** Manifest for a snapshot export; `truncated` is set whenever fewer rows were written than the selection or match held. */
export function snapshotManifest(snapshot: SelectionSnapshot, input: { file: string; rowsExported: number; workspace: boolean; generatedAt?: string }): SnapshotManifest {
  const reasons = [snapshot.note && snapshot.truncated ? snapshot.note : '', input.rowsExported < snapshot.ids.length ? `Exported ${input.rowsExported} of ${snapshot.ids.length} selected notices (some were removed from the catalog after capture).` : ''].filter(Boolean);
  const base = exportManifest({
    file: input.file, scope: snapshot.origin === 'matching' ? 'Frozen selection of every notice matching the filters at capture time' : 'Frozen selection of individually chosen notices',
    filters: snapshot.filters, rowsExported: input.rowsExported, totalMatching: snapshot.matching ?? snapshot.ids.length, truncationReason: reasons.join(' ') || undefined,
    notes: ['Saved-catalog records only; source completeness is not verified.', 'AI suggestions and dimension states are not verified facts or bid decisions.', ...(input.workspace ? [] : ['Review workspace unavailable: assessment and decision columns are empty.'])],
    generatedAt: input.generatedAt,
  });
  return { ...base, capturedAt: snapshot.capturedAt, selection: snapshot.origin, description: snapshot.description, profileVersion: { id: snapshot.profileVersionId, text: snapshot.profileText }, counts: { selected: snapshot.ids.length, matchingAtCapture: snapshot.matching, exported: input.rowsExported }, reviewColumns: input.workspace ? 'included' : 'omitted: review workspace unavailable' };
}

export const exportCsv = (rows: ExportRow[]) => toCsv([...EXPORT_COLUMNS], rows.map(row => EXPORT_COLUMNS.map(key => row[key])));
export const exportJson = (manifest: SnapshotManifest, rows: ExportRow[]) => JSON.stringify({ manifest, records: rows }, null, 2);

export const BASIC_SQL = (count: number) => {
  const r = recordColumns();
  return `SELECT id, kind, ${r.title} AS title, ${r.buyer} AS buyer, ${r.source} AS sourceId, ${r.field('status')} AS status, CASE WHEN kind='opportunity' THEN ${r.closing} ELSE ${r.field('awardDate')} END AS deadline, coalesce(${r.field('detailUrl')}, ${r.field('sourceUrl')}) AS sourceUrl FROM records WHERE id IN (${placeholders(count)})`;
};
export const deadlineStateOf = (raw: unknown, asOf: number) => deadlineState(parseDeadline(typeof raw === 'string' ? raw : null), asOf);

/** Rows for the export, in snapshot order, 150 ids per statement. Missing values stay explicit ("Not assessed for this profile"). */
export async function readExportRows(snapshot: SelectionSnapshot, workspace: boolean, asOf = Date.now()): Promise<ExportRow[]> {
  const out: ExportRow[] = [];
  for (let i = 0; i < snapshot.ids.length; i += 150) {
    const ids = snapshot.ids.slice(i, i + 150);
    const [basics, review] = await Promise.all([sql(BASIC_SQL(ids.length), ids), readRowReview(ids, snapshot.profileVersionId, workspace)]);
    const byId = new Map(basics.map(row => [row.id, row]));
    for (const id of ids) {
      const row = byId.get(id); if (!row) continue;
      const r = review.get(id), a = r?.assessment ?? null, d = r?.decision ?? null, scope = r ? evidenceScopeOf(r.evidence) : null;
      const none = workspace ? 'Not assessed for this profile' : null;
      out.push({ id, kind: row.kind, title: row.title, buyer: row.buyer, sourceId: row.sourceId, sourceStatus: row.status ?? null, deadline: row.deadline ?? null, deadlineState: row.kind === 'opportunity' ? deadlineStateOf(row.deadline, asOf) : null,
        workFit: a ? label(a.relevance) : none, eligibility: a ? label(a.eligibility) : none, delivery: a ? label(a.delivery) : none, response: a ? label(a.response) : none, commercial: a ? label(a.commercial) : none,
        nextAction: a ? label(a.suggestedAction) : none, assessmentFreshness: a?.freshness ?? null, assessmentId: a?.id ?? null, profileVersionId: snapshot.profileVersionId,
        humanDecision: d ? label(d.decision) : workspace ? 'No human decision recorded' : null, decisionAt: d?.createdAt ?? null, decisionNeedsReconfirmation: d ? d.needsReconfirmation : null,
        evidenceScope: scope?.label ?? null, evidenceDetail: scope?.detail ?? null, downloadedFiles: r?.evidence.downloaded ?? null, filesWithUsableText: r?.evidence.usable ?? null, sourceUrl: row.sourceUrl ?? null });
    }
  }
  return out;
}

// ---- Individually selected rows (kept across pages and views for this tab) ---------------------------------------

export interface SelectedRow { id: string; title: string; updatedAt?: string }
const KEY = 'procurement-review-selection';
const listeners = new Set<() => void>();
let cache: SelectedRow[] | null = null;
function load(): SelectedRow[] {
  if (cache) return cache;
  try { const value = JSON.parse(sessionStorage.getItem(KEY) ?? '[]'); cache = Array.isArray(value) ? value.filter(item => item && typeof item.id === 'string') : []; } catch { cache = []; }
  return cache!;
}
export function setSelection(rows: SelectedRow[]) {
  cache = rows;
  try { sessionStorage.setItem(KEY, JSON.stringify(rows)); } catch { /* Private mode: kept for this page only. */ }
  listeners.forEach(listener => listener());
}
export function toggleSelected(row: SelectedRow, on: boolean) {
  const current = load().filter(item => item.id !== row.id);
  setSelection(on ? [...current, row] : current);
}
export function useSelection() {
  return useSyncExternalStore(listener => { listeners.add(listener); return () => { listeners.delete(listener); }; }, load, () => [] as SelectedRow[]);
}
