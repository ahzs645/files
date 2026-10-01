import { label, type AssessmentRow } from './queries';
import './review.css';

type Tone = 'supported' | 'needs_information' | 'blocker' | 'stale' | 'neutral';
const TONES: Record<string, Tone> = {
  strong: 'supported', supported_for_reviewed_requirements: 'supported', feasible: 'supported', sufficient: 'supported', assessable: 'supported', ready_for_human_decision: 'supported',
  possible: 'needs_information', unresolved: 'needs_information', conditional: 'needs_information', tight: 'needs_information', information_needed: 'needs_information', needs_information: 'needs_information', investigate: 'needs_information', consider_partner: 'needs_information',
  blocker: 'blocker', not_feasible: 'blocker', insufficient: 'blocker', outside_policy: 'blocker', decline: 'blocker',
};
/** Unrecognized and unknown values stay neutral: never green by default. */
export const toneOf = (value: unknown): Tone => TONES[String(value)] ?? 'neutral';

const DIMENSIONS: [keyof AssessmentRow, string][] = [['relevance', 'Work fit'], ['eligibility', 'Eligibility'], ['delivery', 'Delivery'], ['response', 'Response time'], ['commercial', 'Commercial']];

export function DimensionChips({ assessment, compact }: { assessment: AssessmentRow | null; compact?: boolean }) {
  if (!assessment) return <span className="rw-chips" data-compact={compact || undefined}><span className="rw-chip" data-tone="neutral"><b>Not assessed for this profile</b></span></span>;
  return <span className="rw-chips" data-compact={compact || undefined}>
    {assessment.freshness === 'stale' && <span className="rw-chip" data-tone="stale"><b>Evidence changed; reconfirm</b></span>}
    {DIMENSIONS.map(([key, name]) => <span key={key} className="rw-chip" data-tone={toneOf(assessment[key])}>{name}: <b>{label(assessment[key])}</b></span>)}
  </span>;
}
