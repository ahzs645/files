import type { Checkpoint } from './full-scrape';
/** Approval previews stay reviewable: BC Bid numeric IDs replace repeated public URLs. */
export function compactCheckpoint(state: Checkpoint) {
  const pending = new Set(state.pending.map(row => row.sourceKey));
  if (!state.knownKeys.every(id => /^\d{1,10}$/.test(id)) || !state.pending.every(row => row.sourceKey === row.processId)) throw new Error('Checkpoint contains an unsupported opportunity identity.');
  return { version: 2, phase: state.phase, currentPage: state.currentPage, totalPages: state.totalPages, startedAt: state.startedAt,
    completedIds: state.knownKeys.filter(id => !pending.has(id)), pendingIds: state.pending.map(row => row.processId) };
}
export function expandCheckpoint(value: any): unknown {
  if (value?.version !== 2) return value;
  const { completedIds, pendingIds } = value;
  if (!Array.isArray(completedIds) || !Array.isArray(pendingIds) || completedIds.length + pendingIds.length > 3000 ||
    ![...completedIds, ...pendingIds].every(id => typeof id === 'string' && /^\d{1,10}$/.test(id))) throw new Error('Invalid compact scrape checkpoint.');
  return { version: 1, kind: 'scrape', scope: 'all-current-public-opportunities', limited: false, capturedAt: new Date().toISOString(),
    phase: value.phase, currentPage: value.currentPage, totalPages: value.totalPages, startedAt: value.startedAt, complete: false,
    knownKeys: [...completedIds, ...pendingIds], listingCount: completedIds.length + pendingIds.length, detailsCompleted: completedIds.length,
    pending: pendingIds.map(processId => ({ sourceKey: processId, processId, detailUrl: `https://bcbid.gov.bc.ca/page.aspx/en/bpm/process_manage_extranet/${processId}` })), failures: [] };
}
