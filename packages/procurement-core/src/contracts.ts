/**
 * Procurement review domain contracts (schema v1).
 *
 * Pure data definitions shared by the dashboard (files repo) and the Zoer host, which vendors a
 * byte-identical copy of this directory. No runtime dependencies, no DOM or Node APIs.
 *
 * Ground rules encoded here: unknown never becomes false/zero/"none"; `unknown`, `not_assessed` and
 * `not_found_in_reviewed_material` stay distinct; a model output is never a verified fact.
 */

export const SCHEMA_VERSION = 1;
export const POLICY_VERSION = 'procurement-policy-v1';

export type ID = string;
/** ISO-8601 timestamp (UTC unless an offset is stated). */
export type ISODateTime = string;

// ---------------------------------------------------------------------------------------------
// Enumerations: a `const` array plus the matching string-literal union for each.
// ---------------------------------------------------------------------------------------------

export const FACT_STATUSES = ['stated', 'explicitly_absent', 'not_found_in_reviewed_material', 'not_reviewed', 'conflicting', 'not_applicable'] as const;
export type FactStatus = (typeof FACT_STATUSES)[number];

/** Statuses a model may emit for a fact; the others are assigned by coverage/review, never by a model. */
export const MODEL_FACT_STATUSES = ['stated', 'explicitly_absent'] as const;
export type ModelFactStatus = (typeof MODEL_FACT_STATUSES)[number];

export const DISCOVERY_STATES = ['not_checked', 'checked_no_public_links', 'links_found', 'external_portal', 'blocked', 'failed'] as const;
export type DiscoveryState = (typeof DISCOVERY_STATES)[number];

export const EXTRACTION_STATUSES = ['not_attempted', 'readable', 'partial', 'unreadable', 'unsupported'] as const;
export type ExtractionStatus = (typeof EXTRACTION_STATUSES)[number];

export const SOURCE_KINDS = ['notice', 'document'] as const;
export type SourceKind = (typeof SOURCE_KINDS)[number];

export const SOURCE_COMPLETENESS = ['unknown', 'checked_public_scope'] as const;
export type SourceCompleteness = (typeof SOURCE_COMPLETENESS)[number];

export const ALIGNMENTS = ['exact', 'normalized_mapped', 'unverified'] as const;
export type Alignment = (typeof ALIGNMENTS)[number];

export const REQUIREMENT_STRENGTHS = ['mandatory', 'preferred', 'conditional', 'informational'] as const;
export type RequirementStrength = (typeof REQUIREMENT_STRENGTHS)[number];

export const REQUIREMENT_CATEGORIES = ['eligibility', 'credential', 'insurance', 'experience', 'personnel', 'equipment', 'submission', 'technical', 'commercial', 'schedule', 'legal', 'other'] as const;
export type RequirementCategory = (typeof REQUIREMENT_CATEGORIES)[number];

export const FACT_FIELD_KEYS = ['closing_date', 'budget', 'estimated_value', 'insurance_limit', 'bid_security', 'contract_duration', 'site_visit', 'questions_deadline', 'buyer', 'location', 'other'] as const;
export type FactFieldKey = (typeof FACT_FIELD_KEYS)[number];

export const MONEY_KINDS = ['buyer_budget', 'buyer_estimated_value', 'award_value', 'insurance_limit', 'bid_security', 'funding_program_amount', 'internal_cost_estimate'] as const;
export type MoneyKind = (typeof MONEY_KINDS)[number];

/** Money kinds a model may extract from buyer material (`internal_cost_estimate` is operator-entered only). */
export const FACT_SEMANTIC_TYPES = ['money:buyer_budget', 'money:buyer_estimated_value', 'money:insurance_limit', 'money:bid_security', 'money:award_value', 'money:funding_program_amount', 'date', 'duration', 'text'] as const;
export type FactSemanticType = (typeof FACT_SEMANTIC_TYPES)[number];

export const MONEY_BASES = ['total_contract', 'annual', 'per_unit', 'unknown'] as const;
export type MoneyBasis = (typeof MONEY_BASES)[number];

export const TAX_BASES = ['inclusive', 'exclusive', 'unknown'] as const;
export type TaxBasis = (typeof TAX_BASES)[number];

export const DATE_PRECISIONS = ['instant', 'date', 'range', 'unknown'] as const;
export type DatePrecision = (typeof DATE_PRECISIONS)[number];

export const DEADLINE_STATES = ['open', 'closing_today_time_unverified', 'closed', 'unknown'] as const;
export type DeadlineState = (typeof DEADLINE_STATES)[number];

/** Lifecycle of a machine claim (requirement or fact). A machine candidate is never automatically accepted. */
export const CLAIM_REVIEW_STATES = ['proposed', 'ungrounded', 'accepted', 'corrected', 'rejected', 'needs_clarification', 'outdated'] as const;
export type ClaimReviewState = (typeof CLAIM_REVIEW_STATES)[number];

/** Stored projection of the latest review event (host `procurement_review_state.state`). */
export const REVIEW_STATES = ['accepted', 'corrected', 'rejected', 'needs_clarification'] as const;
export type ReviewState = (typeof REVIEW_STATES)[number];

export const REVIEW_EVENTS = ['accept', 'reject', 'correct', 'request_clarification', 'reconfirm'] as const;
export type ReviewEventKind = (typeof REVIEW_EVENTS)[number];

export const REVIEW_TARGET_TYPES = ['requirement', 'fact'] as const;
export type ReviewTargetType = (typeof REVIEW_TARGET_TYPES)[number];

export const SPAN_TARGET_TYPES = ['requirement', 'fact', 'stage_run'] as const;
export type SpanTargetType = (typeof SPAN_TARGET_TYPES)[number];

export const REQUIREMENT_MATCHES = ['supported', 'remediable_gap', 'unmet', 'unknown', 'not_applicable'] as const;
export type RequirementMatch = (typeof REQUIREMENT_MATCHES)[number];

export const GATE_ORIGINS = ['buyer_mandatory', 'internal_policy', 'reviewer_preference'] as const;
export type GateOrigin = (typeof GATE_ORIGINS)[number];

export const RELEVANCE_STATES = ['strong', 'possible', 'weak', 'unknown', 'not_assessed'] as const;
export type Relevance = (typeof RELEVANCE_STATES)[number];

export const ELIGIBILITY_STATES = ['supported_for_reviewed_requirements', 'unresolved', 'blocker', 'not_assessed'] as const;
export type EligibilityState = (typeof ELIGIBILITY_STATES)[number];

export const DELIVERY_STATES = ['feasible', 'conditional', 'not_feasible', 'unknown', 'not_assessed'] as const;
export type DeliveryState = (typeof DELIVERY_STATES)[number];

export const RESPONSE_STATES = ['sufficient', 'tight', 'insufficient', 'unknown', 'not_assessed'] as const;
export type ResponseState = (typeof RESPONSE_STATES)[number];

export const COMMERCIAL_STATES = ['assessable', 'information_needed', 'outside_policy', 'not_assessed'] as const;
export type CommercialState = (typeof COMMERCIAL_STATES)[number];

export const FRESHNESS_STATES = ['current', 'stale', 'unknown'] as const;
export type Freshness = (typeof FRESHNESS_STATES)[number];

export const ASSESSMENT_DIMENSIONS = ['relevance', 'eligibility', 'delivery', 'response', 'commercial'] as const;
export type AssessmentDimension = (typeof ASSESSMENT_DIMENSIONS)[number];

export const SUGGESTED_ACTIONS = ['investigate', 'needs_information', 'consider_partner', 'ready_for_human_decision', 'decline', 'archive_or_monitor'] as const;
export type SuggestedAction = (typeof SUGGESTED_ACTIONS)[number];

export const DECISIONS = ['pursue', 'no_bid', 'monitor', 'defer'] as const;
export type DecisionKind = (typeof DECISIONS)[number];

export const TASK_KINDS = ['acquire_evidence', 'resolve_gap', 'reconfirm_change', 'decide', 'other'] as const;
export type TaskKind = (typeof TASK_KINDS)[number];

export const TASK_STATUSES = ['open', 'done', 'cancelled'] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export const CHANGE_KINDS = ['document_added', 'document_modified', 'document_missing_in_check', 'notice_modified', 'profile_published'] as const;
export type ChangeKind = (typeof CHANGE_KINDS)[number];

export const STAGES = ['triage', 'extract', 'consolidate', 'assess', 'changes', 'question'] as const;
export type Stage = (typeof STAGES)[number];

export const STAGE_RUN_STATUSES = ['queued', 'running', 'succeeded', 'failed', 'cancelled', 'superseded'] as const;
export type StageRunStatus = (typeof STAGE_RUN_STATUSES)[number];

export const STAGE_QUALITIES = ['valid', 'needs_review', 'unsupported', 'stale'] as const;
export type StageQuality = (typeof STAGE_QUALITIES)[number];

export const TRIAGE_CLASSIFICATIONS = ['potentially_relevant', 'outside_stated_preferences', 'insufficient_information'] as const;
export type TriageClassification = (typeof TRIAGE_CLASSIFICATIONS)[number];

/** Relevance values a triage model may emit (`not_assessed` is reserved for "no triage ran"). */
export const TRIAGE_RELEVANCE = ['strong', 'possible', 'weak', 'unknown'] as const;
export type TriageRelevance = (typeof TRIAGE_RELEVANCE)[number];

export const PROFILE_SCENARIOS = ['solo', 'team', 'partner'] as const;
export type ProfileScenario = (typeof PROFILE_SCENARIOS)[number];

export const EVIDENCE_VERIFICATIONS = ['self_declared', 'reviewed', 'expired', 'unknown'] as const;
export type EvidenceVerification = (typeof EVIDENCE_VERIFICATIONS)[number];

// ---------------------------------------------------------------------------------------------
// Entities
// ---------------------------------------------------------------------------------------------

/** A quote anchored in an immutable extraction text. Offsets are Unicode code points, half-open [start,end). */
export interface EvidenceSpan {
  id: ID;
  recordId: ID;
  lotId: ID | null;
  targetType: SpanTargetType;
  targetId: ID;
  extractionId: ID;
  textSha256: string;
  offsetUnit: 'unicode_code_point';
  /** null only when `alignment` is `unverified`. */
  start: number | null;
  end: number | null;
  quote: string;
  location: { page: number | null; heading: string | null };
  alignment: Alignment;
}

/** One source a task could not use. */
export interface CoverageGap {
  /** Document/attachment id when known. */
  id: ID | null;
  name: string;
  reason: string;
  /** Defaults to critical when absent: a missing tender file may hold mandatory requirements. */
  critical?: boolean;
}

/** Separate denominators for one task's evidence scope. Unknown totals stay null. */
export interface Coverage {
  taskPurpose: string;
  discovery: DiscoveryState;
  sourceCompleteness: SourceCompleteness;
  /** Files discovered at the source; null when the source inventory was not checked. */
  discovered: number | null;
  downloaded: number;
  usableText: number;
  processed: number;
  missing: CoverageGap[];
  limitations: string[];
}

export interface Fact<T = unknown> {
  id: ID;
  recordId: ID;
  lotId: ID | null;
  stageRunId: ID;
  fieldKey: FactFieldKey;
  semanticType: FactSemanticType;
  status: FactStatus;
  value: T | null;
  grounding: Alignment;
  evidenceIds: ID[];
  reviewState: ClaimReviewState;
}

/** Money value as extracted (fact `value` for `money:*` semantic types). */
export interface MoneyValue {
  lower: number | null;
  upper: number | null;
  /** ISO 4217 code; null when the source does not state it (a bare `$` is not assumed to be CAD). */
  currency: string | null;
  basis: MoneyBasis;
  taxBasis: TaxBasis;
  raw: string | null;
}

export interface Money extends MoneyValue {
  kind: MoneyKind;
  durationMonths: number | null;
  lotId?: ID | null;
}

export interface DateValue {
  raw: string;
  precision: DatePrecision;
  /** UTC instant; only for `instant` precision. */
  iso: string | null;
  /** Calendar date (YYYY-MM-DD) in `zone`; for a range this is the last date. */
  date: string | null;
  /** IANA zone (or `UTC`) the value is interpreted in. */
  zone: string | null;
  /** Whether `zone` was stated by the source or applied as a default. */
  zoneBasis?: 'stated' | 'default' | null;
}

export interface Requirement {
  id: ID;
  recordId: ID;
  lotId: ID | null;
  stageRunId: ID;
  ordinal: number;
  text: string;
  strength: RequirementStrength;
  category: RequirementCategory;
  actor: string | null;
  requiredBy: string | null;
  condition: string | null;
  grounding: Alignment;
  evidenceIds: ID[];
  supersedesRequirementIds: ID[];
  conflictIds: ID[];
}

export interface ProfileEvidence {
  id: ID;
  capability: string;
  holder: string | null;
  verification: EvidenceVerification;
  verifiedAt: ISODateTime | null;
  expiresAt: ISODateTime | null;
  sourceRef: ID | null;
}

export interface ProfilePartner {
  name: string;
  capabilities: string[];
  /** A partner possibility is not a confirmed capability; only `true` allows a partner scenario. */
  confirmed: boolean;
}

/** Editable draft data; also the payload of each immutable published version. */
export interface CompanyProfileData {
  scenario: ProfileScenario;
  serviceLines: string[];
  exclusions: string[];
  regions: string[];
  evidence: ProfileEvidence[];
  partners: ProfilePartner[];
  capacityPeriod: { from: string; to: string } | null;
  /** Operator-approved proposal effort in working days; null when not stated. */
  proposalEffortDays: number | null;
  commercialConstraints: string[];
}

export interface CompanyProfile {
  id: ID;
  name: string;
  draft: CompanyProfileData;
  draftVersion: number;
  updatedAt: ISODateTime;
}

export interface CompanyProfileVersion extends CompanyProfileData {
  id: ID;
  profileId: ID;
  version: number;
  name: string;
  publishedAt: ISODateTime;
  publishedBy: string;
}

export interface GateResult {
  requirementId: ID;
  origin: GateOrigin;
  status: RequirementMatch;
  /** Whether a human reviewed this match. An unreviewed pass is never promoted. */
  reviewed: boolean;
  remediable: boolean | null;
  /** `not_applicable` counts as a pass only when applicability was verified. */
  applicabilityVerified: boolean;
  requiredBy: string | null;
  requirementEvidenceIds: ID[];
  companyEvidenceIds: ID[];
  rationale: string;
  taskId: ID | null;
}

export interface Assessment {
  id: ID;
  recordId: ID;
  lotId: ID | null;
  bundleId: ID | null;
  profileVersionId: ID | null;
  policyVersion: string;
  asOf: ISODateTime;
  freshness: Freshness;
  relevance: Relevance;
  eligibility: EligibilityState;
  delivery: DeliveryState;
  response: ResponseState;
  commercial: CommercialState;
  suggestedAction: SuggestedAction;
  gates: GateResult[];
  criticalUnknowns: string[];
  /** Human-readable reasons, in evaluation order. */
  reasons: string[];
  isCurrent: boolean;
  createdAt: ISODateTime;
}

export interface ReviewEvent {
  id: ID;
  recordId: ID;
  targetType: ReviewTargetType;
  targetId: ID;
  event: ReviewEventKind;
  reason: string;
  correction: unknown | null;
  reviewer: string;
  revision: number;
  occurredAt: ISODateTime;
}

export interface Decision {
  id: ID;
  recordId: ID;
  assessmentId: ID | null;
  decision: DecisionKind;
  note: string;
  actor: string;
  needsReconfirmation: boolean;
  staleReason: string | null;
  createdAt: ISODateTime;
}

export interface ReviewTask {
  id: ID;
  recordId: ID;
  title: string;
  kind: TaskKind;
  linkedType: string | null;
  linkedId: ID | null;
  owner: string | null;
  dueAt: ISODateTime | null;
  status: TaskStatus;
  completionNote: string | null;
  version: number;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
}

export interface ChangeEvent {
  id: ID;
  recordId: ID;
  kind: ChangeKind;
  detail: unknown;
  detectedAt: ISODateTime;
  acknowledgedAt: ISODateTime | null;
  acknowledgedBy: string | null;
}

/** True when `value` is one of the members of `values` (narrowing helper for enum checks). */
export function isOneOf<T extends string>(values: readonly T[], value: unknown): value is T {
  return typeof value === 'string' && (values as readonly string[]).includes(value);
}
