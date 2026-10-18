import { describe, expect, it } from 'vitest';
import { parseDeadline } from '@bcbid/procurement-core';
import { dayLabel, friendlyDeadline } from '../zoer/dashboard/review-workspace/deadline-text';

// Sunday 2026-10-18, 09:00 Pacific (16:00 UTC).
const AS_OF = Date.parse('2026-10-18T16:00:00Z');

describe('friendly deadline text', () => {
  it('reads an ISO date-time without a time zone as Pacific wall-clock time, not an unrecognized date', () => {
    expect(parseDeadline('2026-10-20T14:00:00')).toMatchObject({ precision: 'instant', date: '2026-10-20', iso: '2026-10-20T21:00:00.000Z', zoneBasis: 'default' });
    const d = friendlyDeadline('2026-10-20T14:00:00', AS_OF);
    expect(d.text).toBe('Tue, Oct 20, 2:00 PM · 2 days left');
    expect(d.text).not.toContain('unrecognized');
    expect(d.detail).toBe('2026-10-20T14:00:00 · no time zone stated; Pacific time assumed');
    expect(d).toMatchObject({ state: 'open', tone: 'soon' });
  });
  it('keeps date-only caveats out of the line and in the tooltip', () => {
    expect(friendlyDeadline('2026-10-20', AS_OF)).toEqual({ text: 'Tue, Oct 20 · 2 days left', detail: '2026-10-20 · date only; closing time not verified', state: 'open', tone: 'soon' });
    expect(friendlyDeadline('2026-11-01', AS_OF).text).toBe('Sun, Nov 1 · 14 days left');
    expect(friendlyDeadline('2027-01-05', AS_OF).text).toBe('Tue, Jan 5, 2027 · 79 days left');
  });
  it('says Today and Tomorrow', () => {
    expect(friendlyDeadline('2026-10-18', AS_OF)).toMatchObject({ text: 'Today', state: 'closing_today_time_unverified', tone: 'soon' });
    expect(friendlyDeadline('2026-10-19', AS_OF)).toMatchObject({ text: 'Tomorrow', state: 'open' });
    expect(friendlyDeadline('2026-10-18 2:00:00 PM Pacific Time', AS_OF)).toMatchObject({ text: 'Today, 2:00 PM', detail: '2026-10-18 2:00:00 PM Pacific Time · Pacific time', state: 'open' });
    expect(friendlyDeadline('2026-10-19T21:00:00Z', AS_OF).text).toMatch(/^(Tomorrow|Tue, Oct 20), \d{1,2}:00 [AP]M$/);
    // Late on the 18th Pacific it is already the 19th in UTC; days count in the deadline's own zone.
    expect(friendlyDeadline('2026-10-19', Date.parse('2026-10-19T06:30:00Z')).text).toBe('Tomorrow');
  });
  it('marks closed deadlines and keeps unrecognized text verbatim', () => {
    expect(friendlyDeadline('2026-10-12', AS_OF)).toMatchObject({ text: 'Mon, Oct 12 · closed', state: 'closed', tone: 'passed' });
    expect(friendlyDeadline('2026-10-17', AS_OF).text).toBe('Yesterday · closed');
    expect(friendlyDeadline('see addendum 3', AS_OF)).toMatchObject({ text: 'see addendum 3', state: 'unknown', tone: '' });
    expect(friendlyDeadline('', AS_OF).text).toBe('No deadline given');
    expect(friendlyDeadline('2026-10-20 to 2026-10-24', AS_OF)).toMatchObject({ text: 'Sat, Oct 24 · 6 days left', detail: '2026-10-20 to 2026-10-24 · date range; closing time not verified' });
  });
  it('labels days relative to today', () => {
    expect(dayLabel('2026-10-18', '2026-10-18')).toBe('Today');
    expect(dayLabel('2026-10-19', '2026-10-18')).toBe('Tomorrow');
    expect(dayLabel('2026-10-23', '2026-10-18')).toBe('Fri, Oct 23');
  });
});

describe('result card dates', () => {
  it('keeps the card line short and puts the caveats in the tooltip', async () => {
    const { cardDeadline } = await import('../zoer/dashboard/review-workspace/deadline-text');
    expect(cardDeadline('2026-11-01', 'opportunity', AS_OF)).toMatchObject({ text: 'Closes Nov 1', detail: 'Sun, Nov 1 · 14 days left — 2026-11-01 · date only; closing time not verified' });
    expect(cardDeadline('2026-10-18', 'opportunity', AS_OF).text).toBe('Closes today');
    expect(cardDeadline('2026-10-19T14:00:00', 'opportunity', AS_OF).text).toBe('Closes tomorrow, 2:00 PM');
    expect(cardDeadline('2026-10-12', 'opportunity', AS_OF)).toMatchObject({ text: 'Closed Oct 12', tone: 'passed' });
    expect(cardDeadline('2027-02-01', 'opportunity', AS_OF).text).toBe('Closes Feb 1, 2027');
    expect(cardDeadline('', 'opportunity', AS_OF).text).toBe('No closing date');
    expect(cardDeadline('2026-09-03', 'award', AS_OF).text).toBe('Awarded Sep 3');
  });
});
