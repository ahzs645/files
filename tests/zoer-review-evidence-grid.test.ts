// @vitest-environment jsdom
/**
 * Evidence cell grid (BACKLOG P4): cell state derivation, empty causes, conflict rules, money display and the SQL
 * problem filters/cursors. The SQL twins are run against the host reader in
 * zoer/dashboard/review-workspace/evidence-queries.test.ts (bun) and compared with this derivation.
 */
import { describe, expect, it } from 'vitest';
import { validateCatalogSelect } from '../../zoer/backend/src/catalog-reader';
import { CELL_STATES, CELL_TEXT, GRID_FIELDS, PROBLEMS, cellProblems, deriveCell, evidenceExportHeader, evidenceExportRow, formatFactValue, gridPageSql, gridWhere, problemCountsSql, problemSql, valueKey, type FactRow } from '../zoer/dashboard/review-workspace/evidence-queries';

let seq = 0;
const fact = (overrides: Partial<FactRow>): FactRow => ({ id: `f${++seq}`, recordId: 'r1', lotId: null, fieldKey: 'budget', semanticType: 'money:buyer_budget', status: 'stated', value: { lower: 75000, upper: 75000, currency: 'CAD', basis: 'total_contract', taxBasis: 'exclusive', raw: '$75,000' }, grounding: 'exact', reviewState: null, reviewValue: null, ...overrides });
const money = (lower: number, currency = 'CAD') => ({ lower, upper: lower, currency, basis: 'total_contract', taxBasis: 'unknown', raw: `${currency} ${lower}` });

describe('cell state derivation', () => {
  it('covers every named state, and never leaves a value blank', () => {
    const cases: [FactRow[], boolean, string][] = [
      [[fact({})], false, 'proposed'],
      [[fact({ reviewState: 'accepted' })], false, 'accepted'],
      [[fact({ reviewState: 'corrected', reviewValue: money(80000) })], false, 'corrected'],
      [[fact({ reviewState: 'rejected' })], false, 'rejected'],
      [[fact({ reviewState: 'needs_clarification' })], false, 'needs_clarification'],
      [[fact({})], true, 'outdated'],
      [[fact({ grounding: 'unverified' })], false, 'ungrounded'],
      [[fact({ status: 'not_reviewed', value: null })], false, 'not_reviewed'],
      [[], false, 'not_found'],
      [[fact({ status: 'not_found_in_reviewed_material', value: null })], false, 'not_found'],
      [[fact({ value: money(1) }), fact({ value: money(2) })], false, 'conflicting'],
      [[fact({ status: 'conflicting', value: null })], false, 'conflicting'],
      [[fact({ status: 'not_applicable', value: null })], false, 'not_applicable'],
    ];
    const seen = new Set<string>();
    for (const [facts, stale, state] of cases) {
      const cell = deriveCell('budget', facts, stale);
      expect(cell.state, JSON.stringify(facts)).toBe(state);
      expect(cell.value.trim()).not.toBe('');
      seen.add(cell.state);
    }
    expect([...seen].sort()).toEqual([...CELL_STATES].sort());
  });
  it('shows the correction as the value while keeping the AI fact id for the inspector', () => {
    const original = fact({ reviewState: 'corrected', reviewValue: money(80000) });
    const cell = deriveCell('budget', [original], false);
    expect(cell.value).toBe('CAD 80,000 · total contract');
    expect(cell.factId).toBe(original.id);
  });
  it('names empty causes explicitly', () => {
    expect(deriveCell('site_visit', [], false).value).toBe('Not found in reviewed material');
    expect(deriveCell('site_visit', [fact({ status: 'not_reviewed', value: null })], false).value).toBe('Material not reviewed');
    expect(deriveCell('site_visit', [fact({ status: 'not_applicable', value: null })], false).value).toBe('Not applicable');
    expect(deriveCell('bid_security', [fact({ status: 'explicitly_absent', value: { raw: 'No bid bond required' } })], false).value).toBe('Stated as none: No bid bond required');
    expect(deriveCell('budget', [fact({ value: null })], false).value).toBe('Value not recorded');
  });
  it('treats distinct values in one lot as a conflict, but not the same value twice, other lots or rejected values', () => {
    expect(cellProblems([fact({}), fact({ value: { ...money(75000), raw: 'seventy-five thousand' } })], false).has('conflicting')).toBe(false);
    expect(cellProblems([fact({ value: money(1), lotId: 'L1' }), fact({ value: money(2), lotId: 'L2' })], false).has('conflicting')).toBe(false);
    expect(cellProblems([fact({ value: money(1) }), fact({ value: money(2), reviewState: 'rejected' })], false).has('conflicting')).toBe(false);
    expect(cellProblems([fact({ value: money(1, 'CAD') }), fact({ value: money(1, 'USD') })], false).has('conflicting')).toBe(true);
    const dates = [fact({ fieldKey: 'closing_date', semanticType: 'date', value: { raw: '2026-10-01', precision: 'date' } }), fact({ fieldKey: 'closing_date', semanticType: 'date', value: { raw: '2026-10-08', precision: 'date' } })];
    const cell = deriveCell('closing_date', dates, false);
    expect(cell.state).toBe('conflicting');
    expect(cell.value).toMatch(/^2 different values · e\.g\. 2026-10-0\d \(date only\)$/);
  });
  it('keeps a conflict visible even after a reviewer accepts one of the values', () => {
    const cell = deriveCell('budget', [fact({ value: money(1), reviewState: 'accepted' }), fact({ value: money(2) })], false);
    expect(cell.state).toBe('conflicting');
    expect(cell.problems.has('unreviewed')).toBe(true);
  });
  it('collects every problem in a cell, so filters match cells whose primary badge differs', () => {
    const problems = cellProblems([fact({ grounding: 'unverified' }), fact({ value: money(2) }), fact({ reviewState: 'rejected' })], true);
    expect([...problems].sort()).toEqual(['conflicting', 'outdated', 'rejected', 'unreviewed', 'ungrounded'].sort());
  });
  it('compares values the way the SQL key does', () => {
    expect(valueKey('money:buyer_budget', { lower: 75000, upper: null, currency: 'cad' })).toBe('75000||CAD');
    expect(valueKey('date', { raw: 'Oct 1, 2026', precision: 'date' })).toBe('oct 1, 2026');
    expect(valueKey('text', 'Mandatory')).toBe('mandatory');
    expect(valueKey('text', null)).toBe('');
  });
});

describe('money display', () => {
  it('keeps kind, currency and basis; unknown currency is never assumed', () => {
    expect(formatFactValue('money:insurance_limit', { lower: 5_000_000, upper: 5_000_000, currency: 'CAD', basis: 'unknown' })).toBe('CAD 5,000,000 · basis not stated');
    expect(formatFactValue('money:buyer_budget', { lower: 10, upper: 20, currency: null, basis: 'annual' })).toBe('Currency not stated 10–20 · per year');
    expect(formatFactValue('money:award_value', { lower: 7, upper: 7, currency: 'CAD', basis: 'total_contract' })).toBe('CAD 7 · total contract (Award value)');
    expect(formatFactValue('money:buyer_budget', { lower: null, upper: null, raw: 'To be negotiated' })).toBe('To be negotiated');
  });
});

describe('problem filters and paging SQL', () => {
  it('every statement passes the host validator and stays under its length limit', () => {
    const statements = [problemCountsSql(), problemCountsSql('budget'), ...PROBLEMS.flatMap(problem => [gridPageSql({ problem }, {}).sql, gridPageSql({ problem, field: 'insurance_limit' }, { after: 'r1' }).sql])];
    for (const statement of statements) {
      expect(() => validateCatalogSelect(statement, ['x', 51])).not.toThrow();
      expect(statement.length).toBeLessThan(10_000);
    }
  });
  it('filters the whole catalog of extracted notices, optionally for one field', () => {
    expect(gridWhere({})).toBe("r.id IN (SELECT record_id FROM procurement_stage_runs WHERE stage='extract' AND is_current=1)");
    expect(problemSql('ungrounded', 'budget')).toContain("f.field_key IN ('budget')");
    expect(problemSql('ungrounded')).toContain(`f.field_key IN (${GRID_FIELDS.map(field => `'${field}'`).join(',')})`);
    expect(problemSql('not_found')).toContain(`HAVING count(DISTINCT f.field_key)=${GRID_FIELDS.length}`);
  });
  it('pages by record id in both directions with one extra row to detect more', () => {
    expect(gridPageSql({}, {})).toMatchObject({ parameters: [51] });
    const next = gridPageSql({}, { after: 'r050' }, 50);
    expect(next.sql).toMatch(/AND r\.id>\? ORDER BY r\.id LIMIT \?$/);
    expect(next.parameters).toEqual(['r050', 51]);
    const previous = gridPageSql({}, { before: 'r051' }, 50);
    expect(previous.sql).toMatch(/AND r\.id<\? ORDER BY r\.id DESC LIMIT \?$/);
  });
  it('exports value, state and problems per field, keeping a column per field', () => {
    const header = evidenceExportHeader();
    expect(header).toContain('budget.value'); expect(header).toContain('insurance_limit.state');
    const row = { id: 'r1', title: 'T', buyer: 'B', stale: false, extractedAt: null, mandatory: 3, unreviewed: 1, ungrounded: 0, cells: GRID_FIELDS.map(field => deriveCell(field, [], false)) };
    const values = evidenceExportRow(row);
    expect(values).toHaveLength(header.length);
    expect(values[5]).toBe(CELL_TEXT.not_found);
  });
});
