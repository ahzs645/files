import { excludeMatchSql, parseExcludeTerms } from '../procurement/exclude';
import { sql } from '../procurement/display';
import { json, placeholders } from './queries';
import { normalizeDraft } from './profile-types';

/**
 * Company-profile quick filters, checked before any AI call: excluded keywords (same whole-word matching as the
 * Opportunities "Exclude words" filter) and the profile's internal min/max contract value.
 *
 * Values come only from the current extraction's stated buyer budget / estimated value (reviewer-rejected facts
 * dropped, corrections used). Saved notices rarely carry a value, so an unknown value, or one in another currency,
 * always passes; a notice is filtered only when every comparable stated amount is outside the range.
 */
export interface ProfileFilterRules { terms: string[]; min: number | null; max: number | null; currency: string | null }
export type ProfileFilterHit = { kind: 'keyword'; term: string } | { kind: 'above_max' | 'below_min'; amount: number; limit: number; currency: string | null };

export function profileFilterRules(data: unknown): ProfileFilterRules {
  const draft = normalizeDraft(data), c = draft.commercial;
  return { terms: parseExcludeTerms(draft.excludedKeywords.join('\n')), min: c.minContractValue, max: c.maxContractValue, currency: c.currency };
}
export const hasProfileFilters = (rules: ProfileFilterRules | null | undefined) => !!rules && (rules.terms.length > 0 || rules.min != null || rules.max != null);

type Amount = { lower?: unknown; upper?: unknown; currency?: unknown };
const num = (value: unknown) => typeof value === 'number' && Number.isFinite(value) ? value : null;
/** Range check over stated amounts; null when nothing comparable is known (unknown passes). */
export function valueHit(values: Amount[], rules: Pick<ProfileFilterRules, 'min' | 'max' | 'currency'>): ProfileFilterHit | null {
  if (rules.min == null && rules.max == null) return null;
  const comparable = values.map(v => ({ lo: num(v.lower) ?? num(v.upper), hi: num(v.upper) ?? num(v.lower), currency: typeof v.currency === 'string' && v.currency ? v.currency.toUpperCase() : null }))
    .filter(v => v.lo !== null && (!v.currency || !rules.currency || v.currency === rules.currency));
  if (!comparable.length) return null;
  const lo = Math.min(...comparable.map(v => v.lo!)), hi = Math.max(...comparable.map(v => v.hi!));
  if (rules.max != null && lo > rules.max) return { kind: 'above_max', amount: lo, limit: rules.max, currency: rules.currency };
  if (rules.min != null && hi < rules.min) return { kind: 'below_min', amount: hi, limit: rules.min, currency: rules.currency };
  return null;
}

const money = (value: number, currency: string | null) => `${currency ? `${currency} ` : ''}${value.toLocaleString()}`;
export function hitText(hit: ProfileFilterHit): string {
  if (hit.kind === 'keyword') return `excluded keyword “${hit.term}”`;
  return hit.kind === 'above_max' ? `value above max (stated ${money(hit.amount, hit.currency)}; max ${money(hit.limit, hit.currency)})` : `value below min (stated ${money(hit.amount, hit.currency)}; min ${money(hit.limit, hit.currency)})`;
}
export const filterReason = (hits: ProfileFilterHit[]) => hits.length ? `Filtered by profile: ${hits.map(hitText).join('; ')}` : '';

/** First matching excluded keyword per record (1-based term index, 0 = none). ≤150 ids and ≤25 terms keep it under 200 parameters. */
export function keywordHitsSql(terms: string[], count: number) {
  const match = excludeMatchSql(terms);
  return { sql: `SELECT id, ${match.sql} AS term FROM records WHERE id IN (${placeholders(count)})`, parameters: match.parameters };
}
/** Stated buyer budget / estimated value facts from the current extraction, with any reviewer state. */
export const VALUE_FACTS_SQL = (count: number) => `SELECT f.record_id AS id, f.value, rs.state AS reviewState, rs.value AS reviewValue FROM procurement_facts f JOIN procurement_stage_runs s ON s.id=f.stage_run_id LEFT JOIN procurement_review_state rs ON rs.target_type='fact' AND rs.target_id=f.id WHERE s.stage='extract' AND s.is_current=1 AND f.status='stated' AND f.semantic_type IN ('money:buyer_budget','money:buyer_estimated_value') AND f.record_id IN (${placeholders(count)})`;

export async function readProfileRules(profileVersionId: string | null, read: typeof sql = sql): Promise<ProfileFilterRules | null> {
  if (!profileVersionId) return null;
  const [row] = await read('SELECT data FROM procurement_profile_versions WHERE id=?', [profileVersionId]);
  return row ? profileFilterRules(json(row.data, {})) : null;
}

/** Hits per record (only records with at least one hit are in the map). */
export async function readProfileFilterHits(ids: string[], rules: ProfileFilterRules | null, read: typeof sql = sql): Promise<Map<string, ProfileFilterHit[]>> {
  const out = new Map<string, ProfileFilterHit[]>();
  if (!ids.length || !hasProfileFilters(rules)) return out;
  const add = (id: string, hit: ProfileFilterHit) => out.set(id, [...(out.get(id) ?? []), hit]);
  for (let i = 0; i < ids.length; i += 150) {
    const chunk = ids.slice(i, i + 150);
    if (rules!.terms.length) {
      const query = keywordHitsSql(rules!.terms, chunk.length);
      for (const row of await read(query.sql, [...query.parameters, ...chunk])) if (Number(row.term) > 0) add(String(row.id), { kind: 'keyword', term: rules!.terms[Number(row.term) - 1] });
    }
    if (rules!.min != null || rules!.max != null) {
      const values = new Map<string, Amount[]>();
      for (const row of await read(VALUE_FACTS_SQL(chunk.length), chunk)) {
        if (row.reviewState === 'rejected') continue;
        const value = json<any>(row.reviewState === 'corrected' && row.reviewValue != null ? row.reviewValue : row.value, null);
        const amount = value && typeof value === 'object' && 'value' in value && typeof value.value === 'object' ? value.value : value;
        if (amount && typeof amount === 'object') values.set(String(row.id), [...(values.get(String(row.id)) ?? []), amount]);
      }
      for (const [id, list] of values) { const hit = valueHit(list, rules!); if (hit) add(id, hit); }
    }
  }
  return out;
}

/**
 * Pipeline preflight gate: records filtered by the profile are skipped unless the reviewer includes them.
 * `summary` counts skipped records by reason kind for the preflight line.
 */
export function profileGate(ids: string[], hits: Map<string, ProfileFilterHit[]>, include: boolean) {
  const filtered = ids.filter(id => hits.get(id)?.length);
  const kinds = { keyword: 0, value: 0 };
  for (const id of filtered) { const list = hits.get(id)!; if (list.some(h => h.kind === 'keyword')) kinds.keyword++; if (list.some(h => h.kind !== 'keyword')) kinds.value++; }
  return { run: include ? ids : ids.filter(id => !hits.get(id)?.length), filtered, kinds };
}
