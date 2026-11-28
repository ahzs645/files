import { NO_FIXED_DATE_FROM, NO_FIXED_DATE_TEXT, closesWithin, deadlineState, parseDeadline, zoneDate, type DeadlineState } from './deadline';

export { NO_FIXED_DATE_FROM, NO_FIXED_DATE_TEXT };

/**
 * The effective lifecycle of a notice: one rule for every list, card, count and SQL query.
 *
 * Sources keep saying "Open" long after the closing date (BC Bid for weeks, the CanadaBuys dataset until the notice is
 * dropped), so the stored source status is never trusted on its own:
 *
 * 1. A source status naming a cancellation (cancelled, withdrawn, terminated, rescinded) → `cancelled`.
 * 2. A source status naming an award → `awarded`.
 * 3. A source status saying bidding ended (closed, expired, evaluating, under review, processing, complete, archived)
 *    → `closed`, even before the closing date (the source closed it early).
 * 4. A placeholder closing date ("no fixed date": standing offers, supply arrangements and pre-qualification lists
 *    posted with 2074 or 2100 as the end) never closes → `open` (or `unknown` without an accepting status). It is a
 *    readable date on or after 2036-01-01, or the collectors' shape `closingDate: null` + `closingDateRaw` +
 *    `closingDatePlaceholder: true`.
 * 5. Otherwise the closing date decides: `closingAt`, else the raw `closingDate` (`catalog.normalize` fills a missing
 *    `closingAt` from a source text date such as "Fri Nov 20, 2026 2:00 PM (YST)"). Only ISO values are read
 *    (deadline.ts): an instant closes when it passes; a date or a timestamp without a zone closes after its calendar
 *    day in America/Vancouver.
 *    - No readable closing date → `unknown`.
 *    - A passed closing date → `closed`, whatever the source status says.
 *    - Otherwise `open` when the source says it accepts bids (open, active, published), else `unknown` (no status, or an unrecognized one such as "N/A").
 *
 * Open lists keep the source-open opportunities whose closing date is unknown (`listedOpen`): an unreadable date never
 * hides or closes a notice. `effectiveStatusSql`/`listedOpenSql` express exactly the same rule in host SQL.
 */
export type EffectiveStatus = 'open' | 'closed' | 'awarded' | 'cancelled' | 'unknown';
export const OPPORTUNITY_LIFECYCLE_VERSION = 'opportunity-lifecycle-v3';

/** Statuses that accept bids, compared lower-case and exact. A blank or missing status is not a claim either way. */
export const ACCEPTING_STATUSES = ['open', 'active', 'published'] as const;
/** Substrings of a lower-cased status, checked in this order (SQL uses the same words with LIKE). */
export const CANCELLED_WORDS = ['cancel', 'withdrawn', 'terminated', 'rescinded'] as const;
export const AWARDED_WORDS = ['award'] as const;
export const ENDED_WORDS = ['closed', 'expired', 'evaluat', 'review', 'processing', 'complete', 'archived'] as const;

/**
 * `closingDatePlaceholder`/`closingDateRaw`: collectors store a placeholder closing date as `closingDate: null`,
 * `closingDateRaw: <source text>`, `closingDatePlaceholder: true` (CONNECTORS.md); older rows keep the raw date.
 */
export type OpportunityLifecycleInput = { status?: unknown; closingAt?: unknown; closingDate?: unknown; closingDateRaw?: unknown; closingDatePlaceholder?: unknown; deadline?: unknown };

const text = (value: unknown) => typeof value === 'string' ? value : '';
const sourceStatusText = (status: unknown) => text(status).toLowerCase();
export const acceptingStatus = (status: unknown) => (ACCEPTING_STATUSES as readonly string[]).includes(sourceStatusText(status));

/**
 * The closing value the rule reads: the first of `closingAt`, `closingDate`, `deadline` that is present (as SQL
 * coalesce: a blank `closingAt` is a present, unreadable value; collectors never store one). `catalog.normalize`
 * fills a missing `closingAt` from a source text date, so text dates become readable without a second field.
 */
export function closingValue(row: OpportunityLifecycleInput): string {
  for (const value of [row.closingAt, row.closingDate, row.deadline]) if (typeof value === 'string') return value;
  return '';
}
/** A placeholder closing date: flagged by the collector, or a readable date on or after 2036-01-01. */
export const placeholderClosing = (row: OpportunityLifecycleInput) => row.closingDatePlaceholder === true || isNoFixedDate(closingValue(row));
/** A placeholder end date: a readable closing date on or after 2036-01-01. */
export function isNoFixedDate(raw: unknown): boolean {
  const parsed = parseDeadline(raw);
  return !!parsed && parsed.date >= NO_FIXED_DATE_FROM;
}

export interface EffectiveLifecycle {
  status: EffectiveStatus;
  /** The source says it accepts bids (see ACCEPTING_STATUSES). */
  accepting: boolean;
  /** Shown in open lists: effectively open, or source-open with an unknown closing date. */
  listedOpen: boolean;
  noFixedDate: boolean;
  closing: string;
  state: DeadlineState;
}

export function effectiveLifecycle(row: OpportunityLifecycleInput, now: number | Date = Date.now()): EffectiveLifecycle {
  const status = sourceStatusText(row.status), accepting = acceptingStatus(row.status);
  const closing = closingValue(row), noFixedDate = placeholderClosing(row);
  const state = deadlineState(closing, now);
  const result = (value: EffectiveStatus): EffectiveLifecycle => ({ status: value, accepting, listedOpen: accepting && (value === 'open' || value === 'unknown'), noFixedDate, closing, state });
  if (CANCELLED_WORDS.some(word => status.includes(word))) return result('cancelled');
  if (AWARDED_WORDS.some(word => status.includes(word))) return result('awarded');
  if (ENDED_WORDS.some(word => status.includes(word))) return result('closed');
  if (noFixedDate) return result(accepting ? 'open' : 'unknown');
  if (state === 'unknown') return result('unknown');
  if (state === 'closed') return result('closed');
  return result(accepting ? 'open' : 'unknown');
}

/** "open" | "closed" | "awarded" | "cancelled" | "unknown" — see the rule above. */
export const effectiveStatus = (row: OpportunityLifecycleInput, now: number | Date = Date.now()): EffectiveStatus => effectiveLifecycle(row, now).status;

export type OpportunityLifecycle = { state: DeadlineState; status: EffectiveStatus; open: boolean; closingSoon: boolean; noFixedDate: boolean; sourceStatus: 'open' | 'closed' | 'unknown'; reason: 'source_closed' | 'deadline_passed' | 'source_open' | 'unverified_status' };
/** Compatibility view over `effectiveLifecycle` for lists and counts: `open` is `listedOpen`. */
export function opportunityLifecycle(row: OpportunityLifecycleInput, asOf: number | Date = Date.now(), days = 7): OpportunityLifecycle {
  const life = effectiveLifecycle(row, asOf);
  const sourceEnded = [...CANCELLED_WORDS, ...AWARDED_WORDS, ...ENDED_WORDS].some(word => sourceStatusText(row.status).includes(word));
  const sourceStatus = sourceEnded ? 'closed' : life.accepting ? 'open' : 'unknown';
  const base = { status: life.status, noFixedDate: life.noFixedDate, sourceStatus } as const;
  if (sourceEnded) return { ...base, state: 'closed', open: false, closingSoon: false, reason: 'source_closed' };
  if (life.status === 'closed') return { ...base, state: 'closed', open: false, closingSoon: false, reason: 'deadline_passed' };
  if (!life.listedOpen) return { ...base, state: 'unknown', open: false, closingSoon: false, reason: 'unverified_status' };
  return { ...base, state: life.state === 'unknown' ? 'open' : life.state, open: true, closingSoon: !life.noFixedDate && closesWithin(life.closing, days, asOf), reason: 'source_open' };
}

// ---------------------------------------------------------------------------------------------
// The same rule in host SQL (validator: only count/sum/avg/min/max/length/lower/upper/json_extract/coalesce/julianday/
// cast as functions, no keyword directly before "(", no FROM/JOIN subqueries).
// ---------------------------------------------------------------------------------------------

export type SqlFragment = { sql: string; parameters: (string | number)[] };
const quote = (value: string) => `'${value.replace(/'/g, "''")}'`;
const columns = (alias = '') => {
  const data = alias ? `${alias}.data` : 'data';
  const field = (key: string) => `json_extract(${data},'$.${key}')`;
  return { field };
};
/** The closing value expression (`closingValue`): coalesce of `closingAt` and `closingDate`. */
export function closingValueSql(alias = '') {
  const { field } = columns(alias);
  return `coalesce(${field('closingAt')},${field('closingDate')})`;
}
/**
 * Parts of the rule over the closing expression `v` and the lower-cased status. Kept short: the host refuses statements
 * over 10,000 characters and list queries combine several of these.
 */
function ruleParts(alias: string) {
  const { field } = columns(alias), v = closingValueSql(alias), s = `lower(coalesce(${field('status')},''))`;
  const like = (words: readonly string[]) => words.map(word => `${s} LIKE ${quote(`%${word}%`)}`).join(' OR ');
  return {
    cancelled: like(CANCELLED_WORDS), awarded: like(AWARDED_WORDS), ended: like(ENDED_WORDS),
    accepting: `${s} IN (${ACCEPTING_STATUSES.map(quote).join(',')})`,
    // An ISO date prefix (parseDeadline's forms); blank, missing and free text are unknown.
    readable: `${v} GLOB '[0-9][0-9][0-9][0-9]-*'`,
    datedBefore2036: `${v}<${quote(NO_FIXED_DATE_FROM)}`,
    // The collectors' placeholder shape (closingDate null): unreadable to `v`, so open lists keep it anyway.
    placeholder: `${field('closingDatePlaceholder')}=1 OR CASE WHEN ${v} GLOB '[0-9][0-9][0-9][0-9]-*' AND ${v}>=${quote(NO_FIXED_DATE_FROM)} THEN 1 ELSE 0 END=1`,
    // A time followed by Z or an offset is an instant (julianday reads it, compared with the as-of julian day);
    // otherwise the calendar day against today in Vancouver.
    passed: `CASE WHEN ${v} GLOB '*:[0-9][0-9]*[Zz+-]*' THEN julianday(${v})<? ELSE ${v}<? END`,
  };
}
/** [as-of julian day, today's date in Vancouver] for `passed`. */
const asOfParameters = (asOf: number) => [asOf / 86_400_000 + 2_440_587.5, zoneDate(asOf)];

/** CASE expression yielding 'open' | 'closed' | 'awarded' | 'cancelled' | 'unknown', mirroring `effectiveStatus`. */
export function effectiveStatusSql(asOf: number = Date.now(), alias = ''): SqlFragment {
  const p = ruleParts(alias);
  return {
    sql: `CASE WHEN ${p.cancelled} THEN 'cancelled' WHEN ${p.awarded} THEN 'awarded' WHEN ${p.ended} THEN 'closed' WHEN ${p.placeholder} THEN CASE WHEN ${p.accepting} THEN 'open' ELSE 'unknown' END WHEN coalesce(${p.readable},0)=0 THEN 'unknown' WHEN ${p.datedBefore2036} AND ${p.passed} THEN 'closed' WHEN ${p.accepting} THEN 'open' ELSE 'unknown' END`,
    parameters: asOfParameters(asOf),
  };
}
/** The source says it accepts bids (ACCEPTING_STATUSES), as SQL; no parameters. */
export const acceptingSql = (alias = '') => ruleParts(alias).accepting;
/** Predicate for open lists and counts (`listedOpen`): a source-open opportunity that has not closed. */
export function listedOpenSql(asOf: number = Date.now(), alias = ''): SqlFragment {
  const p = ruleParts(alias), kind = alias ? `${alias}.kind` : 'kind';
  // Accepting statuses never contain the cancelled/awarded/ended words; unknown and placeholder dates stay listed.
  return {
    sql: `${kind}='opportunity' AND ${p.accepting} AND CASE WHEN ${p.readable} AND ${p.datedBefore2036} AND ${p.passed} THEN 0 ELSE 1 END=1`,
    parameters: asOfParameters(asOf),
  };
}
