import { describe, it, expect } from 'vitest';
import { awardSummary, closingCell, formatAwardValue, opportunitySummary, sourceReference } from '../zoer/dashboard/bid-summaries';

describe('phone list row summaries', () => {
  it('describes an opportunity with fallbacks for missing fields', () => {
    expect(opportunitySummary({ sourceKey: 'bcbid:1', description: ' Roof repair ', status: 'Open', opportunityId: '4351', closingDate: '2026-09-08', detailUrl: 'https://bcbid.gov.bc.ca/x' }))
      .toMatchObject({ key: 'bcbid:1', processId: 'bcbid:1', title: 'Roof repair', status: 'Open', id: '4351', closingDate: expect.stringMatching(/Sep 8, 2026/), detailUrl: 'https://bcbid.gov.bc.ca/x' });
    expect(opportunitySummary({ sourceKey: 'k', processId: 'p-9', detailUrl: 'javascript:alert(1)' })).toMatchObject({ processId: 'p-9', title: 'Untitled opportunity', status: 'Unknown status', closingDate: 'N/A', detailUrl: '' });
  });
  it('shows the source reference, never the synthetic record key, as the Opportunity ID', () => {
    const kelowna = 'browser-sites:kelowna:reference-13009-name-construction-aurora-park';
    expect(sourceReference({ sourceKey: kelowna, opportunityId: kelowna, externalId: '13009' })).toBe('13009');
    const penticton = 'municipal-sites:penticton:supply-and-delivery-transformers-0';
    expect(sourceReference({ sourceKey: penticton, opportunityId: penticton, externalId: 'supply-and-delivery-transformers-0' })).toBe('');
    expect(sourceReference({ sourceKey: 'bcbid:1', opportunityId: 'P303832' })).toBe('P303832');
    expect(opportunitySummary({ sourceKey: penticton, opportunityId: penticton }).id).toBe('');
  });
  it('formats closing dates one way, preferring the parsed instant over the source text', () => {
    const at = closingCell({ closingDate: '10/05/26 2:00pm', closingAt: '2026-10-05T14:00:00-07:00' });
    expect(at).not.toContain('10/05/26');
    expect(at).toMatch(/2026/);
    expect(closingCell({ closingDate: '2015-04-06' })).toMatch(/Apr 6, 2015/);
    expect(closingCell({ closingDate: 'Upon award' })).toBe('Upon award');
    expect(closingCell({ closingDate: '' })).toBe('');
  });
  it('formats award values in their own currency and tolerates unknown codes', () => {
    expect(formatAwardValue(102075, 'CAD')).toMatch(/102,075/);
    expect(formatAwardValue(102075, 'CAD')).not.toMatch(/\.\d/);
    expect(formatAwardValue('2500', 'usd')).toMatch(/2,500/);
    expect(formatAwardValue(10, 'Dollars')).toBe('10 Dollars');
    expect(formatAwardValue(10, '')).toBe('10');
    expect(formatAwardValue(null, 'CAD')).toBe('');
    expect(formatAwardValue('n/a', 'CAD')).toBe('');
  });
  it('describes an award, keeping the original text only when a numeric value was formatted', () => {
    const award = awardSummary({ importKey: 'a1', opportunityDescription: 'Fire suppression', successfulSupplier: 'Acme', awardDate: '2026-01-02', contractValue: 102075, currency: 'CAD', contractValueText: '$102,075.00', contractNumber: 'C-1', sourceUrl: 'https://bcbid.gov.bc.ca/award/1' });
    expect(award).toMatchObject({ key: 'a1', title: 'Fire suppression', supplier: 'Acme', awardDate: '2026-01-02', originalValueText: '$102,075.00', contractNumber: 'C-1', sourceUrl: 'https://bcbid.gov.bc.ca/award/1' });
    expect(award.valueText).toMatch(/102,075/);
    expect(awardSummary({ importKey: 'a2', contractValueText: 'Not disclosed', sourceUrl: 'http://insecure.example' })).toMatchObject({ title: 'Untitled award', supplier: 'Supplier not stated', awardDate: 'Undated', valueText: 'Not disclosed', originalValueText: '', sourceUrl: '' });
    expect(awardSummary({ importKey: 'a3' }).valueText).toBe('Value not stated');
  });
});
