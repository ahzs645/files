// Canonical notices: one row per notice in lists, counts and totals. Nothing is deleted; `catalog.normalize` records
// the same decisions on the rows (`mergedInto`, `duplicateOf`) and the read rules below already apply before it runs.

/**
 * CanadaBuys publishes every amendment of a tender as a new dataset row (reference MX-…/PW-…/WS…-Doc… plus amendment
 * 000, 001, …) and imports before 2026-11-13 saved each one under `canadabuys:tender:<reference>:<amendment>`. One
 * reference number (`externalId`) is one notice. Its canonical record is the earliest saved one, the lowest amendment
 * suffix (a blank suffix, the original notice, first): collectors now update that record with each later amendment
 * (CONNECTORS.md "CanadaBuys identity") and `catalog.normalize` folds the later rows saved before into it. Every other
 * row of the reference is superseded. Solicitation numbers are not used: one solicitation can span several references.
 */
export function canadaBuysNoticeKey(data: { sourceId?: unknown; externalId?: unknown } | null | undefined): string | null {
  if (data?.sourceId !== 'canadabuys' || typeof data.externalId !== 'string' || !data.externalId.trim()) return null;
  return data.externalId.trim();
}
/** The amendment suffix of a `…:canadabuys:tender:<reference>:<amendment>` record id. */
export function idAmendment(id: string): string {
  try { return decodeURIComponent(id.slice(id.lastIndexOf(':') + 1)); } catch { return id.slice(id.lastIndexOf(':') + 1); }
}
/** Amendment numbers compare as numbers (`010` after `009`); blank (the original notice) first, other text last. */
export function compareAmendments(a: string, b: string): number {
  const rank = (value: string) => value === '' ? -1 : /^\d+$/.test(value) ? Number(value) : Infinity;
  const x = rank(a), y = rank(b);
  return x !== y ? (x < y ? -1 : 1) : a < b ? -1 : a > b ? 1 : 0;
}
const byAmendment = (a: string, b: string) => compareAmendments(idAmendment(a), idAmendment(b)) || (a < b ? -1 : a > b ? 1 : 0);

/** The reference groups with more than one saved row: canonical id (lowest amendment) and superseded ids (ascending). */
export function canadaBuysGroups(rows: readonly { id: string; data: any }[]): { canonical: string; superseded: string[] }[] {
  const groups = new Map<string, string[]>();
  for (const row of rows) { const key = canadaBuysNoticeKey(row.data); if (key) groups.set(key, [...(groups.get(key) ?? []), row.id]); }
  return [...groups.values()].filter(ids => ids.length > 1).map(ids => { const [canonical, ...superseded] = [...ids].sort(byAmendment); return { canonical, superseded }; });
}
/** Superseded CanadaBuys row id → its canonical record id. */
export function canadaBuysMerges(rows: readonly { id: string; data: any }[]): Map<string, string> {
  return new Map(canadaBuysGroups(rows).flatMap(group => group.superseded.map(id => [id, group.canonical] as const)));
}

/**
 * SQL predicate (no parameters) keeping one row per notice or award:
 * - rows `catalog.normalize` marked `mergedInto` are never shown on their own;
 * - awards marked `duplicateOf` (the same award saved twice) are not counted;
 * - CanadaBuys rows other than the canonical one per reference (lowest id: amendment suffixes share one width, and a
 *   blank suffix sorts first) are hidden, read directly from the data;
 * - `crossSource: 'exclude'` also drops notices marked `duplicateOf` (a local-government copy of a BC Bid notice):
 *   use it for totals and all-source lists; a source's own list keeps them.
 */
/** Text every canonical predicate contains, to avoid adding it twice to one statement. */
export const CANONICAL_MARKER = "'$.mergedInto'),";
export function canonicalNoticeSql(alias = '', options: { crossSource?: 'exclude' | 'include'; source?: string } = {}): string {
  const d = alias ? `${alias}.data` : 'data', k = alias ? `${alias}.kind` : 'kind', id = alias ? `${alias}.id` : 'id';
  const f = (key: string, data = d) => `json_extract(${data},'$.${key}')`;
  const current = `SELECT min(id) FROM records WHERE kind='opportunity' AND ${f('sourceId', 'data')}='canadabuys' GROUP BY ${f('externalId', 'data')}`;
  // Null when the row counts: not merged, and (for awards, or for every row when copies are excluded) no duplicateOf.
  const marks = options.crossSource === 'exclude' ? `coalesce(${f('mergedInto')},${f('duplicateOf')}) IS NULL` : `coalesce(${f('mergedInto')},CASE WHEN ${k}='award' THEN ${f('duplicateOf')} END) IS NULL`;
  // Scoped to one source other than CanadaBuys, the amendment rule cannot apply (shorter statement).
  if (options.source && options.source !== 'all' && options.source !== 'canadabuys') return marks;
  return `${marks} AND CASE WHEN ${k}='opportunity' AND ${f('sourceId')}='canadabuys' AND coalesce(${f('externalId')},'')<>'' THEN CASE WHEN ${id} IN (${current}) THEN 1 ELSE 0 END ELSE 1 END=1`;
}

