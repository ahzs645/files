import { COLLECTION_KEY, connectorCollectionKey } from './source-adapters';
import { connectorStatus, readConnectorCollection, type ConnectorCollection, type Tone } from './source-overview';
import { bcCheckpointHealth, bcSourceHealth, type BcBidCollectionRun } from './source-health';
import { bcLastCollection, LAST_COLLECTION_KEYS } from './status-data';
import { findSchedule, type ScheduleRow } from './schedule-state';
import { liveRunFor, sourceSchedule, type Preset, type RecentRun } from './source-schedules';
import { lastCollectedSlot, lastCollectedText, scheduleSlot, type ScheduleSlot } from './source-cards';
import { browserSiteRows } from './browser-source-overview';
import { BROWSER_SOURCE_ID } from './browser-sites';
import { count, plural } from '../format';

/**
 * One answer per source for "status", "last collected" and "next run", shared by Operations › Sources (the cards) and
 * Operations › Overview ("Sources at a glance"), so the two pages never disagree. Pure: callers pass what they read.
 */

/** BC Bid's saved checkpoints (Sources lists them under Options; an error in any one makes BC Bid "Needs attention"). */
export const BC_CHECKPOINTS = [['checkpoint:full', 'Current opportunities'], ['checkpoint:awards', 'Award history'], ['checkpoint:awards:recent', 'Recent awards']] as const;
/** catalog.workspace keys every summary needs (last collections plus every BC Bid checkpoint). */
export const SOURCE_SUMMARY_KEYS = [...new Set<string>([...LAST_COLLECTION_KEYS, ...BC_CHECKPOINTS.map(([key]) => key)])];

export interface SourceSummaryInput {
  /** catalog.workspace values for SOURCE_SUMMARY_KEYS; undefined while unread. */
  entries: { key: string; value: unknown }[] | undefined;
  /** The workspace read failed (unknown, never "never collected"). */
  entriesError?: boolean;
  /** Recent plugin runs, collection runs by action, and the older workspace's capture runs. */
  runs?: RecentRun[]; collectionRuns?: RecentRun[]; captureRuns?: readonly BcBidCollectionRun[];
  schedules?: ScheduleRow[]; schedulesError?: boolean; presets?: Preset[]; presetsError?: boolean;
  now?: number;
}
export interface SourceSummary {
  status: { tone: Tone; text: string };
  last: { text: string; note: string | null };
  schedule: ScheduleSlot | string;
  /** Connector state (portal sources), for the card's portal table; undefined when unread or unreadable. */
  state?: ConnectorCollection | null;
  stateError?: string;
}

const value = (input: SourceSummaryInput, key: string) => input.entries?.find(item => item.key === key)?.value;

/** BC Bid's checkpoints as Sources shows them. */
export function bcCheckpoints(input: Pick<SourceSummaryInput, 'entries'>) {
  return BC_CHECKPOINTS.map(([key, label]) => ({ key, label, ...bcCheckpointHealth(key, input.entries?.find(item => item.key === key)?.value) }));
}

/** CanadaBuys stopped part-way through the day's file is not "Collected" yet. */
export function canadaBuysPartWay(collection: any): string | undefined {
  if (collection?.status !== 'paused') return undefined;
  const cursor = collection?.receipt;
  return Number.isInteger(cursor?.offset) && Number.isInteger(cursor?.totalRecords) ? `Part-way · ${count(cursor.offset)} of ${plural(cursor.totalRecords, 'row')}` : 'Part-way · continues next run';
}

export function sourceSummary(id: string, input: SourceSummaryInput): SourceSummary {
  const now = input.now ?? Date.now(), read = !!input.entries;
  const sourceRuns = input.collectionRuns || input.runs ? [...new Map([...(input.collectionRuns ?? []), ...(input.runs ?? [])].map(run => [run.runId, run])).values()] : undefined;
  const run = liveRunFor(sourceRuns, id);
  const unread = (text: string) => input.entriesError ? 'Unknown' : read ? text : 'Loading…';
  const slot = (row: ScheduleRow | undefined, presets = true): ScheduleSlot | string => input.schedulesError || (presets && input.presetsError) ? 'Unknown'
    : !input.schedules || (presets && !input.presets) ? 'Loading…' : scheduleSlot(row, now);
  if (id === 'bc-bid') {
    const checkpoints = bcCheckpoints(input), issue = checkpoints.some(item => item.error);
    // Keep action scope and raw statuses when falling back to older Zoer's workspace history.
    const health = bcSourceHealth(input.runs ?? input.captureRuns, read ? checkpoints[0] : undefined, issue);
    const last = bcLastCollection(input.runs, input.captureRuns, read ? value(input, 'checkpoint:full') : undefined);
    return { status: { tone: health.tone, text: health.status }, last: { text: lastCollectedText(last?.at, !!(input.runs || input.captureRuns), now), note: last?.scope ?? null },
      schedule: slot(findSchedule(input.schedules, 'scrape.full'), false) };
  }
  if (id === 'canadabuys') {
    const collection = value(input, COLLECTION_KEY) as any, live = run ? connectorStatus(null, now, run) : null, partWay = canadaBuysPartWay(collection);
    const status: { tone: Tone; text: string } = live ?? (!read ? { tone: 'idle', text: unread('Status unknown') }
      : { tone: collection?.error ? 'warn' : partWay ? 'idle' : collection?.lastSuccessAt ? 'good' : 'idle', text: collection?.error ? 'Needs attention' : partWay ?? (collection?.lastSuccessAt ? 'Collected' : 'Not collected') });
    return { status, last: { text: read ? lastCollectedText(collection?.lastSuccessAt, true, now) : unread(''), note: null }, schedule: slot(sourceSchedule(input.schedules, input.presets, id)) };
  }
  let state: ConnectorCollection | null | undefined, stateError: string | undefined;
  if (read) { try { state = readConnectorCollection(value(input, connectorCollectionKey(id)), id); } catch (e) { stateError = (e as Error).message; } }
  const browser = id === BROWSER_SOURCE_ID;
  let status = !read ? { tone: 'idle' as Tone, text: unread('Status unknown') } : stateError ? { tone: 'warn' as Tone, text: 'Saved state not readable' } : connectorStatus(state, now, run);
  // A site waiting for a browser check waits for the person, whatever the last run's overall result says.
  if (browser && read && !stateError && !run && browserSiteRows(state).some(row => row.status === 'waiting')) status = { tone: 'warn', text: 'Waiting for you' };
  return { status, last: !read ? { text: unread(''), note: null } : stateError ? { text: 'Unknown', note: null } : lastCollectedSlot(state, browser ? 'site' : 'portal', now),
    schedule: browser ? slot(sourceSchedule(input.schedules, input.presets, id), false) : slot(sourceSchedule(input.schedules, input.presets, id)), state, stateError };
}
