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

function validDateOnly(raw: string): boolean {
  const [year, month, day] = raw.split('-').map(Number);
  if (!year || month < 1 || month > 12 || day < 1) return false;
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  return day <= [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
}

/** Preserve source date/time text: timezone-less values never imply expiry. */
export function deadlineLabel(raw: unknown, now: number | Date = Date.now()): string {
  if (typeof raw !== 'string' || !raw.trim()) return 'Not provided';
  const value = raw.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return validDateOnly(value) ? `${value} (date only)` : `${value} (invalid date)`;
  const match = /^(\d{4}-\d{2}-\d{2})[Tt ]([01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d+)?)?([Zz]|[+-](?:[01]\d|2[0-3]):[0-5]\d)?$/.exec(value);
  if (!match || !validDateOnly(match[1])) return `${value} (unrecognized date)`;
  if (!match[3]) return `${value} (timezone not specified)`;
  const time = Date.parse(value);
  if (!Number.isFinite(time)) return `${value} (invalid date)`;
  return `${value}${time < Number(now) ? ' · Deadline passed' : ''}`;
}

export type ProcurementQueryOptions = {
  source?: string;
  kind?: 'all' | 'opportunity' | 'award';
  search?: string;
  region?: string; category?: string; buyer?: string; supplier?: string; classification?: string;
  starred?: boolean;
  deadline?: 'all' | 'week';
  after?: string;
  limit?: number;
};

const field = (key: string) => `json_extract(data, '$.${key}')`;
// CASE keeps compatibility with the host's deliberately small SQL function list.
const source = `coalesce(CASE WHEN ${field('sourceId')}='' THEN NULL ELSE ${field('sourceId')} END, 'bc-bid')`;
const title = `coalesce(${field('description')}, ${field('opportunityDescription')}, ${field('title')}, '')`;
const buyer = `coalesce(${field('issuedBy')}, ${field('issuingOrganization')}, '')`;
const deadline = `CASE WHEN kind='opportunity' THEN coalesce(${field('closingAt')},${field('closingDate')}) ELSE ${field('awardDate')} END`;

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
  if (options.starred) filters.push(`${field('starred')}=1`);
  if (options.search?.trim()) {
    const searchable = [title, buyer, field('externalId'), field('opportunityId'), field('sourceKey'), field('importKey'), field('successfulSupplier'), field('status'), field('region')];
    filters.push(`CASE WHEN ${searchable.map(expression => `coalesce(${expression}, '') LIKE ? ESCAPE '\\'`).join(' OR ')} THEN 1 ELSE 0 END=1`);
    const literal = `%${options.search.trim().replace(/[\\%_]/g, '\\$&')}%`;
    countParameters.push(...searchable.map(() => literal));
  }
  if (options.deadline === 'week') {
    const closing = `coalesce(${field('closingAt')},${field('closingDate')})`;
    filters.push("kind='opportunity'", `lower(coalesce(${field('status')}, '')) IN ('open', 'active')`);
    // SQLite otherwise interprets offset-less input as UTC. Require a source
    // offset first; date-only and unknown-timezone notices are not closing-soon.
    filters.push(`CASE WHEN ${closing} GLOB '????-??-??[Tt ]??:??*[Zz]' OR ${closing} GLOB '????-??-??[Tt ]??:??*[+-]??:??' THEN 1 ELSE 0 END=1`);
    filters.push(`julianday(${closing})>=julianday('now')`, `julianday(${closing})<=julianday('now')+7`);
  }
  const where = filters.join(' AND ');
  const parameters = [...countParameters];
  const cursor = options.after ? ' AND id>?' : '';
  if (options.after) parameters.push(options.after);
  const limit = Number.isFinite(options.limit) ? Math.max(1, Math.min(50, Math.floor(options.limit!))) : 25;
  parameters.push(limit);
  const projection = [
    'id', 'kind', `${title} AS title`, `${source} AS sourceId`,
    ...['sourceKey', 'importKey', 'externalId'].map(key => `${field(key)} AS ${key}`),
    `${buyer} AS buyer`, `${deadline} AS deadline`, `${field('starred')} AS starred`,
    `coalesce(${field('detailUrl')}, ${field('sourceUrl')}) AS sourceUrl`,
    `${field('status')} AS status`, `coalesce(${field('type')}, ${field('opportunityType')}) AS type`,
    `coalesce(${field('region')}, ${field('issuingLocation')}) AS region`,
    `${field('importedAt')} AS importedAt`, `${field('sourceFileName')} AS sourceFileName`,
    'updated_at AS catalogUpdatedAt',
  ];
  return {
    statement: `SELECT ${projection.join(', ')} FROM records WHERE ${where}${cursor} ORDER BY id LIMIT ?`,
    parameters,
    countStatement: `SELECT count(*) AS total FROM records WHERE ${where}`,
    countParameters,
  };
}
