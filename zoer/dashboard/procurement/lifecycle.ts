import { closesWithin, deadlineState, type DeadlineState } from './deadline';

export const OPPORTUNITY_LIFECYCLE_VERSION = 'opportunity-lifecycle-v2';
export type OpportunityLifecycleInput = { status?: unknown; closingAt?: unknown; closingDate?: unknown; deadline?: unknown };
export type OpportunityLifecycle = { state: DeadlineState; open: boolean; closingSoon: boolean; sourceStatus: 'open' | 'closed' | 'unknown'; reason: 'source_closed' | 'deadline_passed' | 'source_open' | 'unverified_status' };
/** An explicit closed source status wins; a passed deadline also closes a stale source "Open". */
export function opportunityLifecycle(row: OpportunityLifecycleInput, asOf: number | Date = Date.now(), days = 7): OpportunityLifecycle {
  const status = typeof row.status === 'string' ? row.status.trim().toLowerCase().replace(/[_-]+/g, ' ') : '';
  const closed = /\b(?:closed|cancelled|canceled|awarded|expired|withdrawn|terminated)\b/.test(status);
  const accepting = /^(?:open|active|published|accepting (?:bids|responses|submissions)|open for (?:bids|responses|submissions))$/.test(status);
  const sourceStatus = closed ? 'closed' : accepting ? 'open' : 'unknown';
  const deadline = row.closingAt || row.closingDate || row.deadline;
  const state = deadlineState(deadline, asOf);
  if (closed) return { state: 'closed', open: false, closingSoon: false, sourceStatus, reason: 'source_closed' };
  if (state === 'closed') return { state, open: false, closingSoon: false, sourceStatus, reason: 'deadline_passed' };
  if (!accepting) return { state: 'unknown', open: false, closingSoon: false, sourceStatus, reason: 'unverified_status' };
  return { state: state === 'unknown' ? 'open' : state, open: true, closingSoon: closesWithin(deadline, days, asOf), sourceStatus, reason: 'source_open' };
}
