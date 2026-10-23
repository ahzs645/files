import { describe, expect, it } from 'vitest';
import { buildContractAwardImportKey, buildLegacyContractAwardImportKey, contractAwardIdentity, deduplicateContractAwards, normalizeContractAwardImportRecord, parseContractAwardMoney, parseContractAwardValue, reconcileContractAwardIdentity } from '../packages/shared/src/contractAwards';
import { publicationBuyerMetadata } from '../zoer/src/publication-metadata';
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

