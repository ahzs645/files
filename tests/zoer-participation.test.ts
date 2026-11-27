// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { parseParticipationHtml } from '../zoer/dashboard/procurement/participation-html';
import { bindParticipationField, bindParticipationRole, participationMoney, validateParticipation } from '../zoer/dashboard/procurement/participation';
import { mergeParticipation, readParticipationInput, referencesAgree } from '../zoer/dashboard/procurement/participation-store';

const bids = 'https://metrovancouver.bidsandtenders.ca/Module/Tenders/en/Tender/Detail/108baf41-b768-48af-a0cf-005dc8e8d409';
const bonfire = 'https://victoria.bonfirehub.ca/opportunities/111736';
const original = '2026-11-26T21:15:00Z';
const later = '2026-11-27T21:15:00Z';
const grids = (id: string, rows: string[][]) =>
  `<div id="${id}">${rows.map(row => `<div class="x-grid3-row"><table><tr>${row.map(cell => `<td class="x-grid3-cell">${cell}</td>`).join('')}</tr></table></div>`).join('')}</div>`;
const packet = { version: 1, source: { url: bids, observedAt: original }, sections: [{
  id: 'review-panels', label: 'Evaluation panels', state: 'published',
  fields: [{ id: 'local-team', label: 'Local team', type: 'text', binding: 'supplier' }, { id: 'reviewed', label: 'Review completed', type: 'boolean' }],
  rows: [{ 'local-team': 'Example', reviewed: false }],
}] };

describe('publisher participation', () => {
  it('preserves custom labels, custom types and reusable bindings', () => {
    const parsed = validateParticipation(packet);
    expect(parsed.sections[0]).toMatchObject({ role: 'custom', fields: packet.sections[0].fields, rows: packet.sections[0].rows });
    expect(bindParticipationRole('Public Document Takers:')).toBe('document-takers');
    expect(bindParticipationField('Vendor', 'text')).toBe('supplier');
    expect(bindParticipationField('Results', 'text')).toBeUndefined();
    expect(readParticipationInput(JSON.stringify(packet), bids)).toEqual(parsed);
    expect(() => readParticipationInput(JSON.stringify(packet), bonfire)).toThrow('must match');
  });

  it('validates a section, field binding, and external URL before writing', () => {
    expect(() => validateParticipation({ ...packet, source: { ...packet.source, url: 'javascript:alert(1)' } })).toThrow('HTTPS URL');
    expect(() => validateParticipation({ ...packet, sections: [{ ...packet.sections[0], rows: [{ phase: 'open' }] }] })).toThrow('declared');
    expect(() => validateParticipation({ ...packet, sections: [{ ...packet.sections[0], fields: [{ id: 'amount', label: 'Price', type: 'text', binding: 'amount' }] }] })).toThrow('does not accept');
    expect(() => validateParticipation({ ...packet, sections: [{ ...packet.sections[0], rows: [] }] })).toThrow('needs rows');
    expect(referencesAgree('RFI 4354', '4354')).toBe(true);
    expect(referencesAgree('4354', '4355')).toBe(false);
  });

  it('reads only rendered proof and skips private contact columns and scripts', () => {
    const html = [
      '<table><tr><th>Bid Number:</th><td>26-0434</td></tr></table>',
      '<a href="https://metrovancouver.bidsandtenders.ca/Module/Tenders/en">Return to the Bids Homepage</a>',
      '<div id="pnlNoPlanTakers" class="x-hide-display">There are no plan takers.</div>',
      '<script>throw new Error("Do not run");</script>',
      grids('dgPlanTakers', [['All-Pro Services Ltd', 'Personal contact'], ['Bay Industrial', 'Personal contact']]),
      grids('dgSubmitted', [['Example Construction', 'Contact', '$289,327.50'], ['Example Construction', 'Contact', 'CAD $313,250.25']]),
      grids('dgMeetingLocations', [['Front entrance', 'Bring PPE', 'Nov 4, 2026, 2 pm (YST)', 'Yes']]),
    ].join('');
    const parsed = parseParticipationHtml(html, bids, original);
    expect(parsed.source.reference).toBe('26-0434');
    expect(parsed.sections[0]).toMatchObject({ state: 'published', rows: [{ supplier: 'All-Pro Services Ltd' }, { supplier: 'Bay Industrial' }] });
    expect(parsed.sections[1]).toMatchObject({ unofficial: true, rows: [
      { supplier: 'Example Construction', amount: { display: '$289,327.50', decimal: '289327.50' } },
      { supplier: 'Example Construction', amount: { display: 'CAD $313,250.25', decimal: '313250.25', currency: 'CAD' } },
    ] });
    expect(parsed.sections.at(-1)?.rows[0]).toMatchObject({ mandatory: true, location: 'Front entrance' });
    expect(JSON.stringify(parsed)).not.toContain('Personal contact');
    expect(() => parseParticipationHtml(html, bonfire, original)).toThrow('different publisher');
  });

  it('distinguishes a hidden template, a genuinely empty grid, and a restriction', () => {
    expect(parseParticipationHtml('<div id="pnlNoPlanTakers">No plan takers</div>', bids, original).sections[0].state).toBe('empty');
    expect(parseParticipationHtml('<div id="PnlPlanTakersAlert">Sign in</div>', bids, original).sections[0].state).toBe('restricted');
    expect(parseParticipationHtml(grids('dgPlanTakers', []), bids, original).sections[0].state).toBe('incomplete');
    expect(() => parseParticipationHtml('<div hidden><div id="pnlNoPlanTakers">No plan takers</div></div>', bids, original)).toThrow('No supported');
  });

  it('keeps Bonfire file counts, money, and award evidence separately', () => {
    const result = parseParticipationHtml(`<table id="publicDocumentTakersTable"><tbody>
      <tr><td>Company A</td><td>12</td><td>Open</td></tr></tbody></table>
      <table id="portalPublicAwardTable"><tbody><tr><td>Company A</td><td>Nov 18, 2026 MST</td>
      <td>$799,829.50</td><td><a href="/opportunities/111736/award">View Award</a></td></tr></tbody></table>`, bonfire, original);
    expect(result.sections[0].rows).toEqual([{ supplier: 'Company A', 'file-count': 12 }]);
    expect(result.sections[1].rows).toEqual([{ supplier: 'Company A', 'awarded-at': 'Nov 18, 2026 MST',
      amount: { display: '$799,829.50', decimal: '799829.50' }, evidence: bonfire + '/award' }]);
    expect(participationMoney('$0.00')).toEqual({ display: '$0.00', decimal: '0.00' });
  });

  it('is idempotent, retains the prior published observation, and respects source order', () => {
    const first = validateParticipation(packet);
    const start = mergeParticipation([], first);
    expect(mergeParticipation(start, first)).toEqual(start);
    const restricted = validateParticipation({ ...packet, source: { ...packet.source, observedAt: later }, sections: [{ ...packet.sections[0], state: 'restricted', rows: [] }] });
    const updated = mergeParticipation(start, restricted);
    expect(updated[0].sections[0]).toMatchObject({ section: { state: 'restricted' }, confirmed: { section: { rows: packet.sections[0].rows } } });
    expect(mergeParticipation(updated, first)).toEqual(updated);
    const empty = validateParticipation({ ...packet, source: { ...packet.source, observedAt: '2026-11-28T21:15:00Z' }, sections: [{ ...packet.sections[0], state: 'empty', rows: [] }] });
    expect(mergeParticipation(updated, empty)[0].sections[0]).not.toHaveProperty('confirmed');
  });
});
