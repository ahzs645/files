/**
 * Port of bid-review-plan/tests/reference-policy.test.mjs (all 19 checks) against procurement-core.
 * `validateExactSpan` became `validateSpan`; the plan's `noticeId` is the host's `recordId`.
 */
import { describe, expect, it } from 'vitest';
import { nextAction, validateSpan, type NextActionGate, type NextActionInput } from '../../packages/procurement-core/src/index';

const gate: NextActionGate = { origin: 'buyer_mandatory', status: 'supported', reviewed: true, remediable: null };
const ready: NextActionInput = { profileVersionId: 'synthetic-v1', taskScopeReady: true, gates: [gate], delivery: 'feasible', response: 'sufficient' };

describe('reference nextAction rules', () => {
  it('supported evidence leads to human decision, not submission', () => expect(nextAction(ready)).toBe('ready_for_human_decision'));
  it('no profile', () => expect(nextAction({ ...ready, profileVersionId: null })).toBe('needs_information'));
  it('empty requirements cannot certify eligibility', () => expect(nextAction({ ...ready, gates: [] })).toBe('needs_information'));
  it('unknown requirement preserved', () => expect(nextAction({ ...ready, gates: [{ ...gate, status: 'unknown' }] })).toBe('needs_information'));
  it('unreviewed pass not promoted', () => expect(nextAction({ ...ready, gates: [{ ...gate, reviewed: false }] })).toBe('needs_information'));
  it('stale result', () => expect(nextAction({ ...ready, stale: true })).toBe('needs_information'));
  it('critical missing source', () => expect(nextAction({ ...ready, criticalUnknowns: ['missing schedule'] })).toBe('needs_information'));
  it('confirmed source closure', () => expect(nextAction({ ...ready, sourceClosedConfirmed: true })).toBe('archive_or_monitor'));
  it('confirmed non-remediable buyer blocker', () => expect(nextAction({ ...ready, gates: [{ ...gate, status: 'unmet', remediable: false }] })).toBe('decline'));
  it('internal preference not called buyer disqualification', () => expect(nextAction({ ...ready, gates: [{ ...gate, origin: 'internal_policy', status: 'unmet', remediable: false }] })).toBe('needs_information'));
  it('unconfirmed partner not assumed', () => expect(nextAction({ ...ready, gates: [{ ...gate, status: 'remediable_gap' }] })).toBe('investigate'));
  it('allowed partner scenario', () => expect(nextAction({ ...ready, gates: [{ ...gate, status: 'remediable_gap' }], confirmedAllowedPartnerScenario: true })).toBe('consider_partner'));
  it('not applicable requires review evidence', () => expect(nextAction({ ...ready, gates: [{ ...gate, status: 'not_applicable' }] })).toBe('needs_information'));
  it('tight response is not ready', () => expect(nextAction({ ...ready, response: 'tight' })).toBe('investigate'));
  it('rejects a missing input', () => expect(() => nextAction(undefined as unknown as NextActionInput)).toThrow(TypeError));
});

describe('reference span validation', () => {
  const source = { recordId: 'n1', extractionId: 'x1', textSha256: 'fixture-hash', text: 'A😀 must comply.' };
  const span = { recordId: 'n1', extractionId: 'x1', textSha256: 'fixture-hash', offsetUnit: 'unicode_code_point', start: 3, end: 7, quote: 'must' };
  it('code point span works across emoji', () => expect(validateSpan(span, source)).toBe(true));
  it('wrong offsets fail', () => expect(validateSpan({ ...span, start: 4 }, source)).toBe(false));
  it('foreign notice evidence rejected', () => expect(validateSpan({ ...span, recordId: 'n2' }, source)).toBe(false));
  it('different text version rejected', () => expect(validateSpan({ ...span, textSha256: 'new-hash' }, source)).toBe(false));
  it('foreign lot evidence rejected', () => expect(validateSpan({ ...span, lotId: 'other-lot' }, source)).toBe(false));
});
