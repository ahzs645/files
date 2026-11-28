// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { profileStateOf } from '../zoer/dashboard/review-workspace/profile-context';
import { profilePickerOptions } from '../zoer/dashboard/review-workspace/ProfilePicker';
import { profilePromptText } from '../zoer/dashboard/review-workspace/ProfilePrompt';
import { coverageIsEmpty, staleIsEmpty, visibleQueues } from '../zoer/dashboard/review-workspace/insights-data';
import { onlyOption } from '../zoer/dashboard/review-prompt';
import { CELL_TEXT, deriveCell, factDisplay, type FactRow } from '../zoer/dashboard/review-workspace/evidence-queries';
import { WORKBENCH_STAGES, executionText } from '../zoer/dashboard/review-workspace/workbench';

const draft = { id: 'p1', name: 'dssdf', published: false };
const live = { id: 'p2', name: 'Acme', published: true };

describe('profile state', () => {
  it('tells none, draft-only, unchosen and chosen apart', () => {
    expect(profileStateOf([], null)).toEqual({ state: 'none' });
    expect(profileStateOf([draft], null)).toEqual({ state: 'draft-only', draftName: 'dssdf' });
    expect(profileStateOf([draft, live], null)).toEqual({ state: 'unchosen' });
    expect(profileStateOf([draft, live], 'v1')).toEqual({ state: 'chosen' });
  });
  it('words the prompt for the state, never "Choose" when nothing can be chosen', () => {
    expect(profilePromptText('draft-only', 'dssdf', true)?.title).toBe('Publish your profile “dssdf”');
    expect(profilePromptText('none', undefined, true)?.title).toBe('Create a company profile');
    expect(profilePromptText('unchosen', undefined, true)?.title).toBe('Choose a profile');
    expect(profilePromptText('chosen', undefined, true)).toBeNull();
    expect(profilePromptText('draft-only', 'dssdf', false)?.title).toBe('No published company profile');
  });
});

describe('Assess as picker', () => {
  it('lists a draft as a disabled entry and offers Manage profiles, not Create a profile', () => {
    const options = profilePickerOptions([], [draft], true);
    expect(options).toContainEqual({ value: 'draft:p1', text: 'dssdf (draft, not published)', disabled: true });
    expect(options.map(o => o.text)).not.toContain('Create a profile…');
    expect(options.at(-1)?.text).toBe('Manage profiles…');
  });
  it('offers Create only when no profile exists, and nothing to manage on a read-only copy', () => {
    expect(profilePickerOptions([], [], true).map(o => o.text)).toEqual(['No company profile', 'Create a profile…']);
    expect(profilePickerOptions([], [draft], false).map(o => o.text)).toEqual(['No company profile', 'dssdf (draft, not published)']);
  });
  it('lists published versions as choosable and leaves published profiles out of the drafts', () => {
    const options = profilePickerOptions([{ id: 'v1', name: 'Acme', version: 2 }], [live, draft], true);
    expect(options.filter(o => !o.disabled).map(o => o.text)).toEqual(['No company profile', 'Acme · v2', 'Manage profiles…']);
    expect(options.filter(o => o.disabled).map(o => o.text)).toEqual(['dssdf (draft, not published)']);
  });
});

describe('Decisions: no grid of zeros', () => {
  it('treats coverage with nothing extracted and no review states as empty', () => {
    expect(coverageIsEmpty({ total: 1568, extracted: 0, states: {} })).toBe(true);
    expect(coverageIsEmpty({ total: 1568, extracted: 0, states: { accepted: 0, proposed: 0 } })).toBe(true);
    expect(coverageIsEmpty({ total: 1568, extracted: 1, states: {} })).toBe(false);
    expect(coverageIsEmpty({ total: 1568, extracted: 0, states: { proposed: 3 } })).toBe(false);
  });
  it('lists only queues with a known, non-zero count', () => {
    expect(visibleQueues([['acquire', 477], ['requirements', 0], ['eligibility', null], ['decide', 0]] as const)).toEqual([['acquire', 477]]);
    expect(visibleQueues([['requirements', 0], ['eligibility', null]] as const)).toEqual([]);
  });
  it('hides stale decisions when there is nothing to reconfirm', () => {
    expect(staleIsEmpty({ decisions: [], staleAssessments: 0 })).toBe(true);
    expect(staleIsEmpty({ decisions: [], staleAssessments: 2 })).toBe(false);
  });
});

describe('AI reviews preselection', () => {
  it('starts on the only prompt or computer, and never guesses among several', () => {
    expect(onlyOption([{ id: 'bid' }], '')).toBe('bid');
    expect(onlyOption([{ id: 'a' }, { id: 'b' }], '')).toBe('');
    expect(onlyOption([], '')).toBe('');
    expect(onlyOption([{ id: 'bid' }], 'kept')).toBe('kept');
  });
});

const fact = (extra: Partial<FactRow>): FactRow => ({ id: 'f1', recordId: 'r1', lotId: null, fieldKey: 'bid_security', semanticType: 'money:bid_security', status: 'stated', value: null, grounding: 'exact', reviewState: null, reviewValue: null, ...extra });
describe('extracted facts: readable money and dates', () => {
  it('shows an amount with its caveats as secondary text', () => {
    expect(factDisplay('money:bid_security', { lower: 6_000_000, upper: 6_000_000, currency: null, basis: 'unknown' })).toMatchObject({ text: '$6,000,000', detail: 'Currency and basis not stated' });
    expect(factDisplay('money:buyer_budget', { lower: 80_000, upper: 80_000, currency: 'CAD', basis: 'total_contract' })).toMatchObject({ text: '$80,000', detail: 'Total contract' });
    expect(factDisplay('money:buyer_budget', { lower: 10, upper: 20, currency: 'CAD', basis: 'annual' })).toMatchObject({ text: '$10–$20 per year', detail: '' });
    expect(factDisplay('money:buyer_budget', { lower: 5, upper: 5, currency: 'USD', basis: 'unknown' }).text).toBe('5 USD');
    expect(factDisplay('money:award_value', { lower: 7, upper: 7, currency: 'CAD', basis: 'total_contract' }).detail).toBe('Total contract · Award value');
    expect(factDisplay('money:buyer_budget', { lower: null, upper: null, raw: 'To be negotiated' }).text).toBe('To be negotiated');
  });
  it('names a conflict as "2 values, e.g. …" and keeps the full text for export', () => {
    const cell = deriveCell('bid_security', [fact({ value: { lower: 6_000_000, upper: 6_000_000, currency: null, basis: 'unknown' } }), fact({ id: 'f2', value: { lower: 5, upper: 5, currency: null, basis: 'unknown' } })], false);
    expect(cell.display.text).toMatch(/^2 values, e\.g\. \$/);
    expect(cell.display.detail).toBe('Currency and basis not stated');
    expect(cell.value).toMatch(/^2 different values · e\.g\. \$6,000,000 · Currency and basis not stated/);
  });
  it('reads dates in the app format and keeps the source wording', () => {
    expect(factDisplay('date', { raw: '2026-09-11', precision: 'date' })).toEqual({ text: 'Sep 11, 2026', detail: '', raw: '2026-09-11' });
    expect(factDisplay('date', { raw: 'three years from the closing date', precision: 'unknown' })).toMatchObject({ text: 'three years from the closing date', detail: 'Not a recognized date' });
    expect(deriveCell('site_visit', [], false).display.text).toBe(CELL_TEXT.not_found);
  });
});

describe('AI pipeline stage text', () => {
  it('never repeats the execution kind', () => {
    for (const stage of WORKBENCH_STAGES) expect(executionText(stage)).not.toMatch(/^(AI|Deterministic) · (AI|Deterministic)\b/i);
    expect(executionText(WORKBENCH_STAGES.find(s => s.key === 'extract')!)).toBe('AI, validated against the schema');
  });
});
