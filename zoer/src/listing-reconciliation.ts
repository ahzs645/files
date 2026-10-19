/**
 * Listing completeness for the full BC Bid crawl. Rows read, distinct opportunities and the publisher's
 * displayed total stay separate facts: duplicates are reported, never dropped, and a shortfall is a count,
 * never invented rows. Pure, so the dashboard can label a saved checkpoint without the crawler.
 */
export interface SourceTotal { value: number | null; label: string | null; kind: 'exact' | 'lower-bound' | 'unavailable' }
/** 1-based page and row of one appearance in the Open listing. */
export interface Position { page: number; row: number }
/** First appearance, then every later one. */
export interface DuplicateAppearance { sourceKey: string; appearances: Position[] }
export interface ListingEvidence {
  /** Read from page 1; null until it is captured. */
  sourceReportedTotal: SourceTotal | null;
  /** A later page's different total label: the listing moved while paging. */
  totalChangedTo: string | null;
  /** Row appearances read on each saved page (index = page - 1). */
  pageRows: number[];
  duplicateAppearances: DuplicateAppearance[];
  /** Ordered row identities of the last saved page, to spot a pager that advanced before its rows. */
  lastPageFingerprint: string | null;
}
export type ReconciliationStatus = 'complete' | 'short' | 'over' | 'unknown';
export interface ListingReconciliation {
  status: ReconciliationStatus; reason: string; identityRule: 'bc-bid-process-id';
  sourceReportedTotal: SourceTotal; rawRowsCaptured: number | null; uniqueIdentitiesCaptured: number;
  /** Distinct opportunities minus an exact published total; null when there is none to compare. */
  difference: number | null; pagesCaptured: number | null; duplicateAppearances: DuplicateAppearance[];
}
/** More repeats than this means the listing is not holding still; the crawl stops rather than grow its checkpoint. */
export const MAX_REPEATED_APPEARANCES = 300;

export const emptyListingEvidence = (): ListingEvidence => ({ sourceReportedTotal: null, totalChangedTo: null, pageRows: [], duplicateAppearances: [], lastPageFingerprint: null });
export const repeatedAppearances = (evidence: ListingEvidence) => evidence.duplicateAppearances.reduce((sum, item) => sum + item.appearances.length - 1, 0);
const UNAVAILABLE: SourceTotal = { value: null, label: null, kind: 'unavailable' };

export function sourceTotal(counts: { totalReported: number | null; reportedCountLabel?: string | null; reportedLowerBound?: number | null }): SourceTotal {
  if (counts.reportedLowerBound != null) return { value: counts.reportedLowerBound, label: counts.reportedCountLabel ?? null, kind: 'lower-bound' };
  if (counts.totalReported != null) return { value: counts.totalReported, label: counts.reportedCountLabel ?? null, kind: 'exact' };
  return UNAVAILABLE;
}

/** Where each identity first appeared. Valid while knownKeys is still in listing order (the listing phase). */
export function firstPositions(evidence: ListingEvidence, knownKeys: string[]) {
  const repeats = new Set(evidence.duplicateAppearances.flatMap(item => item.appearances.slice(1).map(at => `${at.page}:${at.row}`)));
  const first = new Map<string, Position>();
  let cursor = 0;
  evidence.pageRows.forEach((count, index) => {
    for (let row = 1; row <= count; row++) if (!repeats.has(`${index + 1}:${row}`)) first.set(knownKeys[cursor++], { page: index + 1, row });
  });
  return first;
}

const position = (value: any, pageRows: number[]) => Number.isInteger(value?.page) && Number.isInteger(value?.row) && value.page >= 1 &&
  value.page <= pageRows.length && value.row >= 1 && value.row <= pageRows[value.page - 1];
const total = (value: any) => value === null || (['exact', 'lower-bound', 'unavailable'].includes(value?.kind) &&
  (value.value === null || (Number.isInteger(value.value) && value.value >= 0)) && (value.label === null || (typeof value.label === 'string' && value.label.length < 200)));
/** Every row read is either a new identity or a recorded repeat, so the counts must add up. */
export function validListingEvidence(value: any, currentPage: number, knownKeys: string[]) {
  if (!value || !total(value.sourceReportedTotal) || !(value.totalChangedTo === null || (typeof value.totalChangedTo === 'string' && value.totalChangedTo.length < 200)) ||
    !(value.lastPageFingerprint === null || /^[0-9a-f]{16}$/.test(value.lastPageFingerprint)) || !Array.isArray(value.pageRows) || value.pageRows.length !== currentPage ||
    !value.pageRows.every((count: unknown) => Number.isInteger(count) && (count as number) >= 0 && (count as number) <= 200) || !Array.isArray(value.duplicateAppearances)) return false;
  const known = new Set(knownKeys), seen = new Set<string>(), positions = new Set<string>();
  for (const item of value.duplicateAppearances) {
    if (!known.has(item?.sourceKey) || seen.has(item.sourceKey) || !Array.isArray(item.appearances) || item.appearances.length < 2 ||
      !item.appearances.every((at: any) => position(at, value.pageRows) && !positions.has(`${at.page}:${at.row}`) && positions.add(`${at.page}:${at.row}`))) return false;
    seen.add(item.sourceKey);
  }
  const repeats = repeatedAppearances(value);
  return repeats <= MAX_REPEATED_APPEARANCES && value.pageRows.reduce((sum: number, count: number) => sum + count, 0) - repeats === knownKeys.length;
}

export function reconcileListing(evidence: ListingEvidence | null, uniqueIdentitiesCaptured: number, listingFinished: boolean): ListingReconciliation {
  const base = { identityRule: 'bc-bid-process-id' as const, uniqueIdentitiesCaptured, difference: null };
  if (!evidence) return { ...base, status: 'unknown', reason: 'This progress was saved before listing counts were recorded, so completeness cannot be checked.',
    sourceReportedTotal: UNAVAILABLE, rawRowsCaptured: null, pagesCaptured: null, duplicateAppearances: [] };
  const counts = { ...base, sourceReportedTotal: evidence.sourceReportedTotal ?? UNAVAILABLE, rawRowsCaptured: evidence.pageRows.reduce((sum, count) => sum + count, 0),
    pagesCaptured: evidence.pageRows.length, duplicateAppearances: evidence.duplicateAppearances };
  const { value, label, kind } = counts.sourceReportedTotal;
  const distinct = `${uniqueIdentitiesCaptured.toLocaleString('en-CA')} distinct ${uniqueIdentitiesCaptured === 1 ? 'opportunity was' : 'opportunities were'} captured`;
  if (!listingFinished) return { ...counts, status: 'unknown', reason: 'Listing pages are still being read.' };
  if (evidence.totalChangedTo) return { ...counts, status: 'unknown', reason: `BC Bid's total changed from "${label}" to "${evidence.totalChangedTo}" while paging; ${distinct}.` };
  if (kind === 'unavailable' || value === null) return { ...counts, status: 'unknown', reason: `BC Bid did not display a record total; ${distinct}.` };
  if (kind === 'lower-bound') return uniqueIdentitiesCaptured <= value
    ? { ...counts, status: 'short', reason: `BC Bid reported "${label}"; ${distinct}.` }
    : { ...counts, status: 'unknown', reason: `BC Bid reported only a lower bound ("${label}"); ${distinct}, which cannot be confirmed complete.` };
  const difference = uniqueIdentitiesCaptured - value;
  const status = difference === 0 ? 'complete' : difference < 0 ? 'short' : 'over';
  return { ...counts, status, difference, reason: `BC Bid reported ${value.toLocaleString('en-CA')}; ${distinct}.` };
}

/** One line for the run receipt. */
export function reconciliationSummary(result: ListingReconciliation) {
  const repeats = result.duplicateAppearances.reduce((sum, item) => sum + item.appearances.length - 1, 0);
  const read = result.rawRowsCaptured === null ? '' : ` (${result.rawRowsCaptured.toLocaleString('en-CA')} rows read${repeats ? `, ${repeats} repeated` : ''})`;
  const heading = { complete: 'Listing count matches BC Bid', short: 'Listing count short', over: 'Listing count over', unknown: 'Listing completeness unknown' }[result.status];
  return `${heading}: ${result.reason}${read}`;
}
