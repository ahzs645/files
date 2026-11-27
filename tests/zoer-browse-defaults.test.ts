// @vitest-environment jsdom
/**
 * Opportunities › Browse: the default list (open opportunities, closing soonest) and its URL contract, the one status
 * chip per row, the Compare empty-state rule and the phone layout rule.
 */
import { describe, expect, it } from 'vitest';
import { ANY_STATUS, browseDefaults, browseLayout, pinDefaultStatus } from '../zoer/dashboard/procurement/browse-defaults';
import { rowStatus } from '../zoer/dashboard/procurement/display';
import { readReviewScope, reviewScopeHref } from '../zoer/dashboard/review-workspace/queue';
import { COMPARE_MAX, COMPARE_MIN, compareReady } from '../zoer/dashboard/review-workspace/compare-rule';

const read = (query: string) => browseDefaults(new URLSearchParams(query));

describe('Browse opens on open opportunities, closing soonest', () => {
  it('defaults a bare link to Open and Closing soonest', () => {
    const d = read('');
    expect(d).toMatchObject({ defaultStatus: true, anyStatus: false, sort: 'deadline', defaultSort: true });
    expect(d.params.get('open')).toBe('1');
    // Page, layout, search and source links get the same default.
    for (const query of ['layout=table', 'page=2', 'search=roof', 'source=bc-bid', 'shortlist=1', 'view=matrix', 'notice=r1', 'savedSearch=s1']) expect(read(query).params.get('open'), query).toBe('1');
  });
  it('keeps the meaning of links with an explicit status or sort', () => {
    expect(read('sort=updated')).toMatchObject({ sort: 'updated', defaultSort: false, defaultStatus: true });
    expect(read('sort=fit').sort).toBe('fit');
    expect(read('sort=bogus')).toMatchObject({ sort: 'deadline', defaultSort: true });
    // "Any status" is one explicit value; it is not passed on as a source status.
    const any = read(`status=${ANY_STATUS}`);
    expect(any).toMatchObject({ anyStatus: true, defaultStatus: false });
    expect(any.params.has('open')).toBe(false);
    expect(any.params.has('status')).toBe(false);
    expect(read('status=Awarded').params.get('status')).toBe('Awarded');
    expect(read('status=Awarded').params.has('open')).toBe(false);
    expect(read('lifecycle=closed').params.has('open')).toBe(false);
    expect(read('open=1').defaultStatus).toBe(false);
  });
  it('lands Home links where they point', () => {
    // "All closing in 7 days" and the Open tile: open, closing soonest.
    const week = read(reviewScopeHref({ open: true }).split('?')[1] + '&deadline=week&sort=deadline');
    expect(week).toMatchObject({ sort: 'deadline', defaultStatus: false });
    expect(week.params.get('open')).toBe('1');
    // Queue links imply open opportunities already and need no status.
    expect(reviewScopeHref({ queue: 'decide' })).toBe('/procurement?queue=decide');
    expect(read('queue=decide').params.get('open')).toBe('1');
  });
  it('keeps drill-ins over every status on Any status', () => {
    // Insights "All saved notices" cells, Market and Taxonomy links count every status.
    const href = reviewScopeHref({ relevance: 'strong', readiness: 'ready' }, { view: 'table' });
    expect(href).toBe('/procurement?view=table&relevance=strong&readiness=ready&status=all');
    expect(readReviewScope(href)).toEqual({ relevance: 'strong', readiness: 'ready' });
    expect(read(href.split('?')[1])).toMatchObject({ anyStatus: true, defaultStatus: false });
    for (const query of ['kind=opportunity&classification=UNSPSC%3A72', 'buyer=City', 'supplier=Acme', 'category=Works', 'region=Victoria', 'kind=award', 'kind=all&search=roof']) {
      expect(read(query).defaultStatus, query).toBe(false);
      expect(read(query).params.has('open'), query).toBe(false);
    }
    // Lists with awards sort by recently updated (awards have no closing date).
    expect(read('kind=award').sort).toBe('updated');
    expect(read('supplier=Acme').sort).toBe('updated');
  });
  it('pins Open when a filter change on the page would otherwise switch the default off', () => {
    expect(pinDefaultStatus({ buyer: 'City' }, true)).toEqual({ open: '1', buyer: 'City' });
    expect(pinDefaultStatus({ kind: 'all' }, true)).toEqual({ open: '1', kind: 'all' });
    expect(pinDefaultStatus({ search: 'roof' }, true)).toEqual({ search: 'roof' });
    expect(pinDefaultStatus({ buyer: 'City' }, false)).toEqual({ buyer: 'City' });
    expect(pinDefaultStatus({ buyer: 'City', status: ANY_STATUS }, true)).toEqual({ buyer: 'City', status: ANY_STATUS });
  });
});

describe('every result row shows one status chip from one vocabulary', () => {
  const now = Date.parse('2026-10-18T16:00:00Z');
  it('maps source statuses and deadlines to Open, Closed, Awarded, Cancelled or Status unknown', () => {
    const chip = (status: unknown, deadline: unknown, kind = 'opportunity') => { const s = rowStatus(status, deadline, kind, now); return [s.text, s.tone]; };
    expect(chip('Open', '2026-11-01')).toEqual(['Open', 'success']);
    expect(chip('Active', '2026-11-01')).toEqual(['Open', 'success']);
    expect(chip('Open', '2026-10-01')).toEqual(['Closed', 'neutral']);
    expect(chip('', '2026-10-01')).toEqual(['Closed', 'neutral']);
    expect(chip('Closed', '2026-11-01')).toEqual(['Closed', 'neutral']);
    expect(chip('Awarded', '2026-10-01')).toEqual(['Awarded', 'info']);
    expect(chip('Cancelled', '2026-11-01')).toEqual(['Cancelled', 'warning']);
    expect(chip('', '2026-11-01')).toEqual(['Status unknown', 'neutral']);
    expect(chip('N/A', null)).toEqual(['Status unknown', 'neutral']);
    expect(chip(null, '2026-09-03', 'award')).toEqual(['Awarded', 'info']);
    // A source-open notice with an unreadable date is in Open lists, so it reads Open; placeholders stay Open.
    expect(chip('Open', null)).toEqual(['Open', 'success']);
    expect(chip('Open', '2074-12-31')).toEqual(['Open', 'success']);
  });
  it('keeps the source wording in the tooltip when it differs', () => {
    expect(rowStatus('Open', '2026-10-01', 'opportunity', now).title).toContain('still says “Open”');
    expect(rowStatus('Closed', '2026-11-01', 'opportunity', now).title).toContain('before the closing date');
    expect(rowStatus('Open', '2026-11-01', 'opportunity', now).title).toBeUndefined();
    expect(rowStatus('Under review', '2026-10-01', 'opportunity', now)).toMatchObject({ text: 'Closed', title: 'Source status: “Under review”' });
  });
});

describe('Compare and the phone layout', () => {
  it('compares only a selection of 2–4 opportunities; anything else is the one empty state', () => {
    expect([COMPARE_MIN, COMPARE_MAX]).toEqual([2, 4]);
    expect([[], ['a'], ['a', 'b'], ['a', 'b', 'c', 'd'], ['a', 'b', 'c', 'd', 'e']].map(compareReady)).toEqual([false, false, true, true, false]);
  });
  it('always shows the list on phones and hides the List/Table toggle there', () => {
    expect(browseLayout('table', false, '')).toEqual({ table: true, toggle: true });
    expect(browseLayout('table', true, '')).toEqual({ table: false, toggle: false });
    expect(browseLayout(null, true, '')).toEqual({ table: false, toggle: false });
    expect(browseLayout(null, false, '')).toEqual({ table: false, toggle: true });
    expect(browseLayout('table', false, 'matrix')).toEqual({ table: false, toggle: false });
  });
});
