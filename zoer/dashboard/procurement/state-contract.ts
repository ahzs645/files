import { EXCLUDE_MAX_TERMS, EXCLUDE_MAX_TEXT, allExcludeTerms } from './exclude';
export const PURSUIT_STAGES = ['Watching', 'Reviewing', 'Preparing', 'Submitted', 'Awarded', 'Closed'] as const;
export type PursuitStage = typeof PURSUIT_STAGES[number];
export const PURSUITS_KEY = 'procurement:pursuits';
export const SEARCHES_KEY = 'procurement:searches';
export const MAX_PURSUITS = 200;
export const MAX_SEARCHES = 50;
/**
 * "Hide / not relevant" is one workspace key per record (`procurement:hidden:<sha256(recordId)>`, value
 * `{ schemaVersion: 1, recordId, hidden, updatedAt, lastRunId }`) so lists can exclude hidden notices in SQL without
 * touching the source record. The host has no delete, so undo writes `hidden: false`.
 */
export const HIDDEN_PREFIX = 'procurement:hidden:';
/** At most this many records per hide/unhide (one catalog commit holds at most 20 entries). */
export const MAX_HIDDEN_BATCH = 20;
/** Record ids currently hidden. The IS NOT NULL guard keeps `NOT IN` from turning into "exclude everything". */
export const HIDDEN_IDS_SQL = `SELECT json_extract(data,'$.recordId') FROM workspace_state WHERE key LIKE '${HIDDEN_PREFIX}%' AND json_extract(data,'$.hidden')=1 AND json_extract(data,'$.recordId') IS NOT NULL`;
export type ProcurementFilters = {
  source: string; kind: 'all' | 'opportunity' | 'award'; search: string;
  region: string; category: string; classification?: string; buyer: string; supplier: string; deadline: 'all' | 'week'; shortlist: boolean;
  /** Exclude words (exclude.ts). Older saved searches have none. */
  exclude?: string;
};
export type VersionedState = { version: number; updatedAt: string; lastRunId: string };
export type Pursuit = VersionedState & { recordId: string; sourceId: string; title: string; stage: PursuitStage; notes: string };
export type SavedSearch = VersionedState & { id: string; name: string; filters: ProcurementFilters; archived: boolean };
export type ProcurementStateInput =
  | { operation: 'pursuit.upsert'; expectedVersion: number; recordId: string; sourceId: string; stage: PursuitStage; notes: string }
  | { operation: 'search.upsert'; expectedVersion: number; id: string; name: string; filters: ProcurementFilters }
  | { operation: 'search.archive'; expectedVersion: number; id: string }
  /** Idempotent set: hiding twice is the same as once, so no item version is needed. */
  | { operation: 'hidden.set'; recordIds: string[]; hidden: boolean };
/** Pursuit and saved-search writes: versioned items read back from their list keys. */
export type VersionedStateInput = Exclude<ProcurementStateInput, { operation: 'hidden.set' }>;

const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
function text(value: unknown, field: string, maximum: number, empty = false): string {
  if (typeof value !== 'string' || value.length > maximum || (!empty && !value.trim()) || /\u0000/.test(value)) throw Error(`Invalid ${field}.`);
  return value;
}
export function validateSourceId(value: unknown, allowAll = false): string {
  if (allowAll && value === '') return '';
  if (typeof value !== 'string' || !/^[a-z][a-z0-9-]{0,63}$/.test(value)) throw Error('Invalid procurement source ID.');
  return value;
}
export function validateProcurementFilters(value: unknown): ProcurementFilters {
  if (!object(value)) throw Error('Invalid saved-search filters.');
  if (Object.keys(value).some(key => !['source', 'kind', 'search', 'region', 'category', 'classification', 'buyer', 'supplier', 'deadline', 'shortlist', 'exclude'].includes(key))) throw Error('Unknown saved-search filter.');
  const exclude = text(value.exclude ?? '', 'exclude words', EXCLUDE_MAX_TEXT, true);
  if (allExcludeTerms(exclude).length > EXCLUDE_MAX_TERMS) throw Error(`Use at most ${EXCLUDE_MAX_TERMS} exclude words.`);
  if (!['all', 'opportunity', 'award'].includes(value.kind as string) || !['all', 'week'].includes(value.deadline as string) || typeof value.shortlist !== 'boolean') throw Error('Invalid saved-search filter value.');
  return { source: validateSourceId(value.source, true), kind: value.kind as ProcurementFilters['kind'],
    search: text(value.search, 'search text', 1000, true), region: text(value.region, 'region', 300, true),
    category: text(value.category, 'category', 300, true), classification: text(value.classification ?? '', 'classification', 12000, true), buyer: text(value.buyer, 'buyer', 300, true), supplier: text(value.supplier ?? '', 'supplier', 300, true),
    deadline: value.deadline as ProcurementFilters['deadline'], shortlist: value.shortlist, exclude };
}
export function validateProcurementStateInput(value: unknown): ProcurementStateInput {
  if (object(value) && value.operation === 'hidden.set') {
    if (Object.keys(value).some(key => !['operation', 'recordIds', 'hidden'].includes(key))) throw Error('Unknown hidden-notice field.');
    const ids = value.recordIds;
    if (!Array.isArray(ids) || !ids.length || ids.length > MAX_HIDDEN_BATCH || typeof value.hidden !== 'boolean') throw Error(`Hide or show 1–${MAX_HIDDEN_BATCH} notices at a time.`);
    const recordIds = [...new Set(ids.map(id => text(id, 'catalog record ID', 10_000)))];
    if (recordIds.some(id => !/^(opportunity|award):.+$/.test(id))) throw Error('Invalid catalog record ID.');
    return { operation: 'hidden.set', recordIds, hidden: value.hidden };
  }
  if (!object(value) || !Number.isSafeInteger(value.expectedVersion) || (value.expectedVersion as number) < 0) throw Error('A valid expected item version is required.');
  const expectedVersion = value.expectedVersion as number;
  if (value.operation === 'pursuit.upsert') {
    const recordId = text(value.recordId, 'catalog record ID', 10_000);
    if (!/^(opportunity|award):.+$/.test(recordId)) throw Error('Invalid catalog record ID.');
    if (!PURSUIT_STAGES.includes(value.stage as PursuitStage)) throw Error('Invalid pursuit stage.');
    return { operation: value.operation, expectedVersion, recordId, sourceId: validateSourceId(value.sourceId), stage: value.stage as PursuitStage, notes: text(value.notes, 'pursuit notes', 4000, true) };
  }
  if (value.operation === 'search.upsert' || value.operation === 'search.archive') {
    const id = text(value.id, 'saved-search ID', 80);
    if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/.test(id)) throw Error('Invalid saved-search ID.');
    if (value.operation === 'search.archive') return { operation: value.operation, expectedVersion, id };
    return { operation: value.operation, expectedVersion, id, name: text(value.name, 'saved-search name', 100).trim(), filters: validateProcurementFilters(value.filters) };
  }
  throw Error('Unknown procurement state operation.');
}

/** Existing malformed state is an error, never a reason to overwrite it with an empty list. */
export function readProcurementItems<T extends Pursuit | SavedSearch>(value: unknown, kind: 'pursuits' | 'searches'): T[] {
  if (value === undefined) return [];
  if (!object(value) || value.schemaVersion !== 1 || !Array.isArray(value.items) || value.items.length > (kind === 'pursuits' ? MAX_PURSUITS : MAX_SEARCHES)) throw Error('Saved procurement state is invalid; existing data was retained.');
  const ids = new Set<string>();
  for (const item of value.items) {
    if (!object(item) || !Number.isSafeInteger(item.version) || (item.version as number) < 1 || typeof item.updatedAt !== 'string' || !Number.isFinite(Date.parse(item.updatedAt)) || typeof item.lastRunId !== 'string') throw Error('Saved procurement item is invalid; existing data was retained.');
    const input = kind === 'pursuits'
      ? validateProcurementStateInput({ ...item, operation: 'pursuit.upsert', expectedVersion: item.version })
      : validateProcurementStateInput({ ...item, operation: 'search.upsert', expectedVersion: item.version });
    const id = input.operation === 'pursuit.upsert' ? input.recordId : input.operation === 'hidden.set' ? '' : input.id;
    if (ids.has(id) || (kind === 'searches' && typeof item.archived !== 'boolean') || (kind === 'pursuits' && (typeof item.title !== 'string' || item.title.length > 20_000))) throw Error('Saved procurement item is invalid; existing data was retained.');
    ids.add(id);
  }
  return value.items as T[];
}
