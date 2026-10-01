/**
 * Display tone for verdict enums. Only explicitly supported states are green; anything unrecognized
 * is `neutral` (never green). `needs_information` is its own non-blocking tone, not a failure.
 */
import { SUGGESTED_ACTIONS, type SuggestedAction } from './contracts';

export { SUGGESTED_ACTIONS };
export type { SuggestedAction };

export const VERDICT_TONES = ['supported', 'needs_information', 'blocker', 'neutral', 'stale'] as const;
export type VerdictTone = (typeof VERDICT_TONES)[number];

const TONES: Record<string, VerdictTone> = {
  // supported
  supported_for_reviewed_requirements: 'supported', supported: 'supported', feasible: 'supported', sufficient: 'supported',
  assessable: 'supported', ready_for_human_decision: 'supported', accepted: 'supported', corrected: 'supported', current: 'supported',
  // needs information (unresolved, never green, never red)
  unresolved: 'needs_information', unknown: 'needs_information', needs_information: 'needs_information', information_needed: 'needs_information',
  conditional: 'needs_information', tight: 'needs_information', remediable_gap: 'needs_information', investigate: 'needs_information',
  consider_partner: 'needs_information', needs_clarification: 'needs_information', insufficient_information: 'needs_information',
  not_found_in_reviewed_material: 'needs_information', not_reviewed: 'needs_information', conflicting: 'needs_information',
  unverified: 'needs_information', ungrounded: 'needs_information', proposed: 'needs_information', partial: 'needs_information',
  closing_today_time_unverified: 'needs_information', needs_review: 'needs_information',
  // blockers
  blocker: 'blocker', unmet: 'blocker', not_feasible: 'blocker', insufficient: 'blocker', outside_policy: 'blocker',
  decline: 'blocker', rejected: 'blocker', unreadable: 'blocker', failed: 'blocker',
  // stale
  stale: 'stale', outdated: 'stale', superseded: 'stale',
};

/** Tone for any verdict value; unrecognized strings and non-strings are `neutral`. */
export function verdictTone(value: unknown): VerdictTone {
  if (typeof value !== 'string') return 'neutral';
  return Object.prototype.hasOwnProperty.call(TONES, value) ? TONES[value]! : 'neutral';
}

export const SUGGESTED_ACTION_LABELS: Record<SuggestedAction, string> = {
  investigate: 'Investigate',
  needs_information: 'Needs information',
  consider_partner: 'Consider a partner',
  ready_for_human_decision: 'Ready for a human decision',
  decline: 'Decline suggested',
  archive_or_monitor: 'Archive or monitor',
};
