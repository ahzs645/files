import { describe, expect, it } from 'vitest';
import {
  NO_PROFILE_REASON, POLICY_VERSION, evaluateAssessment, parseDeadline, requirementTiming, stableStringify,
  type AssessmentInput, type Coverage, type Money, type PolicyMatch, type PolicyProfile, type PolicyRequirement,
} from '../../packages/procurement-core/src/index';

const coverage: Coverage = { taskPurpose: 'requirements', discovery: 'links_found', sourceCompleteness: 'unknown', discovered: 2, downloaded: 2, usableText: 2, processed: 2, missing: [], limitations: [] };
const profile: PolicyProfile = {
  id: 'pv1',
  proposalEffortDays: 5,
  evidence: [
    { id: 'ev-ins', capability: 'CGL insurance $5M', holder: null, verification: 'reviewed', verifiedAt: '2026-01-01T00:00:00Z', expiresAt: '2027-01-01T00:00:00Z', sourceRef: null },
    { id: 'ev-cor', capability: 'COR certificate', holder: null, verification: 'reviewed', verifiedAt: '2026-01-01T00:00:00Z', expiresAt: '2026-06-01T00:00:00Z', sourceRef: null },
  ],
};
const req = (id: string, extra: Partial<PolicyRequirement> = {}): PolicyRequirement => ({ id, text: `Requirement ${id}`, strength: 'mandatory', category: 'insurance', requiredBy: 'at submission', grounding: 'exact', reviewState: 'accepted', evidenceIds: [`span-${id}`], ...extra });
const match = (requirementId: string, extra: Partial<PolicyMatch> = {}): PolicyMatch => ({ requirementId, status: 'supported', origin: 'buyer_mandatory', companyEvidenceIds: ['ev-ins'], reviewed: true, remediable: null, rationale: 'Certificate on file.', ...extra });
const budget: Money = { kind: 'buyer_budget', lower: 50000, upper: 100000, currency: 'CAD', basis: 'total_contract', taxBasis: 'exclusive', durationMonths: null, raw: '$50,000 - $100,000 CAD' };
const base: AssessmentInput = {
  asOf: '2026-09-27T17:00:00Z', profileVersionId: 'pv1', profile,
  requirements: [req('r1')], matches: [match('r1')],
  triage: { relevance: 'strong', classification: 'potentially_relevant' },
  coverage, deadline: parseDeadline('2026-10-20 2:00:00 PM'), stale: false,
  deliveryReview: 'feasible', money: [budget],
};
const evaluate = (patch: Partial<AssessmentInput> = {}) => evaluateAssessment({ ...base, ...patch });

describe('evaluateAssessment baseline', () => {
  it('fully supported, reviewed, current inputs reach a human decision (never a submission)', () => {
    const result = evaluate();
    expect(result).toMatchObject({
      policyVersion: POLICY_VERSION, asOf: '2026-09-27T17:00:00.000Z', freshness: 'current', relevance: 'strong',
      eligibility: 'supported_for_reviewed_requirements', delivery: 'feasible', response: 'sufficient', commercial: 'assessable',
      suggestedAction: 'ready_for_human_decision', deadlineState: 'open', taskScopeReady: true, criticalUnknowns: [],
    });
    expect(result.gates).toHaveLength(1);
    expect(result.decisionBasisEvidenceIds).toEqual(['ev-ins', 'span-r1']);
    expect(result.reasons.at(-1)).toBe('Suggested next action: ready for human decision.');
  });

  it('is deterministic and does not mutate its input', () => {
    const input = structuredClone(base);
    const snapshot = stableStringify(input);
    expect(stableStringify(evaluateAssessment(input))).toBe(stableStringify(evaluateAssessment(input)));
    expect(stableStringify(input)).toBe(snapshot);
  });

  it('requires a valid frozen as-of point and a matching profile', () => {
    expect(() => evaluate({ asOf: 'yesterday' })).toThrow(TypeError);
    expect(() => evaluate({ profileVersionId: 'pv2' })).toThrow(/does not match/);
  });
});

describe('BACKLOG P5 acceptance', () => {
  it('no profile means not_assessed and needs_information with "Choose a team to assess fit"', () => {
    const result = evaluate({ profileVersionId: null, profile: null });
    expect(result).toMatchObject({ eligibility: 'not_assessed', delivery: 'not_assessed', response: 'not_assessed', commercial: 'not_assessed', suggestedAction: 'needs_information', gates: [] });
    expect(result.reasons).toContain(`${NO_PROFILE_REASON}.`);
    expect(NO_PROFILE_REASON).toBe('Choose a team to assess fit');
    // Classification and extraction stay usable without a profile.
    expect(result.relevance).toBe('strong');
  });

  it('missing credential evidence is unknown, not a failure', () => {
    const result = evaluate({ requirements: [req('r1'), req('r2', { text: 'Valid COR certificate', category: 'credential' })] });
    const gate = result.gates.find(g => g.requirementId === 'r2')!;
    expect(gate).toMatchObject({ status: 'unknown', reviewed: false });
    expect(result.eligibility).toBe('unresolved');
    expect(result.eligibility).not.toBe('blocker');
    expect(result.suggestedAction).toBe('needs_information');
    expect(result.criticalUnknowns).toContain('Company evidence unknown for: Valid COR certificate');
  });

  it('an explicitly unmet, reviewed, non-remediable buyer condition is a blocker', () => {
    const result = evaluate({ matches: [match('r1', { status: 'unmet', remediable: false, companyEvidenceIds: [] })] });
    expect(result.eligibility).toBe('blocker');
    expect(result.suggestedAction).toBe('decline');
    expect(result.reasons.some(r => r.startsWith('Blocker:'))).toBe(true);
  });

  it('unmet without review or without confirmed non-remediability is not a blocker', () => {
    expect(evaluate({ matches: [match('r1', { status: 'unmet', remediable: false, reviewed: false })] })).toMatchObject({ eligibility: 'unresolved', suggestedAction: 'needs_information' });
    expect(evaluate({ matches: [match('r1', { status: 'unmet', remediable: null })] })).toMatchObject({ eligibility: 'unresolved', suggestedAction: 'needs_information' });
  });

  it('internal policy is not a buyer disqualification', () => {
    const result = evaluate({
      requirements: [req('r1'), req('r2', { strength: 'preferred', text: 'Work within 50 km of Prince George', category: 'other' })],
      matches: [match('r1'), match('r2', { origin: 'internal_policy', status: 'unmet', remediable: false })],
    });
    expect(result.eligibility).toBe('supported_for_reviewed_requirements');
    expect(result.suggestedAction).toBe('needs_information');
    expect(result.reasons).toContain('Internal policy not met (not a buyer disqualification): Work within 50 km of Prince George');
  });

  it('partner capacity cannot be assumed', () => {
    const viaPartner = evaluate({ matches: [match('r1', { viaPartner: true })] });
    expect(viaPartner.gates[0]).toMatchObject({ status: 'remediable_gap', remediable: true });
    expect(viaPartner.suggestedAction).toBe('investigate');
    expect(viaPartner.eligibility).toBe('unresolved');
    const confirmed = evaluate({ matches: [match('r1', { viaPartner: true })], partnerScenarioConfirmed: true });
    expect(confirmed.suggestedAction).toBe('consider_partner');
  });

  it('a requirement due at award can be a conditional remediation task', () => {
    const result = evaluate({
      requirements: [req('r1'), req('r2', { text: 'Provide WorkSafeBC clearance letter', requiredBy: 'prior to contract award', category: 'personnel' })],
      matches: [match('r1'), match('r2', { status: 'unmet', remediable: true, companyEvidenceIds: [] })],
    });
    const gate = result.gates.find(g => g.requirementId === 'r2')!;
    expect(gate.status).toBe('remediable_gap');
    expect(result.eligibility).toBe('unresolved');
    expect(result.delivery).toBe('conditional');
    expect(result.suggestedAction).toBe('investigate');
    expect(result.tasks).toContainEqual({ kind: 'resolve_gap', title: 'Resolve gap: Provide WorkSafeBC clearance letter', linkedType: 'requirement', linkedId: 'r2', dueHint: 'prior to contract award' });
    expect(result.reasons).toContain('Remediable gap (due prior to contract award, after submission): Provide WorkSafeBC clearance letter');
  });

  it('an updated profile reruns the assessment only (same requirements, new profile scope)', () => {
    const before = evaluate();
    const pv2: PolicyProfile = { id: 'pv2', evidence: [], proposalEffortDays: 5 };
    const input = { ...base, profileVersionId: 'pv2', profile: pv2 };
    const requirementsBefore = stableStringify(input.requirements);
    const after = evaluateAssessment(input);
    expect(stableStringify(input.requirements)).toBe(requirementsBefore);
    expect(after.profileVersionId).toBe('pv2');
    // pv1 company evidence is not scoped to pv2: ownership check turns the pass into unknown.
    expect(after.gates[0]).toMatchObject({ requirementId: 'r1', status: 'unknown' });
    expect(after.suggestedAction).toBe('needs_information');
    expect(before.suggestedAction).toBe('ready_for_human_decision');
  });

  it('an eligibility pass cannot override missing critical evidence', () => {
    const missing = evaluate({ coverage: { ...coverage, discovered: 3, missing: [{ id: 'doc-3', name: 'Appendix B', reason: 'download failed' }] } });
    expect(missing.eligibility).toBe('unresolved');
    expect(missing.suggestedAction).toBe('needs_information');
    expect(missing.criticalUnknowns).toContain('Missing source: Appendix B (download failed).');
    expect(missing.tasks).toContainEqual({ kind: 'acquire_evidence', title: 'Obtain Appendix B', linkedType: 'document', linkedId: 'doc-3', dueHint: null });
    expect(missing.reasons).toContain('Reviewed requirements are supported, but missing critical evidence prevents an eligibility pass.');
    const unprocessed = evaluate({ coverage: { ...coverage, processed: 1 } });
    expect(unprocessed).toMatchObject({ eligibility: 'unresolved', suggestedAction: 'needs_information', taskScopeReady: false });
    expect(evaluate({ coverage: null })).toMatchObject({ eligibility: 'unresolved', suggestedAction: 'needs_information' });
    expect(evaluate({ coverage: { ...coverage, discovery: 'not_checked' } }).suggestedAction).toBe('needs_information');
    // A non-critical gap is recorded but does not block.
    expect(evaluate({ coverage: { ...coverage, missing: [{ id: null, name: 'Drawing set', reason: 'reference only', critical: false }] } }).suggestedAction).toBe('ready_for_human_decision');
  });
});

describe('evaluateAssessment rules', () => {
  it('an empty requirement ledger never yields supported eligibility', () => {
    for (const requirements of [[], [req('p', { strength: 'preferred' })], [req('i', { strength: 'informational' })]]) {
      const result = evaluate({ requirements, matches: [] });
      expect(result.eligibility).toBe('unresolved');
      expect(result.suggestedAction).toBe('needs_information');
      expect(result.reasons).toContain('No mandatory requirements in the reviewed ledger; an empty ledger is not an eligibility pass.');
    }
  });

  it('a rejected requirement is never used as supported', () => {
    const result = evaluate({ requirements: [req('r1', { reviewState: 'rejected' })] });
    expect(result.gates).toEqual([]);
    expect(result.eligibility).toBe('unresolved');
    expect(result.reasons).toContain('1 rejected or outdated requirement(s) excluded.');
    expect(result.reasons.some(r => r.startsWith('Ignored 1 match'))).toBe(true);
  });

  it('ungrounded or clarification-pending requirements are critical unknowns', () => {
    expect(evaluate({ requirements: [req('r1', { grounding: 'unverified', reviewState: null })] }).criticalUnknowns[0]).toMatch(/could not be located/);
    expect(evaluate({ requirements: [req('r1', { reviewState: 'needs_clarification' })] }).suggestedAction).toBe('needs_information');
    // A reviewer who accepts an unverified requirement makes it usable.
    expect(evaluate({ requirements: [req('r1', { grounding: 'unverified', reviewState: 'accepted' })] }).suggestedAction).toBe('ready_for_human_decision');
  });

  it('conditional requirements gate; not_applicable needs verified applicability', () => {
    const requirements = [req('r1'), req('c1', { strength: 'conditional', condition: 'If subcontractors are used' })];
    expect(evaluate({ requirements, matches: [match('r1'), match('c1', { status: 'not_applicable' })] }).suggestedAction).toBe('needs_information');
    expect(evaluate({ requirements, matches: [match('r1'), match('c1', { status: 'not_applicable', applicabilityVerified: true })] }).suggestedAction).toBe('ready_for_human_decision');
  });

  it('an unreviewed pass is not promoted', () => {
    expect(evaluate({ matches: [match('r1', { reviewed: false })] })).toMatchObject({ eligibility: 'unresolved', suggestedAction: 'needs_information' });
  });

  it('expired company evidence is unknown', () => {
    const result = evaluate({ matches: [match('r1', { companyEvidenceIds: ['ev-cor'] })] });
    expect(result.gates[0]!.status).toBe('unknown');
    expect(result.gates[0]!.rationale).toContain('expired');
  });

  it('stale inputs and material conflicts need information', () => {
    expect(evaluate({ stale: true })).toMatchObject({ freshness: 'stale', suggestedAction: 'needs_information' });
    expect(evaluate({ conflicts: [{ description: 'Two closing dates stated', material: true }] }).suggestedAction).toBe('needs_information');
    expect(evaluate({ conflicts: [{ description: 'Resolved', material: true, resolved: true }] }).suggestedAction).toBe('ready_for_human_decision');
  });

  it('closure: passed deadline or confirmed closure → archive_or_monitor', () => {
    const passed = evaluate({ deadline: parseDeadline('2026-09-01 2:00:00 PM') });
    expect(passed).toMatchObject({ deadlineState: 'closed', suggestedAction: 'archive_or_monitor', response: 'insufficient' });
    expect(evaluate({ sourceClosedConfirmed: true }).suggestedAction).toBe('archive_or_monitor');
  });

  it('a same-day date-only deadline is not closed', () => {
    const result = evaluate({ asOf: '2026-10-02T05:30:00Z', deadline: parseDeadline('2026-10-01') }); // 22:30 PDT on Oct 1
    expect(result.deadlineState).toBe('closing_today_time_unverified');
    expect(result.suggestedAction).not.toBe('archive_or_monitor');
    expect(result.response).toBe('insufficient');
  });

  it('response time uses deadline precision and approved effort', () => {
    // as-of 2026-09-27 (Pacific), 5 days of approved effort, 2-day buffer.
    expect(evaluate({ deadline: parseDeadline('2026-10-01') }).response).toBe('insufficient');
    const tight = evaluate({ deadline: parseDeadline('2026-10-03') });
    expect(tight.response).toBe('tight');
    expect(tight.suggestedAction).toBe('investigate');
    expect(evaluate({ deadline: parseDeadline('2026-10-05') }).response).toBe('sufficient');
    expect(evaluate({ proposalEffortDays: 30 }).response).toBe('insufficient');
  });

  it('delivery requires reviewer confirmation of capacity', () => {
    const result = evaluate({ deliveryReview: null });
    expect(result.delivery).toBe('unknown');
    expect(result.suggestedAction).toBe('investigate');
    expect(evaluate({ deliveryReview: 'not_feasible' }).delivery).toBe('not_feasible');
  });

  it('unknown relevance and commercial inputs stay unknown/information_needed', () => {
    expect(evaluate({ triage: null }).relevance).toBe('not_assessed');
    expect(evaluate({ triage: { relevance: 'maybe?' } }).relevance).toBe('unknown');
    expect(evaluate({ triage: { relevance: 'weak' } }).suggestedAction).toBe('ready_for_human_decision');
    const noBudget = evaluate({ money: [] });
    expect(noBudget.commercial).toBe('information_needed');
    expect(evaluate({ money: [{ ...budget, kind: 'insurance_limit' }] }).commercial).toBe('information_needed');
    expect(evaluate({ commercialReview: 'outside_policy' }).commercial).toBe('outside_policy');
  });

  it('response is unknown without an approved effort or a known deadline', () => {
    expect(evaluate({ profile: { ...profile, proposalEffortDays: null } }).response).toBe('unknown');
    expect(evaluate({ deadline: parseDeadline('soon') }).response).toBe('unknown');
    expect(evaluate({ deadline: null }).deadlineState).toBe('unknown');
  });

  it('lot scope excludes other lots but keeps notice-wide requirements', () => {
    const result = evaluate({ lotId: 'lot-a', requirements: [req('r1'), req('r2', { lotId: 'lot-b' })], matches: [match('r1')] });
    expect(result.gates.map(g => g.requirementId)).toEqual(['r1']);
    expect(result.suggestedAction).toBe('ready_for_human_decision');
  });

  it('unknowns round-trip through JSON without becoming false', () => {
    const result = evaluate({ profileVersionId: null, profile: null, triage: null, deadline: null, coverage: null });
    const roundTripped = JSON.parse(JSON.stringify(result));
    expect(roundTripped).toEqual(result);
    expect(roundTripped.eligibility).toBe('not_assessed');
    expect(roundTripped.relevance).toBe('not_assessed');
    expect(roundTripped.deadlineState).toBe('unknown');
    const gates = JSON.parse(stableStringify(evaluate({ requirements: [req('r9')] }).gates));
    expect(gates[0].status).toBe('unknown');
    expect(gates[0].remediable).toBeNull();
    expect(gates[0].reviewed).toBe(false);
  });
});

describe('requirementTiming', () => {
  it('classifies raw due points without assuming submission', () => {
    expect(requirementTiming('at submission')).toBe('submission');
    expect(requirementTiming('with the proposal')).toBe('submission');
    expect(requirementTiming('at award')).toBe('award');
    expect(requirementTiming('prior to contract award')).toBe('award');
    expect(requirementTiming('before commencement of work')).toBe('contract');
    expect(requirementTiming(null)).toBe('unknown');
    expect(requirementTiming('eventually')).toBe('unknown');
  });
});
