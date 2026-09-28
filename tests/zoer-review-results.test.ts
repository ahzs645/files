import { describe, it, expect } from 'vitest';
import { composePrompt, type ReviewField } from '../zoer/dashboard/review-fields';
import { RESULTS_PAGE, columnText, readReviewResults, readRunResults, readRunReview, resultColumns, resultProblems, resultsCsv, reviewFromRow } from '../zoer/dashboard/review-results';

const fields: ReviewField[] = [
  { key: 'budget', label: 'Budget', type: 'money', description: 'Budget.' },
  { key: 'siteMeeting', label: 'Site meeting', type: 'yes-no', description: 'Mandatory meeting.' },
];
const typedPrompt = composePrompt('Assess.', fields);
const row = (id: string, values: object, instructions = typedPrompt) => ({
  id, run_id: 'run', record_id: `opportunity:${id}`, prompt_id: 'p', prompt_version: 2, model: 'm', status: 'succeeded', error: null, created_at: '2026-09-27T00:00:00Z', title: `Notice ${id}`,
  summary: 'Roof work', labels: '["Roofing"]', fields: JSON.stringify(values), evidence: '[]', coverage: null, unverified: 0, instructions,
});

describe('review results', () => {
  it('shapes catalog rows like saved review details', () => {
    const review = reviewFromRow(row('1', { budget: null }));
    expect(review.result).toMatchObject({ summary: 'Roof work', labels: ['Roofing'], fields: { budget: null }, prompt: { id: 'p', version: 2, instructions: typedPrompt } });
    expect(reviewFromRow({ ...row('2', {}), status: 'failed' }).result).toBeNull();
  });
  it('pages with one extra row to detect more results and avoids selecting large document reviews', async () => {
    const calls: any[] = [];
    const page = await readReviewResults(async (_, input) => { calls.push(input); return { rows: Array.from({ length: RESULTS_PAGE + 1 }, (_, i) => row(String(i), {})) }; }, 'p', 200);
    expect(page.rows).toHaveLength(RESULTS_PAGE); expect(page.more).toBe(true);
    expect(calls[0].parameters).toEqual(['p', RESULTS_PAGE + 1, 200]);
    expect(calls[0].statement).not.toMatch(/documentReviews|;|\bcontent\b|\bupdate\b|\bdelete\b|\btemp\b|\bmain\b/i);
    expect(await readRunReview(async () => ({ rows: [] }), 'run', 'x')).toBeNull();
  });
  it('uses typed definitions as columns, or the most common keys for free-form prompts', () => {
    expect(resultColumns(typedPrompt, []).map(c => c.label)).toEqual(['Budget', 'Site meeting']);
    const legacy = [reviewFromRow(row('1', { workRequired: 'x', funding: {} }, 'Prose')), reviewFromRow(row('2', { funding: {} }, 'Prose'))];
    expect(resultColumns('Prose', legacy).map(c => [c.key, c.label, !!c.field])).toEqual([['funding', 'Funding', false], ['workRequired', 'Work', false]]);
  });
  it('reads cells by own property so free-form keys like "constructor" show as not stated', () => {
    const review = reviewFromRow(row('1', {}, 'Prose'));
    expect(columnText({ key: 'constructor', label: 'Constructor' }, review)).toBe('Not stated');
    expect(columnText({ key: 'budget', label: 'Budget', field: fields[0] }, reviewFromRow(row('1', {})))).toBe('Not returned');
  });
  it('lists every record in a run: produced, reused because unchanged, failed, or without a result', async () => {
    const calls: any[] = [];
    const failed = { ...row('b', {}), status: 'failed', error: 'Model timed out', run_id: 'run-1' };
    const query = async (_: string, input: any) => {
      calls.push(input);
      if (input.statement.includes('WHERE r.run_id=?')) return { rows: [{ ...row('a', { budget: null }), run_id: 'run-1' }, failed] };
      if (input.statement.includes('r.prompt_id=?')) return { rows: [{ ...row('c', {}), id: 'old-c' }] };
      return { rows: [{ id: 'd', title: 'Notice d' }] };
    };
    const rows = await readRunResults(query as any, { id: 'run-1', promptId: 'p', recordIds: ['opportunity:a', 'opportunity:b', 'opportunity:c', 'd'], finishedAt: '2026-09-28T00:00:00Z' });
    expect(rows.map(r => [r.record_id, r.outcome, r.status])).toEqual([
      ['opportunity:a', 'succeeded', 'succeeded'], ['opportunity:b', 'failed', 'failed'], ['opportunity:c', 'reused', 'succeeded'], ['d', 'none', 'none'],
    ]);
    expect(rows[3].title).toBe('Notice d');
    // Reused results must predate the run's last update, and only unresolved records are looked up.
    expect(calls[1].parameters).toEqual(['p', '2026-09-28T00:00:00Z', 'opportunity:c', 'd']);
    expect(calls[2].parameters).toEqual(['d']);
    for (const call of calls) expect(call.statement).not.toMatch(/;|\bcontent\b|\bupdate\b|\bdelete\b|\btemp\b|\bmain\b/i);
    expect((await readRunResults(async () => ({ rows: [] }), { id: 'r', recordIds: ['x'], running: true }))[0].outcome).toBe('waiting');
  });
  it('checks each row against the prompt version that produced it', () => {
    expect(resultProblems(reviewFromRow(row('1', { budget: '$5M', siteMeeting: true })))?.problems).toBe(1);
    expect(resultProblems(reviewFromRow(row('1', { anything: 1 }, 'Prose')))).toBeNull();
  });
  it('exports formatted values and problem counts', () => {
    const reviews = [reviewFromRow(row('1', { budget: { amount: 5000, currency: 'CAD' }, siteMeeting: false }))];
    const [header, body] = resultsCsv(resultColumns(typedPrompt, reviews), reviews);
    expect(header).toEqual(['Record ID', 'Title', 'Reviewed', 'Prompt version', 'Model', 'Budget', 'Site meeting', 'Field problems', 'Labels', 'Summary']);
    expect(body[0].slice(5)).toEqual([expect.stringMatching(/5,000/), 'No', 0, 'Roofing', 'Roof work']);
  });
});
