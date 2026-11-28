import { BROWSER_CHECK } from './model';
import { formatWhen } from '../../apps/dashboard/src/lib/formatting';

type Tone = 'success' | 'running' | 'warning' | 'error' | 'info' | 'neutral';

/**
 * What the BC Bid page's collection card says and offers, from the real state: an active run, a browser check that
 * waits for a person, saved progress worth resuming, or nothing to resume. One state, one primary action.
 */

/** The parts of `checkpoint:full` the card reads. */
export interface FullCheckpoint {
  phase?: string; currentPage?: number; totalPages?: number | null; listingCount?: number; detailsCompleted?: number;
  pending?: unknown[]; complete?: boolean; error?: string | null; capturedAt?: string; runId?: string;
}
/** The fields of a display-model run (`model.ts` `buildModel().runs`) the card reads. */
export interface CardRun {
  _id: string; actionId: string; status: string; paused?: boolean; startedAt: number; completedAt: number | null;
  counts: { listingCount: number; detailCount: number }; errorCode?: string | null; waitingForUser?: boolean; progress: { message: string };
}
export interface SavedProgress { listingCount: number; detailsCompleted: number; remaining: number; currentPage: number; totalPages: number | null; listing: boolean }

export type CollectionState =
  | { kind: 'running' | 'stopping' | 'paused'; run: CardRun }
  | { kind: 'waiting'; since: number | null; resume: SavedProgress | null }
  | { kind: 'resumable'; resume: SavedProgress; interrupted: boolean }
  | { kind: 'ready'; lastFull: CardRun | null };

const n = (value: unknown) => Number.isFinite(Number(value)) ? Number(value) : 0;
/**
 * Saved progress worth resuming. A full scrape that stopped before saving a listing page (page 0, no listings) has
 * nothing to resume: "Resume" would be a fresh start, so it is not offered.
 */
export function savedProgress(checkpoint: FullCheckpoint | null | undefined): SavedProgress | null {
  if (!checkpoint || checkpoint.complete) return null;
  const listingCount = n(checkpoint.listingCount), detailsCompleted = n(checkpoint.detailsCompleted), currentPage = n(checkpoint.currentPage);
  if (listingCount <= 0 && currentPage <= 0 && detailsCompleted <= 0) return null;
  const remaining = Array.isArray(checkpoint.pending) ? checkpoint.pending.length : 0;
  return { listingCount, detailsCompleted, remaining, currentPage, totalPages: checkpoint.totalPages ? n(checkpoint.totalPages) : null, listing: checkpoint.phase === 'listing' };
}

const plural = (value: number, one: string, many: string) => `${value.toLocaleString()} ${value === 1 ? one : many}`;
/** "792 opportunities saved from 53 of 53 listing pages" or "6 of 792 opportunities have details · 786 remaining". */
export function progressText(progress: SavedProgress) {
  if (progress.listing || (!progress.remaining && !progress.detailsCompleted))
    return `${plural(progress.listingCount, 'opportunity', 'opportunities')} saved from ${progress.currentPage.toLocaleString()}${progress.totalPages ? ` of ${progress.totalPages.toLocaleString()}` : ''} listing ${progress.totalPages === 1 || (!progress.totalPages && progress.currentPage === 1) ? 'page' : 'pages'}`;
  return `${progress.detailsCompleted.toLocaleString()} of ${plural(progress.listingCount, 'opportunity has', 'opportunities have')} details · ${progress.remaining.toLocaleString()} remaining`;
}

/** A later run that actually read BC Bid shows the browser got past the check. */
const collectedAfter = (runs: CardRun[], at: number) => runs.some(run => run.status === 'succeeded' && run.startedAt > at && (run.counts.listingCount > 0 || run.counts.detailCount > 0));

/**
 * @param runs display-model runs, newest first.
 * @param checkpoint the saved full checkpoint (`checkpoint:full`) while it is incomplete, else null.
 * @param sharedCheckSince Operations › Overview's pending browser check (`DocumentGap.checkPendingSince`), passed only when
 *   collection and downloads use the same Zoer browser, so the same check blocks both.
 */
export function collectionState(runs: CardRun[], checkpoint: FullCheckpoint | null | undefined, sharedCheckSince?: string | null): CollectionState {
  const active = runs.find(run => run.status === 'running' || run.status === 'stopping');
  if (active) return { kind: active.paused ? 'paused' : active.status === 'stopping' ? 'stopping' : 'running', run: active };
  const resume = savedProgress(checkpoint);
  const checks: number[] = [];
  for (const run of runs) if (run.waitingForUser) { const at = run.completedAt ?? run.startedAt; if (!collectedAfter(runs, run.startedAt)) checks.push(at); }
  const saved = checkpoint && !checkpoint.complete && BROWSER_CHECK.test(checkpoint.error ?? '') ? Date.parse(checkpoint.capturedAt ?? '') : NaN;
  if (Number.isFinite(saved) && !collectedAfter(runs, saved)) checks.push(saved);
  const shared = Date.parse(sharedCheckSince ?? '');
  if (Number.isFinite(shared) && !collectedAfter(runs, shared)) checks.push(shared);
  if (checks.length || (checkpoint && !checkpoint.complete && BROWSER_CHECK.test(checkpoint.error ?? '') && !Number.isFinite(saved)))
    return { kind: 'waiting', since: checks.length ? Math.max(...checks) : null, resume };
  const lastFull = runs.find(run => run.actionId === 'scrape.full') ?? null;
  if (resume) return { kind: 'resumable', resume, interrupted: lastFull?.errorCode === 'scrape_interrupted' };
  return { kind: 'ready', lastFull };
}

const RUN_WORD: Record<string, [string, Tone]> = { succeeded: ['Done', 'success'], failed: ['Failed', 'error'], cancelled: ['Stopped', 'neutral'] };
/** Badge, sentence and primary action for each collection state (exported for tests). */
export function collectionCopy(state: CollectionState): { badge: [string, Tone] | null; text: string; detail?: string; primary: 'open-browser' | 'resume' | 'start' | null; secondary: 'resume' | 'start' | 'stop' | null } {
  switch (state.kind) {
    case 'running': return { badge: ['Running', 'running'], text: state.run.progress.message, primary: null, secondary: 'stop' };
    case 'stopping': return { badge: ['Running', 'running'], text: 'Stopping after the current page. Saved opportunities are kept.', primary: null, secondary: null };
    case 'paused': return { badge: ['Paused for update', 'info'], text: state.run.progress.message, primary: null, secondary: null };
    case 'waiting': return { badge: ['Waiting for you', 'warning'],
      text: `BC Bid asked for a browser check${state.since ? ` (${formatWhen(state.since)})` : ''}. Open the Zoer browser, complete the check, then hand control back.`,
      detail: state.resume ? `Saved so far: ${progressText(state.resume)}. Resume afterwards to continue from there.` : 'Then start a full collection. No full collection has progress to resume.',
      primary: 'open-browser', secondary: state.resume ? 'resume' : 'start' };
    case 'resumable': return { badge: state.interrupted ? ['Interrupted', 'warning'] : ['Part-way', 'info'], text: `Saved so far: ${progressText(state.resume)}.`, primary: 'resume', secondary: null };
    case 'ready': {
      const last = state.lastFull;
      return { badge: last ? RUN_WORD[last.status] ?? null : null, primary: 'start', secondary: null,
        text: last ? `Last full collection ${last.status === 'succeeded' ? 'finished' : last.status === 'cancelled' ? 'was stopped' : 'failed'} ${formatWhen(last.completedAt ?? last.startedAt)}.` : 'No full collection in the recent runs.',
        detail: last?.status === 'failed' ? last.progress.message : undefined };
    }
  }
}

