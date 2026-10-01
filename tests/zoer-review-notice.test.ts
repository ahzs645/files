// @vitest-environment jsdom
/**
 * Notice detail (review workspace P4/P6/P7): pure rules behind the Decision, Requirements, Evidence, Changes and
 * Activity tabs. SQL for the same module is checked against the host reader in
 * zoer/dashboard/review-workspace/notice-queries.test.ts (bun test).
 */
import { describe, expect, it } from 'vitest';
import {
  decisionNoteRule, filterRequirements, headerMoney, mergeActivity, noteSatisfies, passageParts, requirementCounts, resolveNoticeTab, reviewStateOf, scopeText, spanProblem, stageStatus, usageText,
  type FactRow, type RequirementRow, type SpanRow, type StageRunRow,
} from '../zoer/dashboard/review-workspace/notice-queries';

const cps = (s: string) => Array.from(s);
const at = (text: string, part: string) => { const i = text.indexOf(part); return [Array.from(text.slice(0, i)).length, Array.from(text.slice(0, i)).length + Array.from(part).length]; };

describe('code-point passage highlighting', () => {
  const text = 'Intro 👋🏽 notes. Bidders must hold WCB 🎉 coverage and café́ access. End 🧾.';
  it('splits by code points around emoji and combining marks, never cutting a surrogate pair', () => {
    const [start, end] = at(text, 'Bidders must hold WCB 🎉 coverage');
    const parts = passageParts(text, start, end)!;
    expect(parts.match).toBe('Bidders must hold WCB 🎉 coverage');
    expect(parts.before + parts.match + parts.after).toBe(text);
    expect(parts.clippedStart || parts.clippedEnd).toBe(false);
    const [s2, e2] = at(text, 'café́');
    expect(passageParts(text, s2, e2)!.match).toBe('café́');
  });
  it('clips context in code points and can show the full text', () => {
    const [start, end] = at(text, 'WCB');
    const parts = passageParts(text, start, end, 3)!;
    expect(parts.match).toBe('WCB');
    expect(cps(parts.before)).toHaveLength(3);
    expect(parts.after).toBe(' 🎉 ');
    expect(parts.clippedStart && parts.clippedEnd).toBe(true);
    const full = passageParts(text, start, end, 3, true)!;
    expect(full.before + full.match + full.after).toBe(text);
    expect(full.clippedStart || full.clippedEnd).toBe(false);
  });
  it('rejects offsets that do not fit the text rather than highlighting the wrong passage', () => {
    expect(passageParts(text, null, 4)).toBeNull();
    expect(passageParts(text, 5, 5)).toBeNull();
    expect(passageParts(text, 0, cps(text).length + 1)).toBeNull();
    // A UTF-16 length would overshoot the code-point length for this text.
    expect(passageParts(text, 0, text.length)).toBeNull();
  });
  it('names why a passage cannot be shown instead of a dead link', () => {
    const [start, end] = at(text, 'WCB');
    const extraction = { id: 'e1', recordId: 'r1', documentId: null, sourceKind: 'notice', name: 'Notice', sha256: 'x', extractorVersion: 'v1', text, textSha256: 'h1', codePoints: cps(text).length, status: 'readable', limitations: [], createdAt: '' };
    const span: SpanRow = { id: 's1', extractionId: 'e1', textSha256: 'h1', startCp: start, endCp: end, quote: 'WCB', page: null, heading: null, alignment: 'exact' };
    expect(spanProblem(span, extraction, 'r1')).toBeNull();
    expect(spanProblem({ ...span, alignment: 'unverified', startCp: null, endCp: null }, extraction, 'r1')).toBe('Quote not found in source; candidate kept as ungrounded.');
    expect(spanProblem(null, extraction, 'r1', 'unverified')).toBe('Quote not found in source; candidate kept as ungrounded.');
    expect(spanProblem({ ...span, textSha256: 'other' }, extraction, 'r1')).toMatch(/different version/);
    expect(spanProblem({ ...span, quote: 'XYZ' }, extraction, 'r1')).toMatch(/do not reproduce/);
    expect(spanProblem(span, extraction, 'another-record')).toMatch(/do not reproduce/);
    expect(spanProblem(span, null, 'r1')).toMatch(/not in the catalog/);
  });
});

describe('human decision note rule', () => {
  const supported = { eligibility: 'supported_for_reviewed_requirements', suggestedAction: 'ready_for_human_decision', freshness: 'current', criticalUnknowns: [] as string[] };
  it('requires a note without an assessment, when overriding a blocker, or when eligibility is not supported', () => {
    expect(decisionNoteRule(null, 'pursue').required).toBe(true);
    expect(decisionNoteRule({ ...supported, eligibility: 'blocker', suggestedAction: 'decline' }, 'pursue')).toMatchObject({ required: true, reason: expect.stringMatching(/overriding a confirmed blocker/) });
    expect(decisionNoteRule({ ...supported, eligibility: 'blocker' }, 'no_bid').required).toBe(true);
    expect(decisionNoteRule({ ...supported, eligibility: 'unresolved', suggestedAction: 'needs_information' }, 'monitor').required).toBe(true);
    expect(decisionNoteRule({ ...supported, eligibility: 'not_assessed' }, 'defer').required).toBe(true);
  });
  it('requires a note to proceed on stale evidence or critical unknowns, not otherwise', () => {
    expect(decisionNoteRule(supported, 'pursue').required).toBe(false);
    expect(decisionNoteRule({ ...supported, freshness: 'stale' }, 'pursue').required).toBe(true);
    expect(decisionNoteRule({ ...supported, freshness: 'stale' }, 'monitor').required).toBe(false);
    expect(decisionNoteRule({ ...supported, criticalUnknowns: ['Insurance limit'] }, 'pursue').required).toBe(true);
    expect(decisionNoteRule(supported, '').required).toBe(false);
  });
  it('matches the host minimum of three characters', () => {
    const rule = decisionNoteRule(null, 'pursue');
    expect(noteSatisfies(rule, '  ok ')).toBe(false);
    expect(noteSatisfies(rule, 'Partner confirmed')).toBe(true);
    expect(noteSatisfies({ required: false }, '')).toBe(true);
  });
});

describe('requirement ledger filters and counts', () => {
  const row = (i: number, patch: Partial<RequirementRow> = {}): RequirementRow => ({ id: `q${i}`, lotId: null, stageRunId: 'x', ordinal: i, text: `Requirement ${i}`, strength: 'preferred', category: 'other', actor: null, requiredBy: null, conditionText: null, grounding: 'exact', supersedes: [], conflicts: [], reviewState: null, reviewValue: null, revision: 0, spanCount: 1, sourceName: null, page: null, heading: null, match: null, matchRevision: 0, ...patch });
  const rows = Array.from({ length: 37 }, (_, i) => row(i + 1, { strength: i < 12 ? 'mandatory' : 'preferred', grounding: i >= 34 ? 'unverified' : 'exact' }));
  rows[0] = { ...rows[0], reviewState: 'accepted', match: { status: 'supported', origin: 'buyer_mandatory', companyEvidence: [], rationale: 'r', remediable: null, reviewer: 'me', revision: 1, updatedAt: '' } };
  it('counts every requirement (no cap) with mandatory and ungrounded totals', () => {
    expect(requirementCounts(rows).text).toBe('37 requirements; 12 mandatory; 3 ungrounded');
    expect(requirementCounts([row(1)]).text).toBe('1 requirement; 0 mandatory; 0 ungrounded');
  });
  it('defaults review state to proposed or ungrounded from grounding', () => {
    expect(reviewStateOf(rows[1])).toBe('proposed');
    expect(reviewStateOf(rows[36])).toBe('ungrounded');
    expect(reviewStateOf({ ...rows[36], reviewState: 'rejected' })).toBe('rejected');
  });
  it('filters by strength, review state, match and grounding', () => {
    const none = { strength: '', review: '', match: '', grounding: '' };
    expect(filterRequirements(rows, none)).toHaveLength(37);
    expect(filterRequirements(rows, { ...none, strength: 'mandatory' })).toHaveLength(12);
    expect(filterRequirements(rows, { ...none, review: 'ungrounded' })).toHaveLength(3);
    expect(filterRequirements(rows, { ...none, review: 'accepted' }).map(r => r.id)).toEqual(['q1']);
    expect(filterRequirements(rows, { ...none, match: 'supported' })).toHaveLength(1);
    expect(filterRequirements(rows, { ...none, match: 'none' })).toHaveLength(36);
    expect(filterRequirements(rows, { ...none, grounding: 'unverified', strength: 'mandatory' })).toHaveLength(0);
  });
});

describe('header money uses buyer budget / estimated value only', () => {
  const fact = (id: string, semanticType: string, value: any, patch: Partial<FactRow> = {}): FactRow => ({ id, lotId: null, stageRunId: 'x', fieldKey: 'other', semanticType, status: 'stated', value, grounding: 'exact', reviewState: null, reviewValue: null, revision: 0, spanCount: 1, sourceName: null, page: null, heading: null, ...patch });
  const cad = (n: number, basis = 'total_contract') => ({ lower: n, upper: n, currency: 'CAD', basis, taxBasis: 'unknown', raw: `CAD ${n}` });
  it('never promotes an insurance limit to the budget', () => {
    const result = headerMoney([fact('i', 'money:insurance_limit', cad(5_000_000))], true);
    expect(result.headline).toEqual([]);
    expect(result.text).toBe('Budget not found; insurance limit listed separately');
    expect(result.others[0].label).toMatch(/^Insurance limit \(CAD/);
  });
  it('keeps currencies and bases in separate lines', () => {
    const result = headerMoney([fact('a', 'money:buyer_budget', cad(75_000)), fact('b', 'money:buyer_budget', { ...cad(50_000), currency: 'USD' }), fact('c', 'money:buyer_budget', cad(20_000, 'annual')), fact('d', 'money:award_value', cad(1))], true);
    expect(result.headline).toHaveLength(3);
    expect(result.headline.map(line => line.label)).toEqual(['Buyer budget (CAD, total contract)', 'Buyer budget (USD, total contract)', 'Buyer budget (CAD, per year)']);
    expect(result.headline[0].text).toMatch(/75,000/);
    expect(result.others.map(line => line.label)).toEqual(['Award value (CAD, total contract)']);
  });
  it('drops rejected facts, applies corrections and keeps explicit statuses distinct', () => {
    expect(headerMoney([fact('a', 'money:buyer_budget', cad(75_000), { reviewState: 'rejected' })], true).text).toBe('Budget not found in reviewed material');
    const corrected = headerMoney([fact('a', 'money:buyer_budget', cad(75_000), { reviewState: 'corrected', reviewValue: { value: cad(80_000) } })], true);
    expect(corrected.headline[0].text).toMatch(/80,000/);
    expect(headerMoney([fact('a', 'money:buyer_budget', null, { status: 'explicitly_absent', fieldKey: 'budget' })], true).text).toBe('Budget explicitly not disclosed');
    expect(headerMoney([], false).text).toBe('Not reviewed');
  });
});

describe('tabs, stage status, scope and activity', () => {
  it('maps old tab values and hides review tabs when the workspace is unavailable', () => {
    expect(resolveNoticeTab('documents', true)).toBe('evidence');
    expect(resolveNoticeTab('overview', true)).toBe('decision');
    expect(resolveNoticeTab('requirements', true)).toBe('requirements');
    expect(resolveNoticeTab('requirements', false)).toBe('decision');
    expect(resolveNoticeTab('documents', false)).toBe('evidence');
    expect(resolveNoticeTab('ai', false)).toBe('ai');
    expect(resolveNoticeTab(null, true)).toBe('decision');
  });
  const run = (id: string, patch: Partial<StageRunRow>): StageRunRow => ({ id, runId: 'r', stage: 'extract', stageKey: id, bundleId: null, templateId: 'procurement.extract', templateVersion: 1, model: 'm', status: 'succeeded', quality: 'valid', isCurrent: false, summary: null, coverage: null, usage: { known: false }, issues: [], error: null, startedAt: '2026-09-20T10:00:00Z', finishedAt: '2026-09-20T10:05:00Z', dryRun: false, ...patch });
  it('keeps the earlier result visible and dated when a newer run fails; test runs never count', () => {
    const runs = [run('dry', { startedAt: '2026-09-27T00:00:00Z', summary: 'Test run: x', dryRun: true, status: 'failed' }), run('new', { startedAt: '2026-09-26T00:00:00Z', status: 'failed', finishedAt: '2026-09-26T00:01:00Z' }), run('old', { isCurrent: true })];
    const status = stageStatus(runs, 'extract');
    expect(status.current?.id).toBe('old');
    expect(status.tone).toBe('failed');
    expect(status.note).toMatch(/^Review failed validation; earlier result retained with its date \(/);
    expect(stageStatus([run('only', { status: 'failed' })], 'extract').note).toMatch(/no earlier result/);
    expect(stageStatus([run('p', { isCurrent: true, quality: 'needs_review', issues: [{}, {}] })], 'extract')).toMatchObject({ tone: 'partial', note: expect.stringMatching(/2 validation issues/) });
    expect(stageStatus([run('q', { status: 'running' }), run('old', { isCurrent: true })], 'extract')).toMatchObject({ running: true, tone: 'running' });
    expect(stageStatus([], 'triage').note).toBe('Not run yet');
  });
  it('reports unknown usage as unknown, never zero', () => {
    expect(usageText({ known: false })).toBe('usage unknown');
    expect(usageText(null)).toBe('usage unknown');
    expect(usageText({ inputTokens: 1200, outputTokens: 300 })).toBe('1,200 in / 300 out tokens');
  });
  it('names the evidence scope with separate denominators', () => {
    expect(scopeText(null, 'triage')).toBe('Based on the saved notice only');
    expect(scopeText({ discovered: null, downloaded: 2, usableText: 1, processed: 1, sourceCompleteness: 'unknown' }, 'extract')).toBe('2 files downloaded (discovered total unknown); 1 contains usable text; 1 processed for requirements; source completeness unknown');
    expect(scopeText({ discovered: 6, downloaded: 4, usableText: 3, processed: 2 }, 'extract')).toBe('4 of 6 discovered files downloaded; 3 contain usable text; 2 processed for requirements; source completeness unknown');
  });
  it('merges activity newest first with undated items last', () => {
    const merged = mergeActivity([{ at: '2026-09-01T00:00:00Z', kind: 'a', title: 'old' }, { at: null, kind: 'a', title: 'undated' }, { at: '2026-09-20T00:00:00Z', kind: 'b', title: 'new' }]);
    expect(merged.map(item => item.title)).toEqual(['new', 'old', 'undated']);
  });
});

test('clipped passage context never starts or ends mid-word', () => {
  const text = 'Record ID: opportunity:1 and several more words sit right here. The Contractor must carry insurance. Closing words follow afterwards in this longer trailing sentence.';
  const start = [...text].length - [...text.slice(text.indexOf('The Contractor'))].length, end = start + [...'The Contractor must carry insurance.'].length;
  const parts = passageParts(text, start, end, 45)!;
  expect(parts.match).toBe('The Contractor must carry insurance.');
  expect(parts.before.startsWith(' ') || /^\S/.test(parts.before)).toBe(true);
  expect(text.charAt(text.indexOf(parts.before) - 1)).toMatch(/\s/);
  expect(parts.after.endsWith(' ')).toBe(false);
  expect(text.charAt(text.indexOf(parts.after) + parts.after.length)).toMatch(/\s/);
});
