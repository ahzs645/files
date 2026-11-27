/** Award table cells read as values: money, calendar dates (future ones flagged), "—" for what the source left out. */
import { describe, expect, it } from 'vitest';
import { awardDateCell, awardDateText, formatAwardDay } from '../zoer/dashboard/award-dates';
import { awardMoney, missingText } from '../zoer/dashboard/bid-columns';

const now = Date.parse('2026-11-27T20:00:00Z');
describe('award money', () => {
  it('formats CAD (stated or implied) and other currencies, cents only when present', () => {
    expect(awardMoney(3000000, 'CAD')).toBe('$3,000,000');
    expect(awardMoney('3000000', null)).toBe('$3,000,000');
    expect(awardMoney(369603.4, 'cad')).toBe('$369,603.40');
    expect(awardMoney(136000, 'USD')).toBe('US$136,000');
    expect(awardMoney(0, 'CAD')).toBe('$0');
    expect(awardMoney(-2500, 'CAD')).toBe('-$2,500');
  });
  it('shows a dash for anything that is not an amount', () => {
    for (const value of [null, undefined, '', 'null', 'N/A', '3,000,000.00 approx', NaN]) expect(awardMoney(value, 'CAD')).toBe('—');
  });
});
describe('missing text', () => {
  it('treats absent, blank, "null" and "N/A" as missing and keeps real words', () => {
    for (const value of [null, undefined, '', '  ', 'null', 'NULL', 'N/A', 'n/a', 'NA']) expect(missingText(value)).toBe(true);
    for (const value of ['Competitive', 'None', '0', 0, 'Not applicable']) expect(missingText(value)).toBe(false);
  });
});
describe('award dates', () => {
  it('formats calendar days and keeps the source text in the tooltip', () => {
    expect(formatAwardDay('2026-11-26')).toBe('Nov 26, 2026');
    expect(formatAwardDay('2024-02-29T08:00:00Z')).toBe('Feb 29, 2024');
    expect(formatAwardDay('2026-02-30')).toBeNull();
    expect(formatAwardDay('TBD')).toBeNull();
    expect(awardDateCell('2026-11-26', now)).toEqual({ text: 'Nov 26, 2026', future: false, title: '2026-11-26' });
  });
  it('flags dates after today instead of stating them as fact', () => {
    const cell = awardDateCell('2027-07-01', now);
    expect(cell.future).toBe(true); expect(cell.text).toBe('Jul 1, 2027'); expect(cell.title).toMatch(/after today/);
    expect(awardDateCell('2026-11-27', now).future).toBe(false);
  });
  it('replaces dates past the plausible limit and dashes missing ones', () => {
    expect(awardDateCell('2107-09-28', now).text).toBe('Date unknown (source says 2107-09-28)');
    expect(awardDateCell(null, now).text).toBe('—');
    expect(awardDateCell('Spring 2025', now).text).toBe('Spring 2025');
  });
  it('reads the same in the phone list', () => {
    expect(awardDateText('2026-11-26', now)).toBe('Nov 26, 2026');
    expect(awardDateText('2027-07-01', now)).toBe('Jul 1, 2027 · after today, check source');
    expect(awardDateText('', now)).toBe('');
  });
});
