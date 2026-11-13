import { parseDeadline, validDate } from '../dashboard/procurement/deadline';
import { NO_FIXED_DATE_FROM } from '../dashboard/procurement/lifecycle';
import { canadaBuysGroups, compareAmendments, idAmendment } from '../dashboard/procurement/canonical';
import { CROSS_SOURCE_COPIES, crossSourceMatch, indexByClosingDay, type NoticeSummary } from '../dashboard/procurement/duplicates';
import { AWARD_DUPLICATE_RULE, awardDuplicates } from '../dashboard/procurement/award-duplicates';
import { isPauseError } from './pause';

/**
 * `catalog.normalize`: record the read-side data-quality decisions on existing rows, so every reader (SQL totals,
 * exports, the host's document queue) sees them. Never deletes a record:
 *
 * (a) CanadaBuys: one record per reference number (`externalId`). The canonical record is the lowest amendment suffix
 *     (blank first), the record collectors now update (CONNECTORS.md "CanadaBuys identity"). It takes the current
 *     values of the highest saved amendment, lists every amendment in `amendmentHistory` and keeps `starred` if any
 *     row had it; every other row of the reference is left as saved and gets `mergedInto` = the canonical id
 *     (`mergeReason`).
 * (b) award rows that repeat another award get `duplicateOf` = the kept row (`duplicateReason: 'same-award'`);
 *     local-government / bids&tenders / browser-site notices that repeat a BC Bid notice get `duplicateOf` = the BC
 *     Bid record (`duplicateReason: 'also-on-bc-bid'`, `duplicateScore`);
 * (c) closing dates: a placeholder (2036 or later) takes the collectors' shape (`closingDate: null`, the source value
 *     in `closingDateRaw`, `closingDatePlaceholder: true`, no derived `closingAt`); a source text date
 *     ("Fri Nov 20, 2026 2:00 PM (PST)") fills a missing `closingAt` (the raw `closingDate` is kept); each judgement
 *     is recorded in `closingNormalized` ({ kind, value, from, rule }); nothing readable → kind `unknown`.
 *
 * Idempotent: a second run finds nothing to change. Marks this action wrote earlier and no longer applies are
 * removed. `dryRun` (the default) only reports the counts.
 */
export const NORMALIZE_KEY = 'catalog:normalize';
export const CLOSING_RULE = 'closing-v1';
export const CANADABUYS_MERGE_REASON = 'canadabuys-amendment';
export const SAME_AWARD_REASON = 'same-award';
export const CROSS_SOURCE_REASON = 'also-on-bc-bid';
type Host = (method: string, input: any) => Promise<any>;
export interface NormalizeInput { dryRun?: boolean }
type Row = { id: string; data: Record<string, any> };
type Patch = { set: Record<string, unknown>; unset: string[] };

const MONTHS: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12 };
// bids&tenders prints "(YST)" for BC since November 2026 (UTC−07 all year), read the same way by its collector.
const ZONES: Record<string, string> = { PST: '-08:00', PDT: '-07:00', YST: '-07:00', MST: '-07:00', MDT: '-06:00', CST: '-06:00', CDT: '-05:00', EST: '-05:00', EDT: '-04:00', AST: '-04:00', ADT: '-03:00', NST: '-03:30', NDT: '-02:30', UTC: 'Z', GMT: 'Z' };
const pad = (n: number) => String(n).padStart(2, '0');
/**
 * A source's text closing date: "Fri Nov 20, 2026 2:00:00 PM (PST)", "November 20, 2026", "20 Nov 2026 14:00".
 * With a known zone label the result is an instant; otherwise only the calendar day is kept (an unknown label is not
 * guessed).
 */
export function parseClosingText(raw: string): { kind: 'instant' | 'date'; value: string } | null {
  const text = raw.trim().replace(/\s+/g, ' ');
  const mdy = /^(?:[A-Za-z]{3,9},? )?([A-Za-z]{3,9})\.? (\d{1,2}),? (\d{4})(?:,? (?:at )?(\d{1,2}):(\d{2})(?::(\d{2}))? ?([AaPp]\.?[Mm]\.?)?)?(?: \(?([A-Z]{2,4})\)?)?$/.exec(text);
  const dmy = mdy ? null : /^(\d{1,2}) ([A-Za-z]{3,9})\.? (\d{4})(?:,? (\d{1,2}):(\d{2})(?::(\d{2}))? ?([AaPp]\.?[Mm]\.?)?)?(?: \(?([A-Z]{2,4})\)?)?$/.exec(text);
  const m = mdy ?? dmy;
  if (!m) return null;
  const [monthName, dayText] = mdy ? [m[1], m[2]] : [m[2], m[1]];
  const month = MONTHS[monthName.toLowerCase().slice(0, monthName.toLowerCase().startsWith('sept') ? 4 : 3)], year = Number(m[3]), day = Number(dayText);
  if (!month) return null;
  const date = `${year}-${pad(month)}-${pad(day)}`;
  if (!validDate(date)) return null;
  const zone = m[8] && ZONES[m[8].toUpperCase()];
  if (m[4] === undefined || !zone) return { kind: 'date', value: date };
  let hour = Number(m[4]); const minute = Number(m[5]), second = Number(m[6] ?? 0), meridiem = m[7]?.toLowerCase().replace(/\./g, '');
  if (meridiem) { if (hour < 1 || hour > 12) return null; hour = hour % 12 + (meridiem === 'pm' ? 12 : 0); }
  if (hour > 23 || minute > 59 || second > 59) return null;
  return { kind: 'instant', value: `${date}T${pad(hour)}:${pad(minute)}:${pad(second)}${zone}` };
}

export type NormalizedClosing = { kind: 'no-fixed-date' | 'instant' | 'date' | 'unknown'; value: string | null; from: string; rule: string };
/**
 * What `closingNormalized` should hold for an opportunity, or null when the stored value is read as it is. A
 * `closingAt` this action filled earlier (equal to its recorded value) is ignored, so the judgement is made from the
 * source again; a placeholder already in the collectors' shape needs nothing (or keeps this action's record of it).
 */
export function normalizedClosing(data: Record<string, any>): NormalizedClosing | null {
  const ours = data.closingNormalized?.rule === CLOSING_RULE ? data.closingNormalized : null;
  if (data.closingDatePlaceholder === true) return ours?.kind === 'no-fixed-date' ? ours : null;
  const at = typeof data.closingAt === 'string' && !(ours && ours.value === data.closingAt) ? data.closingAt.trim() : '';
  const raw = typeof data.closingDate === 'string' ? data.closingDate.trim() : '';
  const from = at || raw, parsed = parseDeadline(from);
  if (parsed) return parsed.date >= NO_FIXED_DATE_FROM ? { kind: 'no-fixed-date', value: null, from: raw || at, rule: CLOSING_RULE } : null;
  const text = raw ? parseClosingText(raw) : null;
  if (text) return text.value.slice(0, 10) >= NO_FIXED_DATE_FROM ? { kind: 'no-fixed-date', value: null, from: raw, rule: CLOSING_RULE } : { ...text, from: raw, rule: CLOSING_RULE };
  return { kind: 'unknown', value: null, from, rule: CLOSING_RULE };
}

// ---------------------------------------------------------------------------------------------
// CanadaBuys amendment folding (the same entry shape as the collector's `amendmentHistory`).
// ---------------------------------------------------------------------------------------------

const AMENDMENT = 'amendmentNumber-numeroModification';
export interface AmendmentEntry { amendmentNumber: string; amendmentDate?: string; closingDate?: string | null; publishedAt?: string; seenAt: string; sourceFileSha256?: string }
/** The amendment a saved row holds: its field, else its source row, else its id suffix. */
export function rowAmendment(id: string, data: any): string {
  if (typeof data?.amendmentNumber === 'string') return data.amendmentNumber;
  const raw = data?.rawSourceData?.[AMENDMENT];
  return typeof raw === 'string' ? raw.trim() : idAmendment(id);
}
function amendmentEntry(id: string, data: any): AmendmentEntry {
  const raw = data?.rawSourceData ?? {};
  const amendmentDate = typeof raw['amendmentDate-dateModification'] === 'string' ? raw['amendmentDate-dateModification'].trim() : '';
  const closing = typeof raw['tenderClosingDate-appelOffresDateCloture'] === 'string' ? raw['tenderClosingDate-appelOffresDateCloture'].trim() : data?.closingDateRaw ?? data?.closingDate;
  const published = typeof data?.publishedAt === 'string' ? data.publishedAt : typeof raw['publicationDate-datePublication'] === 'string' && raw['publicationDate-datePublication'].trim() ? raw['publicationDate-datePublication'].trim() : '';
  return { amendmentNumber: rowAmendment(id, data), ...(amendmentDate ? { amendmentDate } : {}), ...(closing ? { closingDate: closing } : {}), ...(published ? { publishedAt: published } : {}),
    seenAt: String(data?.importedAt ?? data?.sourceRetrievedAt ?? ''), ...(typeof data?.sourceFileSha256 === 'string' ? { sourceFileSha256: data.sourceFileSha256 } : {}) };
}
/** One entry per amendment number, oldest first; an amendment already listed keeps its first entry. */
function amendmentHistory(canonical: Row, superseded: readonly Row[]): AmendmentEntry[] {
  const entries = new Map<string, AmendmentEntry>();
  for (const entry of Array.isArray(canonical.data.amendmentHistory) ? canonical.data.amendmentHistory : [amendmentEntry(canonical.id, canonical.data)])
    if (entry && typeof entry.amendmentNumber === 'string' && !entries.has(entry.amendmentNumber)) entries.set(entry.amendmentNumber, entry);
  for (const row of superseded) { const entry = amendmentEntry(row.id, row.data); if (!entries.has(entry.amendmentNumber)) entries.set(entry.amendmentNumber, entry); }
  return [...entries.values()].sort((a, b) => compareAmendments(a.amendmentNumber, b.amendmentNumber)).slice(-50);
}
/** Fields that stay the canonical record's own when it takes a later amendment's values. */
const OWN_FIELDS = ['sourceKey', 'processId', 'opportunityId', 'starred', 'hidden', 'amendmentHistory', 'mergedInto', 'mergeReason', 'duplicateOf', 'duplicateReason', 'duplicateScore', 'closingNormalized'];
/**
 * The canonical record of a CanadaBuys reference after folding its superseded rows (full data), or null when it
 * already holds them: the highest saved amendment's values when it is later than the record's own, every amendment
 * in `amendmentHistory`, and `starred` if any row had it. An empty attachment list never replaces saved links.
 */
export function foldAmendments(canonical: Row, superseded: readonly Row[]): Record<string, any> | null {
  if (!superseded.length) return null;
  const latest = [...superseded].sort((a, b) => compareAmendments(rowAmendment(a.id, a.data), rowAmendment(b.id, b.data)))[superseded.length - 1];
  let next: Record<string, any> = { ...canonical.data };
  if (compareAmendments(rowAmendment(latest.id, latest.data), rowAmendment(canonical.id, canonical.data)) > 0) {
    const fields = Object.fromEntries(Object.entries(latest.data).filter(([key]) => !OWN_FIELDS.includes(key)));
    if (!(Array.isArray(fields.attachments) && fields.attachments.length) && Array.isArray(canonical.data.attachments) && canonical.data.attachments.length) {
      fields.attachments = canonical.data.attachments;
      if (canonical.data.attachmentsAccess !== undefined) fields.attachmentsAccess = canonical.data.attachmentsAccess;
    }
    const amendment = rowAmendment(latest.id, latest.data);
    next = { ...next, ...fields, amendmentNumber: amendment, ...(/^\d+$/.test(amendment) ? { amendments: Number(amendment) } : {}) };
  }
  next.amendmentHistory = amendmentHistory(canonical, superseded);
  if ([canonical, ...superseded].some(row => row.data.starred === true)) next.starred = true;
  return same(next, canonical.data) ? null : next;
}

const summary = (row: Row, closing: string | null): NoticeSummary => ({
  id: row.id, title: String(row.data.description ?? row.data.title ?? ''), buyer: String(row.data.issuedBy ?? ''),
  deadline: closing, url: row.data.detailUrl ?? row.data.sourceUrl ?? null, sourceId: typeof row.data.sourceId === 'string' && row.data.sourceId ? row.data.sourceId : 'bc-bid',
});

/** Cross-row decisions, made once from the whole catalog. */
export interface Decisions {
  merges: Map<string, string>;
  folds: Map<string, string[]>;
  links: Map<string, { id: string; score: number }>;
  awards: Map<string, string>;
}
export interface NormalizePlan {
  decisions: Decisions;
  /** Per-record changes on the scanned data (dry-run counts; the run recomputes them from each record as it is). */
  patches: Map<string, Patch>;
  counts: {
    canadaBuysAmendments: { references: number; rows: number; canonicalUpdated: number };
    awardDuplicates: { groups: number; rows: number; value: Record<string, number> };
    crossSource: { rows: number; bySource: Record<string, number> };
    closingDates: { noFixedDate: number; textDates: number; unknown: number; closingAtFilled: number };
  };
}
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
function patchFor(data: Record<string, any>, wanted: Record<string, unknown>, owned: string[]): Patch | null {
  const set: Record<string, unknown> = {}, unset: string[] = [];
  for (const [key, value] of Object.entries(wanted)) if (!same(data[key], value)) set[key] = value;
  for (const key of owned) if (!(key in wanted) && data[key] !== undefined) unset.push(key);
  return Object.keys(set).length || unset.length ? { set, unset } : null;
}

/** The marks one opportunity should carry (merge, BC Bid link, closing date), from its data as it is now. */
export function opportunityPatch(row: Row, decisions: Decisions): Patch | null {
  const wanted: Record<string, unknown> = {}, owned: string[] = [];
  const merge = decisions.merges.get(row.id), link = decisions.links.get(row.id), normalized = normalizedClosing(row.data);
  if (merge) Object.assign(wanted, { mergedInto: merge, mergeReason: CANADABUYS_MERGE_REASON });
  if (row.data.mergeReason === CANADABUYS_MERGE_REASON) owned.push('mergedInto', 'mergeReason');
  if (link) Object.assign(wanted, { duplicateOf: link.id, duplicateReason: CROSS_SOURCE_REASON, duplicateScore: link.score });
  if (row.data.duplicateReason === CROSS_SOURCE_REASON) owned.push('duplicateOf', 'duplicateReason', 'duplicateScore');
  const ours = row.data.closingNormalized?.rule === CLOSING_RULE ? row.data.closingNormalized : null;
  const filledByUs = !!ours?.value && row.data.closingAt === ours.value;
  if (normalized) wanted.closingNormalized = normalized;
  if (ours) owned.push('closingNormalized');
  if (normalized?.kind === 'no-fixed-date' && row.data.closingDatePlaceholder !== true) {
    // The collectors' placeholder shape; the source value moves to closingDateRaw, the derived closingAt goes.
    Object.assign(wanted, { closingDate: null, closingDateRaw: normalized.from, closingDatePlaceholder: true });
    owned.push('closingAt');
  } else if (normalized?.value && (row.data.closingAt == null || filledByUs)) wanted.closingAt = normalized.value;
  else if (filledByUs) owned.push('closingAt');
  return patchFor(row.data, wanted, owned);
}
export function awardPatch(row: Row, decisions: Decisions): Patch | null {
  const kept = decisions.awards.get(row.id), wanted: Record<string, unknown> = {}, owned: string[] = [];
  if (kept) Object.assign(wanted, { duplicateOf: kept, duplicateReason: SAME_AWARD_REASON });
  if (row.data.duplicateReason === SAME_AWARD_REASON) owned.push('duplicateOf', 'duplicateReason');
  return patchFor(row.data, wanted, owned);
}

/** Decisions and changes for `opportunities` and `awards` (`{ id, data }`, full or slim data). Pure, for tests and dry runs. */
export function planNormalization(opportunities: readonly Row[], awards: readonly Row[]): NormalizePlan {
  const counts: NormalizePlan['counts'] = { canadaBuysAmendments: { references: 0, rows: 0, canonicalUpdated: 0 }, awardDuplicates: { groups: 0, rows: 0, value: {} }, crossSource: { rows: 0, bySource: {} }, closingDates: { noFixedDate: 0, textDates: 0, unknown: 0, closingAtFilled: 0 } };
  const byId = new Map(opportunities.map(row => [row.id, row]));
  // (a) CanadaBuys references.
  const groups = canadaBuysGroups(opportunities), merges = new Map<string, string>(), folds = new Map<string, string[]>();
  for (const group of groups) {
    for (const id of group.superseded) merges.set(id, group.canonical);
    folds.set(group.canonical, group.superseded);
    if (foldAmendments(byId.get(group.canonical)!, group.superseded.map(id => byId.get(id)!))) counts.canadaBuysAmendments.canonicalUpdated++;
  }
  counts.canadaBuysAmendments.references = groups.length; counts.canadaBuysAmendments.rows = merges.size;
  // (c) closing dates first: cross-source matching reads the normalized value.
  const closing = new Map(opportunities.map(row => [row.id, normalizedClosing(row.data)] as const));
  for (const row of opportunities) {
    const value = closing.get(row.id);
    if (value?.kind === 'no-fixed-date' && row.data.closingDatePlaceholder !== true) counts.closingDates.noFixedDate++;
    else if (value?.kind === 'unknown') counts.closingDates.unknown++;
    if (value?.value) counts.closingDates.textDates++; // only a source text date yields a value
  }
  const closingOf = (row: Row) => closing.get(row.id)?.value || row.data.closingAt || row.data.closingDate || null;
  // (b) local copies of BC Bid notices (superseded rows take no part).
  const bcBid = opportunities.filter(row => !row.data.sourceId || row.data.sourceId === 'bc-bid').map(row => summary(row, closingOf(row)));
  const candidates = indexByClosingDay(bcBid), links = new Map<string, { id: string; score: number }>();
  for (const row of opportunities) {
    if (!(CROSS_SOURCE_COPIES as readonly string[]).includes(row.data.sourceId) || merges.has(row.id)) continue;
    const notice = summary(row, closingOf(row)), match = crossSourceMatch(notice, candidates(notice));
    if (match) { links.set(row.id, { id: match.notice.id, score: match.score.score }); counts.crossSource.rows++; counts.crossSource.bySource[row.data.sourceId] = (counts.crossSource.bySource[row.data.sourceId] ?? 0) + 1; }
  }
  // (b) repeated awards.
  const duplicates = awardDuplicates(awards);
  counts.awardDuplicates.groups = new Set(duplicates.values()).size; counts.awardDuplicates.rows = duplicates.size;
  for (const row of awards) {
    if (!duplicates.has(row.id)) continue;
    const value = Number(row.data.contractValue), currency = typeof row.data.currency === 'string' && row.data.currency ? row.data.currency.toUpperCase() : 'unknown';
    if (Number.isFinite(value)) counts.awardDuplicates.value[currency] = Math.round(((counts.awardDuplicates.value[currency] ?? 0) + value) * 100) / 100;
  }
  const decisions: Decisions = { merges, folds, links, awards: duplicates }, patches = new Map<string, Patch>();
  for (const row of opportunities) {
    const patch = opportunityPatch(row, decisions);
    if (patch) { patches.set(row.id, patch); if ('closingAt' in patch.set) counts.closingDates.closingAtFilled++; }
  }
  for (const row of awards) { const patch = awardPatch(row, decisions); if (patch) patches.set(row.id, patch); }
  return { decisions, patches, counts };
}

export function applyPatch(data: Record<string, any>, patch: Patch): Record<string, any> {
  const next = { ...data, ...patch.set };
  for (const key of patch.unset) delete next[key];
  return next;
}

// Fields read by the plan; the scan keeps only these.
const OPPORTUNITY_FIELDS = ['sourceId', 'externalId', 'description', 'title', 'issuedBy', 'closingAt', 'closingDate', 'closingDateRaw', 'closingDatePlaceholder', 'detailUrl', 'sourceUrl', 'status', 'starred', 'amendmentNumber', 'amendmentHistory', 'mergedInto', 'mergeReason', 'duplicateOf', 'duplicateReason', 'duplicateScore', 'closingNormalized'];
const AWARD_FIELDS = ['sourceId', 'opportunityId', 'successfulSupplier', 'supplierAddress', 'awardDate', 'contractValue', 'contractNumber', 'currency', 'duplicateOf', 'duplicateReason'];
const slim = (data: any, fields: string[]) => {
  const result: Record<string, any> = Object.fromEntries(fields.filter(key => data[key] !== undefined).map(key => [key, data[key]]));
  const amendment = data.rawSourceData?.[AMENDMENT];
  if (typeof amendment === 'string') result.rawSourceData = { [AMENDMENT]: amendment };
  return result;
};
const PAGE = 200, MAX_COMMIT_BYTES = 3_000_000, FOLD_BATCH = 10;
const changed = (error: unknown) => !isPauseError(error) && /Catalog changed/.test((error as Error).message);

async function scan(host: Host, kind: string, fields: string[]): Promise<Row[]> {
  const rows: Row[] = [];
  let after = '';
  for (let page = 0; page < 100_000; page++) {
    const result = await host('catalog.read', { kind, after, limit: PAGE });
    for (const row of result.records) rows.push({ id: row.id, data: slim(row.data, fields) });
    if (!result.records.length || !result.next) break;
    after = result.next;
  }
  return rows;
}

/** Fold superseded CanadaBuys rows into their canonical record, a few references per transaction at one revision. */
async function applyFolds(host: Host, folds: Map<string, string[]>): Promise<number> {
  const groups = [...folds], records = (rows: any[]) => new Map(rows.map((row: any) => [row.id, row]));
  let written = 0;
  for (let i = 0; i < groups.length; i += FOLD_BATCH) {
    let committed = false;
    for (let attempt = 0; attempt < 4 && !committed; attempt++) {
      try {
        let revision: number | undefined;
        const found = new Map<string, any>(), batch: any[] = [];
        for (const [canonical, superseded] of groups.slice(i, i + FOLD_BATCH)) {
          const ids = [canonical, ...superseded];
          for (let j = 0; j < ids.length; j += 4) {
            const result = await host('catalog.read', { ids: ids.slice(j, j + 4), ...(revision === undefined ? {} : { revision }) });
            revision ??= result.revision;
            for (const [id, row] of records(result.records)) found.set(id, row);
          }
          const row = found.get(canonical);
          if (!row) continue;
          const next = foldAmendments({ id: row.id, data: row.data }, superseded.filter(id => found.has(id)).map(id => ({ id, data: found.get(id).data })));
          if (next) batch.push({ id: row.id, kind: row.kind, title: typeof next.description === 'string' && next.description ? next.description : row.title, data: next });
        }
        if (batch.length) { await host('catalog.commit', { revision, records: batch }); written += batch.length; }
        committed = true;
      } catch (error) { if (!changed(error)) throw error; }
    }
    if (!committed) throw Error('The catalog kept changing; run the cleanup again (it continues safely).');
  }
  return written;
}

/** Re-read each page and commit the marks each record needs as it is now; a conflict re-reads the page. */
async function apply(host: Host, kind: 'opportunity' | 'award', decisions: Decisions): Promise<number> {
  const patchOf = kind === 'opportunity' ? opportunityPatch : awardPatch;
  let after = '', written = 0;
  for (let page = 0; page < 100_000; page++) {
    let next: string | null = null, committed = false;
    for (let attempt = 0; attempt < 4 && !committed; attempt++) {
      const result = await host('catalog.read', { kind, after, limit: PAGE });
      let batch: any[] = [], bytes = 0;
      const flush = async () => {
        if (!batch.length) return;
        const response = await host('catalog.commit', { revision: result.revision, records: batch });
        if (response?.conflict) throw Error('Catalog changed; retry transaction.');
        written += batch.length; batch = []; bytes = 0; result.revision = response?.revision ?? result.revision;
      };
      try {
        for (const row of result.records) {
          const patch = patchOf({ id: row.id, data: row.data }, decisions);
          if (!patch) continue;
          const record = { id: row.id, kind: row.kind, title: row.title, data: applyPatch(row.data, patch) };
          const size = new TextEncoder().encode(JSON.stringify(record)).byteLength;
          if (batch.length && bytes + size > MAX_COMMIT_BYTES) await flush();
          batch.push(record); bytes += size;
        }
        await flush();
        committed = true; next = result.records.length ? result.next : null;
      } catch (error) { if (!changed(error)) throw error; }
    }
    if (!committed) throw Error('The catalog kept changing; run the cleanup again (it continues safely).');
    if (!next) break;
    after = next;
  }
  return written;
}

export async function normalizeCatalog(host: Host, input: NormalizeInput = {}, runId = 'unknown', now = () => new Date().toISOString()) {
  if (input === null || typeof input !== 'object' || Object.keys(input).some(key => key !== 'dryRun') || (input.dryRun !== undefined && typeof input.dryRun !== 'boolean')) throw Error('Invalid cleanup request: only { dryRun: boolean } is accepted.');
  const dryRun = input.dryRun !== false;
  if (!(await host('catalog.read', { ids: [] })).primary) throw Error('Initialize the existing procurement catalog before cleaning it up.');
  const opportunities = await scan(host, 'opportunity', OPPORTUNITY_FIELDS), awards = await scan(host, 'award', AWARD_FIELDS);
  const plan = planNormalization(opportunities, awards);
  const ids = [...plan.patches.keys()], marks = ids.filter(id => Object.keys(plan.patches.get(id)!.set).length).length;
  const report = {
    dryRun, scanned: { opportunities: opportunities.length, awards: awards.length }, ...plan.counts,
    changes: { records: ids.length, marked: marks, cleared: ids.length - marks, opportunities: ids.filter(id => id.startsWith('opportunity:')).length, awards: ids.filter(id => id.startsWith('award:')).length },
    updated: 0, folded: 0, rules: { closing: CLOSING_RULE, awards: AWARD_DUPLICATE_RULE },
  };
  if (dryRun) return report;
  // Folds first, so each canonical record's closing date is judged on its current amendment.
  const folded = await applyFolds(host, plan.decisions.folds);
  const updated = await apply(host, 'opportunity', plan.decisions) + await apply(host, 'award', plan.decisions);
  const result = { ...report, updated, folded };
  // The last run's report, for Status and the operator (no record is touched by this entry).
  for (let attempt = 0; attempt < 4; attempt++) {
    const { revision } = await host('catalog.read', { ids: [] });
    try { await host('catalog.commit', { revision, records: [], entries: [{ key: NORMALIZE_KEY, value: { version: 1, runId, finishedAt: now(), ...result } }] }); break; }
    catch (error) { if (isPauseError(error) || !/Catalog changed/.test((error as Error).message) || attempt === 3) throw error; }
  }
  return result;
}
