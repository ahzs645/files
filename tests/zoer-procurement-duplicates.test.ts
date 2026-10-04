import { describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { validateCatalogSelect } from '../../zoer/backend/src/catalog-reader';
import { CANDIDATE_LIMIT, DUPLICATE_THRESHOLD, closingDay, duplicateCandidatesQuery, explainDuplicate, findDuplicates, noticeSummaryQuery, normalizeBuyer, pageDuplicates, pageDuplicatesQuery, scoreDuplicate, titleTokens, tokenSimilarity, type NoticeSummary } from '../zoer/dashboard/procurement/duplicates';

const notice = (id: string, fields: Partial<NoticeSummary> = {}): NoticeSummary => ({ id, title: 'Bowen Road Paving Program', buyer: 'City of Nanaimo', deadline: '2026-10-07', url: null, sourceId: 'bc-bid', ...fields });

describe('normalisation', () => {
  it('strips legal forms, municipal prefixes, punctuation and accents from buyers', () => {
    expect(normalizeBuyer('The Corporation of the City of Nanaimo')).toBe('nanaimo');
    expect(normalizeBuyer('Nanaimo, City of')).toBe('nanaimo');
    expect(normalizeBuyer('ACME Construction Ltd.')).toBe('acme construction');
    expect(normalizeBuyer('Société Québec Inc')).toBe('societe quebec');
    expect(normalizeBuyer('Regional District of Nanaimo')).toBe('regional district of nanaimo');
  });
  it('drops notice-type words and reference numbers from titles but keeps short numbers', () => {
    expect(titleTokens('RFP 2026-14: Bowen Road Paving Programs')).toEqual(['bowen', 'road', 'paving', 'program']);
    expect(titleTokens('ITT #10234 Phase 2 Watermain')).toEqual(['phase', '2', 'watermain']);
    expect(tokenSimilarity(titleTokens('Phase 2 Watermain'), titleTokens('Phase 3 Watermain'))).toBeLessThan(1);
  });
  it('reads closing days from ISO values and source dates', () => {
    expect(closingDay('2026-10-07T15:00:00-07:00')).toBe('2026-10-07');
    expect(closingDay('2026-10-07')).toBe('2026-10-07');
    expect(closingDay('Wed Oct 7, 2026 3:00 PM (PDT)')).toBeNull();
  });
});

describe('scoring (title 0.4, buyer 0.3, date 0.2, URL 0.1; threshold 0.85)', () => {
  it('treats the same job on two portals as a duplicate and explains it', () => {
    const score = scoreDuplicate(notice('a', { title: 'RFP 2026-14 Bowen Road Paving Program', buyer: 'The Corporation of the City of Nanaimo' }), notice('b', { title: 'Bowen Road Paving Programs', deadline: '2026-10-07T15:00:00-07:00', sourceId: 'bidsandtenders' }));
    expect(score).toMatchObject({ score: 1, exact: true });
    expect(explainDuplicate(score)).toBe('Same buyer, same title words, same closing day');
  });
  it('scores partial matches with the weights and says so in words', () => {
    const score = scoreDuplicate(notice('a'), notice('b', { title: 'Bowen Road Paving and Sidewalk Program', deadline: '2026-10-07T14:00:00-07:00' }));
    expect(score.title).toBeCloseTo(8 / 9, 3); // "and" is filler: 4 shared words of 4 and 5
    expect(score.score).toBeCloseTo(0.4 * 8 / 9 + 0.3 + 0.2, 3);
    expect(score.score).toBeGreaterThanOrEqual(DUPLICATE_THRESHOLD);
    expect(explainDuplicate(score)).toBe('Same buyer, title 89% similar, same closing day');
  });
  it('allows a day for date-only values, not for two exact instants', () => {
    expect(scoreDuplicate(notice('a'), notice('b', { deadline: '2026-10-08' })).score).toBe(0.9);
    const instants = scoreDuplicate(notice('a', { deadline: '2026-10-07T23:00:00Z' }), notice('b', { deadline: '2026-10-08T23:00:00Z' }));
    expect(instants.score).toBeCloseTo(0.8, 3);
    expect(explainDuplicate(instants)).toContain('closing dates 1 day apart');
  });
  it('does not confuse different buyers, different jobs or City and District of North Vancouver', () => {
    expect(scoreDuplicate(notice('a'), notice('b', { buyer: 'City of Kamloops' })).score).toBeLessThan(DUPLICATE_THRESHOLD);
    expect(scoreDuplicate(notice('a'), notice('b', { title: 'Janitorial services' })).score).toBeLessThan(DUPLICATE_THRESHOLD);
    expect(scoreDuplicate(notice('a', { buyer: 'City of North Vancouver' }), notice('b', { buyer: 'District of North Vancouver' })).buyer).toBe(0);
    expect(scoreDuplicate(notice('a'), notice('b', { deadline: '2026-11-07' })).score).toBeLessThan(DUPLICATE_THRESHOLD);
  });
  it('counts the same notice link as a duplicate', () => {
    expect(scoreDuplicate(notice('a', { url: 'https://www.x.ca/n/1/' }), notice('b', { title: 'Other', buyer: 'Other', deadline: null, url: 'https://x.ca/n/1' }))).toMatchObject({ score: 1, sameUrl: true });
  });
});

describe('candidate SQL through the host validator', () => {
  const db = new DatabaseSync(':memory:');
  db.exec('CREATE TABLE records(id TEXT PRIMARY KEY,kind TEXT NOT NULL,title TEXT NOT NULL,data TEXT NOT NULL,hash TEXT NOT NULL,updated_at TEXT NOT NULL)');
  const insert = db.prepare('INSERT INTO records VALUES(?,?,?,?,?,?)');
  const add = (id: string, data: any, kind = 'opportunity') => insert.run(id, kind, data.description ?? id, JSON.stringify(data), 'h', '2026-10-01');
  add('opportunity:1', { description: 'RFP 2026-14 Bowen Road Paving Program', issuedBy: 'City of Nanaimo', closingDate: '2026-10-07', detailUrl: 'https://bcbid.gov.bc.ca/1' });
  add('opportunity:bidsandtenders:nanaimo:9', { sourceId: 'bidsandtenders', description: 'Bowen Road Paving Program', issuedBy: 'City of Nanaimo', closingDate: 'Wed Oct 7, 2026 3:00 PM (PDT)', closingAt: '2026-10-07T15:00:00-07:00', detailUrl: 'https://nanaimo.bidsandtenders.ca/9' });
  add('opportunity:canadabuys:tender:x:', { sourceId: 'canadabuys', description: 'Bowen Road Paving Program', issuedBy: 'Public Services and Procurement Canada', closingDate: '2026-12-01' });
  add('opportunity:2', { description: 'Harewood park washrooms', issuedBy: 'City of Nanaimo', closingDate: '2026-11-20' });
  add('opportunity:3', { description: 'Office supplies', issuedBy: 'City of Kamloops', closingDate: '2026-10-08' });
  add('opportunity:4', { description: 'Fleet tires', issuedBy: 'City of Kamloops', closingDate: '2026-12-24' });
  add('award:1', { opportunityDescription: 'Bowen Road Paving Program', issuedBy: 'City of Nanaimo', awardDate: '2026-10-07' }, 'award');
  for (let i = 0; i < 220; i++) add(`opportunity:z${String(i).padStart(3, '0')}`, { description: `Unrelated ${i}`, issuedBy: 'Province', closingDate: '2026-10-06' });
  const read = (statement: string, parameters: (string | number)[]) => { validateCatalogSelect(statement, parameters); expect(statement).not.toMatch(/\b(?:and|or|where|then|else|not)\s*\(/i); return db.prepare(`SELECT * FROM (${statement}) LIMIT 201`).all(...parameters) as any[]; };
  const self = () => read(noticeSummaryQuery('opportunity:1').statement, noticeSummaryQuery('opportunity:1').parameters)[0] as NoticeSummary;

  it('reads candidates by title, closing day ± 1 and buyer, title and date matches first, capped at 200', () => {
    const query = duplicateCandidatesQuery(self());
    expect(query.statement.length).toBeLessThan(10_000);
    const rows = read(query.statement, query.parameters);
    expect(rows).toHaveLength(CANDIDATE_LIMIT);
    const ids = rows.map(row => row.id);
    for (const id of ['opportunity:bidsandtenders:nanaimo:9', 'opportunity:3']) expect(ids).toContain(id);
    expect(ids).not.toContain('opportunity:canadabuys:tender:x:'); // other title, buyer and month
    expect(ids).not.toContain('opportunity:2'); // buyer-only matches rank last, so the cap drops them first
    expect(ids).not.toContain('opportunity:1');
    expect(ids).not.toContain('award:1');
    const matches = findDuplicates(self(), rows);
    expect(matches.map(match => match.notice.id)).toEqual(['opportunity:bidsandtenders:nanaimo:9']);
    expect(matches[0].notice.sourceId).toBe('bidsandtenders');
  });
  it('finds a same-buyer candidate outside the date window', () => {
    const query = duplicateCandidatesQuery({ ...self(), title: 'Harewood park washroom', deadline: null });
    expect(read(query.statement, query.parameters).map(row => row.id)).toContain('opportunity:2');
  });
  it('flags a result page with one exact-title query', () => {
    const page = [self(), read(noticeSummaryQuery('opportunity:2').statement, ['opportunity:2'])[0]];
    const query = pageDuplicatesQuery(page)!;
    expect(query.parameters).toHaveLength(2);
    const flags = pageDuplicates(page, read(query.statement, query.parameters));
    expect([...flags.keys()]).toEqual([]); // exact titles differ ("RFP 2026-14 …"): only the notice view's fuzzy check finds it
    const bt = read(noticeSummaryQuery('opportunity:bidsandtenders:nanaimo:9').statement, ['opportunity:bidsandtenders:nanaimo:9'])[0];
    const flagged = pageDuplicates([bt], read(pageDuplicatesQuery([bt])!.statement, pageDuplicatesQuery([bt])!.parameters));
    expect(flagged.get(bt.id)).toBeUndefined(); // the CanadaBuys copy has the same title but another buyer and date
    expect(pageDuplicatesQuery([])).toBeNull();
  });
});
