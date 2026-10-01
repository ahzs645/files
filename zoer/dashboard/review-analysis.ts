/**
 * Aggregates saved AI review results across records: one summary per output field, AI label counts,
 * review coverage by source, and reviewed opportunities that close soon.
 */
import { fieldLabel } from './procurement/ai';
import { passedOrder } from './procurement/catalog';
import { closesWithin, deadlineSortTime, deadlineState, zoneDate, type DeadlineState } from './procurement/deadline';
import { DEFAULT_SCALE, MONEY_ROLE_LABELS, checkFields, fieldValue, moneyRole, parsePrompt, type ReviewField } from './review-fields';

type Query = (method: 'catalog.query', input: { statement: string; parameters: (string | number)[] }) => Promise<{ rows: any[] }>;
const PAGE = 200, MAX_ROWS = 4000;

const data = (key: string) => `json_extract(rec.data,'$.${key}')`;
// Same expressions as the Procurement search (procurement/catalog.ts), limited to the host's SQL functions.
const SOURCE = `coalesce(CASE WHEN ${data('sourceId')}='' THEN NULL ELSE ${data('sourceId')} END,'bc-bid')`;
const DEADLINE = `CASE WHEN rec.kind='opportunity' THEN coalesce(${data('closingAt')},${data('closingDate')}) ELSE ${data('awardDate')} END`;
const BUYER = `coalesce(${data('issuedBy')},${data('issuingOrganization')},'')`;
// Categorizing prompts only; on-demand evidence runs (`procurement:`/`evidence:`) answer one-off questions.
const CATEGORIZING = "r.status='succeeded' AND r.prompt_id NOT LIKE 'procurement:%' AND r.prompt_id NOT LIKE 'evidence:%'";

export type AnalysisRow = {
  recordId: string; promptId: string; promptVersion: number; reviewedAt: string; title: string; kind: string;
  source: string; deadline: string | null; buyer: string; status: string | null; fields: Record<string, unknown>; labels: string[];
};
const parse = (text: unknown, fallback: any) => { if (typeof text !== 'string') return fallback; try { return JSON.parse(text) ?? fallback; } catch { return fallback; } };

/**
 * Latest successful result per record and prompt, optionally for one prompt and source. With `promptVersion`,
 * only results from that version count (latest per record within it): field definitions can change between
 * versions, so results from different versions are never aggregated together.
 */
export async function readAnalysisRows(query: Query, scope: { promptId?: string; promptVersion?: number; source?: string } = {}) {
  const filters = [CATEGORIZING], parameters: (string | number)[] = [];
  if (scope.promptId) { filters.push('r.prompt_id=?'); parameters.push(scope.promptId); }
  const sameVersion = scope.promptVersion !== undefined ? ' AND n.prompt_version=r.prompt_version' : '';
  if (scope.promptVersion !== undefined) { filters.push('r.prompt_version=?'); parameters.push(scope.promptVersion); }
  if (scope.source) { filters.push(`${SOURCE}=?`); parameters.push(scope.source); }
  const statement = `SELECT r.record_id,r.prompt_id,r.prompt_version,r.created_at,json_extract(r.result,'$.fields') fields,json_extract(r.result,'$.labels') labels,
    rec.title,rec.kind,${SOURCE} source,${DEADLINE} deadline,${BUYER} buyer,${data('status')} status
    FROM reviews r JOIN records rec ON rec.id=r.record_id
    WHERE ${filters.join(' AND ')} AND NOT EXISTS (SELECT 1 FROM reviews n WHERE n.record_id=r.record_id AND n.prompt_id=r.prompt_id AND n.status='succeeded' AND n.created_at>r.created_at${sameVersion})
    ORDER BY r.created_at DESC,r.id LIMIT ? OFFSET ?`;
  const rows: AnalysisRow[] = [];
  for (let offset = 0; offset < MAX_ROWS; offset += PAGE) {
    const page = (await query('catalog.query', { statement, parameters: [...parameters, PAGE, offset] })).rows;
    rows.push(...page.map(row => ({
      recordId: row.record_id, promptId: row.prompt_id, promptVersion: row.prompt_version, reviewedAt: row.created_at, title: row.title ?? row.record_id, kind: row.kind,
      source: row.source, deadline: row.deadline ?? null, buyer: row.buyer ?? '', status: row.status ?? null, fields: parse(row.fields, {}), labels: parse(row.labels, []),
    })));
    if (page.length < PAGE) return { rows, truncated: false };
  }
  return { rows, truncated: true };
}

export type PromptVersionCount = { version: number; records: number };
/**
 * Records with a successful result per version of one prompt, newest version first, plus how many records have
 * results only from versions other than `current` (excluded from the current-version analysis).
 */
export async function readPromptVersions(query: Query, promptId: string, current: number, source?: string) {
  const filters = [CATEGORIZING, 'r.prompt_id=?'], parameters: (string | number)[] = [promptId];
  if (source) { filters.push(`${SOURCE}=?`); parameters.push(source); }
  const from = `FROM reviews r JOIN records rec ON rec.id=r.record_id WHERE ${filters.join(' AND ')}`;
  const [versions, older] = await Promise.all([
    query('catalog.query', { parameters, statement: `SELECT r.prompt_version version,count(DISTINCT r.record_id) records ${from} GROUP BY r.prompt_version ORDER BY r.prompt_version DESC LIMIT 200` }),
    query('catalog.query', { parameters: [...parameters, current, current], statement: `SELECT count(DISTINCT r.record_id) records ${from} AND r.prompt_version<>?
      AND NOT EXISTS (SELECT 1 FROM reviews c WHERE c.record_id=r.record_id AND c.prompt_id=r.prompt_id AND c.status='succeeded' AND c.prompt_version=?)` }),
  ]);
  return { versions: versions.rows.map(row => ({ version: Number(row.version), records: Number(row.records) })) as PromptVersionCount[], olderOnly: Number(older.rows[0]?.records ?? 0) };
}

/** The saved instructions of one prompt version, read from a result it produced (older versions are not stored elsewhere). */
export async function readVersionInstructions(query: Query, promptId: string, version: number): Promise<string | undefined> {
  const { rows } = await query('catalog.query', { parameters: [promptId, version], statement: `SELECT json_extract(r.result,'$.prompt.instructions') instructions FROM reviews r
    WHERE r.prompt_id=? AND r.prompt_version=? AND r.status='succeeded' ORDER BY r.created_at DESC LIMIT 1` });
  return typeof rows[0]?.instructions === 'string' ? rows[0].instructions : undefined;
}

/** Open opportunities per source, and how many have a categorizing review. */
export async function readCoverage(query: Query) {
  const { rows } = await query('catalog.query', { parameters: [], statement: `SELECT ${SOURCE} source,count(*) open,
    count(CASE WHEN EXISTS (SELECT 1 FROM reviews r WHERE r.record_id=rec.id AND ${CATEGORIZING}) THEN 1 END) reviewed
    FROM records rec WHERE rec.kind='opportunity' AND lower(coalesce(${data('status')},'open')) IN ('open','active','') GROUP BY source ORDER BY open DESC` });
  return rows.map(row => ({ source: String(row.source), open: Number(row.open), reviewed: Number(row.reviewed) }));
}

export type Bucket = { label: string; count: number; recordIds: string[] };
export type Stats = { count: number; min: string; median: string; max: string; mean: string };
/** One currency and basis of a money field. Amounts are never summed or averaged across partitions. */
export type MoneyPartition = { currency: string; basis: string; stats: Stats; buckets: Bucket[] };
export type FieldSummary =
  | { key: string; label: string; kind: 'categories'; buckets: Bucket[]; notStated: number }
  | { key: string; label: string; kind: 'numbers'; buckets: Bucket[]; notStated: number; stats: Stats }
  | { key: string; label: string; kind: 'money'; notStated: number; partitions: MoneyPartition[] }
  | { key: string; label: string; kind: 'items'; buckets: Bucket[]; notStated: number; none: number }
  | { key: string; label: string; kind: 'text'; stated: number; notStated: number };

const empty = (value: unknown) => value === undefined || value === null || value === '' || (typeof value === 'string' && /^not (stated|provided|disclosed)/i.test(value.trim()));
/** Count records per label. With `order`, every listed label appears (zero counts included) in that order. */
function bucketize(entries: Array<[string, string]>, order?: string[]): Bucket[] {
  const map = new Map<string, Bucket>((order ?? []).map(label => [label, { label, count: 0, recordIds: [] }]));
  for (const [label, id] of entries) { const b = map.get(label) ?? { label, count: 0, recordIds: [] }; if (!b.recordIds.includes(id)) { b.count++; b.recordIds.push(id); } map.set(label, b); }
  return order ? [...map.values()] : [...map.values()].sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}
const valid = (field: ReviewField, value: unknown) => checkFields([field], { [field.key]: value }).checks[0].state === 'ok';
const median = (sorted: number[]) => sorted.length % 2 ? sorted[(sorted.length - 1) / 2] : (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2;
/** Up to six equal-width ranges; whole-number scales get one bucket per step instead. */
function ranges(values: Array<[number, string]>, format: (n: number) => string, scale?: { min: number; max: number }): Bucket[] {
  if (scale) return bucketize(values.map(([v, id]) => [String(v), id]), Array.from({ length: scale.max - scale.min + 1 }, (_, i) => String(scale.min + i)));
  const nums = values.map(([v]) => v), lo = Math.min(...nums), hi = Math.max(...nums);
  if (lo === hi) return [{ label: format(lo), count: values.length, recordIds: values.map(([, id]) => id) }];
  const slots = Math.min(6, values.length), width = (hi - lo) / slots;
  const buckets = Array.from({ length: slots }, (_, i) => ({ label: `${format(lo + width * i)} – ${format(i === slots - 1 ? hi : lo + width * (i + 1))}`, count: 0, recordIds: [] as string[] }));
  for (const [v, id] of values) { const b = buckets[Math.min(slots - 1, Math.floor((v - lo) / width))]; b.count++; b.recordIds.push(id); }
  return buckets;
}

function stats(values: number[], format: (n: number) => string): Stats {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted.length ? { count: sorted.length, min: format(sorted[0]), median: format(median(sorted)), max: format(sorted[sorted.length - 1]), mean: format(sorted.reduce((s, v) => s + v, 0) / sorted.length) }
    : { count: 0, min: '—', median: '—', max: '—', mean: '—' };
}

/** Summarize one typed field over the rows. Values that don't match the type are left out of charts. */
export function summarizeField(field: ReviewField, rows: AnalysisRow[]): FieldSummary {
  const present = rows.map(row => [fieldValue(row.fields, field.key), row.recordId] as const);
  const stated = present.filter(([v]) => !empty(v));
  const notStated = present.length - stated.length;
  const base = { key: field.key, label: field.label };
  // Values that don't match the declared type are counted as stated but left out of charts; Results flags them.
  const typed = stated.filter(([v]) => valid(field, v));
  switch (field.type) {
    case 'choice': return { ...base, kind: 'categories', notStated, buckets: bucketize(typed.map(([v, id]) => [String(v), id]), field.options) };
    case 'yes-no': return { ...base, kind: 'categories', notStated, buckets: bucketize(typed.map(([v, id]) => [v ? 'Yes' : 'No', id]), ['Yes', 'No']) };
    case 'list': {
      const lists = typed as Array<readonly [string[], string]>;
      return { ...base, kind: 'items', notStated, none: lists.filter(([v]) => !v.length).length, buckets: bucketize(lists.flatMap(([v, id]) => v.map(item => [String(item).trim(), id] as [string, string]))).slice(0, 12) };
    }
    case 'date': {
      const months = typed.map(([v, id]) => [String(v).slice(0, 7), id] as [string, string]);
      return { ...base, kind: 'categories', notStated, buckets: bucketize(months).sort((a, b) => a.label.localeCompare(b.label)) };
    }
    case 'money': {
      // Partition by currency and basis (value.basis when the model gave one, else the field's role); an unknown
      // basis is its own partition. Stats and ranges are computed within a partition only.
      const role = moneyRole(field), groups = new Map<string, { currency: string; basis: string; values: Array<[number, string]> }>();
      for (const [v, id] of typed) {
        const m = v as { amount: number; currency: string; basis?: unknown }, stated = typeof m.basis === 'string' && m.basis.trim() ? m.basis.trim().replace(/_/g, ' ').toLowerCase() : '';
        const basis = stated || (role === 'other' ? 'basis not stated' : MONEY_ROLE_LABELS[role].toLowerCase()), key = `${m.currency}|${basis}`;
        const g = groups.get(key) ?? { currency: m.currency, basis, values: [] }; g.values.push([m.amount, id]); groups.set(key, g);
      }
      const partitions = [...groups.values()].sort((a, b) => b.values.length - a.values.length || a.currency.localeCompare(b.currency) || a.basis.localeCompare(b.basis)).map(g => {
        // Compact amounts (CA$250K) keep stats and range labels readable in narrow cards.
        const format = (n: number) => new Intl.NumberFormat(undefined, { style: 'currency', currency: g.currency, notation: 'compact', maximumFractionDigits: 1 }).format(n);
        return { currency: g.currency, basis: g.basis, stats: stats(g.values.map(([v]) => v), format), buckets: ranges(g.values, format) };
      });
      return { ...base, kind: 'money', notStated, partitions };
    }
    case 'number': case 'percent': case 'scale': {
      const values = typed.map(([v, id]) => [v as number, id] as [number, string]);
      const format = (n: number) => field.type === 'percent' ? `${Math.round(n * 10) / 10}%` : field.type === 'scale' ? String(Math.round(n * 10) / 10) : (Math.round(n * 100) / 100).toLocaleString();
      return { ...base, kind: 'numbers', notStated, stats: stats(values.map(([v]) => v), format), buckets: values.length ? ranges(values, format, field.type === 'scale' ? field.scale ?? DEFAULT_SCALE : undefined) : [] };
    }
    default: return { ...base, kind: 'text', stated: stated.length, notStated };
  }
}

/**
 * Free-form prompts have no definitions, so infer a summary per returned key: objects with a `status`
 * (e.g. funding) and short repeated strings become categories, arrays become item counts.
 */
export function inferSummaries(rows: AnalysisRow[], limit = 12): FieldSummary[] {
  const keys = new Map<string, number>();
  for (const row of rows) for (const key of Object.keys(row.fields)) keys.set(key, (keys.get(key) ?? 0) + 1);
  return [...keys].sort((a, b) => b[1] - a[1]).slice(0, limit).map(([key]) => {
    const values = rows.map(row => [fieldValue(row.fields, key), row.recordId] as const), stated = values.filter(([v]) => !empty(v));
    const label = fieldLabel(key), notStated = values.length - stated.length;
    if (stated.length && stated.every(([v]) => Array.isArray(v))) {
      const items = bucketize(stated.flatMap(([v, id]) => (v as unknown[]).map(item => [typeof item === 'string' ? item.trim() : Object.values(item ?? {}).filter(x => typeof x === 'string').join(' · '), id] as [string, string])).filter(([l]) => l && !empty(l)));
      // Free-form lists are often unique sentences; only items that recur are worth charting.
      const repeated = items.filter(b => b.count > 1);
      if (!repeated.length) return { key, label, kind: 'text', stated: stated.filter(([v]) => (v as unknown[]).length).length, notStated: notStated + stated.filter(([v]) => !(v as unknown[]).length).length };
      return { key, label, kind: 'items', notStated, none: stated.filter(([v]) => !(v as unknown[]).length).length, buckets: repeated.slice(0, 12) };
    }
    if (stated.length && stated.every(([v]) => v && typeof v === 'object' && typeof (v as any).status === 'string'))
      return { key, label, kind: 'categories', notStated, buckets: bucketize(stated.map(([v, id]) => [String((v as any).status).replace(/_/g, ' ').replace(/^./, c => c.toUpperCase()), id])) };
    if (stated.length && stated.every(([v]) => typeof v === 'boolean'))
      return { key, label, kind: 'categories', notStated, buckets: bucketize(stated.map(([v, id]) => [v ? 'Yes' : 'No', id]), ['Yes', 'No']) };
    const strings = stated.filter(([v]) => typeof v === 'string') as Array<readonly [string, string]>;
    const distinct = new Set(strings.map(([v]) => v.trim()));
    // Categories only when values repeat; unique descriptions stay text.
    if (strings.length === stated.length && distinct.size < stated.length && distinct.size <= 12 && [...distinct].every(v => v.length <= 60))
      return { key, label, kind: 'categories', notStated, buckets: bucketize(strings.map(([v, id]) => [v.trim(), id])) };
    return { key, label, kind: 'text', stated: stated.length, notStated };
  });
}

/** Typed prompts summarize their definitions; free-form prompts infer from what came back. */
export function summarize(promptText: string | undefined, rows: AnalysisRow[]): FieldSummary[] {
  const { fields } = parsePrompt(promptText);
  return fields.length ? fields.map(field => summarizeField(field, rows)) : inferSummaries(rows);
}

/** Labels grouped ignoring case, hyphens and underscores (the AI writes both "Budget not disclosed" and "budget-not-disclosed"); each shows its most common spelling. */
export function labelCounts(rows: AnalysisRow[]) {
  const norm = (label: string) => label.toLowerCase().replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim();
  const spellings = new Map<string, Map<string, number>>();
  const entries = rows.flatMap(row => row.labels.filter(l => typeof l === 'string' && l.trim()).map(l => {
    const key = norm(l), counts = spellings.get(key) ?? new Map<string, number>();
    counts.set(l.trim(), (counts.get(l.trim()) ?? 0) + 1); spellings.set(key, counts);
    return [key, row.recordId] as [string, string];
  }));
  // Prefer the most used spelling; on a tie, the one written with spaces and capitals.
  const display = (key: string) => [...spellings.get(key)!].sort((a, b) => b[1] - a[1] || Number(/[-_]/.test(a[0])) - Number(/[-_]/.test(b[0])) || Number(/[A-Z]/.test(b[0])) - Number(/[A-Z]/.test(a[0])))[0][0];
  return bucketize(entries).map(bucket => ({ ...bucket, label: display(bucket.label) }));
}

/** A sortable deadline time (see procurement/deadline.ts); date-only values sort at the end of their Vancouver day. */
export const deadlineTime = (raw: string | null): number | null => deadlineSortTime(raw);

/**
 * Reviewed opportunities not yet closed whose deadline falls within `days`, soonest first. A same-day date-only
 * deadline is included with state `closing_today_time_unverified`, never dropped as closed.
 */
export function closingSoon(rows: AnalysisRow[], now = Date.now(), days = 14): Array<AnalysisRow & { time: number; state: DeadlineState }> {
  const seen = new Set<string>();
  return rows.filter(row => row.kind === 'opportunity' && closesWithin(row.deadline, days, now) && !seen.has(row.recordId) && seen.add(row.recordId))
    .map(row => ({ ...row, time: deadlineSortTime(row.deadline)!, state: deadlineState(row.deadline, now) }))
    .sort((a, b) => a.time - b.time);
}

/** A headline score to show beside each notice: the prompt's first scale, percent or number field. */
export function scoreField(promptText: string | undefined): ReviewField | undefined {
  return parsePrompt(promptText).fields.find(f => f.type === 'scale') ?? parsePrompt(promptText).fields.find(f => f.type === 'percent' || f.type === 'number');
}

/** Open opportunities from one source with no categorizing review yet, upcoming deadlines first. */
export async function readUnreviewed(query: Query, source: string, limit = 50, now = Date.now()) {
  const { rows } = await query('catalog.query', { parameters: [source, zoneDate(now), limit], statement: `SELECT rec.id FROM records rec
    WHERE rec.kind='opportunity' AND lower(coalesce(${data('status')},'open')) IN ('open','active','') AND ${SOURCE}=?
    AND NOT EXISTS (SELECT 1 FROM reviews r WHERE r.record_id=rec.id AND ${CATEGORIZING})
    ORDER BY ${passedOrder(DEADLINE)},${DEADLINE},rec.id LIMIT ?` });
  return rows.map(row => String(row.id));
}
