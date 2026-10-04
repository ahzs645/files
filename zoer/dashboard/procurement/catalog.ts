import { CLOSING_TODAY_TEXT, addDays, deadlineState, parseDeadline, zoneDate } from './deadline';
import { excludeSql } from './exclude';
import { HIDDEN_IDS_SQL } from './state-contract';

export type ProcurementSource = {
  id: string;
  label: string;
  jurisdiction: string;
  description: string;
  mode: 'scraper' | 'csv-import' | 'planned';
  url: string;
};

export const SOURCES: readonly ProcurementSource[] = [
  { id: 'bc-bid', label: 'BC Bid', jurisdiction: 'British Columbia', description: 'Saved BC Bid opportunities and contract awards.', mode: 'scraper', url: 'https://bcbid.gov.bc.ca' },
  { id: 'canadabuys', label: 'CanadaBuys', jurisdiction: 'Canada', description: 'Federal notices collected from the official dataset or imported from CSV files.', mode: 'csv-import', url: 'https://canadabuys.canada.ca/en/tender-opportunities' },
  { id: 'bidsandtenders', label: 'bids&tenders (BC)', jurisdiction: 'British Columbia', description: 'Open notices from BC municipalities, regional districts and other public buyers on bids&tenders.', mode: 'scraper', url: 'https://bidsandtenders.com' },
  { id: 'municipal-sites', label: 'BC local government websites', jurisdiction: 'British Columbia', description: 'Bids listed on the own websites of BC municipalities and regional districts that publish them outside BC Bid and bids&tenders.', mode: 'scraper', url: 'https://rdn.bc.ca/current-bid-opportunities' },
];

export function sourceId(data: { sourceId?: unknown } | null | undefined): string {
  return typeof data?.sourceId === 'string' && data.sourceId !== '' ? data.sourceId : 'bc-bid';
}

export function safeSourceUrl(raw: unknown): string | null {
  if (typeof raw !== 'string' || !raw.trim()) return null;
  try {
    const url = new URL(raw);
    return url.protocol === 'https:' && !url.username && !url.password ? url.href : null;
  } catch { return null; }
}

/** Preserve source date/time text and add the shared open/closed judgement (see deadline.ts). */
export function deadlineLabel(raw: unknown, now: number | Date = Date.now()): string {
  if (typeof raw !== 'string' || !raw.trim()) return 'Not provided';
  const value = raw.trim(), parsed = parseDeadline(value), state = deadlineState(value, now);
  const judgement = state === 'closed' ? ' · Deadline passed' : state === 'closing_today_time_unverified' ? ` · ${CLOSING_TODAY_TEXT}` : '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return parsed ? `${value} (date only)${judgement}` : `${value} (invalid date)`;
  if (!parsed) return `${value} (unrecognized date)`;
  return parsed.precision === 'date' ? `${value} (timezone not specified)${judgement}` : `${value}${judgement}`;
}

export type ProcurementQueryOptions = {
  source?: string;
  kind?: 'all' | 'opportunity' | 'award';
  search?: string;
  region?: string; category?: string; buyer?: string; supplier?: string; classification?: string;
  /** BC place (places.ts): `m:<municipality>` or `rd:<regional district>`. */
  place?: string;
  /** An AI label from a successful categorizing review (not an on-demand evidence run). */
  aiLabel?: string;
  starred?: boolean;
  deadline?: 'all' | 'week';
  /** Exclude words (exclude.ts); comma/line separated. */
  exclude?: string;
  /**
   * Notices hidden as "not relevant" (`procurement:hidden:*` workspace keys). Omitted = no hidden handling (other
   * callers keep their rows); the Opportunities list passes `exclude` by default. Adds a `hidden` column.
   */
  hidden?: 'exclude' | 'include' | 'only';
  /** Frozen "now" for deadline filters (tests); defaults to the current time. */
  asOf?: number;
  after?: string;
  limit?: number;
  /**
   * `id` pages by cursor (`after`); other sorts page by `offset`. `date-asc` lists upcoming
   * dates soonest first, then passed dates, then undated notices.
   */
  sort?: 'id' | 'date-desc' | 'date-asc' | 'updated';
  offset?: number;
  /** Extra parameterized WHERE fragment (review-workspace filters) over unaliased `records`. */
  where?: { sql: string; parameters: (string | number)[] };
  /** Custom parameterized ORDER BY (pages by offset like the dated sorts); overrides `sort`'s order. */
  order?: { sql: string; parameters: (string | number)[] };
};

const field = (key: string) => `json_extract(data, '$.${key}')`;
// CASE keeps compatibility with the host's deliberately small SQL function list.
const source = `coalesce(CASE WHEN ${field('sourceId')}='' THEN NULL ELSE ${field('sourceId')} END, 'bc-bid')`;
const title = `coalesce(${field('description')}, ${field('opportunityDescription')}, ${field('title')}, '')`;
const buyer = `coalesce(${field('issuedBy')}, ${field('issuingOrganization')}, '')`;
/** SQL test for a value with an explicit UTC offset (an instant). */
export const zonedSql = (value: string) => `${value} GLOB '????-??-??[Tt ]??:??*[Zz]' OR ${value} GLOB '????-??-??[Tt ]??:??*[+-]??:??'`;
/**
 * Sort key: 0 upcoming, 1 passed, 2 undated; takes today's America/Vancouver date as one parameter. Date-only
 * and timezone-less values count as passed only after their calendar day, never at UTC midnight.
 */
export const passedOrder = (value: string) => `CASE WHEN coalesce(${value}, '')='' THEN 2 WHEN ${zonedSql(value)} THEN CASE WHEN julianday(${value}) < julianday('now') THEN 1 ELSE 0 END WHEN ${value} < ? THEN 1 ELSE 0 END`;
const deadline = `CASE WHEN kind='opportunity' THEN coalesce(${field('closingAt')},${field('closingDate')}) ELSE ${field('awardDate')} END`;

/** The host bridge rejects longer statements with a generic message; say what to change instead. */
export const STATEMENT_LIMIT = 10_000;
export function checkStatementSize(...statements: string[]) {
  if (statements.some(statement => statement.length > STATEMENT_LIMIT)) throw Error('Too many filters for one query. Remove some exclude words or other filters and try again.');
}

/** Read-only, bounded catalog query. Counts retain filters but ignore the cursor. */
export function buildProcurementQuery(options: ProcurementQueryOptions = {}) {
  const filters = ["kind IN ('opportunity', 'award')"];
  const countParameters: (string | number)[] = [];
  if (options.kind && options.kind !== 'all') {
    filters.push('kind=?'); countParameters.push(options.kind);
  }
  if (options.source && options.source !== 'all') {
    filters.push(`${source}=?`); countParameters.push(options.source);
  }
  for (const [key,expression] of [['region', `coalesce(${field('region')},${field('issuingLocation')},'')`],['category',`coalesce(${field('category')},${field('classification')},'')`],['buyer',buyer],['supplier',`coalesce(${field('successfulSupplier')},'')`],['classification', `coalesce(CASE WHEN ${field('classificationCodes')}='' OR ${field('classificationCodes')}='[]' THEN NULL ELSE ${field('classificationCodes')} END, CASE WHEN ${field('commodities')}='' OR ${field('commodities')}='[]' THEN NULL ELSE ${field('commodities')} END, ${field('sourceCategory')},${field('category')},'')`]] as const) { if (options[key] !== undefined && options[key] !== '') {filters.push(`${expression}=?`);countParameters.push(options[key]!);} }
  const place = options.place?.match(/^(m|rd):(.+)$/);
  if (place) { filters.push(`${field(place[1] === 'm' ? 'place.municipality' : 'place.regionalDistrict')}=?`); countParameters.push(place[2]); }
  if (options.starred) filters.push(`${field('starred')}=1`);
  if (options.aiLabel?.trim()) {
    filters.push(`id IN (SELECT record_id FROM reviews WHERE status='succeeded' AND prompt_id NOT LIKE 'procurement:%' AND json_extract(result, '$.labels') LIKE ? ESCAPE '\\')`);
    countParameters.push(`%${JSON.stringify(options.aiLabel.trim()).replace(/[\\%_]/g, '\\$&')}%`);
  }
  if (options.search?.trim()) {
    const searchable = [title, buyer, field('externalId'), field('opportunityId'), field('sourceKey'), field('importKey'), field('successfulSupplier'), field('status'), field('region')];
    filters.push(`CASE WHEN ${searchable.map(expression => `coalesce(${expression}, '') LIKE ? ESCAPE '\\'`).join(' OR ')} THEN 1 ELSE 0 END=1`);
    const literal = `%${options.search.trim().replace(/[\\%_]/g, '\\$&')}%`;
    countParameters.push(...searchable.map(() => literal));
  }
  const excluded = excludeSql(options.exclude);
  if (excluded) { filters.push(excluded.sql); countParameters.push(...excluded.parameters); }
  if (options.hidden === 'exclude') filters.push(`id NOT IN (${HIDDEN_IDS_SQL})`);
  else if (options.hidden === 'only') filters.push(`id IN (${HIDDEN_IDS_SQL})`);
  const today = zoneDate(options.asOf ?? Date.now());
  if (options.deadline === 'week') {
    const closing = `coalesce(${field('closingAt')},${field('closingDate')})`;
    filters.push("kind='opportunity'", `lower(coalesce(${field('status')}, '')) IN ('open', 'active')`);
    // SQL approximation of deadlineState (deadline.ts): values with an explicit offset compare as instants
    // (SQLite would read offset-less input as UTC). Date-only and timezone-less values compare by calendar
    // date against today in America/Vancouver, so a same-day date-only notice stays listed (time unverified).
    filters.push(`CASE WHEN ${zonedSql(closing)} THEN CASE WHEN julianday(${closing})>=julianday('now') AND julianday(${closing})<=julianday('now')+7 THEN 1 ELSE 0 END WHEN ${closing} GLOB '????-??-??*' THEN CASE WHEN ${closing}>=? AND ${closing}<? THEN 1 ELSE 0 END ELSE 0 END=1`);
    countParameters.push(today, addDays(today, 8));
  }
  if (options.where?.sql && options.where.sql !== '1=1') { filters.push(options.where.sql); countParameters.push(...options.where.parameters); }
  const where = filters.join(' AND ');
  const parameters = [...countParameters];
  const dated = options.sort === 'date-desc' || options.sort === 'date-asc' || options.sort === 'updated' || !!options.order;
  const cursor = options.after && !dated ? ' AND id>?' : '';
  if (cursor) parameters.push(options.after!);
  if (options.order) parameters.push(...options.order.parameters);
  else if (options.sort === 'date-asc') parameters.push(today);
  const limit = Number.isFinite(options.limit) ? Math.max(1, Math.min(50, Math.floor(options.limit!))) : 25;
  parameters.push(limit);
  const offset = dated && Number.isFinite(options.offset) ? Math.max(0, Math.min(100_000, Math.floor(options.offset!))) : 0;
  if (dated) parameters.push(offset);
  const order = options.order ? options.order.sql : options.sort === 'updated' ? 'updated_at DESC, id'
    : options.sort === 'date-asc' ? `${passedOrder(deadline)}, ${deadline} ASC, id`
    : dated ? `CASE WHEN coalesce(${deadline}, '')='' THEN 1 ELSE 0 END, coalesce(${deadline}, '') DESC, id` : 'id';
  const projection = [
    'id', 'kind', `${title} AS title`, `${source} AS sourceId`,
    ...['sourceKey', 'importKey', 'externalId'].map(key => `${field(key)} AS ${key}`),
    `${buyer} AS buyer`, `${deadline} AS deadline`, `${field('starred')} AS starred`,
    `coalesce(${field('detailUrl')}, ${field('sourceUrl')}) AS sourceUrl`,
    `${field('status')} AS status`, `coalesce(${field('type')}, ${field('opportunityType')}) AS type`,
    `coalesce(${field('region')}, ${field('issuingLocation')}) AS region`,
    `${field('importedAt')} AS importedAt`, `${field('sourceFileName')} AS sourceFileName`,
    'updated_at AS catalogUpdatedAt',
    ...(options.hidden ? [options.hidden === 'exclude' ? '0 AS hidden' : options.hidden === 'only' ? '1 AS hidden' : `CASE WHEN id IN (${HIDDEN_IDS_SQL}) THEN 1 ELSE 0 END AS hidden`] : []),
  ];
  return {
    statement: `SELECT ${projection.join(', ')} FROM records WHERE ${where}${cursor} ORDER BY ${order} LIMIT ?${dated ? ' OFFSET ?' : ''}`,
    parameters,
    countStatement: `SELECT count(*) AS total FROM records WHERE ${where}`,
    countParameters,
    /** The WHERE clause alone (over unaliased `records`), for snapshots and matrix counts; parameters = countParameters. */
    where,
  };
}
