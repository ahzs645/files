import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { validateCatalogSelect } from '../../zoer/backend/src/catalog-reader';
import { buyerValue, formatField, latestReview } from '../zoer/dashboard/procurement/ai';
import { buildProcurementQuery } from '../zoer/dashboard/procurement/catalog';
import { readLabelFacets, readRecordLabels } from '../zoer/dashboard/procurement/label-reader';
import { composePrompt } from '../zoer/dashboard/review-fields';

const { host } = vi.hoisted(() => ({ host: vi.fn() }));
vi.mock('../zoer/dashboard/bridge', () => ({ host }));

let db: DatabaseSync;
beforeEach(() => {
  db = new DatabaseSync(':memory:');
  db.exec('CREATE TABLE records(id TEXT PRIMARY KEY, kind TEXT, data TEXT, updated_at TEXT); CREATE TABLE reviews(id TEXT PRIMARY KEY, record_id TEXT, prompt_id TEXT, status TEXT, result TEXT, created_at TEXT)');
  host.mockReset();
  host.mockImplementation(async (method: string, input: { statement: string; parameters: (string | number)[] }) => {
    expect(method).toBe('catalog.query');
    validateCatalogSelect(input.statement, input.parameters);
    const rows = db.prepare(`SELECT * FROM (${input.statement}) LIMIT 201`).all(...input.parameters);
    return { rows: rows.slice(0, 200), truncated: rows.length > 200 };
  });
});
afterEach(() => db.close());

function record(id: string) {
  db.prepare('INSERT INTO records VALUES (?, ?, ?, ?)').run(id, 'opportunity', '{}', '');
}
function review(id: string, recordId: string, labels: string[], extra: { created_at?: string; prompt_id?: string | null; status?: string; purpose?: unknown } = {}) {
  const row = { id, record_id: recordId, prompt_id: 'categories', status: 'succeeded', created_at: '2026-09-01T00:00:00Z', ...extra, result: { labels, ...('purpose' in extra ? { purpose: extra.purpose } : {}) } };
  db.prepare('INSERT INTO reviews VALUES (?, ?, ?, ?, ?, ?)').run(row.id, row.record_id, row.prompt_id, row.status, JSON.stringify(row.result), row.created_at);
  return row;
}
function filtered(label: string) {
  const query = buildProcurementQuery({ aiLabel: label });
  validateCatalogSelect(query.statement, query.parameters);
  validateCatalogSelect(query.countStatement, query.countParameters);
  const ids = db.prepare(query.statement).all(...query.parameters).map(row => row.id);
  expect(db.prepare(query.countStatement).get(...query.countParameters)?.total).toBe(ids.length);
  return ids;
}

describe('current AI categories use the same review in rows, filters and facets', () => {
  it('drops removed labels, ignores evidence and failed attempts, and breaks time ties by ID', async () => {
    record('notice');
    const history = [
      review('winner-b', 'notice', ['Roofing', 'Roofing']),
      // Later insertion is not a newer review; tied timestamps use the larger ID.
      review('winner-a', 'notice', ['Construction']),
      review('old', 'notice', ['Old category'], { created_at: '2026-08-01T00:00:00Z' }),
      review('failed', 'notice', ['Failed category'], { status: 'failed', created_at: '2026-10-01T00:00:00Z' }),
      review('evidence', 'notice', ['Evidence category'], { prompt_id: 'evidence:requirements', created_at: '2026-10-02T00:00:00Z' }),
      review('procurement', 'notice', ['Procurement category'], { prompt_id: 'procurement:question', created_at: '2026-10-03T00:00:00Z' }),
      review('purpose', 'notice', ['Purpose category'], { purpose: 'requirements', created_at: '2026-10-04T00:00:00Z' }),
    ];
    expect(latestReview(history)?.id).toBe('winner-b');
    expect(filtered('Roofing')).toEqual(['notice']);
    for (const label of ['Construction', 'Old category', 'Failed category', 'Evidence category', 'Procurement category', 'Purpose category']) expect(filtered(label)).toEqual([]);
    expect(await readRecordLabels(['notice'])).toEqual(new Map([['notice', ['Roofing', 'Roofing']]]));
    expect(await readLabelFacets()).toEqual({ reviewed: 1, counts: [['Roofing', 1]] });
  });

  it('matches JavaScript purpose truthiness and handles legacy missing prompt IDs', async () => {
    const purposes = [undefined, null, false, 0, '', true, 1, 'requirements', [], {}];
    const expected = new Map<string, string[]>();
    for (const [index, purpose] of purposes.entries()) {
      const id = String(index).padStart(2, '0');
      record(id);
      const history = [review(`${id}-old`, id, ['Previous']), review(`${id}-new`, id, ['Current'], { created_at: '2026-10-01T00:00:00Z', prompt_id: null, purpose })];
      expected.set(id, latestReview(history).result.labels);
    }
    expect(await readRecordLabels([...expected.keys()])).toEqual(expected);
    expect(filtered('Current')).toEqual([...expected].filter(([, labels]) => labels[0] === 'Current').map(([id]) => id));
    expect(await readLabelFacets()).toEqual({ reviewed: 10, counts: [['Current', 5], ['Previous', 5]] });
  });

  it.each(['100% coverage', 'under_score', 'Buyer "quoted" work', 'Path \\ roof', "Owner's work", 'Équipement'])('matches an ordinarily encoded label literally: %s', async label => {
    record('match'); record('other');
    review('match-review', 'match', [label]);
    review('other-review', 'other', ['1000 coverage', 'underXscore', 'A different label']);
    expect(filtered(label)).toEqual(['match']);
    expect((await readRecordLabels(['match'])).get('match')).toEqual([label]);
  });

  it('selects winners before the host cap and pages both row labels and facets', async () => {
    const ids = Array.from({ length: 205 }, (_, i) => String(i).padStart(3, '0'));
    for (const id of ids) { record(id); review(`${id}-winner`, id, ['Roofing']); }
    for (let i = 0; i < 220; i++) review(`history-${i}`, '000', ['Removed'], { created_at: '2026-08-01T00:00:00Z' });
    const labels = await readRecordLabels([...ids, '000']);
    expect(labels.size).toBe(205);
    expect([...labels.values()].every(value => value[0] === 'Roofing')).toBe(true);
    expect(await readLabelFacets()).toEqual({ reviewed: 205, counts: [['Roofing', 205]] });
  });
});

describe('legacy disclosed amounts retain unknown currency', () => {
  it.each([undefined, null, '', '$', 'usd', 'CAD dollars', 42])('never assumes CAD for currency %s', currency => {
    const funding = { status: 'disclosed', amount: 80_000, currency, basis: 'Stated budget' };
    const value = buyerValue({ result: { fields: { funding } } });
    expect(value.label).toBe('Buyer budget (AI-extracted)');
    expect(value.text).toBe('80,000 · currency unknown');
    expect(formatField('funding', funding)).toBe('80,000 · currency unknown · Stated budget');
  });

  it('keeps known currency and separate insurance and bond roles', () => {
    const instructions = composePrompt('Assess.', [
      { key: 'insurance', label: 'Insurance', type: 'money', description: 'Required coverage.', role: 'insurance_limit' },
      { key: 'bond', label: 'Bond', type: 'money', description: 'Required bond.', role: 'bid_security' },
    ]);
    const fields = { funding: { status: 'disclosed', amount: 80_000 }, insurance: { amount: 5_000_000, currency: 'CAD' }, bond: { amount: 10_000, currency: 'CAD' } };
    const value = buyerValue({ result: { fields, prompt: { instructions } } });
    expect(value.text).toBe('80,000 · currency unknown');
    expect(value.others.map(other => other.label)).toEqual(['Insurance limit (AI-extracted)', 'Bond or bid security (AI-extracted)']);
    expect(formatField('funding', { ...fields.funding, currency: 'USD' })).not.toContain('currency unknown');
    expect(formatField('funding', { status: 'disclosed', currency: 'CAD' })).toBe('Amount not stated');
  });
});
