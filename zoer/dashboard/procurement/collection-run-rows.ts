import { BROWSER_COLLECT_ACTION, BROWSER_SITES, BROWSER_SOURCE_ID } from './browser-sites';
import { CONNECTOR_SOURCES, type ConnectorCollection, type Tone } from './source-overview';
import { COLLECT_ACTION, isLive, type RecentRun } from './source-schedules';
import { SOURCES } from './catalog';
import { count, plural, runStateText, when } from '../format';

/**
 * Collection runs in the shared run words (Running, Done, Partly failed, Failed, Stopped, Interrupted, Waiting for you,
 * Queued), one line each: what the run collected (source, portals done of total, opportunities saved) and when.
 * Zoer's run list keeps no per-run counts, so finished runs take them from the source's saved state, which describes
 * only the newest run of that source; older runs show what they were asked to collect, never a guessed result.
 */

export const COLLECT_ACTIONS = [COLLECT_ACTION, BROWSER_COLLECT_ACTION];
export const runSourceId = (run: RecentRun) => typeof run.input?.sourceId === 'string' ? run.input.sourceId as string : '';

export interface RunRow {
  id: string; title: string; word: string; tone: Tone; parts: string[]; when: string;
  /** Lines shown when the row is expanded, and the run's own error (plain words; raw text in a tooltip). */
  details: string[]; error: string | null;
  canPause: boolean; canResume: boolean; canCancel: boolean;
}
export interface RunFacts {
  /** The source's saved collection state; it describes this run only when the run is the one that wrote it last. */
  state?: ConnectorCollection | null;
}

const sourceName = (id: string) => SOURCES.find(source => source.id === id)?.label ?? id;
const portalCount = (sourceId: string) => sourceId === BROWSER_SOURCE_ID ? BROWSER_SITES.length : CONNECTOR_SOURCES.find(source => source.id === sourceId)?.portals.length;
const nounOf = (sourceId: string) => sourceId === BROWSER_SOURCE_ID ? 'site' : 'portal';
const minutes = (from: string, to: string | undefined) => {
  const ms = to ? Date.parse(to) - Date.parse(from) : NaN;
  if (!Number.isFinite(ms) || ms < 0) return '';
  const m = Math.round(ms / 60_000);
  return m < 1 ? 'under a minute' : m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} min`;
};

/** The run's state word, tone and a short explanation; resumable runs say why they wait. */
export function runWord(run: RecentRun, now = Date.now()): { word: string; tone: Tone; note: string | null; canPause: boolean; canResume: boolean; canCancel: boolean } {
  const off = { canPause: false, canResume: false, canCancel: false };
  if (!isLive(run)) {
    const word = runStateText(run.status);
    return { word, tone: word === 'Done' ? 'good' : word === 'Stopped' ? 'idle' : 'warn', note: run.status === 'outcome_unknown' ? 'Zoer lost track of this run; saved opportunities are kept.' : null, ...off };
  }
  const state = run.resumable?.state, live = { canPause: false, canResume: false, canCancel: true };
  if (run.status === 'waiting_for_user' && !state) return { word: 'Waiting for you', tone: 'warn', note: 'Waiting for your approval in Zoer.', ...live };
  if (run.status === 'pending' && !state) return { word: 'Queued', tone: 'idle', note: 'Starts when no other run of this plugin is active.', ...live };
  switch (state) {
    case 'paused': return { word: 'Interrupted', tone: 'idle', note: 'Paused. Resume continues from the last saved portal.', ...live, canResume: true };
    case 'paused-for-update': return { word: 'Interrupted', tone: 'idle', note: 'Paused for a Zoer update; continues by itself when the update is done.', ...live };
    case 'resume-needed': return { word: 'Interrupted', tone: 'warn', note: 'Zoer restarted during this step. Resume continues from the last saved portal.', ...live, canResume: true };
    case 'needs-user': return { word: 'Waiting for you', tone: 'warn', note: run.resumable?.lastError?.message ?? 'Review the run in Zoer, then resume it.', ...live, canResume: true };
    case 'waiting': {
      const next = run.resumable?.nextStepAt, why = run.resumable?.lastError?.message;
      return { word: 'Running', tone: 'busy', note: `Waiting to retry${next ? ` ${when(next, now)}` : ''}${why ? `: the site asked to slow down or did not answer (${why})` : ''}.`, ...live, canPause: true };
    }
    default: return { word: 'Running', tone: 'busy', note: run.resumable?.progress?.phase ?? null, ...live, canPause: !!run.resumable };
  }
}

/** One collection run as a single line plus its expanded details. */
export function collectionRunRow(run: RecentRun, facts: RunFacts = {}, now = Date.now()): RunRow {
  const sourceId = runSourceId(run), noun = nounOf(sourceId);
  const title = sourceId === 'all' ? 'All sources' : sourceId ? sourceName(sourceId) : 'Collection';
  const state = runWord(run, now), asked = Array.isArray(run.input?.portals) ? run.input.portals.length : Array.isArray(run.input?.sites) ? run.input.sites.length : portalCount(sourceId);
  const progress = run.resumable?.progress, parts: string[] = [];
  let word = state.word, tone = state.tone;
  // Portals done of total: live progress, or the saved state of the attempt this run wrote last.
  const own = facts.state && facts.state.ownerRunId === run.runId ? facts.state : null;
  const attempt = own?.attempt?.startedAt ? own : null;
  if (isLive(run) && progress?.done !== undefined && progress.total !== undefined) parts.push(progress.unit === 'rows' ? `${count(progress.done)} of ${plural(progress.total, 'row')}` : `${count(progress.done)} of ${plural(progress.total, noun)}`);
  else if (attempt && sourceId !== 'canadabuys') {
    const ids = attempt.attempt!.portals ?? Object.keys(attempt.portals), entries = ids.map(id => attempt.portals[id]).filter(entry => entry?.attemptStartedAt === attempt.attempt!.startedAt);
    const collected = entries.filter(entry => ['complete', 'incomplete'].includes(entry.status)), failed = entries.filter(entry => entry.status === 'failed').length;
    parts.push(`${count(collected.length)} of ${plural(ids.length, noun)}`);
    // Each collected portal records how many opportunities it saved (every listed one is written); unknown counts are not guessed.
    if (collected.every(entry => entry.recordCount !== undefined)) parts.push(`${plural(collected.reduce((sum, entry) => sum + entry.recordCount!, 0), 'opportunity', 'opportunities')} saved`);
    if (failed && word === 'Done') { word = 'Partly failed'; tone = 'warn'; }
  } else if (asked !== undefined && sourceId !== 'canadabuys' && sourceId !== 'all') parts.push(plural(asked, noun));
  const counted = !!attempt && sourceId !== 'canadabuys';
  const took = minutes(run.createdAt, run.finishedAt);
  const details = [
    `Started ${when(run.createdAt, now)}${run.finishedAt ? ` · finished ${when(run.finishedAt, now)}${took ? ` (${took})` : ''}` : ''}`,
    ...(state.note ? [state.note] : []),
    ...(!isLive(run) && !counted ? [sourceId === 'canadabuys' ? 'CanadaBuys runs record no per-run counts; its card shows the last file.' : 'Counts are kept for the newest run of each source only.'] : []),
  ];
  return { id: run.runId, title, word, tone, parts, when: when(run.createdAt, now), details, error: run.error ?? null, canPause: state.canPause, canResume: state.canResume, canCancel: state.canCancel };
}

/** What the empty list says: never "no collection has run" when sources report a collection. */
export function emptyRunsText(lastAt: string | null, now = Date.now()): string {
  return lastAt ? `No recent runs in Zoer’s run list; last collection ${when(lastAt, now)}.` : 'No collection run in Zoer’s run list yet.';
}
