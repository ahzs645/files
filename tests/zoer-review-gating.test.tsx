// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { ResultRow, type ResultRowData } from '../zoer/dashboard/procurement/ResultRow';
import { todayLayout } from '../zoer/dashboard/review-workspace/today-data';
import { profileSelectable, readOnlyDefaultProfile } from '../zoer/dashboard/review-workspace/profile-types';
import { gridTable } from '../zoer/dashboard/bid-columns';

const AS_OF = Date.parse('2026-10-18T16:00:00Z');
const row: ResultRowData = { id: 'o1', kind: 'opportunity', title: 'Roof replacement', buyer: 'City of Prince George', deadline: '2026-11-01', sourceId: 'bc-bid', status: 'Open', externalId: 'BCB-1', starred: 1 };
const card = (writes: boolean, data: ResultRowData = row) => renderToStaticMarkup(<ResultRow row={data} asOf={AS_OF} writes={writes} checked={false} open={false} onCheck={() => {}} onOpen={() => {}} />);

describe('opportunity cards', () => {
  it('drops the selection checkbox without writes and keeps a small read-only star', () => {
    const html = card(false);
    expect(html).not.toContain('type="checkbox"');
    expect(html).toContain('aria-label="Shortlisted"');
    expect(card(false, { ...row, starred: 0 })).not.toContain('Shortlisted');
    expect(card(true)).toContain('type="checkbox"');
    // With writes the star is the page's own toggle button, not the read-only mark.
    expect(card(true)).not.toContain('pc-star-mark');
  });
  it('reads as one meta line: when · source · status, with the type only when it is not an opportunity', () => {
    const text = card(false).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
    expect(text).toContain('Closes Nov 1 · BC Bid · Open');
    expect(text).not.toContain('Opportunity');
    expect(text).not.toContain('date only');
    expect(card(false, { ...row, kind: 'award', deadline: '2026-09-03', status: null }).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ')).toContain('Awarded Sep 3 · BC Bid · Award');
  });
});

describe('Home in review mode', () => {
  it('shows new notices and alert checks only on hosts that collect', () => {
    expect(todayLayout({ collection: true })).toEqual({ newSince: true, alerts: true, columns: 3 });
    expect(todayLayout({ collection: false })).toEqual({ newSince: false, alerts: false, columns: 2 });
  });
  it('offers "Assess as" only when a read-only copy has a real choice', () => {
    expect(profileSelectable(true, 0)).toBe(true);
    expect(profileSelectable(false, 0)).toBe(false);
    expect(profileSelectable(false, 1)).toBe(false);
    expect(profileSelectable(false, 2)).toBe(true);
    expect(readOnlyDefaultProfile(false, ['only'])).toBe('only');
    expect(readOnlyDefaultProfile(true, ['only'])).toBeNull();
    expect(readOnlyDefaultProfile(false, ['a', 'b'])).toBeNull();
  });
});

describe('award history table', () => {
  const names = (kind: 'award' | 'opportunity', caps: { writes: boolean; surface: string }) => { const { table, hidden } = gridTable(kind, caps); return table.columns.map(column => column.name).filter(name => !hidden.includes(name)); };
  it('opens on five columns in Societyer and leaves out Star without writes', () => {
    expect(names('award', { writes: false, surface: 'societyer' })).toEqual(['awardDate', 'opportunityDescription', 'buyer', 'successfulSupplier', 'contractValue']);
    expect(gridTable('award', { writes: false, surface: 'societyer' }).table.columns.some(column => column.name === 'starred')).toBe(false);
    // The other columns stay in the table for the column picker.
    expect(gridTable('award', { writes: false, surface: 'societyer' }).table.columns.map(column => column.name)).toContain('contractNumber');
    expect(names('award', { writes: true, surface: 'zoer' })).toEqual(expect.arrayContaining(['starred', 'contractNumber', 'currency', 'sourceUrl']));
    expect(names('opportunity', { writes: false, surface: 'zoer' })[0]).toBe('opportunityId');
  });
});
