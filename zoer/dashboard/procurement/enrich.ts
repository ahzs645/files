import { contactsForRecord } from './contacts';
import { placeForRecord } from './places';

/** Bump when place or contact rules change, so the backfill action re-tags records tagged by older rules. */
export const ENRICHMENT_VERSION = 1;
/** Workspace state of the backfill action (procurement.enrich): cursor and running totals. */
export const ENRICHMENT_KEY = 'procurement:enrichment:backfill';
/** Sources whose records get `place`/`contacts` here; connectors set their own from the portal. */
export const ENRICHED_SOURCES = new Set(['bc-bid', 'canadabuys']);
const sourceOf = (data: any) => typeof data?.sourceId === 'string' && data.sourceId ? data.sourceId : 'bc-bid';

/**
 * `place`, `contacts` and an empty `region` for one BC Bid or CanadaBuys record (CONNECTORS.md §3). Pure and
 * idempotent: the same record always gives the same fields, and a region we filled is replaced, never trusted.
 * Records from other sources are returned unchanged.
 */
export function enrichNotice<T extends Record<string, any>>(data: T): T {
  if (!data || !ENRICHED_SOURCES.has(sourceOf(data))) return data;
  const next: Record<string, any> = { ...data };
  const place = placeForRecord(next), contacts = contactsForRecord(next);
  if (place) next.place = place; else delete next.place;
  if (contacts.length) next.contacts = contacts; else delete next.contacts;
  if (next.regionFromPlace) { delete next.region; delete next.regionFromPlace; }
  const label = place?.municipality ?? place?.regionalDistrict;
  if (label && !(typeof next.region === 'string' && next.region.trim())) { next.region = label; next.regionFromPlace = true; }
  return next as T;
}

/** True when enrichNotice would change the saved record (the backfill skips unchanged rows). */
export function enrichmentChanged(data: any): boolean {
  const next = enrichNotice(data);
  return next !== data && JSON.stringify(['place', 'contacts', 'region', 'regionFromPlace'].map(key => next[key])) !==
    JSON.stringify(['place', 'contacts', 'region', 'regionFromPlace'].map(key => data[key]));
}
