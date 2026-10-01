import { sql } from '../procurement/display';

/** JSON columns come back as text from the read-only bridge. Bad JSON reads as the fallback, never as a value. */
export function json<T>(value: unknown, fallback: T): T {
  if (typeof value !== 'string') return (value ?? fallback) as T;
  try { return JSON.parse(value) as T; } catch { return fallback; }
}

/** SQL placeholders for an IN list; callers must page long lists (bridge limit: 200 parameters). */
export const placeholders = (count: number) => Array.from({ length: count }, () => '?').join(',');

export interface ProfileVersionRow { id: string; profileId: string; version: number; name: string; publishedAt: string }

export async function readProfileVersions(): Promise<ProfileVersionRow[]> {
  const rows = await sql("SELECT v.id, v.profile_id AS profileId, v.version, p.name, v.published_at AS publishedAt FROM procurement_profile_versions v JOIN procurement_profiles p ON p.id=v.profile_id ORDER BY p.name, v.version DESC LIMIT 200");
  return rows.map(row => ({ ...row, version: Number(row.version) }));
}

export interface AssessmentRow {
  id: string; recordId: string; profileVersionId: string | null; policyVersion: string; asOf: string; freshness: string;
  relevance: string; eligibility: string; delivery: string; response: string; commercial: string; suggestedAction: string;
  gates: any[]; criticalUnknowns: string[]; reasons: string[]; createdAt: string;
}

/**
 * Current assessments for the given records under exactly one profile version (null = no profile).
 * Never falls back to another profile's assessment: a missing row means "Not assessed for this profile".
 */
export async function readCurrentAssessments(recordIds: string[], profileVersionId: string | null): Promise<Map<string, AssessmentRow>> {
  const result = new Map<string, AssessmentRow>();
  for (let i = 0; i < recordIds.length; i += 150) {
    const ids = recordIds.slice(i, i + 150);
    const rows = await sql(`SELECT id, record_id AS recordId, profile_version_id AS profileVersionId, policy_version AS policyVersion, as_of AS asOf, freshness, relevance, eligibility, delivery, response, commercial, suggested_action AS suggestedAction, gates, critical_unknowns AS criticalUnknowns, reasons, created_at AS createdAt FROM procurement_assessments WHERE is_current=1 AND ${profileVersionId ? 'profile_version_id=?' : 'profile_version_id IS NULL'} AND record_id IN (${placeholders(ids.length)})`, profileVersionId ? [profileVersionId, ...ids] : ids);
    for (const row of rows) result.set(row.recordId, { ...row, gates: json(row.gates, []), criticalUnknowns: json(row.criticalUnknowns, []), reasons: json(row.reasons, []) });
  }
  return result;
}

export interface DecisionRow { id: string; recordId: string; assessmentId: string | null; decision: string; note: string; actor: string; needsReconfirmation: boolean; staleReason: string | null; createdAt: string }

/** Latest human decision per record. Decisions are separate from AI suggestions and pursuit stages. */
export async function readLatestDecisions(recordIds: string[]): Promise<Map<string, DecisionRow>> {
  const result = new Map<string, DecisionRow>();
  for (let i = 0; i < recordIds.length; i += 150) {
    const ids = recordIds.slice(i, i + 150);
    const rows = await sql(`SELECT d.id, d.record_id AS recordId, d.assessment_id AS assessmentId, d.decision, d.note, d.actor, d.needs_reconfirmation AS needsReconfirmation, d.stale_reason AS staleReason, d.created_at AS createdAt FROM procurement_decisions d WHERE d.record_id IN (${placeholders(ids.length)}) AND d.created_at=(SELECT max(x.created_at) FROM procurement_decisions x WHERE x.record_id=d.record_id)`, ids);
    for (const row of rows) result.set(row.recordId, { ...row, needsReconfirmation: Number(row.needsReconfirmation) === 1 });
  }
  return result;
}

/** Plain-language labels for stored enums (INTERFACE-SPEC §3 copy rules). Unknown values are shown verbatim. */
export const LABELS: Record<string, string> = {
  strong: 'Strong', possible: 'Possible', weak: 'Weak', unknown: 'Unknown', not_assessed: 'Not assessed for this profile',
  supported_for_reviewed_requirements: 'Supported for reviewed requirements', unresolved: 'Unresolved', blocker: 'Blocker',
  feasible: 'Feasible', conditional: 'Conditional', not_feasible: 'Not feasible', sufficient: 'Sufficient', tight: 'Tight', insufficient: 'Insufficient',
  assessable: 'Assessable', information_needed: 'Information needed', outside_policy: 'Outside policy',
  investigate: 'Investigate', needs_information: 'Needs information', consider_partner: 'Consider a partner',
  ready_for_human_decision: 'Ready for your decision', decline: 'Decline', archive_or_monitor: 'Archive or monitor',
  pursue: 'Pursue', no_bid: 'No bid', monitor: 'Monitor', defer: 'Defer',
  current: 'Current', stale: 'Evidence changed; reconfirm', mandatory: 'Mandatory', preferred: 'Preferred', informational: 'Informational',
  supported: 'Supported', remediable_gap: 'Remediable gap', unmet: 'Unmet', not_applicable: 'Not applicable',
  exact: 'Exact quote', normalized_mapped: 'Quote matched after normalizing spacing', unverified: 'Quote not found in source',
  stated: 'Stated', explicitly_absent: 'Explicitly absent', not_found_in_reviewed_material: 'Not found in reviewed material', not_reviewed: 'Not reviewed', conflicting: 'Conflicting',
};
export const label = (value: unknown) => (value == null || value === '' ? 'Unknown' : LABELS[String(value)] ?? String(value));
