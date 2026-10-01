/**
 * Deterministic assessment policy (IMPLEMENTATION-PLAN §8, POLICY_VERSION procurement-policy-v1).
 *
 * Explicit inputs in, explicit dimensions out. Relevance, eligibility, delivery, response and
 * commercial practicality are separate; reasons and critical unknowns are persisted; the suggested
 * action follows the reference `nextAction` rules. Nothing here decides for a human.
 */
import {
  POLICY_VERSION, TRIAGE_RELEVANCE, isOneOf,
  type Alignment, type ClaimReviewState, type CommercialState, type Coverage, type DateValue, type DeadlineState,
  type DeliveryState, type EligibilityState, type Freshness, type GateOrigin, type GateResult, type ID, type ISODateTime,
  type Money, type ProfileEvidence, type Relevance, type RequirementCategory, type RequirementMatch, type RequirementStrength,
  type ResponseState, type SuggestedAction, type TaskKind,
} from './contracts';
import { calendarDateInZone, deadlineState, isValidTimeZone, DEFAULT_DEADLINE_ZONE } from './dates';
import { HEADLINE_MONEY_KINDS } from './money';

// ---------------------------------------------------------------------------------------------
// Reference next-action rules (port of bid-review-plan/contracts/reference-policy.mjs)
// ---------------------------------------------------------------------------------------------

export interface NextActionGate {
  origin: GateOrigin | string;
  status: RequirementMatch | string;
  reviewed?: boolean;
  remediable?: boolean | null;
  applicabilityVerified?: boolean;
}

export interface NextActionInput {
  sourceClosedConfirmed?: boolean;
  gates?: readonly NextActionGate[];
  profileVersionId?: ID | null;
  stale?: boolean;
  materialConflict?: boolean;
  criticalUnknowns?: readonly string[];
  taskScopeReady?: boolean;
  confirmedAllowedPartnerScenario?: boolean;
  delivery?: DeliveryState | string;
  response?: ResponseState | string;
}

/** The five-step decision policy. Order matters: closure, confirmed blocker, missing inputs, gaps, readiness. */
export function nextAction(input: NextActionInput): SuggestedAction {
  if (!input || typeof input !== 'object') throw new TypeError('Assessment input required.');
  if (input.sourceClosedConfirmed === true) return 'archive_or_monitor';
  const gates = Array.isArray(input.gates) ? input.gates : [];
  if (gates.some(g => g.origin === 'buyer_mandatory' && g.status === 'unmet' && g.reviewed === true && g.remediable === false)) return 'decline';
  if (!input.profileVersionId || input.stale || input.materialConflict || input.criticalUnknowns?.length) return 'needs_information';
  if (!input.taskScopeReady || gates.length === 0) return 'needs_information';
  if (gates.some(g => g.status === 'unknown' || !g.reviewed)) return 'needs_information';
  if (gates.some(g => g.status === 'remediable_gap')) return input.confirmedAllowedPartnerScenario ? 'consider_partner' : 'investigate';
  // Neither an unreviewed assumed pass nor an unsupported "not applicable" is a pass.
  if (gates.some(g => g.status !== 'supported' && !(g.status === 'not_applicable' && g.applicabilityVerified === true))) return 'needs_information';
  if (input.delivery !== 'feasible' || input.response !== 'sufficient') return 'investigate';
  return 'ready_for_human_decision';
}

// ---------------------------------------------------------------------------------------------
// evaluateAssessment
// ---------------------------------------------------------------------------------------------

/** A requirement row plus its current review state. */
export interface PolicyRequirement {
  id: ID;
  text: string;
  strength: RequirementStrength;
  category: RequirementCategory | string;
  requiredBy?: string | null;
  condition?: string | null;
  lotId?: ID | null;
  grounding: Alignment;
  /** Latest human review state; absent → `proposed` (or `ungrounded` when the quote failed alignment). */
  reviewState?: ClaimReviewState | null;
  evidenceIds?: ID[];
}

/** A requirement ↔ profile-version match (host `procurement_matches`). */
export interface PolicyMatch {
  requirementId: ID;
  status: RequirementMatch;
  origin: GateOrigin;
  companyEvidenceIds?: ID[];
  rationale?: string;
  remediable?: boolean | null;
  reviewed: boolean;
  /** `not_applicable` is a pass only with verified applicability. */
  applicabilityVerified?: boolean;
  /** Support depends on a partner, not the company itself (never a confirmed capability on its own). */
  viaPartner?: boolean;
  taskId?: ID | null;
}

export interface PolicyConflict {
  id?: ID;
  description: string;
  material: boolean;
  resolved?: boolean;
}

/** The published profile version fields the policy reads. */
export interface PolicyProfile {
  id: ID;
  evidence: ProfileEvidence[];
  proposalEffortDays?: number | null;
}

export interface AssessmentInput {
  /** Frozen as-of point; every time-dependent rule uses this, never the wall clock. */
  asOf: ISODateTime | number | Date;
  profileVersionId: ID | null;
  /** Published profile version; when given, company evidence IDs are ownership/expiry checked against it. */
  profile?: PolicyProfile | null;
  requirements: readonly PolicyRequirement[];
  matches: readonly PolicyMatch[];
  /** Current triage result for the notice, or null when triage has not run. */
  triage: { relevance: string; classification?: string | null } | null;
  /** Coverage of the requirements extraction task, or null when unknown. */
  coverage: Coverage | null;
  deadline: DateValue | null;
  /** Inputs changed since the evidence was reviewed (new documents, profile publish, …). */
  stale: boolean;
  conflicts?: readonly PolicyConflict[];
  /** Source-confirmed cancellation/closure (in addition to a passed deadline). */
  sourceClosedConfirmed?: boolean;
  /** Reviewer confirmed the buyer allows the named partner scenario and the partner is committed. */
  partnerScenarioConfirmed?: boolean;
  /** Reviewer judgement of scenario/capacity feasibility; null when not confirmed. */
  deliveryReview?: 'feasible' | 'conditional' | 'not_feasible' | null;
  /** Operator-approved proposal effort in calendar days (overrides the profile's value). */
  proposalEffortDays?: number | null;
  /** Reviewer commercial judgement; null when not given. */
  commercialReview?: 'assessable' | 'outside_policy' | null;
  /** Reviewed money facts for the notice/lot (only buyer budget/value make it assessable). */
  money?: readonly Money[];
  /** Lot being assessed; requirements scoped to other lots are excluded (notice-wide ones apply). */
  lotId?: ID | null;
}

export interface GapTaskDraft {
  kind: TaskKind;
  title: string;
  linkedType: 'requirement' | 'document' | null;
  linkedId: ID | null;
  /** Raw due point from the source (e.g. "at award"); the reviewer sets an owner and date. */
  dueHint: string | null;
}

export interface AssessmentEvaluation {
  policyVersion: string;
  asOf: ISODateTime;
  profileVersionId: ID | null;
  lotId: ID | null;
  freshness: Freshness;
  relevance: Relevance;
  eligibility: EligibilityState;
  delivery: DeliveryState;
  response: ResponseState;
  commercial: CommercialState;
  suggestedAction: SuggestedAction;
  gates: GateResult[];
  criticalUnknowns: string[];
  reasons: string[];
  decisionBasisEvidenceIds: ID[];
  deadlineState: DeadlineState;
  taskScopeReady: boolean;
  /** Suggested follow-up tasks (remediable gaps, missing sources); the host/human creates them. */
  tasks: GapTaskDraft[];
}

/** Calendar-day buffer beyond the approved proposal effort below which response time is `tight`. */
export const RESPONSE_BUFFER_DAYS = 2;
export const NO_PROFILE_REASON = 'Choose a team to assess fit';
const GATING_STRENGTHS: readonly RequirementStrength[] = ['mandatory', 'conditional'];
const DELIVERY_CATEGORIES: readonly string[] = ['personnel', 'equipment', 'schedule', 'technical', 'experience'];
const INCOMPLETE_DISCOVERY = new Set(['not_checked', 'blocked', 'failed', 'external_portal']);

export type RequirementTiming = 'submission' | 'award' | 'contract' | 'unknown';

/** Classify a raw `requiredBy` due point. Anything unrecognized is `unknown` (never assumed to be submission). */
export function requirementTiming(requiredBy: string | null | undefined): RequirementTiming {
  const text = (requiredBy ?? '').toLowerCase();
  if (!text.trim()) return 'unknown';
  if (/\b(award|notice of (award|intent)|prior to (contract|execution|signing)|before (contract|signing|execution)|upon notification|successful (proponent|bidder))\b/.test(text)) return 'award';
  if (/\b(commencement|start of (work|services)|mobili[sz]|during (the )?(contract|term|work)|contract (start|execution)|throughout)\b/.test(text)) return 'contract';
  if (/\b(submission|submit|closing|close|with (the |your )?(bid|proposal|tender|quote|response)|time of (bid|tender|submission)|bid opening)\b/.test(text)) return 'submission';
  return 'unknown';
}

const passes = (g: GateResult) => g.reviewed && (g.status === 'supported' || (g.status === 'not_applicable' && g.applicabilityVerified));
const isBlocker = (g: GateResult) => g.origin === 'buyer_mandatory' && g.status === 'unmet' && g.reviewed && g.remediable === false;
const short = (text: string) => (text.length > 120 ? `${text.slice(0, 117)}…` : text);

function toIso(asOf: AssessmentInput['asOf']): { iso: string; ms: number } {
  const ms = asOf instanceof Date ? asOf.getTime() : typeof asOf === 'number' ? asOf : Date.parse(asOf);
  if (!Number.isFinite(ms)) throw new TypeError(`evaluateAssessment needs a valid asOf; received ${String(asOf)}.`);
  return { iso: new Date(ms).toISOString(), ms };
}

function daysBetween(fromDate: string, toDate: string): number {
  const [a, b] = [fromDate, toDate].map(d => Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10)));
  return Math.round((b! - a!) / 86_400_000);
}

/** Evaluate one assessment deterministically from explicit inputs. */
export function evaluateAssessment(input: AssessmentInput): AssessmentEvaluation {
  if (!input || typeof input !== 'object') throw new TypeError('Assessment input required.');
  const { iso: asOf, ms: now } = toIso(input.asOf);
  if (input.profile && input.profileVersionId && input.profile.id !== input.profileVersionId) throw new TypeError(`Profile ${input.profile.id} does not match profileVersionId ${input.profileVersionId}.`);
  const reasons: string[] = [];
  const critical: string[] = [];
  const tasks: GapTaskDraft[] = [];
  const addCritical = (text: string) => { if (!critical.includes(text)) critical.push(text); };
  const lotId = input.lotId ?? null;

  // Relevance comes only from triage; a missing triage is not_assessed, an unrecognized value unknown.
  let relevance: Relevance;
  if (!input.triage) {
    relevance = 'not_assessed';
    reasons.push('Relevance not assessed: notice triage has not run.');
  } else {
    relevance = isOneOf(TRIAGE_RELEVANCE, input.triage.relevance) ? input.triage.relevance : 'unknown';
    reasons.push(`Relevance ${relevance} (notice triage).`);
    if (input.triage.classification === 'outside_stated_preferences') reasons.push('Triage: outside stated preferences — an internal filter, not a buyer condition.');
  }

  // Deadline and source closure.
  const deadline = deadlineState(input.deadline, now);
  const sourceClosed = input.sourceClosedConfirmed === true || deadline === 'closed';
  if (input.sourceClosedConfirmed === true) reasons.push('Source confirms the opportunity is closed or cancelled.');
  if (deadline === 'closed') reasons.push(`Closing deadline has passed (${input.deadline?.raw ?? 'unknown'}).`);
  else if (deadline === 'closing_today_time_unverified') reasons.push('Closing date is today; closing time not verified.');
  else if (deadline === 'unknown') reasons.push('Closing deadline unknown.');

  // Freshness and conflicts.
  const freshness: Freshness = input.stale ? 'stale' : 'current';
  if (input.stale) reasons.push('Inputs changed since this evidence was reviewed; reconfirm before relying on it.');
  const materialConflicts = (input.conflicts ?? []).filter(c => c.material && !c.resolved);
  for (const conflict of materialConflicts) reasons.push(`Unresolved source conflict: ${short(conflict.description)}`);

  // Task scope / coverage. Unknown coverage is never treated as complete.
  const coverage = input.coverage;
  let taskScopeReady = false;
  if (!coverage) {
    addCritical('Requirement extraction coverage is unknown.');
  } else {
    if (coverage.usableText <= 0) addCritical('No readable source text was processed for requirements.');
    else if (coverage.processed < coverage.usableText) addCritical(`${coverage.usableText - coverage.processed} of ${coverage.usableText} readable sources not processed for requirements.`);
    for (const gap of coverage.missing) {
      if (gap.critical === false) { reasons.push(`Source not used: ${gap.name} (${gap.reason}).`); continue; }
      addCritical(`Missing source: ${gap.name} (${gap.reason}).`);
      tasks.push({ kind: 'acquire_evidence', title: `Obtain ${gap.name}`, linkedType: gap.id ? 'document' : null, linkedId: gap.id, dueHint: null });
    }
    if (INCOMPLETE_DISCOVERY.has(coverage.discovery)) addCritical(`Attachment discovery ${coverage.discovery.replace(/_/g, ' ')}; source documents may be missing.`);
    for (const limitation of coverage.limitations) reasons.push(`Limitation: ${limitation}`);
    taskScopeReady = coverage.usableText > 0 && coverage.processed >= coverage.usableText;
  }

  // Requirements in scope, with their effective review state.
  const inScope = input.requirements.filter(r => lotId === null || (r.lotId ?? null) === null || r.lotId === lotId);
  const effectiveState = (r: PolicyRequirement): ClaimReviewState => {
    const state = r.reviewState ?? 'proposed';
    if (r.grounding === 'unverified' && (state === 'proposed' || state === 'ungrounded')) return 'ungrounded';
    return state;
  };
  const active = inScope.filter(r => !['rejected', 'outdated'].includes(effectiveState(r)));
  const excluded = inScope.length - active.length;
  if (excluded) reasons.push(`${excluded} rejected or outdated requirement(s) excluded.`);
  for (const r of active) {
    if (!GATING_STRENGTHS.includes(r.strength)) continue;
    const state = effectiveState(r);
    if (state === 'ungrounded') addCritical(`Requirement could not be located in the source text; review it: ${short(r.text)}`);
    if (state === 'needs_clarification') addCritical(`Clarification requested: ${short(r.text)}`);
  }

  const finish = (partial: Omit<AssessmentEvaluation, 'suggestedAction' | 'policyVersion' | 'asOf' | 'criticalUnknowns' | 'reasons' | 'tasks' | 'deadlineState' | 'taskScopeReady' | 'freshness' | 'relevance' | 'lotId' | 'profileVersionId'>, partnerConfirmed: boolean): AssessmentEvaluation => {
    const suggestedAction = nextAction({
      sourceClosedConfirmed: sourceClosed, gates: partial.gates, profileVersionId: input.profileVersionId, stale: input.stale,
      materialConflict: materialConflicts.length > 0, criticalUnknowns: critical, taskScopeReady,
      confirmedAllowedPartnerScenario: partnerConfirmed, delivery: partial.delivery, response: partial.response,
    });
    reasons.push(`Suggested next action: ${suggestedAction.replace(/_/g, ' ')}.`);
    return {
      policyVersion: POLICY_VERSION, asOf, profileVersionId: input.profileVersionId, lotId, freshness, relevance, ...partial,
      suggestedAction, criticalUnknowns: critical, reasons, tasks, deadlineState: deadline, taskScopeReady,
    };
  };

  // No profile: classification and extraction stay useful; company-specific assertions are blocked.
  if (!input.profileVersionId) {
    reasons.push(`${NO_PROFILE_REASON}.`);
    return finish({ eligibility: 'not_assessed', delivery: 'not_assessed', response: 'not_assessed', commercial: 'not_assessed', gates: [], decisionBasisEvidenceIds: [] }, false);
  }

  // Gates: every mandatory/conditional requirement, plus any requirement carrying an internal/reviewer gate.
  const matchByRequirement = new Map<ID, PolicyMatch>();
  for (const match of input.matches) matchByRequirement.set(match.requirementId, match);
  const activeIds = new Set(active.map(r => r.id));
  const foreignMatches = input.matches.filter(m => !activeIds.has(m.requirementId)).length;
  if (foreignMatches) reasons.push(`Ignored ${foreignMatches} match(es) for requirements outside this assessment scope.`);
  const profileEvidence = input.profile ? new Map(input.profile.evidence.map(e => [e.id, e])) : null;
  const expired = (e: ProfileEvidence) => e.verification === 'expired' || (e.expiresAt !== null && Number.isFinite(Date.parse(e.expiresAt)) && Date.parse(e.expiresAt) <= now);

  const gates: GateResult[] = [];
  const categoryOf = new Map<ID, string>();
  for (const r of active) {
    const match = matchByRequirement.get(r.id);
    const gating = GATING_STRENGTHS.includes(r.strength);
    if (!gating && (!match || match.origin === 'buyer_mandatory')) continue;
    categoryOf.set(r.id, r.category);
    const requiredBy = r.requiredBy ?? null;
    const base = { requirementId: r.id, requiredBy, requirementEvidenceIds: [...(r.evidenceIds ?? [])], taskId: match?.taskId ?? null };
    if (!match) {
      gates.push({ ...base, origin: 'buyer_mandatory', status: 'unknown', reviewed: false, remediable: null, applicabilityVerified: false, companyEvidenceIds: [], rationale: 'No company match recorded; missing company evidence is unknown, not a failure.' });
      addCritical(`Company evidence unknown for: ${short(r.text)}`);
      continue;
    }
    let status: RequirementMatch = match.status;
    let remediable = match.remediable ?? null;
    const notes: string[] = match.rationale ? [match.rationale] : [];
    const companyEvidenceIds = [...new Set(match.companyEvidenceIds ?? [])];
    if (profileEvidence && status === 'supported') {
      const foreign = companyEvidenceIds.filter(id => !profileEvidence.has(id));
      if (foreign.length) {
        status = 'unknown';
        notes.push(`Company evidence ${foreign.join(', ')} is not part of this profile version.`);
      } else if (companyEvidenceIds.length && companyEvidenceIds.every(id => expired(profileEvidence.get(id)!))) {
        status = 'unknown';
        notes.push('All linked company evidence has expired as of the assessment date.');
      }
    }
    if (match.viaPartner && (status === 'supported' || status === 'unknown')) {
      status = 'remediable_gap';
      remediable = true;
      notes.push('Relies on a partner; a partner possibility is not a confirmed capability.');
    }
    if (status === 'unmet' && remediable === true) status = 'remediable_gap';
    const gate: GateResult = { ...base, origin: match.origin, status, reviewed: match.reviewed === true, remediable, applicabilityVerified: match.applicabilityVerified === true, companyEvidenceIds, rationale: notes.join(' ') };
    gates.push(gate);

    const label = short(r.text);
    if (status === 'remediable_gap') {
      const timing = requirementTiming(requiredBy);
      reasons.push(`Remediable gap (${requiredBy ? `due ${requiredBy}` : 'due point not stated'}${timing === 'award' || timing === 'contract' ? ', after submission' : ''}): ${label}`);
      if (!match.taskId) tasks.push({ kind: 'resolve_gap', title: `Resolve gap: ${label}`, linkedType: 'requirement', linkedId: r.id, dueHint: requiredBy });
    } else if (status === 'unmet') {
      if (isBlocker(gate)) reasons.push(`Blocker: reviewed, non-remediable buyer requirement not met: ${label}`);
      else if (gate.origin !== 'buyer_mandatory') reasons.push(`${gate.origin === 'internal_policy' ? 'Internal policy' : 'Reviewer preference'} not met (not a buyer disqualification): ${label}`);
      else if (!gate.reviewed) reasons.push(`Marked unmet but not reviewed: ${label}`);
      else reasons.push(`Unmet; remediability not confirmed: ${label}`);
    } else if (status === 'unknown') {
      if (gate.origin === 'buyer_mandatory') addCritical(`Company evidence unknown for: ${label}`);
      if (notes.length) reasons.push(`${notes.join(' ')} (${label})`);
    } else if (status === 'not_applicable' && !gate.applicabilityVerified) {
      reasons.push(`Marked not applicable without verified applicability: ${label}`);
    } else if (!gate.reviewed) {
      reasons.push(`Match not reviewed; an unreviewed pass is not promoted: ${label}`);
    }
  }

  // Eligibility (buyer-imposed gates only). A pass never comes from an empty ledger or overrides missing evidence.
  const buyerGates = gates.filter(g => g.origin === 'buyer_mandatory');
  let eligibility: EligibilityState;
  if (buyerGates.some(isBlocker)) eligibility = 'blocker';
  else if (!buyerGates.length) {
    eligibility = 'unresolved';
    reasons.push('No mandatory requirements in the reviewed ledger; an empty ledger is not an eligibility pass.');
  } else if (buyerGates.every(passes) && taskScopeReady && critical.length === 0) eligibility = 'supported_for_reviewed_requirements';
  else {
    eligibility = 'unresolved';
    if (buyerGates.every(passes)) reasons.push('Reviewed requirements are supported, but missing critical evidence prevents an eligibility pass.');
  }

  // Delivery feasibility for the scenario: gate evidence plus explicit reviewer confirmation of capacity.
  const deliveryGates = gates.filter(g => DELIVERY_CATEGORIES.includes(categoryOf.get(g.requirementId) ?? ''));
  let delivery: DeliveryState;
  if (input.deliveryReview === 'not_feasible' || deliveryGates.some(g => g.status === 'unmet' && g.reviewed && g.remediable === false)) delivery = 'not_feasible';
  else if (input.deliveryReview === 'conditional' || deliveryGates.some(g => g.status === 'remediable_gap')) delivery = 'conditional';
  else if (input.deliveryReview === 'feasible' && deliveryGates.every(passes)) delivery = 'feasible';
  else delivery = 'unknown';
  if (!input.deliveryReview) reasons.push('Delivery capacity for this scenario not confirmed by a reviewer.');

  // Response feasibility: deadline precision vs approved proposal effort (calendar days).
  const effort = input.proposalEffortDays ?? input.profile?.proposalEffortDays ?? null;
  let response: ResponseState;
  if (deadline === 'closed') response = 'insufficient';
  else if (deadline === 'unknown' || !input.deadline) response = 'unknown';
  else if (effort === null || !Number.isFinite(effort) || effort < 0) {
    response = 'unknown';
    reasons.push('Proposal effort not set; response time cannot be assessed.');
  } else {
    let remaining: number;
    if (input.deadline.precision === 'instant' && input.deadline.iso) remaining = (Date.parse(input.deadline.iso) - now) / 86_400_000;
    else {
      const zone = isValidTimeZone(input.deadline.zone) ? input.deadline.zone : DEFAULT_DEADLINE_ZONE;
      remaining = daysBetween(calendarDateInZone(now, zone), input.deadline.date!);
    }
    response = remaining < effort ? 'insufficient' : remaining < effort + RESPONSE_BUFFER_DAYS ? 'tight' : 'sufficient';
    reasons.push(`Response time ${response}: about ${Math.max(0, Math.floor(remaining))} day(s) left for ${effort} day(s) of proposal effort.`);
  }

  // Commercial practicality: never manufacture a budget.
  let commercial: CommercialState;
  const headline = (input.money ?? []).filter(m => (HEADLINE_MONEY_KINDS as readonly string[]).includes(m.kind) && (m.lower !== null || m.upper !== null));
  if (input.commercialReview === 'outside_policy') {
    commercial = 'outside_policy';
    reasons.push('Reviewer marked the commercial terms outside policy.');
  } else if (input.commercialReview === 'assessable' || headline.length) commercial = 'assessable';
  else {
    commercial = 'information_needed';
    reasons.push('Buyer budget or estimated value not stated in reviewed material; budget fit cannot be claimed.');
  }

  const basis = new Set<ID>();
  for (const g of gates) if (passes(g)) for (const id of [...g.requirementEvidenceIds, ...g.companyEvidenceIds]) basis.add(id);
  return finish({ eligibility, delivery, response, commercial, gates, decisionBasisEvidenceIds: [...basis].sort() }, input.partnerScenarioConfirmed === true);
}
