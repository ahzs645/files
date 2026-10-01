import { describe, expect, it } from 'vitest';
import {
  HEADLINE_MONEY_KINDS, MONEY_KINDS, calendarDateInZone, deadlineState, parseDeadline, parseMoney, partitionMoney, summarizeMoney,
  type Money,
} from '../../packages/procurement-core/src/index';

describe('parseDeadline', () => {
  it('parses BC Bid closing times in Pacific time with DST from Intl, not fixed offsets', () => {
    expect(parseDeadline('2026-03-17 2:00:00 PM')).toEqual({ raw: '2026-03-17 2:00:00 PM', precision: 'instant', iso: '2026-03-17T21:00:00.000Z', date: '2026-03-17', zone: 'America/Vancouver', zoneBasis: 'default' });
    expect(parseDeadline('2026-01-15 2:00:00 PM').iso).toBe('2026-01-15T22:00:00.000Z');
    expect(parseDeadline('2026-10-01 2:00:00 PM Pacific Time')).toMatchObject({ precision: 'instant', iso: '2026-10-01T21:00:00.000Z', zone: 'America/Vancouver', zoneBasis: 'stated' });
    expect(parseDeadline('2026-12-01 2:00 PM PST').iso).toBe('2026-12-01T22:00:00.000Z');
    expect(parseDeadline('2026-10-09 12:00:00 PM').iso).toBe('2026-10-09T19:00:00.000Z');
    expect(parseDeadline('2026-10-09 12:00:00 AM').iso).toBe('2026-10-09T07:00:00.000Z');
  });

  it('parses ISO instants with offsets or Z', () => {
    expect(parseDeadline('2026-10-01T14:00:00-07:00')).toMatchObject({ precision: 'instant', iso: '2026-10-01T21:00:00.000Z', zone: '-07:00', zoneBasis: 'stated' });
    expect(parseDeadline('2026-10-01T21:00:00Z')).toMatchObject({ iso: '2026-10-01T21:00:00.000Z', zone: 'UTC' });
    expect(parseDeadline('2026-10-01 14:00-0500').iso).toBe('2026-10-01T19:00:00.000Z');
  });

  it('keeps date-only values as date precision', () => {
    expect(parseDeadline('2026-10-01')).toEqual({ raw: '2026-10-01', precision: 'date', iso: null, date: '2026-10-01', zone: 'America/Vancouver', zoneBasis: 'default' });
    expect(parseDeadline('Apr 15, 2026')).toMatchObject({ precision: 'date', date: '2026-04-15' });
    expect(parseDeadline('15 September 2026')).toMatchObject({ precision: 'date', date: '2026-09-15' });
  });

  it('parses month-name instants, other stated zones and a default zone option', () => {
    expect(parseDeadline('January 15, 2026 11:00 AM Eastern Time')).toMatchObject({ iso: '2026-01-15T16:00:00.000Z', zone: 'America/Toronto', zoneBasis: 'stated' });
    expect(parseDeadline('2026-10-01 at 2 PM')).toMatchObject({ precision: 'instant', iso: '2026-10-01T21:00:00.000Z' });
    expect(parseDeadline('2026-10-01 14:00', { defaultZone: 'America/Toronto' }).iso).toBe('2026-10-01T18:00:00.000Z');
    expect(parseDeadline('2026-10-01 14:00 America/Edmonton').iso).toBe('2026-10-01T20:00:00.000Z');
    expect(() => parseDeadline('2026-10-01', { defaultZone: 'Mars/Olympus' })).toThrow(RangeError);
  });

  it('recognizes ranges and keeps the last date', () => {
    expect(parseDeadline('2026-10-01 to 2026-10-05')).toMatchObject({ precision: 'range', date: '2026-10-05', iso: null });
  });

  it('keeps unparseable or invalid values unknown with the raw text', () => {
    for (const raw of ['TBD', 'garbage', '2026-02-30', '2026-10-01 25:00', '2026-10-01 13:00 PM']) {
      expect(parseDeadline(raw)).toEqual({ raw, precision: 'unknown', iso: null, date: null, zone: null, zoneBasis: null });
    }
    expect(parseDeadline(null)).toMatchObject({ raw: '', precision: 'unknown' });
    expect(parseDeadline(undefined).precision).toBe('unknown');
  });
});

describe('deadlineState', () => {
  const dateOnly = parseDeadline('2026-10-01');
  it('a same-day date-only deadline is closing today with time unverified, never closed', () => {
    expect(deadlineState(dateOnly, '2026-10-01T06:59:00Z')).toBe('open'); // Sep 30 23:59 PDT
    expect(deadlineState(dateOnly, '2026-10-01T07:00:00Z')).toBe('closing_today_time_unverified');
    expect(deadlineState(dateOnly, '2026-10-02T06:59:00Z')).toBe('closing_today_time_unverified'); // Oct 1 23:59 PDT, already Oct 2 in UTC
    expect(deadlineState(dateOnly, '2026-10-02T07:00:00Z')).toBe('closed');
  });
  it('uses the value zone for the calendar day', () => {
    const toronto = parseDeadline('2026-10-01', { defaultZone: 'America/Toronto' });
    expect(deadlineState(toronto, '2026-10-02T04:30:00Z')).toBe('closed');
    expect(deadlineState(dateOnly, '2026-10-02T04:30:00Z')).toBe('closing_today_time_unverified');
    expect(calendarDateInZone('2026-10-02T04:30:00Z', 'America/Vancouver')).toBe('2026-10-01');
  });
  it('compares instants exactly', () => {
    const instant = parseDeadline('2026-10-01 2:00:00 PM');
    expect(deadlineState(instant, '2026-10-01T20:59:59Z')).toBe('open');
    expect(deadlineState(instant, '2026-10-01T21:00:00Z')).toBe('closed');
    expect(deadlineState(instant, new Date('2026-10-02T00:00:00Z'))).toBe('closed');
  });
  it('unknown stays unknown and as-of must be valid', () => {
    expect(deadlineState(parseDeadline('TBD'), '2026-10-01T00:00:00Z')).toBe('unknown');
    expect(deadlineState(null, '2026-10-01T00:00:00Z')).toBe('unknown');
    expect(() => deadlineState(dateOnly, 'not a date')).toThrow(TypeError);
  });
  it('ranges close only after their last date', () => {
    const range = parseDeadline('2026-10-01 to 2026-10-05');
    expect(deadlineState(range, '2026-10-03T19:00:00Z')).toBe('open');
    expect(deadlineState(range, '2026-10-05T19:00:00Z')).toBe('closing_today_time_unverified');
  });
});

describe('parseMoney', () => {
  it('parses amounts, codes, ranges, ceilings and multipliers', () => {
    expect(parseMoney('$1,250,000.00 CAD')).toEqual({ lower: 1250000, upper: 1250000, currency: 'CAD', basis: 'unknown', taxBasis: 'unknown', raw: '$1,250,000.00 CAD', isMaximum: false });
    expect(parseMoney('$50,000 - $100,000')).toMatchObject({ lower: 50000, upper: 100000, currency: null });
    expect(parseMoney('up to $2M')).toMatchObject({ lower: null, upper: 2000000, isMaximum: true });
    expect(parseMoney('Not to exceed $750,000 including GST')).toMatchObject({ lower: null, upper: 750000, taxBasis: 'inclusive' });
    expect(parseMoney('between $10k and $20k per year plus GST')).toMatchObject({ lower: 10000, upper: 20000, basis: 'annual', taxBasis: 'exclusive' });
    expect(parseMoney('C$3.5 million excluding taxes')).toMatchObject({ lower: 3500000, currency: 'CAD', taxBasis: 'exclusive' });
    expect(parseMoney('USD 40,000 total contract value')).toMatchObject({ lower: 40000, currency: 'USD', basis: 'total_contract' });
    expect(parseMoney('$85/hour')).toMatchObject({ lower: 85, basis: 'per_unit' });
    expect(parseMoney('minimum $5,000,000 per occurrence')).toMatchObject({ lower: 5000000, upper: null });
    expect(parseMoney('Budget for fiscal 2026: $75,000')).toMatchObject({ lower: 75000, upper: 75000 });
  });
  it('never assumes a currency for a bare dollar sign unless asked', () => {
    expect(parseMoney('$500')!.currency).toBeNull();
    expect(parseMoney('$500', { dollarCurrency: 'CAD' })!.currency).toBe('CAD');
    expect(parseMoney('500 USD', { dollarCurrency: 'CAD' })!.currency).toBe('USD');
  });
  it('keeps unknown as null', () => {
    for (const raw of ['TBD', 'To be negotiated', '', null, undefined, 'at least 25 years of experience', '10% holdback']) expect(parseMoney(raw)).toBeNull();
    expect(parseMoney('Insurance limit 5,000,000 per occurrence')).toMatchObject({ lower: 5000000, currency: null });
  });
});

describe('money partitions', () => {
  const m = (kind: Money['kind'], lower: number | null, upper: number | null, extra: Partial<Money> = {}): Money => ({ kind, lower, upper, currency: 'CAD', basis: 'total_contract', taxBasis: 'unknown', durationMonths: null, raw: null, ...extra });
  const items: Money[] = [
    m('buyer_budget', 100, 100), m('insurance_limit', 5000000, 5000000), m('buyer_budget', 200, 200),
    m('buyer_budget', 300, 300, { currency: 'USD' }), m('buyer_budget', 50, 50, { basis: 'annual' }),
    m('buyer_budget', 10, 10, { currency: null }), m('buyer_budget', null, null), m('buyer_budget', 70, 70, { taxBasis: 'inclusive' }),
  ];
  it('never mixes kind, currency, basis or tax basis', () => {
    const groups = partitionMoney(items);
    expect(groups.map(g => g.key)).toEqual([
      'buyer_budget|CAD|total_contract|unknown', 'insurance_limit|CAD|total_contract|unknown', 'buyer_budget|USD|total_contract|unknown',
      'buyer_budget|CAD|annual|unknown', 'buyer_budget|unknown|total_contract|unknown', 'buyer_budget|CAD|total_contract|inclusive',
    ]);
    for (const group of groups) for (const item of group.items) expect([item.kind, item.currency, item.basis, item.taxBasis]).toEqual([group.kind, group.currency, group.basis, group.taxBasis]);
    expect(groups.reduce((n, g) => n + g.items.length, 0)).toBe(items.length);
  });
  it('summarizes with honest unknown counts and totals only for point values', () => {
    const [budget] = partitionMoney(items);
    expect(summarizeMoney(budget!)).toEqual({ key: 'buyer_budget|CAD|total_contract|unknown', kind: 'buyer_budget', currency: 'CAD', basis: 'total_contract', taxBasis: 'unknown', count: 3, known: 2, unknown: 1, min: 100, max: 200, total: null, label: 'Buyer budget (CAD, total contract)' });
    const [points] = partitionMoney([m('buyer_budget', 100, 100), m('buyer_budget', 200, 200)]);
    expect(summarizeMoney(points!).total).toBe(300);
    const [range] = partitionMoney([m('buyer_budget', 100, 200)]);
    expect(summarizeMoney(range!).total).toBeNull();
    const [unknownCurrency] = partitionMoney([m('buyer_budget', 1, 1, { currency: null, basis: 'unknown' })]);
    expect(summarizeMoney(unknownCurrency!).label).toBe('Buyer budget (currency not stated, basis not stated)');
  });
  it('refuses to summarize a mixed group', () => {
    expect(() => summarizeMoney({ key: 'buyer_budget|CAD|total_contract|unknown', kind: 'buyer_budget', currency: 'CAD', basis: 'total_contract', taxBasis: 'unknown', items: [m('buyer_budget', 1, 1), m('insurance_limit', 2, 2)] })).toThrow(/unlike/);
  });
  it('headline kinds exclude insurance, security and awards', () => {
    expect(HEADLINE_MONEY_KINDS).toEqual(['buyer_budget', 'buyer_estimated_value']);
    for (const kind of HEADLINE_MONEY_KINDS) expect(MONEY_KINDS).toContain(kind);
  });
});
