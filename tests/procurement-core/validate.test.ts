import { describe, expect, it } from 'vitest';
import { parseModelJson, validateExtractionOutput, validateTriageOutput } from '../../packages/procurement-core/src/index';

const requirement = { text: 'Hold CGL insurance of $5,000,000', strength: 'mandatory', category: 'insurance', actor: 'Contractor', requiredBy: 'at award', condition: null, lot: null, quote: 'The Contractor shall carry CGL insurance of $5,000,000.' };
const budgetFact = { fieldKey: 'budget', semanticType: 'money:buyer_budget', status: 'stated', value: { lower: 50000, upper: 100000, currency: 'CAD', basis: 'total_contract', taxBasis: 'exclusive', raw: '$50,000 - $100,000 CAD' }, quote: 'budget of $50,000 - $100,000 CAD' };
const output = (patch: Record<string, unknown> = {}) => ({ requirements: [requirement], facts: [budgetFact], coverage: { complete: true, note: null }, ...patch });

describe('parseModelJson', () => {
  it('accepts objects, raw JSON, fenced JSON and JSON wrapped in prose', () => {
    expect(parseModelJson({ a: 1 })).toEqual({ ok: true, value: { a: 1 } });
    expect(parseModelJson('{"a":1}')).toEqual({ ok: true, value: { a: 1 } });
    expect(parseModelJson('```json\n{"a":1}\n```')).toEqual({ ok: true, value: { a: 1 } });
    expect(parseModelJson('Here you go:\n{"a":1}\nThanks')).toEqual({ ok: true, value: { a: 1 } });
    expect(parseModelJson('{"a":')).toMatchObject({ ok: false });
    expect(parseModelJson(42)).toMatchObject({ ok: false });
  });
});

describe('validateExtractionOutput', () => {
  it('accepts a valid output verbatim', () => {
    const result = validateExtractionOutput(JSON.stringify(output()));
    expect(result.ok).toBe(true);
    expect(result.issues).toEqual([]);
    expect(result.requirements).toEqual([requirement]);
    expect(result.facts).toEqual([budgetFact]);
    expect(result.coverage).toEqual({ complete: true, note: null });
  });

  it('parses fenced model output', () => {
    expect(validateExtractionOutput('```json\n' + JSON.stringify(output()) + '\n```').requirements).toHaveLength(1);
  });

  it('fails only when the output is unusable', () => {
    expect(validateExtractionOutput('not json at all')).toMatchObject({ ok: false, requirements: [], facts: [] });
    expect(validateExtractionOutput('[]').ok).toBe(false);
    expect(validateExtractionOutput({ requirements: 'many' }).ok).toBe(false);
    expect(validateExtractionOutput({}).ok).toBe(false);
    expect(validateExtractionOutput(null).ok).toBe(false);
  });

  it('never caps the requirement count', () => {
    const many = Array.from({ length: 250 }, (_, i) => ({ ...requirement, text: `Requirement ${i}`, quote: `Clause ${i}` }));
    const result = validateExtractionOutput(output({ requirements: many }));
    expect(result.requirements).toHaveLength(250);
    expect(result.issues).toEqual([]);
  });

  it('maps unknown categories to other with an issue', () => {
    const result = validateExtractionOutput(output({ requirements: [{ ...requirement, category: 'safety' }, { ...requirement, category: undefined }] }));
    expect(result.requirements.map(r => r.category)).toEqual(['other', 'other']);
    expect(result.issues.map(i => [i.path, i.severity])).toEqual([['requirements[0].category', 'warning'], ['requirements[1].category', 'warning']]);
  });

  it('drops invalid requirements into issues instead of throwing', () => {
    const bad = [
      'just a string', { ...requirement, text: '  ' }, { ...requirement, strength: 'must' }, { ...requirement, quote: '' }, { ...requirement, quote: undefined },
    ];
    const result = validateExtractionOutput(output({ requirements: [...bad, requirement] }));
    expect(result.ok).toBe(true);
    expect(result.requirements).toEqual([requirement]);
    expect(result.issues.filter(i => i.severity === 'error').map(i => i.path)).toEqual(['requirements[0]', 'requirements[1]', 'requirements[2]', 'requirements[3]', 'requirements[4]']);
    expect(result.issues[2]!.item).toEqual(bad[2]);
  });

  it('never invents or carries extra fields; absent optionals become null', () => {
    const result = validateExtractionOutput(output({ requirements: [{ text: 'Submit via BC Bid', strength: 'Mandatory', category: 'Submission', quote: 'Submit via BC Bid', confidence: 0.9, id: 'x' }] }));
    expect(result.requirements[0]).toEqual({ text: 'Submit via BC Bid', strength: 'mandatory', category: 'submission', actor: null, requiredBy: null, condition: null, lot: null, quote: 'Submit via BC Bid' });
    const numericActor = validateExtractionOutput(output({ requirements: [{ ...requirement, actor: 7 }] }));
    expect(numericActor.requirements[0]!.actor).toBeNull();
    expect(numericActor.issues[0]).toMatchObject({ path: 'requirements[0].actor', severity: 'warning' });
  });

  it('keeps quotes verbatim for alignment', () => {
    const quote = '  “exact”\npassage ';
    expect(validateExtractionOutput(output({ requirements: [{ ...requirement, quote }] })).requirements[0]!.quote).toBe(quote);
  });

  it('validates money values', () => {
    const fact = (value: unknown) => validateExtractionOutput(output({ facts: [{ ...budgetFact, value }] }));
    expect(fact({ ...budgetFact.value, lower: 200000 }).facts).toEqual([]);
    expect(fact({ ...budgetFact.value, lower: 200000 }).issues[0]!.message).toMatch(/exceeds/);
    expect(fact({ ...budgetFact.value, currency: 'CA' }).facts).toEqual([]);
    expect(fact({ ...budgetFact.value, currency: 'Canadian dollars' }).facts).toEqual([]);
    expect(fact({ ...budgetFact.value, currency: 'cad' }).facts[0]!.value).toMatchObject({ currency: 'CAD' });
    expect(fact({ ...budgetFact.value, currency: null }).facts[0]!.value).toMatchObject({ currency: null });
    expect(fact({ ...budgetFact.value, lower: Infinity }).facts).toEqual([]);
    expect(fact({ ...budgetFact.value, lower: -5 }).facts).toEqual([]);
    expect(fact({ ...budgetFact.value, upper: '$100k' }).facts).toEqual([]);
    expect(fact('100000').facts).toEqual([]);
    const coerced = fact({ ...budgetFact.value, lower: '50000' });
    expect(coerced.facts[0]!.value).toMatchObject({ lower: 50000 });
    expect(coerced.issues[0]).toMatchObject({ severity: 'warning' });
    const unknownBasis = fact({ lower: null, upper: 1, currency: null, basis: 'monthly', taxBasis: 'maybe' });
    expect(unknownBasis.facts[0]!.value).toEqual({ lower: null, upper: 1, currency: null, basis: 'unknown', taxBasis: 'unknown', raw: null });
    // Unknown bounds stay null, never zero.
    const noBounds = fact({ currency: 'CAD' });
    expect(noBounds.facts[0]!.value).toMatchObject({ lower: null, upper: null });
  });

  it('never lets an insurance field populate the budget', () => {
    const result = validateExtractionOutput(output({ facts: [{ ...budgetFact, fieldKey: 'insurance_limit' }, { ...budgetFact, fieldKey: 'budget', semanticType: 'money:insurance_limit' }] }));
    expect(result.facts).toEqual([]);
    expect(result.issues.every(i => i.severity === 'error' && /cannot carry/.test(i.message))).toBe(true);
  });

  it('validates fact status, field keys, dates and absence', () => {
    const facts = [
      { ...budgetFact, status: 'not_found_in_reviewed_material' },
      { ...budgetFact, semanticType: 'money:guess' },
      { fieldKey: 'closing_date', semanticType: 'date', status: 'stated', value: { raw: '2026-10-01 2:00 PM', precision: 'exact' }, quote: 'Closing: 2026-10-01 2:00 PM' },
      { fieldKey: 'closing_date', semanticType: 'date', status: 'stated', value: { precision: 'date' }, quote: 'Closing soon' },
      { fieldKey: 'budget', semanticType: 'money:buyer_budget', status: 'explicitly_absent', value: { lower: 0 }, quote: 'No budget is disclosed.' },
      { fieldKey: 'warranty', semanticType: 'text', status: 'stated', value: '2 years', quote: 'Warranty: 2 years' },
      { fieldKey: 'buyer', semanticType: 'text', status: 'stated', value: '', quote: 'Buyer:' },
      { ...budgetFact, quote: '' },
    ];
    const result = validateExtractionOutput(output({ facts }));
    expect(result.facts).toEqual([
      { fieldKey: 'closing_date', semanticType: 'date', status: 'stated', value: { raw: '2026-10-01 2:00 PM', precision: 'unknown' }, quote: 'Closing: 2026-10-01 2:00 PM' },
      { fieldKey: 'budget', semanticType: 'money:buyer_budget', status: 'explicitly_absent', value: null, quote: 'No budget is disclosed.' },
      { fieldKey: 'other', semanticType: 'text', status: 'stated', value: '2 years', quote: 'Warranty: 2 years' },
    ]);
    expect(result.issues.filter(i => i.severity === 'error').map(i => i.path)).toEqual(['facts[0]', 'facts[1]', 'facts[3]', 'facts[6]', 'facts[7]']);
  });

  it('never implies full coverage when coverage is missing or malformed', () => {
    expect(validateExtractionOutput({ requirements: [] }).coverage).toEqual({ complete: false, note: null });
    expect(validateExtractionOutput(output({ coverage: { complete: 'yes' } })).coverage.complete).toBe(false);
    const partial = validateExtractionOutput(output({ coverage: { complete: false, note: 'Stopped at 4.2' } }));
    expect(partial.coverage).toEqual({ complete: false, note: 'Stopped at 4.2' });
    expect(validateExtractionOutput({ requirements: [] }).issues.map(i => i.path)).toEqual(['facts', 'coverage']);
  });
});

describe('validateTriageOutput', () => {
  const triage = { classification: 'potentially_relevant', relevance: 'possible', workCategory: 'Civil engineering', route: 'Request for Proposals', reasons: [{ text: 'Road design', quote: 'detailed design of Highway 16' }], missingInformation: ['Scope documents'], summary: 'Based on the saved notice only, …' };
  it('accepts a valid triage', () => {
    expect(validateTriageOutput('```json\n' + JSON.stringify(triage) + '\n```')).toEqual({ ok: true, triage, issues: [] });
  });
  it('rejects an unknown classification (required)', () => {
    expect(validateTriageOutput({ ...triage, classification: 'relevant' })).toMatchObject({ ok: false, triage: null });
    expect(validateTriageOutput('nope').ok).toBe(false);
  });
  it('keeps unknown relevance unknown and nulls stay null', () => {
    const result = validateTriageOutput({ classification: 'insufficient_information', relevance: 'high', reasons: ['Bare title', { text: '' }, { text: 'Title only', quote: '' }], missingInformation: ['Scope', 3] });
    expect(result.triage).toEqual({ classification: 'insufficient_information', relevance: 'unknown', workCategory: null, route: null, reasons: [{ text: 'Bare title', quote: null }, { text: 'Title only', quote: null }], missingInformation: ['Scope'], summary: null });
    expect(result.issues.map(i => [i.path, i.severity])).toEqual([['relevance', 'warning'], ['reasons[1]', 'error'], ['missingInformation[1]', 'error']]);
  });
});
