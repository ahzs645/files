// @vitest-environment jsdom
/**
 * P0 "Fix misleading outputs first": one regression per defect in the review plan's BACKLOG P0 acceptance.
 * Each test reproduces the earlier behaviour (noted in its comment) and pins the corrected one.
 */
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { buyerValue, coverageText, documentCounts, documentSummary, estimatedValue, hasUsableText, verdictText, verdictTone } from '../zoer/dashboard/procurement/ai';
import { AiResult } from '../zoer/dashboard/procurement/AiResult';
import { buildProcurementQuery, deadlineLabel } from '../zoer/dashboard/procurement/catalog';
import { CLOSING_TODAY_TEXT, closesWithin, deadlineState, endOfZoneDay, zoneDate } from '../zoer/dashboard/procurement/deadline';
import { shortDate } from '../zoer/dashboard/procurement/display';
import { documentScope } from '../zoer/dashboard/document-scope';
import { closingSoon, readAnalysisRows, readPromptVersions, summarizeField, type AnalysisRow } from '../zoer/dashboard/review-analysis';
import { composePrompt, moneyRole, parsePrompt, TYPED_TEMPLATE, type ReviewField } from '../zoer/dashboard/review-fields';
import { readAllReviewResults, readRunResults } from '../zoer/dashboard/review-results';
import { exportManifest, manifestNote, toCsv } from '../zoer/dashboard/export';

const money = (key: string, label: string, extra: Partial<ReviewField> = {}): ReviewField => ({ key, label, type: 'money', description: `${label}.`, ...extra });
const review = (fields: ReviewField[], values: Record<string, unknown>) => ({ status: 'succeeded', result: { fields: values, prompt: { instructions: composePrompt('Assess.', fields) } } });

describe('P0: semantic amount binding', () => {
  it('never shows an insurance amount as the budget (was: first valid money field became "Estimated value")', () => {
    const fields = [money('insuranceLimit', 'Insurance'), money('budget', 'Budget')];
    const value = buyerValue(review(fields, { insuranceLimit: { amount: 5_000_000, currency: 'CAD' }, budget: null }));
    expect(value.label).toBe('Budget');
    expect(value.text).toBe('Budget not found; insurance limit listed separately');
    expect(value.others).toEqual([{ label: 'Insurance limit (AI-extracted)', text: expect.stringMatching(/5,000,000/) }]);
    expect(estimatedValue(review(fields, { insuranceLimit: { amount: 5_000_000, currency: 'CAD' } }))).toBe('');
  });
  it('binds only buyer budget or estimated value, labelled with its basis', () => {
    const fields = [money('liability', 'Liability coverage'), money('bidBond', 'Bid bond'), money('amount', 'Amount'), money('estimatedValue', 'Estimated value')];
    const value = buyerValue(review(fields, { liability: { amount: 2e6, currency: 'CAD' }, bidBond: { amount: 1e4, currency: 'CAD' }, amount: { amount: 9, currency: 'CAD' }, estimatedValue: { amount: 250_000, currency: 'CAD' } }));
    expect(value.label).toBe('Estimated contract value (AI-extracted)');
    expect(value.text).toMatch(/250,000/);
    expect(value.others.map(o => o.label)).toEqual(['Insurance limit (AI-extracted)', 'Bond or bid security (AI-extracted)', 'Amount (AI-extracted)']);
    // An unclassified "Amount" is never a budget.
    expect(buyerValue(review([money('amount', 'Amount')], { amount: { amount: 9, currency: 'CAD' } })).text).toBe('Not found in reviewed material');
    const funding = buyerValue({ result: { fields: { funding: { status: 'disclosed', amount: 80000, currency: 'CAD', basis: 'Stated budget' } } } });
    expect(funding.label).toBe('Buyer budget (AI-extracted)');
    expect(buyerValue(undefined).text).toBe('Not reviewed');
  });
  it('round-trips an explicit role through the <review-fields> tag and infers one for older prompts', () => {
    const fields = [money('limit', 'Coverage', { role: 'insurance_limit' }), money('cap', 'Cap', { role: 'buyer_budget' })];
    expect(parsePrompt(composePrompt('x', fields)).fields.map(f => f.role)).toEqual(['insurance_limit', 'buyer_budget']);
    // Legacy prompt text has no role: inferred conservatively, exclusions before budget words.
    const legacy = parsePrompt(composePrompt('x', [money('insuranceBudget', 'Insurance budget'), money('value', 'Value')])).fields;
    expect(legacy.map(f => f.role)).toEqual([undefined, undefined]);
    expect(legacy.map(moneyRole)).toEqual(['insurance_limit', 'other']);
    expect(TYPED_TEMPLATE.fields.find(f => f.key === 'budget')?.role).toBe('buyer_budget');
    // A prompt with an explicit role reads it even when the label looks like a budget.
    expect(buyerValue(review([money('budget', 'Budget', { role: 'insurance_limit' })], { budget: { amount: 1, currency: 'CAD' } })).text).toBe('Budget not found; insurance limit listed separately');
  });
});

describe('P0: explicit verdict tones', () => {
  it('shows needs_information and unrecognised values as neutral (was: anything without "no" was green)', () => {
    for (const value of ['needs_information', 'investigate', 'unclear', 'conditional', 'consider_partner', 'Bid, if bonding is available', 'maybe', '', null, 42])
      expect(verdictTone(value)).toBe('neutral');
    for (const value of ['bid', 'Pursue', 'YES', 'ready_for_human_decision']) expect(verdictTone(value)).toBe('supported');
    for (const value of ['no', 'No-bid', 'no_bid', 'decline', 'Do not bid.']) expect(verdictTone(value)).toBe('not_recommended');
    // Old regex /no/i also turned "Unknown" orange and "Needs information" green; both are neutral now.
    expect(verdictTone('Unknown')).toBe('neutral');
    expect(verdictText('needs_information')).toBe('Needs information');
  });
  it('renders the verdict with a neutral tone and a text label, and the base CSS colour is neutral', () => {
    const html = renderToStaticMarkup(<AiResult review={{ id: 'r', status: 'succeeded', prompt_id: 'procurement:bid-no-bid', result: { purpose: 'bid-no-bid', summary: 'Gaps remain.', fields: { recommendation: 'needs_information' } } }} />);
    expect(html).toContain('data-verdict="neutral"');
    expect(html).toContain('>Needs information<');
    const css = readFileSync(resolve(__dirname, '../zoer/dashboard/procurement/notice.css'), 'utf8');
    expect(css).toMatch(/\.pc-verdict\{[^}]*color:var\(--text-secondary\)/);
    expect(css).toMatch(/\.pc-verdict\[data-verdict=supported\]\{color:var\(--status-success\)\}/);
  });
});

describe('P0: document readability', () => {
  const docs = [
    { id: '1', url: 'u1', status: 'downloaded', text_length: 1200 }, { id: '2', url: 'u2', status: 'downloaded', text_length: 800 },
    { id: '3', url: 'u3', status: 'downloaded', text_length: 50 }, { id: '4', url: 'u4', status: 'downloaded', text_length: 0 },
    { id: '5', url: 'u5', status: 'failed', error: '403' },
  ];
  it('does not count a downloaded empty file as readable (was: status "downloaded" meant readable)', () => {
    expect(hasUsableText(docs[3])).toBe(false);
    expect(hasUsableText({ status: 'downloaded' })).toBe(false);
    const counts = documentCounts(docs, ['u1', 'u2', 'u3', 'u4', 'u5', 'u6'].map(url => ({ url })));
    expect(counts).toEqual({ discovered: 6, downloaded: 4, usable: 3, savedWithoutText: 1, failed: 1 });
    expect(documentSummary(counts)).toBe('4 of 6 discovered files downloaded; 3 contain usable text');
  });
  it('keeps unknown discovery unknown', () => {
    expect(documentSummary(documentCounts([], undefined))).toBe('Attachment discovery not checked');
    expect(documentSummary(documentCounts([], []))).toBe('No public attachment links found in this check');
    expect(documentSummary(documentCounts(docs.slice(0, 1), undefined))).toBe('1 file downloaded (discovered total unknown); 1 contains usable text');
  });
  it('does not trust an inconsistent host readable count and names textless files (was: "[object Object] unreadable")', () => {
    const text = coverageText({ result: { coverage: { includeDocuments: true, discovered: 3, downloaded: 2, readable: 2, unreadable: [{ documentId: 'd', name: 'blank.pdf' }] } } });
    expect(text).toBe('2 of 3 discovered files downloaded; 1 contains usable text · saved without usable text: blank.pdf');
    expect(coverageText({ result: { coverage: { includeDocuments: false } } })).toBe('Based on the saved notice only');
    expect(coverageText({ result: { coverage: { records: [{ discovered: 4, downloaded: 2, readable: 1, omitted: ['x'] }] } } })).toBe('2 of 4 discovered files downloaded; 1 text source included; 1 omitted for length');
  });
});

describe('P0: same-day date-only deadlines', () => {
  // 18:00 in Vancouver is already the next day in UTC: the old helpers treated the date as passed or silently open.
  const evening = Date.parse('2026-09-27T18:00:00-07:00');
  it('is unresolved, not closed and not silently open', () => {
    expect(zoneDate(evening)).toBe('2026-09-27');
    expect(deadlineState('2026-09-27', evening)).toBe('closing_today_time_unverified');
    expect(deadlineState('2026-09-27T14:00', evening)).toBe('closing_today_time_unverified');
    expect(deadlineState('2026-09-26', evening)).toBe('closed');
    expect(deadlineState('2026-09-28', evening)).toBe('open');
    expect(deadlineState('2026-09-27T14:00:00-07:00', evening)).toBe('closed');
    expect(deadlineState('2026-09-27T19:00:00-07:00', evening)).toBe('open');
    expect(deadlineState('TBD', evening)).toBe('unknown');
    expect(shortDate('2026-09-27', evening)).toEqual({ text: expect.stringContaining(CLOSING_TODAY_TEXT), tone: 'soon' });
    expect(shortDate('2026-09-26', evening).tone).toBe('passed');
    expect(shortDate('2026-09-27', evening, false).text).not.toContain(CLOSING_TODAY_TEXT);
    expect(deadlineLabel('2026-09-27', evening)).toBe(`2026-09-27 (date only) · ${CLOSING_TODAY_TEXT}`);
  });
  it('uses the Intl zone offset, including daylight saving', () => {
    expect(new Date(endOfZoneDay('2026-07-01')).toISOString()).toBe('2026-07-02T06:59:59.000Z');
    expect(new Date(endOfZoneDay('2026-12-01')).toISOString()).toBe('2026-12-02T07:59:59.000Z');
  });
  it('stays in bulk-download scope and the closing-soon list (was: dropped once Date.parse passed UTC midnight)', () => {
    const records = [{ id: 'today', data: { status: 'Open', closingDate: '2026-09-27', attachments: [{}] } }, { id: 'yesterday', data: { status: 'Open', closingDate: '2026-09-26', attachments: [{}] } }];
    expect(documentScope(records, 'current', evening).ids).toEqual(['today']);
    const row = (id: string, deadline: string): AnalysisRow => ({ recordId: id, promptId: 'p', promptVersion: 1, reviewedAt: '', title: id, kind: 'opportunity', source: 'bc-bid', deadline, buyer: '', status: 'Open', fields: {}, labels: [] });
    expect(closingSoon([row('today', '2026-09-27'), row('gone', '2026-09-26'), row('next', '2026-10-01')], evening).map(r => [r.recordId, r.state])).toEqual([['today', 'closing_today_time_unverified'], ['next', 'open']]);
    expect(closesWithin('2026-10-04', 7, evening)).toBe(true);
    expect(closesWithin('2026-10-05', 7, evening)).toBe(false);
  });
  it('keeps same-day date-only rows in SQL week filters and the upcoming sort group', () => {
    const db = new DatabaseSync(':memory:');
    db.exec('CREATE TABLE records(id TEXT PRIMARY KEY, kind TEXT, data TEXT, updated_at TEXT)');
    for (const [id, closingDate] of [['today', '2026-09-27'], ['past', '2026-09-20'], ['later', '2026-10-02']])
      db.prepare('INSERT INTO records VALUES (?, ?, ?, ?)').run(id, 'opportunity', JSON.stringify({ status: 'Open', closingDate }), '');
    const run = (options: Parameters<typeof buildProcurementQuery>[0]) => { const q = buildProcurementQuery({ asOf: evening, ...options }); return db.prepare(q.statement).all(...q.parameters).map((r: any) => r.id); };
    expect(run({ deadline: 'week' })).toEqual(['later', 'today']);
    expect(run({ sort: 'date-asc' })).toEqual(['today', 'later', 'past']);
    db.close();
  });
});

describe('P0: money partitions', () => {
  it('never mixes currencies or bases (was: first row\'s currency applied to every amount)', () => {
    const field = money('value', 'Contract value');
    const rows = [
      { v: { amount: 100, currency: 'CAD' } }, { v: { amount: 300, currency: 'CAD' } }, { v: { amount: 1_000_000, currency: 'USD' } },
      { v: { amount: 50, currency: 'CAD', basis: 'annual' } }, { v: null },
    ].map((f, i) => ({ recordId: `r${i}`, promptId: 'p', promptVersion: 1, reviewedAt: '', title: '', kind: 'opportunity', source: 'bc-bid', deadline: null, buyer: '', status: null, fields: { value: f.v }, labels: [] }));
    const s = summarizeField(field, rows);
    if (s.kind !== 'money') throw Error('expected money');
    expect(s.partitions.map(p => [p.currency, p.basis, p.stats.count])).toEqual([['CAD', 'estimated contract value', 2], ['CAD', 'annual', 1], ['USD', 'estimated contract value', 1]]);
    expect(s.partitions[0].stats.max).toMatch(/300/);
    expect(s.partitions[0].stats.max).not.toMatch(/M/);
    expect(s.notStated).toBe(1);
    // An unclassified field without a stated basis is its own "basis not stated" partition.
    const other = summarizeField(money('x', 'Amount'), [{ ...rows[0], fields: { x: { amount: 1, currency: 'CAD' } } }]);
    expect(other.kind === 'money' && other.partitions[0].basis).toBe('basis not stated');
  });
});

describe('P0: prompt versions are not aggregated together', () => {
  const seed = () => {
    const db = new DatabaseSync(':memory:');
    db.exec('CREATE TABLE records(id TEXT PRIMARY KEY, kind TEXT, title TEXT, data TEXT); CREATE TABLE reviews(id TEXT PRIMARY KEY, record_id TEXT, prompt_id TEXT, prompt_version INTEGER, status TEXT, result TEXT, created_at TEXT)');
    for (const id of ['a', 'b', 'c']) db.prepare('INSERT INTO records VALUES (?,?,?,?)').run(id, 'opportunity', id, '{}');
    const add = (id: string, record: string, version: number, at: string, fields: object) => db.prepare('INSERT INTO reviews VALUES (?,?,?,?,?,?,?)').run(id, record, 'p', version, 'succeeded', JSON.stringify({ fields, labels: [] }), at);
    add('a1', 'a', 1, '2026-09-01', { old: 1 }); add('a2', 'a', 2, '2026-09-02', { score: 4 }); add('a1b', 'a', 1, '2026-09-03', { old: 2 });
    add('b1', 'b', 1, '2026-09-01', { old: 3 }); add('c2', 'c', 2, '2026-09-02', { score: 5 });
    return { db, query: async (_: string, input: { statement: string; parameters: (string | number)[] }) => ({ rows: db.prepare(input.statement).all(...input.parameters) as any[] }) };
  };
  it('reads only the requested version and counts records excluded as older-only (was: latest result of any version)', async () => {
    const { db, query } = seed();
    const current = await readAnalysisRows(query, { promptId: 'p', promptVersion: 2 });
    expect(current.rows.map(r => [r.recordId, r.promptVersion, r.fields]).sort()).toEqual([['a', 2, { score: 4 }], ['c', 2, { score: 5 }]]);
    const older = await readAnalysisRows(query, { promptId: 'p', promptVersion: 1 });
    expect(older.rows.map(r => [r.recordId, r.fields]).sort()).toEqual([['a', { old: 2 }], ['b', { old: 3 }]]);
    // Without a version the old behaviour remains available (all-prompts overview only).
    expect((await readAnalysisRows(query, { promptId: 'p' })).rows.map(r => r.promptVersion).sort()).toEqual([1, 1, 2]);
    expect(await readPromptVersions(query, 'p', 2)).toEqual({ versions: [{ version: 2, records: 2 }, { version: 1, records: 2 }], olderOnly: 1 });
    db.close();
  });
});

describe('P0: complete exports with a manifest', () => {
  const resultRow = (i: number) => ({ id: `r${i}`, record_id: `rec${i}`, prompt_id: 'p', prompt_version: 1, status: 'succeeded', created_at: '2026-09-27', fields: '{}', labels: '[]', title: `T${i}` });
  const paged = (total: number) => async (_: string, input: { statement: string; parameters: (string | number)[] }) => {
    if (/count\(\*\) total/.test(input.statement)) return { rows: [{ version: 1, total }] };
    const [, limit, offset] = input.parameters as number[];
    return { rows: Array.from({ length: Math.max(0, Math.min(limit, total - offset)) }, (_, i) => resultRow(offset + i)) };
  };
  it('exports every result in scope, beyond the old 3,000-row stop', async () => {
    const all = await readAllReviewResults(paged(3150), 'p');
    expect(all.rows).toHaveLength(3150);
    expect(all).toMatchObject({ total: 3150, truncated: false, reason: '' });
    const manifest = exportManifest({ file: 'x.csv', scope: 'Latest result per record', filters: { promptId: 'p' }, rowsExported: all.rows.length, totalMatching: all.total });
    expect(manifest).toMatchObject({ rowsExported: 3150, totalMatching: 3150, truncated: false, truncationReason: null, generatedAt: expect.any(String) });
  });
  it('reports truncation explicitly when a ceiling or shortfall applies', async () => {
    const capped = await readAllReviewResults(paged(250), 'p', 120);
    expect(capped).toMatchObject({ truncated: true, total: 250, reason: expect.stringContaining('ceiling') });
    expect(capped.rows).toHaveLength(120);
    const manifest = exportManifest({ file: 'x.csv', scope: 's', filters: {}, rowsExported: 120, totalMatching: 250, truncationReason: capped.reason });
    expect(manifest.truncated).toBe(true);
    expect(manifestNote(manifest)).toMatch(/^Exported 120 of 250 rows\. Incomplete: /);
    expect(exportManifest({ file: 'x.csv', scope: 's', filters: {}, rowsExported: 9, totalMatching: 10 })).toMatchObject({ truncated: true, truncationReason: 'Exported 9 of 10 matching rows.' });
  });
  it('lists every record of a run larger than 200 (was: capped at 200)', async () => {
    const ids = Array.from({ length: 250 }, (_, i) => `rec${i}`);
    const rows = await readRunResults(async (_, input) => {
      if (input.statement.includes('WHERE r.run_id=?')) { const [, limit, offset] = input.parameters as number[]; return { rows: Array.from({ length: Math.max(0, Math.min(limit, 250 - offset)) }, (_, i) => resultRow(offset + i)) }; }
      return { rows: [] };
    }, { id: 'run', promptId: 'p', recordIds: ids });
    expect(rows).toHaveLength(250);
    expect(rows.every(r => r.outcome === 'succeeded')).toBe(true);
  });
  it('neutralises spreadsheet formulas in CSV cells', () => {
    const csv = toCsv(['a', 'b', 'c', 'd'], [['=HYPERLINK("x")', '+1', '-2', '@SUM(A1)']]);
    expect(csv.split('\r\n')[1]).toBe(`"'=HYPERLINK(""x"")","'+1","'-2","'@SUM(A1)"`);
  });
});
