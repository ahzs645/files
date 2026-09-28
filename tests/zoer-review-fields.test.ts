import { describe, it, expect } from 'vitest';
import { MAX_PROMPT_LENGTH, TYPED_TEMPLATE, checkFields, fieldValue, composePrompt, fieldKey, fieldProblems, formatTyped, outputContract, parsePrompt, suggestFields, type ReviewField } from '../zoer/dashboard/review-fields';
import { defaultReviewPrompt } from '../zoer/dashboard/review-prompt';
import { estimatedValue } from '../zoer/dashboard/procurement/ai';

const fields: ReviewField[] = [
  { key: 'budget', label: 'Budget', type: 'money', description: 'Stated budget.' },
  { key: 'closingDate', label: 'Closing date', type: 'date', description: 'Closing date.' },
  { key: 'route', label: 'Route', type: 'choice', options: ['Competitive bid', 'Direct award'], description: 'Award route.' },
  { key: 'siteMeeting', label: 'Site meeting', type: 'yes-no', description: 'Mandatory site meeting.' },
  { key: 'credentials', label: 'Credentials', type: 'list', description: 'Required credentials.' },
];

describe('review prompt fields', () => {
  it('round-trips instructions and fields through the saved prompt text', () => {
    const text = composePrompt('Assess the bid.\n', fields);
    expect(text.startsWith('Assess the bid.\n\nOUTPUT FIELDS')).toBe(true);
    expect(parsePrompt(text)).toEqual({ instructions: 'Assess the bid.', fields });
    expect(parsePrompt(composePrompt(parsePrompt(text).instructions, fields))).toEqual(parsePrompt(text));
  });
  it('treats legacy prompts as instructions without typed fields', () => {
    expect(parsePrompt(defaultReviewPrompt)).toEqual({ instructions: defaultReviewPrompt, fields: [] });
    expect(composePrompt('Only prose.', [])).toBe('Only prose.');
  });
  it('tells the model every key, its format and the choice options', () => {
    const contract = outputContract(fields);
    for (const f of fields) expect(contract).toContain(`"${f.key}"`);
    expect(contract).toContain('"Competitive bid", "Direct award"');
    expect(contract).toContain('{"amount": number, "currency": "CAD"}');
    expect(contract).toMatch(/Use null when the reviewed evidence does not state a value/);
  });
  it('keeps the typed template within the host prompt limit', () => {
    const text = composePrompt(TYPED_TEMPLATE.instructions, TYPED_TEMPLATE.fields);
    expect(text.length).toBeLessThan(MAX_PROMPT_LENGTH);
    expect(fieldProblems(TYPED_TEMPLATE.fields)).toEqual([]);
  });
  it('reports ambiguous definitions before saving', () => {
    expect(fieldProblems([{ key: 'a', label: 'A', type: 'text', description: 'x' }, { key: 'a', label: 'B', type: 'choice', options: ['one'], description: '' }])).toEqual([
      'B: the key "a" is used twice.', 'B: describe what the AI should extract.', 'B: list at least two different options.',
    ]);
    expect(fieldProblems([{ key: 'Bad key', label: 'Bad', type: 'text', description: 'x' }])[0]).toMatch(/must start with a lowercase letter/);
  });
  it('rejects choice fields that collapse to fewer than two distinct options or exceed twenty', () => {
    const choice = (options: string[]): ReviewField => ({ key: 'route', label: 'Route', type: 'choice', options, description: 'x' });
    expect(fieldProblems([choice(['Bid', ' Bid ', ''])])).toEqual(['Route: list at least two different options.']);
    expect(fieldProblems([choice(Array.from({ length: 21 }, (_, i) => `Option ${i}`))])).toEqual(['Route: use at most 20 options.']);
  });
  it('ignores inherited object properties when reading returned fields', () => {
    const field: ReviewField = { key: 'constructor', label: 'Constructor', type: 'text', description: 'x' };
    expect(fieldValue({}, 'constructor')).toBeUndefined();
    expect(checkFields([field], {}).checks[0].state).toBe('missing');
    expect(checkFields([field], { constructor: 'ok' }).checks[0].state).toBe('ok');
  });
  it('asks the model to keep values within the host size limit', () => {
    expect(outputContract(fields)).toContain('Keep text values under 300 characters and lists under 12 items.');
  });
  it('shows a typed budget as the notice estimated value', () => {
    const review = (budget: unknown) => ({ result: { fields: { budget }, prompt: { instructions: composePrompt('Assess.', fields) } } });
    expect(estimatedValue(review({ amount: 480000, currency: 'CAD' }))).toMatch(/480,000/);
    expect(estimatedValue(review('$480k'))).toBe('');
    expect(estimatedValue(review(null))).toBe('');
    expect(estimatedValue({ result: { fields: { funding: { status: 'disclosed', amount: 5, currency: 'CAD' } } } })).toMatch(/5/);
  });
  it('names unnamed fields by position so problems are easy to find', () => {
    expect(fieldProblems([{ key: 'a', label: 'A', type: 'text', description: 'x' }, { key: 'newField', label: '', type: 'text', description: '' }])).toEqual([
      'Field 2: add a name.', 'Field 2: describe what the AI should extract.',
    ]);
  });
  it('supports percentages from 0 to 100', () => {
    const pct: ReviewField = { key: 'share', label: 'Subcontract share', type: 'percent', description: 'x' };
    expect(outputContract([pct])).toContain('a JSON number from 0 to 100 meaning percent (15 means 15%)');
    expect(checkFields([pct], { share: 12.5 }).problems).toBe(0);
    for (const bad of [120, -1, '15%']) expect(checkFields([pct], { share: bad }).checks[0].state).toBe('invalid');
    expect(formatTyped(pct, 12.5)).toBe('12.5%');
  });
  it('supports whole-number scales with labelled ends', () => {
    const fit: ReviewField = { key: 'fit', label: 'Fit', type: 'scale', scale: { min: 1, max: 5, lowLabel: 'poor fit', highLabel: 'strong fit' }, description: 'How well we fit.' };
    const contract = outputContract([fit]);
    expect(contract).toContain('a whole number from 1 to 5 (1 = poor fit, 5 = strong fit)');
    expect(contract).toContain('{"fit":3}');
    expect(parsePrompt(composePrompt('Assess.', [fit])).fields).toEqual([fit]);
    expect(checkFields([fit], { fit: 4 }).problems).toBe(0);
    for (const bad of [0, 6, 3.5, '4']) expect(checkFields([fit], { fit: bad }).checks[0].state).toBe('invalid');
    expect(formatTyped(fit, 4)).toBe('4 / 5');
    expect(fieldProblems([{ ...fit, scale: { min: 5, max: 1 } }])).toEqual(['Fit: the scale needs whole numbers with the lowest below the highest.']);
    expect(fieldProblems([{ ...fit, scale: { min: NaN, max: 5 } }])).toHaveLength(1);
    expect(fieldProblems([{ ...fit, scale: { min: 0, max: 1000 } }])).toEqual(['Fit: keep the scale to at most 100 steps.']);
    // Older saved scale fields without explicit bounds default to 1–5.
    const { scale: _, ...bare } = fit;
    expect(checkFields([bare], { fit: 5 }).problems).toBe(0);
  });
  it('derives unique camelCase keys from labels', () => {
    expect(fieldKey('Closing date & time')).toBe('closingDateTime');
    expect(fieldKey('Budget', ['budget', 'budget2'])).toBe('budget3');
    expect(fieldKey('2025 value')).toBe('value');
    expect(fieldKey('!!!')).toBe('field');
  });
  it('checks model output against the declared types', () => {
    const { checks, extra, problems } = checkFields(fields, {
      budget: { amount: 250000, currency: 'CAD' }, closingDate: '15 Oct 2026', route: 'Sole source', siteMeeting: null, extraThing: 1,
    });
    expect(checks.map(c => c.state)).toEqual(['ok', 'invalid', 'invalid', 'empty', 'missing']);
    expect(extra).toEqual(['extraThing']);
    expect(problems).toBe(3);
    expect(checkFields(fields, { budget: null, closingDate: '2026-10-15T14:00-07:00', route: 'Direct award', siteMeeting: false, credentials: [] }).problems).toBe(0);
  });
  it('formats typed values for display', () => {
    expect(formatTyped(fields[0], { amount: 250000, currency: 'CAD' })).toMatch(/250,000/);
    expect(formatTyped(fields[3], false)).toBe('No');
    expect(formatTyped(fields[4], [])).toBe('None');
    expect(formatTyped(fields[4], ['COR'])).toEqual(['COR']);
    expect(formatTyped(fields[1], null)).toBe('Not stated');
    expect(formatTyped(fields[1], undefined)).toBe('Not returned');
    expect(formatTyped(fields[0], '$5M')).toBe('$5M');
  });
  it('suggests typed fields from an earlier free-form result', () => {
    expect(suggestFields({ workRequired: 'Roof', funding: { status: 'disclosed', amount: 5, currency: 'CAD' }, deadlines: ['x'], closing_date: '2026-01-02', count: 2, mandatory: true }).map(f => [f.key, f.type])).toEqual([
      ['workRequired', 'text'], ['funding', 'money'], ['deadlines', 'list'], ['closingDate', 'date'], ['count', 'number'], ['mandatory', 'yes-no'],
    ]);
  });
});
