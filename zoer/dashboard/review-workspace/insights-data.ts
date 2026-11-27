/**
 * Empty-state rules for Insights › Decisions (pure, tested): a panel whose numbers are all zero is replaced by one line
 * that says what has to happen first, never shown as a grid of zeros.
 */
export type RequirementCoverage = { total: number; extracted: number; states: Record<string, number> };
/** True when no notice in scope has a current extraction and no requirement is in any review state. */
export const coverageIsEmpty = (c: RequirementCoverage) => c.extracted === 0 && Object.values(c.states).every(value => !value);

/** Queues worth listing: known, non-zero counts only. `null` (needs a profile) is left to the page's profile prompt. */
export function visibleQueues<Q extends string>(queues: readonly (readonly [Q, number | null])[]): [Q, number][] {
  return queues.filter((entry): entry is readonly [Q, number] => typeof entry[1] === 'number' && entry[1] > 0).map(([queue, count]) => [queue, count]);
}

/** Stale decisions are shown only when there is at least one decision to reconfirm or stale assessment. */
export const staleIsEmpty = (s: { decisions: readonly unknown[]; staleAssessments: number }) => s.decisions.length === 0 && s.staleAssessments === 0;

export const NO_EXTRACTION_TEXT = 'No requirements have been extracted yet. Select opportunities and choose Extract requirements.';
