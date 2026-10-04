// @vitest-environment jsdom
import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { validateCatalogSelect } from '../../zoer/backend/src/catalog-reader';
// The Zoer host's alert SQL has no imports so it can be run beside the plugin's own query builder.
import { procurementAlertQuery } from '../../zoer/backend/src/procurement-alert-query';
import { buildProcurementQuery, checkStatementSize, type ProcurementQueryOptions } from '../zoer/dashboard/procurement/catalog';
import { EXCLUDE_MAX_TERMS, NOISE_TERMS, allExcludeTerms, excludeMatchSql, excludePattern, excludeSql, parseExcludeTerms, withNoiseTerms } from '../zoer/dashboard/procurement/exclude';
import { addDays, zoneDate } from '../zoer/dashboard/procurement/deadline';
import { HIDDEN_IDS_SQL, type ProcurementFilters } from '../zoer/dashboard/procurement/state-contract';
import { opportunityPredicate } from '../zoer/dashboard/review-workspace/opportunity-queries';

const DAY = 86_400_000;
function catalog() {
  const db = new DatabaseSync(':memory:');
  db.exec('CREATE TABLE records(id TEXT PRIMARY KEY,kind TEXT NOT NULL,title TEXT NOT NULL,data TEXT NOT NULL,hash TEXT NOT NULL,updated_at TEXT NOT NULL); CREATE TABLE workspace_state(key TEXT PRIMARY KEY,data TEXT NOT NULL,updated_at TEXT NOT NULL)');
  const add = (id: string, data: Record<string, unknown>, kind = id.split(':')[0]) => { const title = String(data.description ?? data.opportunityDescription ?? id); db.prepare('INSERT INTO records VALUES(?,?,?,?,?,?)').run(id, kind, title, JSON.stringify({ issuedBy: 'City of Victoria', status: 'Open', ...data }), 'h', '2026-10-01T00:00:00Z'); };
  const hide = (recordId: string, hidden = true) => db.prepare('INSERT OR REPLACE INTO workspace_state VALUES(?,?,?)').run('procurement:hidden:' + createHash('sha256').update(recordId).digest('hex'), JSON.stringify({ schemaVersion: 1, recordId, hidden, updatedAt: 'x', lastRunId: 'r' }), 'x');
  const ids = (statement: string, parameters: (string | number)[]) => (db.prepare(statement).all(...parameters) as any[]).map(row => String(row.id)).sort();
  const plugin = (options: ProcurementQueryOptions) => { const query = buildProcurementQuery(options); validateCatalogSelect(query.statement, query.parameters); validateCatalogSelect(query.countStatement, query.countParameters); return ids(`SELECT id FROM records WHERE ${query.where}`, query.countParameters); };
  const host = (filters: Record<string, unknown>, now = Date.now()) => { const query = procurementAlertQuery(filters, now); return ids(query.statement, query.parameters); };
  return { db, add, hide, plugin, host };
}

describe('exclude words', () => {
  it('normalizes terms: separators, case (ASCII like SQLite lower), duplicates, one-letter terms and the cap', () => {
    expect(parseExcludeTerms(' Golf ,golf;; a\n*\nSnow   Removal\nFERTILIZ** ')).toEqual(['golf', 'snow removal', 'fertiliz*']);
    expect(parseExcludeTerms(42)).toEqual([]);
    const many = Array.from({ length: 30 }, (_, i) => `term${i}`).join(',');
    expect(allExcludeTerms(many)).toHaveLength(30);
    expect(parseExcludeTerms(many)).toHaveLength(EXCLUDE_MAX_TERMS);
  });
  it('builds GLOB patterns with literal metacharacters, phrase separators and an optional word-start wildcard', () => {
    expect(excludePattern('golf')).toBe('*[^a-z0-9]golf[^a-z0-9]*');
    expect(excludePattern('snow removal')).toBe('*[^a-z0-9]snow[^a-z0-9]removal[^a-z0-9]*');
    expect(excludePattern('fertiliz*')).toBe('*[^a-z0-9]fertiliz*');
    expect(excludePattern('100%[x]?')).toBe('*[^a-z0-9]100%[[]x][?][^a-z0-9]*');
    expect(excludeSql('')).toBeNull();
    expect(excludeSql('golf, janitorial')!.parameters).toHaveLength(2);
    expect(excludeMatchSql([]).sql).toBe('0');
  });
  it('offers the starter noise list without duplicating words the user already has', () => {
    expect(withNoiseTerms('')).toBe(NOISE_TERMS.join('\n'));
    const next = withNoiseTerms('Golf\nbridges');
    expect(next.startsWith('Golf\nbridges\n')).toBe(true);
    expect(allExcludeTerms(next).filter(term => term === 'golf')).toHaveLength(1);
    expect(allExcludeTerms(withNoiseTerms('')).length).toBeLessThanOrEqual(EXCLUDE_MAX_TERMS);
  });
  it('drops whole-word matches in title, source description and buyer, keeps partial words, and runs under the bridge rules', () => {
    const c = catalog();
    c.add('opportunity:golf', { description: 'Golf Course Mowing' });
    c.add('opportunity:golfing', { description: 'Golfing lessons' });
    c.add('opportunity:desc', { description: 'Facility services', descriptionText: 'Includes JANITORIAL cleaning.' });
    c.add('opportunity:buyer', { description: 'Roof', issuedBy: 'Snow-Removal Authority' });
    c.add('opportunity:fert', { description: 'Fertilizer supply' });
    c.add('award:janitor', { opportunityDescription: 'Janitorial award', issuingOrganization: 'BC Housing' });
    c.add('opportunity:pct', { description: '100%[x]? literal' });
    expect(c.plugin({ exclude: 'golf, janitorial\nsnow removal; fertiliz*' })).toEqual(['opportunity:golfing', 'opportunity:pct']);
    expect(c.plugin({ exclude: '100%[x]?' })).not.toContain('opportunity:pct');
    expect(c.plugin({ exclude: '%' })).toHaveLength(7);
  });
  it('fits the host statement limit with every list filter, a review queue and the maximum number of long terms', () => {
    const exclude = Array.from({ length: EXCLUDE_MAX_TERMS }, (_, i) => `${'x'.repeat(55)}${i}`).join('\n');
    const options: ProcurementQueryOptions = { source: 'bc-bid', kind: 'opportunity', search: 'roof', region: 'Victoria', category: 'Works', buyer: 'B', supplier: 'S', classification: '[]', aiLabel: 'Roofing', starred: true, deadline: 'week', exclude, hidden: 'include', sort: 'date-asc' };
    const queue = opportunityPredicate({ queue: 'eligibility' }, {}, { profileVersionId: 'pv1', workspace: true });
    const query = buildProcurementQuery({ ...options, where: queue });
    expect(() => validateCatalogSelect(query.statement, query.parameters)).not.toThrow();
    expect(() => checkStatementSize(query.statement, query.countStatement)).not.toThrow();
    // Stacking every review filter on top is refused with a plain instruction instead of the bridge's generic error.
    const everything = opportunityPredicate({ queue: 'eligibility', relevance: 'strong', readiness: 'ready', reqCategory: 'insurance', match: 'unknown' }, { gap: 'extract', eligibility: 'blocker', action: 'investigate', decision: 'no_bid' }, { profileVersionId: 'pv1', workspace: true });
    const huge = buildProcurementQuery({ ...options, where: everything });
    expect(() => checkStatementSize(huge.statement)).toThrow('Remove some exclude words');
  });
});

describe('hidden notices', () => {
  it('are left out by default, can be included or listed alone, and are marked in a column; unhiding restores them', () => {
    const c = catalog();
    c.add('opportunity:a', {}); c.add('opportunity:b', {}); c.add('award:c', {});
    c.hide('opportunity:a');
    // A malformed entry without a record id must not turn NOT IN into "exclude everything".
    c.db.prepare('INSERT INTO workspace_state VALUES(?,?,?)').run('procurement:hidden:broken', JSON.stringify({ hidden: true }), 'x');
    expect(c.plugin({ hidden: 'exclude' })).toEqual(['award:c', 'opportunity:b']);
    expect(c.plugin({ hidden: 'include' })).toEqual(['award:c', 'opportunity:a', 'opportunity:b']);
    expect(c.plugin({ hidden: 'only' })).toEqual(['opportunity:a']);
    expect(c.plugin({})).toHaveLength(3);
    const query = buildProcurementQuery({ hidden: 'include', limit: 50 });
    expect((c.db.prepare(query.statement).all(...query.parameters) as any[]).map(row => [row.id, row.hidden])).toEqual([['award:c', 0], ['opportunity:a', 1], ['opportunity:b', 0]]);
    c.hide('opportunity:a', false);
    expect(c.plugin({ hidden: 'exclude' })).toHaveLength(3);
    expect(() => validateCatalogSelect(`SELECT id FROM records WHERE id NOT IN (${HIDDEN_IDS_SQL})`, [])).not.toThrow();
  });
});

describe('saved-search alerts select exactly what the saved search lists', () => {
  const now = Date.now(), today = zoneDate(now);
  const c = catalog();
  c.add('opportunity:roof', { description: 'Roof replacement', closingDate: addDays(today, 3), region: 'Victoria', category: 'Construction', starred: true, externalId: 'BC-100' });
  c.add('opportunity:today', { description: 'HVAC upgrade', closingDate: today, region: 'Nanaimo' });
  c.add('opportunity:passed-open', { description: 'Paving', closingDate: addDays(today, -2) });
  c.add('opportunity:passed-instant', { description: 'Paving instant', closingAt: new Date(now - 3_600_000).toISOString() });
  c.add('opportunity:instant-soon', { sourceId: 'canadabuys', description: 'Federal roof', closingAt: new Date(now + 2 * DAY).toISOString(), closingDate: new Date(now + 2 * DAY).toISOString() });
  c.add('opportunity:zoneless', { sourceId: 'canadabuys', description: 'Zoneless roof', closingDate: `${addDays(today, 2)}T14:00:00` });
  c.add('opportunity:far', { description: 'Roof far', closingDate: addDays(today, 30) });
  c.add('opportunity:day8', { description: 'Roof day 8', closingDate: addDays(today, 8) });
  c.add('opportunity:closed', { description: 'Roof closed', closingDate: addDays(today, 2), status: 'Closed' });
  c.add('opportunity:blank-status', { description: 'Roof blank', closingDate: addDays(today, 2), status: '' });
  c.add('opportunity:janitorial', { description: 'Janitorial services', closingDate: addDays(today, 1), issuedBy: 'BC Housing' });
  c.add('opportunity:hidden', { description: 'Roof hidden', closingDate: addDays(today, 1) });
  c.add('opportunity:fert-desc', { description: 'Grounds', descriptionText: 'Fertilizer application', classificationCodes: [{ code: '1' }] });
  c.add('opportunity:title-differs', { description: 'Bridge', title: 'Roof' });
  c.add('award:roof', { opportunityDescription: 'Roof award', issuingOrganization: 'BC Housing', successfulSupplier: 'Dominion Roofing', category: 'Construction' });
  c.add('award:legacy', { sourceId: '', opportunityDescription: 'Legacy award', successfulSupplier: 'Acme' });
  c.add('opportunity:nanaimo', { description: 'Roof Nanaimo', closingDate: addDays(today, 2), place: { municipality: 'Nanaimo', regionalDistrict: 'Regional District of Nanaimo', method: 'buyer' } });
  c.add('opportunity:rdn', { description: 'Roof RDN', place: { municipality: null, regionalDistrict: 'Regional District of Nanaimo', method: 'buyer' } });
  c.add('opportunity:nanaimo-region-only', { description: 'Roof untagged', region: 'Nanaimo' });
  c.hide('opportunity:hidden');
  const base: ProcurementFilters = { source: '', kind: 'all', search: '', region: '', category: '', classification: '', buyer: '', supplier: '', deadline: 'all', shortlist: false, exclude: '', place: '' };
  const cases: [string, Partial<ProcurementFilters>][] = [
    ['everything', {}], ['source', { source: 'canadabuys' }], ['legacy source', { source: 'bc-bid' }], ['kind', { kind: 'award' }],
    ['search', { search: 'roof' }], ['search by number', { search: 'BC-100' }], ['region', { region: 'Victoria' }], ['category', { category: 'Construction' }],
    ['buyer', { buyer: 'BC Housing' }], ['supplier', { supplier: 'Dominion Roofing' }], ['classification', { classification: JSON.stringify([{ code: '1' }]) }],
    ['shortlist', { shortlist: true }], ['closing in 7 days', { deadline: 'week', kind: 'opportunity' }],
    ['exclude', { exclude: 'janitorial, fertiliz*' }], ['exclude buyer', { exclude: 'bc housing' }],
    ['combined', { deadline: 'week', kind: 'opportunity', search: 'roof', exclude: 'federal' }],
    ['place: municipality', { place: 'm:Nanaimo' }], ['place: regional district', { place: 'rd:Regional District of Nanaimo' }],
    ['place with other filters', { place: 'rd:Regional District of Nanaimo', deadline: 'week', search: 'roof' }],
  ];
  it.each(cases)('%s', (_, partial) => {
    const filters = { ...base, ...partial };
    const options: ProcurementQueryOptions = { source: filters.source, kind: filters.kind, search: filters.search, region: filters.region, category: filters.category, classification: filters.classification, buyer: filters.buyer, supplier: filters.supplier, starred: filters.shortlist, deadline: filters.deadline, exclude: filters.exclude, place: filters.place, hidden: 'exclude', asOf: now };
    const listed = c.plugin(options);
    expect(c.host(filters, now)).toEqual(listed);
    expect(listed).not.toContain('opportunity:hidden');
  });
  it('place filters the tagged place only, never the free-text region', () => {
    expect(c.host({ ...base, place: 'm:Nanaimo' }, now)).toEqual(['opportunity:nanaimo']);
    expect(c.host({ ...base, place: 'rd:Regional District of Nanaimo' }, now)).toEqual(['opportunity:nanaimo', 'opportunity:rdn']);
  });
  it('closing in 7 days keeps today and zoneless dates and drops passed deadlines whatever the source status says', () => {
    expect(c.host({ ...base, deadline: 'week' }, now)).toEqual(['opportunity:instant-soon', 'opportunity:janitorial', 'opportunity:nanaimo', 'opportunity:roof', 'opportunity:today', 'opportunity:zoneless']);
  });
});
