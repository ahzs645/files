import { describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { buildContractAwardImportKey, buildLegacyContractAwardImportKey, contractAwardIdentity, deduplicateContractAwards, normalizeContractAwardImportRecord, parseContractAwardMoney, parseContractAwardValue, reconcileContractAwardIdentity } from '../packages/shared/src/contractAwards';
import { opportunityLifecycle } from '../zoer/dashboard/procurement/lifecycle';
import { publicationBuyerMetadata } from '../zoer/src/publication-metadata';
import { readAnalysisRows, readCoverage, readUnreviewed } from '../zoer/dashboard/review-analysis';
import { readReviewResults } from '../zoer/dashboard/review-results';
import { latestReview } from '../zoer/dashboard/procurement/ai';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
const readerSource = process.env.ZOER_SOURCE_ROOT
  ? pathToFileURL(join(process.env.ZOER_SOURCE_ROOT, 'backend/src/catalog-reader.ts')).href
  : new URL('../../zoer/backend/src/catalog-reader.ts', import.meta.url).href;
const { validateCatalogSelect } = await import(readerSource);

const award = normalizeContractAwardImportRecord({ opportunityId: 'A-123', opportunityDescription: 'Original title', contractNumber: 'C-1', contractValueText: '1,000.00', currency: 'CAD', successfulSupplier: 'Supplier', issuingOrganization: 'Buyer' } as any);
const now = Date.parse('2026-10-22T12:00:00-07:00');

describe('validated source money', () => {
  it.each([
    ['1.2 million', '1200000.00', '120000000', 1200000],
    ['(1,234.50)', '-1234.50', '-123450', -1234.5],
    ['CAD $1,234.50', '1234.50', '123450', 1234.5],
    ['$0.00', '0.00', '0', 0],
    ['-0.01', '-0.01', '-1', -0.01],
  ])('parses %s without discarding semantic characters', (raw, decimal, minorUnits, value) => {
    expect(parseContractAwardMoney(raw as string, { currency: 'CAD' })).toMatchObject({ raw, status: 'parsed', decimal, minorUnits, value, scale: 2, currency: 'CAD', parserVersion: 'award-money-v2' });
  });
  it.each(['1,23.45', '12.34.56', '100 to 200', '100 + tax', '1e6', '$1,234 CAD USD', '(-1,234.50)', '--1', '∞', 'CAD not disclosed'])('keeps invalid input %s unknown', raw => {
    expect(parseContractAwardMoney(raw, { currency: 'CAD' }).value).toBeNull();
  });
  it('does not round fractional minor units or cross currency bounds', () => {
    expect(parseContractAwardMoney('1.005', { currency: 'CAD' })).toMatchObject({ status: 'ambiguous', value: null });
    expect(parseContractAwardMoney('100 USD', { currency: 'CAD' }).status).toBe('ambiguous');
    expect(parseContractAwardMoney('10.1', { currency: 'JPY' }).value).toBeNull();
    expect(parseContractAwardMoney('9007199254740992', { currency: 'CAD' }).status).toBe('out_of_bounds');
    expect(parseContractAwardMoney('9'.repeat(10000), { currency: 'CAD' }).status).toBe('out_of_bounds');
    expect(parseContractAwardMoney('$10')).toMatchObject({ status: 'parsed', currency: null });
  });
  it('uses a declared locale rather than guessing ambiguous separators', () => {
    expect(parseContractAwardMoney('1 234,50', { currency: 'CAD', locale: 'fr-CA' })).toMatchObject({ status: 'parsed', decimal: '1234.50' });
    expect(parseContractAwardValue('1 234,50', 'CAD')).toBeNull();
    expect(parseContractAwardMoney(' 1.2 million ', { currency: 'CAD' }).raw).toBe(' 1.2 million ');
  });
});

describe('source identities and mapping provenance', () => {
  it('keeps a reliable award identity through title, party, date and value corrections', () => {
    const changed = { ...award, opportunityDescription: 'Corrected title', successfulSupplier: 'Corrected supplier', awardDate: '2026-10-01', contractValueText: '2,000', issuingOrganization: 'Corrected buyer' };
    expect(buildContractAwardImportKey(changed)).toBe(buildContractAwardImportKey(award));
    expect(buildContractAwardImportKey({ ...award, sourceId: 'another-source' })).not.toBe(buildContractAwardImportKey(award));
    expect(buildContractAwardImportKey({ ...award, contractNumber: 'C-2' })).not.toBe(buildContractAwardImportKey(award));
  });
  it('preserves legacy IDs and rejects competing physical identities', () => {
    const saved = { ...award, importKey: buildLegacyContractAwardImportKey(award), starred: true };
    expect(reconcileContractAwardIdentity({ ...award, opportunityDescription: 'Correction' }, [saved])).toMatchObject({ importKey: saved.importKey, previous: { starred: true } });
    expect(() => reconcileContractAwardIdentity(award, [saved, { ...award, importKey: buildContractAwardImportKey(award) }])).toThrow('multiple saved');
    expect(() => reconcileContractAwardIdentity(award, [{ ...saved, _id: 'one' }, { ...saved, _id: 'two' }])).toThrow('multiple saved');
  });
  it('leaves missing source identifiers unresolved and preserves case-sensitive source IDs', () => {
    expect(contractAwardIdentity({ ...award, contractNumber: 'N/A' }).status).toBe('legacy_unresolved');
    expect(buildContractAwardImportKey({ ...award, sourceAwardId: 'Ab' })).not.toBe(buildContractAwardImportKey({ ...award, sourceAwardId: 'ab' }));
    expect(contractAwardIdentity({ ...award, contractNumber: null }).status).toBe('legacy_unresolved');
  });
  it('never silently collapses differing awards sharing a proposed contract anchor', () => {
    expect(deduplicateContractAwards([award, {...award}])).toHaveLength(1);
    expect(() => deduplicateContractAwards([award, {...award,successfulSupplier:'Another lot winner'}])).toThrow('distinct sourceAwardId');
    expect(deduplicateContractAwards([{...award,sourceAwardId:'lot-1'},{...award,sourceAwardId:'lot-2'}])).toHaveLength(2);
  });
  it('cannot adopt a different source record just because an old unscoped key matches', () => {
    const saved = { ...award, importKey: buildLegacyContractAwardImportKey(award) };
    const other = { ...award, sourceId: 'canadabuys' };
    const reconciled = reconcileContractAwardIdentity(other, [saved]);
    expect(reconciled.previous).toBeUndefined();expect(reconciled.importKey).not.toBe(saved.importKey);
    expect(buildContractAwardImportKey({ ...other,contractNumber:null })).not.toBe(buildContractAwardImportKey({ ...award,contractNumber:null }));
  });
  it('publishes versioned proposed mappings without inventing an unknown parent', () => {
    const mapped = publicationBuyerMetadata('award', award);
    expect(mapped).toMatchObject({ buyerId: 'unmapped:Buyer', buyerOrganizationId: 'unmapped:Buyer', buyerOrganization: 'Buyer', contractNumberMissing: false, justificationMissing: true,
      mappingProvenance: { authority: 'proposed-source-label-mapping', status: 'Not mapped' } });
    expect(mapped.mappingVersion).toBe(mapped.mappingProvenance.version);
  });
});

describe('one source-status/deadline lifecycle', () => {
  it('never counts cancelled notices as closing soon and closes stale open notices', () => {
    expect(opportunityLifecycle({ status: 'Cancelled', closingDate: '2026-10-23' }, now)).toMatchObject({ open: false, closingSoon: false, reason: 'source_closed' });
    expect(opportunityLifecycle({ status: 'Open', closingAt: '2026-10-22T11:00:00-07:00' }, now)).toMatchObject({ open: false, reason: 'deadline_passed' });
    expect(opportunityLifecycle({ status: 'Open', closingDate: '2026-10-21' }, now).open).toBe(false);
  });
  it('preserves same-day uncertainty and distinguishes unknown status and deadline', () => {
    expect(opportunityLifecycle({ status: 'Open', closingDate: '2026-10-22' }, now)).toMatchObject({ state: 'closing_today_time_unverified', open: true, closingSoon: true });
    expect(opportunityLifecycle({ status: 'Open', closingDate: 'bad' }, now)).toMatchObject({ open: true, closingSoon: false });
    expect(opportunityLifecycle({ status: '', closingDate: '2026-10-23' }, now)).toMatchObject({ open: false, reason: 'unverified_status' });
  });
});

function catalog() {
  const db = new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE records(id TEXT PRIMARY KEY,kind TEXT,title TEXT,data TEXT);
    CREATE TABLE reviews(id TEXT PRIMARY KEY,record_id TEXT,prompt_id TEXT,prompt_version INTEGER,status TEXT,result TEXT,created_at TEXT,run_id TEXT,model TEXT,error TEXT);
    CREATE INDEX reviews_scope ON reviews(record_id,prompt_id,created_at,id)`);
  const save = (id: string, status = 'Open', deadline: string | null = null) => db.prepare('INSERT INTO records VALUES(?,?,?,?)').run(id, 'opportunity', id, JSON.stringify({ sourceId: 'bc-bid', status, closingDate: deadline }));
  const review = (id: string, recordId: string, status = 'succeeded', version = 1) => db.prepare('INSERT INTO reviews VALUES(?,?,?,?,?,?,?,?,?,?)').run(id, recordId, 'p', version, status, JSON.stringify({ fields: { choice: id }, labels: [] }), '2026-10-22T10:00:00Z', 'run', 'model', null);
  const query = async (_method: 'catalog.query', input: { statement: string; parameters: (string | number)[] }) => {
    validateCatalogSelect(input.statement, input.parameters);
    return { rows: db.prepare(input.statement).all(...input.parameters) };
  };
  return { db, save, review, query };
}

describe('complete deterministic review projections on real SQLite', () => {
  it('reads beyond the former 4,000-row limit with bounded pages', async () => {
    const { db, save, review, query } = catalog();
    try {
      db.exec('BEGIN'); for (let i = 0; i < 4001; i++) { const id = `n${String(i).padStart(5, '0')}`; save(id); review(id, id); } db.exec('COMMIT');
      const result = await readAnalysisRows(query, { promptId: 'p' });
      expect(result.rows).toHaveLength(4001); expect(result.truncated).toBe(false);
    } finally { db.close(); }
  });
  it('resolves timestamp ties exactly and excludes an older success after failure', async () => {
    const { db, save, review, query } = catalog();
    try {
      save('one'); review('a', 'one'); review('b', 'one');
      const projection = await readAnalysisRows(query);
      expect(projection.rows).toHaveLength(1); expect(projection.rows[0].fields.choice).toBe('b');
      expect((await readReviewResults(query, 'p')).rows.map(row => row.id)).toEqual(['b']);
      expect(latestReview([{id:'a',created_at:'2026-10-22',status:'succeeded',result:{}},{id:'b',created_at:'2026-10-22',status:'succeeded',result:{}}]).id).toBe('b');
      review('c', 'one', 'failed');
      expect((await readAnalysisRows(query)).rows).toEqual([]);
      expect(await readCoverage(query, now)).toEqual([{ source: 'bc-bid', open: 1, reviewed: 0, reviewFailed: 1 }]);
      expect(await readUnreviewed(query, 'bc-bid', 50, now)).toEqual(['one']);
    } finally { db.close(); }
  });
  it('uses exactly the same eligibility for source coverage and unreviewed selection', async () => {
    const { db, save, review, query } = catalog();
    try {
      save('today', 'Open', '2026-10-22'); save('soon', 'Active', '2026-10-23'); save('cancelled', 'Cancelled', '2026-10-23'); save('past', 'Open', '2026-10-21'); save('unknown', '', '2026-10-23');
      review('success', 'today');
      expect(await readCoverage(query, now)).toEqual([{ source: 'bc-bid', open: 2, reviewed: 1, reviewFailed: 0 }]);
      expect(await readUnreviewed(query, 'bc-bid', 50, now)).toEqual(['soon']);
    } finally { db.close(); }
  });
  it('fails explicitly on a truncated SQL projection', async () => {
    await expect(readAnalysisRows(async () => ({ rows: [], truncated: true }))).rejects.toThrow('truncated');
  });
});
