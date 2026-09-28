import { describe, it, expect } from 'vitest';
import { closingSoon, deadlineTime, inferSummaries, labelCounts, readAnalysisRows, readCoverage, readUnreviewed, scoreField, summarize, summarizeField, type AnalysisRow } from '../zoer/dashboard/review-analysis';
import { composePrompt, type ReviewField } from '../zoer/dashboard/review-fields';

const row = (id: string, fields: Record<string, unknown>, extra: Partial<AnalysisRow> = {}): AnalysisRow => ({
  recordId: id, promptId: 'p', promptVersion: 1, reviewedAt: '2026-09-27T00:00:00Z', title: `Notice ${id}`, kind: 'opportunity', source: 'bc-bid',
  deadline: null, buyer: 'City', status: 'Open', fields, labels: [], ...extra,
});
const field = (type: ReviewField['type'], extra: Partial<ReviewField> = {}): ReviewField => ({ key: 'v', label: 'Value', type, description: 'x', ...extra });

describe('AI review analysis', () => {
  it('counts choice options in their declared order, including unused options', () => {
    const s = summarizeField(field('choice', { options: ['Bid', 'Direct', 'Other'] }), [row('a', { v: 'Direct' }), row('b', { v: 'Bid' }), row('c', { v: 'Direct' }), row('d', { v: null }), row('e', { v: 'Nonsense' })]);
    expect(s.kind === 'categories' && s.buckets.map(b => [b.label, b.count])).toEqual([['Bid', 1], ['Direct', 2], ['Other', 0]]);
    expect(s.kind === 'categories' && s.buckets[1].recordIds).toEqual(['a', 'c']);
    expect(s.kind === 'categories' && s.notStated).toBe(1);
  });
  it('shows every step of a scale and numeric statistics', () => {
    const s = summarizeField(field('scale', { scale: { min: 1, max: 5 } }), [row('a', { v: 5 }), row('b', { v: 3 }), row('c', { v: 5 }), row('d', { v: 9 })]);
    expect(s.kind === 'numbers' && s.buckets.map(b => [b.label, b.count])).toEqual([['1', 0], ['2', 0], ['3', 1], ['4', 0], ['5', 2]]);
    expect(s.kind === 'numbers' && s.stats).toEqual({ count: 3, min: '3', median: '5', max: '5', mean: '4.3' });
  });
  it('groups percentages and money into ranges', () => {
    const pct = summarizeField(field('percent'), [row('a', { v: 10 }), row('b', { v: 20 }), row('c', { v: 90 })]);
    expect(pct.kind === 'numbers' && pct.buckets.reduce((n, b) => n + b.count, 0)).toBe(3);
    expect(pct.kind === 'numbers' && pct.stats.median).toBe('20%');
    const money = summarizeField(field('money'), [row('a', { v: { amount: 100000, currency: 'CAD' } }), row('b', { v: { amount: 300000, currency: 'CAD' } })]);
    expect(money.kind === 'numbers' && money.stats.max).toMatch(/300K/);
  });
  it('counts list items across records and records with an empty list', () => {
    const s = summarizeField(field('list'), [row('a', { v: ['COR', 'Bid bond'] }), row('b', { v: ['COR'] }), row('c', { v: [] })]);
    expect(s.kind === 'items' && s.buckets.map(b => [b.label, b.count])).toEqual([['COR', 2], ['Bid bond', 1]]);
    expect(s.kind === 'items' && s.none).toBe(1);
  });
  it('infers categories from free-form results such as funding status', () => {
    const rows = [
      row('a', { funding: { status: 'not_disclosed' }, mandatoryDesignations: ['COR'], workRequired: 'Long unique text a', route: 'Competitive bid' }),
      row('b', { funding: { status: 'disclosed', amount: 5 }, mandatoryDesignations: [], workRequired: 'Long unique text b', route: 'Competitive bid' }),
      row('c', { funding: { status: 'not_disclosed' }, mandatoryDesignations: ['COR'], workRequired: 'Not stated in reviewed evidence', route: 'Direct award' }),
    ];
    const byKey = Object.fromEntries(inferSummaries(rows).map(s => [s.key, s]));
    expect(byKey.funding.kind === 'categories' && byKey.funding.buckets.map(b => [b.label, b.count])).toEqual([['Not disclosed', 2], ['Disclosed', 1]]);
    expect(byKey.mandatoryDesignations.kind).toBe('items');
    expect(byKey.workRequired).toMatchObject({ kind: 'text', stated: 2, notStated: 1 });
    expect(byKey.route.kind).toBe('categories');
  });
  it('charts only recurring items in free-form lists and ignores "not stated" items', () => {
    const rows = [row('a', { steps: ['Ask the buyer about budget', 'Not stated in reviewed evidence'] }), row('b', { steps: ['Visit the site'] }), row('c', { steps: [] })];
    expect(inferSummaries(rows)[0]).toMatchObject({ key: 'steps', kind: 'text', stated: 2, notStated: 1 });
    const repeated = inferSummaries([row('a', { req: ['COR', 'Bond'] }), row('b', { req: ['COR'] })])[0];
    expect(repeated.kind === 'items' && repeated.buckets.map(b => [b.label, b.count])).toEqual([['COR', 2]]);
  });
  it('uses typed definitions when the prompt has them', () => {
    const prompt = composePrompt('Assess.', [field('yes-no', { key: 'meeting', label: 'Site meeting' })]);
    expect(summarize(prompt, [row('a', { meeting: true }), row('b', { meeting: false }), row('c', { meeting: true })]).map(s => s.kind === 'categories' && s.buckets.map(b => b.count))).toEqual([[2, 1]]);
    expect(scoreField(composePrompt('x', [field('text'), field('percent', { key: 'p' }), field('scale', { key: 's' })]))?.key).toBe('s');
  });
  it('counts labels once per record', () => {
    expect(labelCounts([row('a', {}, { labels: ['Roofing', 'Roofing', 'COR required'] }), row('b', {}, { labels: ['Roofing'] })]).map(b => [b.label, b.count])).toEqual([['Roofing', 2], ['COR required', 1]]);
  });
  it('groups label spellings that differ only in case, hyphens or underscores', () => {
    const rows = [row('a', {}, { labels: ['Budget not disclosed'] }), row('b', {}, { labels: ['budget-not-disclosed'] }), row('c', {}, { labels: ['budget_not_disclosed', 'COR'] })];
    expect(labelCounts(rows).map(b => [b.label, b.count])).toEqual([['Budget not disclosed', 3], ['COR', 1]]);
  });
  it('lists reviewed opportunities closing within two weeks, soonest first', () => {
    const now = Date.parse('2026-09-27T12:00:00-07:00');
    const rows = [row('late', {}, { deadline: '2026-10-30' }), row('soon', {}, { deadline: '2026-10-01T14:00:00-07:00' }), row('today', {}, { deadline: '2026-09-27' }),
      row('past', {}, { deadline: '2026-09-01' }), row('award', {}, { kind: 'award', deadline: '2026-09-30' }), row('soon', {}, { deadline: '2026-10-01T14:00:00-07:00', promptId: 'other' })];
    expect(closingSoon(rows, now).map(r => r.recordId)).toEqual(['today', 'soon']);
    expect(deadlineTime('bad')).toBeNull();
  });
  it('pages through every result with SQL the host accepts', async () => {
    const calls: any[] = [];
    const { rows, truncated } = await readAnalysisRows(async (_, input) => { calls.push(input); const offset = input.parameters.at(-1) as number;
      return { rows: offset === 0 ? Array.from({ length: 200 }, (_, i) => ({ record_id: `r${i}`, fields: '{"a":1}', labels: '["x"]' })) : [{ record_id: 'last', fields: null, labels: null }] }; }, { promptId: 'p', source: 'canadabuys' });
    expect(rows).toHaveLength(201); expect(truncated).toBe(false);
    expect(rows[200].fields).toEqual({}); expect(rows[0].labels).toEqual(['x']);
    expect(calls[0].parameters).toEqual(['p', 'canadabuys', 200, 0]); expect(calls[1].parameters).toEqual(['p', 'canadabuys', 200, 200]);
    const coverage = await readCoverage(async (_, input) => { calls.push(input); return { rows: [{ source: 'bc-bid', open: '5', reviewed: '2' }] }; });
    expect(coverage).toEqual([{ source: 'bc-bid', open: 5, reviewed: 2 }]);
    expect(await readUnreviewed(async (_, input) => { calls.push(input); expect(input.parameters).toEqual(['canadabuys', 50]); return { rows: [{ id: 'x' }] }; }, 'canadabuys')).toEqual(['x']);
    for (const call of calls) {
      expect(call.statement).not.toMatch(/;|\bcontent\b|\bupdate\b|\bdelete\b|\btemp\b|\bmain\b|\bpragma\b/i);
      const functions = [...call.statement.matchAll(/([a-z_][a-z0-9_]*)\s*\(/gi)].map((m: RegExpMatchArray) => m[1].toLowerCase());
      expect(functions.filter((f: string) => !['select', 'in', 'exists', 'count', 'sum', 'avg', 'min', 'max', 'length', 'lower', 'upper', 'json_extract', 'coalesce', 'julianday', 'cast'].includes(f))).toEqual([]);
    }
  });
});
