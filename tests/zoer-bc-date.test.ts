import { describe, expect, it } from 'vitest';
import { bcDate, closesWithin, closingNotPassed } from '../zoer/dashboard/bc-date';
import { buyerQuery } from '../zoer/dashboard/buyer-query';

describe('BC calendar dates', () => {
  const evening = Date.parse('2026-09-22T00:30:00Z'); // 17:30 PDT on September 21
  it('uses the Pacific calendar day rather than UTC', () => {
    expect(bcDate(evening)).toBe('2026-09-21');
    expect(bcDate(evening, 7)).toBe('2026-09-28');
    expect(bcDate(Date.parse('2026-11-01T09:30:00Z'), 1)).toBe('2026-11-02');
  });
  it('treats date-only closing dates as open until the end of that day', () => {
    expect(closingNotPassed('2026-09-21', evening)).toBe(true);
    expect(closingNotPassed('2026-09-20', evening)).toBe(false);
    expect(closingNotPassed('2026-09-21T23:00:00Z', evening)).toBe(false);
    expect(closingNotPassed('', evening)).toBeNull();
    expect(closesWithin('2026-09-21', 7, evening)).toBe(true);
    expect(closesWithin('2026-09-28', 7, evening)).toBe(true);
    expect(closesWithin('2026-09-29', 7, evening)).toBe(false);
  });
});

describe('buyer mapping query parameter', () => {
  const names = Array.from({ length: 5000 }, (_, i) => `Example Services Branch Office ${i} "Region" \\ West`).concat('Ministry of Health');
  it('sends only matching names for searches and buyer filters, so large inventories stay within bounds', () => {
    const search = buyerQuery(names, 'opportunity', 'organization', { search: 'health' });
    expect(JSON.parse(search.parameter)).toEqual({ plain: { 'Ministry of Health': [0, 1, 1] }, quoted: [] });
    const filter = buyerQuery(names, 'award', 'source', { organization: 'Example Services Branch Office 7 "Region" \\ West' });
    expect(JSON.parse(filter.parameter).quoted).toHaveLength(1);
  });
  it('still bounds a buyer sort, which needs every name', () => {
    expect(() => buyerQuery(names, 'award', 'organization', { sort: { id: 'buyer' } })).toThrow(/bounded query limit/);
  });
});
