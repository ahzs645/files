/**
 * The same contract award saved more than once. BC Bid's public award history lists some awards twice (consecutive
 * award ids, or a migrated listing next to the current one, sometimes with a re-typed description), so totals counted
 * them twice. Two rows are one award when source, opportunity, supplier, award date, contract value and contract
 * number all agree (case and spacing ignored).
 *
 * - "Migrated Supplier" rows carry the real supplier in `supplierAddress` ("Successful Supplier: X Supplier Address:
 *   …"); that name is used.
 * - Placeholder suppliers (blank, "N/A", "TBD", "Please see metrovancouver.org", a migrated row without a name) never
 *   make two rows the same award: a qualification list with 19 unnamed suppliers is 19 awards.
 * - Different contract numbers are different contracts (a standing offer split into service areas SA1…SA12).
 *
 * The earliest record id of a group is kept. `catalog.normalize` marks the others `duplicateOf` (nothing is deleted);
 * analysis that reads every award collapses with the same key before it runs.
 */
export const AWARD_DUPLICATE_RULE = 'award-duplicate-v1';
const PLACEHOLDER = /^(?:|n\/?a|none|tbd|tba|various|multiple|unknown|migrated supplier|please see\b.*|see\b.*)$/;
const squash = (value: unknown) => typeof value === 'string' ? value.toLowerCase().replace(/\s+/g, ' ').trim() : typeof value === 'number' && Number.isFinite(value) ? String(value) : '';

export interface AwardRow { opportunityId?: unknown; successfulSupplier?: unknown; supplierAddress?: unknown; awardDate?: unknown; contractValue?: unknown; contractNumber?: unknown; sourceId?: unknown }

/** The supplier an award names, reading the real name out of a "Migrated Supplier" row. */
export function awardSupplierName(row: AwardRow): string {
  let name = typeof row.successfulSupplier === 'string' ? row.successfulSupplier : '';
  if (squash(name) === 'migrated supplier') name = /^\s*Successful Supplier:\s*([\s\S]*?)\s*Supplier Address:/i.exec(typeof row.supplierAddress === 'string' ? row.supplierAddress : '')?.[1] ?? '';
  return squash(name).replace(/\.$/, '');
}

/** One key per award, or null when the row cannot be told apart from a different award (see above). */
export function awardDuplicateKey(row: AwardRow): string | null {
  const supplier = awardSupplierName(row), opportunity = squash(row.opportunityId), date = squash(row.awardDate);
  if (PLACEHOLDER.test(supplier) || !opportunity || !date) return null;
  return [squash(row.sourceId) || 'bc-bid', opportunity, supplier, date, squash(row.contractValue), squash(row.contractNumber)].join('\u0001');
}

/** Duplicate award record id → the kept record id, from `{ id, data }` rows. */
export function awardDuplicates(rows: readonly { id: string; data: AwardRow }[]): Map<string, string> {
  const kept = new Map<string, string>(), result = new Map<string, string>();
  for (const row of [...rows].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0)) {
    const key = awardDuplicateKey(row.data);
    if (!key) continue;
    const first = kept.get(key);
    if (first) result.set(row.id, first); else kept.set(key, row.id);
  }
  return result;
}

/**
 * Awards for analysis, one row per award: rows marked `duplicateOf` are dropped, then the key above collapses rows not
 * yet marked. `id` reads a row's record id (for the earliest-id choice).
 */
export function collapseAwardDuplicates<T extends AwardRow & { duplicateOf?: unknown }>(rows: readonly T[], id: (row: T) => string): T[] {
  const unmarked = rows.filter(row => row.duplicateOf == null);
  const duplicates = awardDuplicates(unmarked.map(row => ({ id: id(row), data: row })));
  return duplicates.size ? unmarked.filter(row => !duplicates.has(id(row))) : unmarked;
}
