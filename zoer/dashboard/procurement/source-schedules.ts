import { BROWSER_COLLECT_ACTION, BROWSER_SOURCE_ID } from './browser-sites';
import type { ScheduleRow } from './schedule-state';

/**
 * Schedules per source on Zoer's presets (host service S6): every source gets one saved preset of
 * `procurement.collect` (`externalRef: "source:<id>"`) and its own schedule bound to that preset, so CanadaBuys,
 * bids&tenders and the municipal sites run on their own intervals. "Retry problem portals" is a preset too
 * (`externalRef: "retry:<id>"`, input `{ sourceId, portals }`), updated and run when the person asks.
 *
 * The 0.33 schedule (one row per action with input `{ sourceId: "all" }`) still works if someone turns it on in Zoer's
 * settings, but the Sources page offers to replace it with per-source schedules at the same interval.
 */
export const COLLECT_ACTION = 'procurement.collect';
export type Host = (method: string, input?: unknown) => Promise<any>;
export interface Preset { id: string; actionId: string; name: string; input: any; externalRef?: string; updatedAt?: string }
/** One run of this plugin as `runs.recent` reports it (S6); `resumable` is present for resumable actions (S1). */
export interface RecentRun {
  runId: string; actionId: string; presetId?: string; status: string; createdAt: string; finishedAt?: string; input: any; error?: string;
  resumable?: { state?: string; slices?: number; progress?: { phase?: string; done?: number; total?: number; unit?: string } | null; nextStepAt?: string | null; lastError?: { code: string; message: string } | null };
}

/** Sources scheduled from the Sources page (the browser sites keep their schedule in Zoer's settings: it needs a browser). */
export const SCHEDULED_SOURCES = ['canadabuys', 'bidsandtenders', 'municipal-sites'] as const;
export const sourceRef = (sourceId: string) => `source:${sourceId}`;
export const retryRef = (sourceId: string) => `retry:${sourceId}`;
/**
 * What a source's schedule runs. CanadaBuys without `maxBatches` imports the whole daily file across resumable steps
 * (continuing the same file, starting over on a new one); connectors collect every portal.
 */
export const sourceInput = (sourceId: string) => ({ sourceId });
const sameInput = (a: any, b: any) => JSON.stringify(a) === JSON.stringify(b);

/** The schedule row bound to a preset, the legacy one-per-action row, and the presets by id. */
export function findPresetSchedule(rows: ScheduleRow[] | undefined, presetId: string | undefined) {
  return presetId ? rows?.find(row => row.presetId === presetId) : undefined;
}
export const sourcePreset = (presets: Preset[] | undefined, sourceId: string, actionId = COLLECT_ACTION) =>
  presets?.find(preset => preset.actionId === actionId && preset.externalRef === sourceRef(sourceId));
/** The 0.33 `{ sourceId: 'all' }` schedule (no preset), if one is saved. */
export const legacyAllSchedule = (rows: ScheduleRow[] | undefined) =>
  rows?.find(row => row.actionId === COLLECT_ACTION && !row.presetId && row.body?.input?.sourceId === 'all');
/** Schedules Zoer turned off because the plugin was updated (it disables every schedule on an upgrade). */
export const stoppedByUpdate = (rows: ScheduleRow[] | undefined) =>
  (rows ?? []).filter(row => !row.enabled && /plugin or settings changed/i.test(row.error ?? ''));

export function sourceSchedule(rows: ScheduleRow[] | undefined, presets: Preset[] | undefined, sourceId: string) {
  const actionId = sourceId === BROWSER_SOURCE_ID ? BROWSER_COLLECT_ACTION : COLLECT_ACTION;
  // The browser sites are scheduled in Zoer's settings (no preset); everything else through its source preset.
  if (sourceId === BROWSER_SOURCE_ID) return rows?.find(row => row.actionId === actionId && !row.presetId);
  return findPresetSchedule(rows, sourcePreset(presets, sourceId)?.id);
}

/** The source's preset, created on first use (names are what Zoer's own settings and run history show). */
export async function ensureSourcePreset(host: Host, sourceId: string, label: string): Promise<Preset> {
  const { presets } = await host('presets.list', { actionId: COLLECT_ACTION });
  const found = (presets as Preset[]).find(preset => preset.externalRef === sourceRef(sourceId));
  if (found && sameInput(found.input, sourceInput(sourceId))) return found;
  if (found) return (await host('presets.save', { id: found.id, input: sourceInput(sourceId) })).preset;
  return (await host('presets.save', { actionId: COLLECT_ACTION, name: `Collect ${label}`, input: sourceInput(sourceId), externalRef: sourceRef(sourceId) })).preset;
}

/** Turn a source's schedule on (creating its preset) or pause it. */
export async function saveSourceSchedule(host: Host, sourceId: string, label: string, enabled: boolean, intervalHours: number) {
  const preset = await ensureSourcePreset(host, sourceId, label);
  return host('schedules.save', { actionId: COLLECT_ACTION, presetId: preset.id, enabled, intervalHours });
}

/**
 * Replace the 0.33 "all sources" schedule with one schedule per source at the same interval, then turn the old one
 * off so nothing collects twice. Only on the person's request: an upgrade never turns schedules back on by itself.
 */
export async function migrateAllSchedule(host: Host, legacy: ScheduleRow, labels: Record<string, string>) {
  for (const sourceId of SCHEDULED_SOURCES) await saveSourceSchedule(host, sourceId, labels[sourceId] ?? sourceId, true, legacy.intervalHours);
  if (legacy.enabled) await host('schedules.save', { actionId: COLLECT_ACTION, input: legacy.body?.input ?? { sourceId: 'all' }, enabled: false, intervalHours: legacy.intervalHours });
}

/** Actions the dashboard can schedule itself; browser actions are scheduled in Zoer's settings with their browser. */
export const DASHBOARD_SCHEDULED_ACTIONS = [COLLECT_ACTION, 'procurement.alerts'];
/** Stopped-by-update schedules the page can turn back on (not the legacy `all` row, not browser actions). */
export const reenableable = (rows: ScheduleRow[] | undefined) => stoppedByUpdate(rows).filter(row => row !== legacyAllSchedule(rows) && DASHBOARD_SCHEDULED_ACTIONS.includes(row.actionId));
/**
 * Turn back on, with their own intervals, the schedules Zoer stopped because the plugin was updated. The legacy `all`
 * row is not among them (the page offers per-source schedules instead); rows without a preset keep their own input.
 */
export async function reenableStopped(host: Host, rows: ScheduleRow[]) {
  let count = 0;
  for (const row of reenableable(rows)) {
    await host('schedules.save', { actionId: row.actionId, ...(row.presetId ? { presetId: row.presetId } : { input: row.body?.input ?? {} }), enabled: true, intervalHours: row.intervalHours });
    count++;
  }
  return count;
}

/** "Retry problem portals": save (or update) the source's retry preset with these portals and run it. */
export async function runRetryPreset(host: Host, sourceId: string, label: string, portals: string[]) {
  const input = { sourceId, portals };
  const { presets } = await host('presets.list', { actionId: COLLECT_ACTION });
  const found = (presets as Preset[]).find(preset => preset.externalRef === retryRef(sourceId));
  const preset: Preset = found
    ? sameInput(found.input, input) ? found : (await host('presets.save', { id: found.id, input })).preset
    : (await host('presets.save', { actionId: COLLECT_ACTION, name: `Retry problem portals · ${label}`, input, externalRef: retryRef(sourceId) })).preset;
  return host('action', { actionId: COLLECT_ACTION, presetId: preset.id });
}

const TERMINAL = new Set(['succeeded', 'failed', 'cancelled', 'outcome_unknown']);
export const isLive = (run: RecentRun) => !TERMINAL.has(run.status);
/** The live collection run that covers a source (`all` covers every plain-HTTP source), newest first. */
export function liveRunFor(runs: RecentRun[] | undefined, sourceId: string) {
  return runs?.find(run => isLive(run) && (run.input?.sourceId === sourceId || (run.input?.sourceId === 'all' && sourceId !== BROWSER_SOURCE_ID)));
}

export type RunTone = 'good' | 'busy' | 'warn' | 'idle';
/** A run in plain words: what it is doing now, and whether it can be paused or resumed from here. */
export function runState(run: RecentRun | undefined): { text: string; tone: RunTone; detail: string | null; canPause: boolean; canResume: boolean; canCancel: boolean } | null {
  if (!run) return null;
  const progress = run.resumable?.progress, state = run.resumable?.state;
  const count = progress?.done !== undefined && progress.total !== undefined ? ` · ${progress.done.toLocaleString()} of ${progress.total.toLocaleString()}` : '';
  const at = (iso: string | null | undefined) => iso && Number.isFinite(Date.parse(iso)) ? new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }) : null;
  const live = isLive(run);
  if (!live) {
    const text = run.status === 'succeeded' ? 'Finished' : run.status === 'cancelled' ? 'Cancelled' : run.status === 'failed' ? 'Failed' : 'Outcome unknown';
    return { text, tone: run.status === 'succeeded' ? 'good' : run.status === 'cancelled' ? 'idle' : 'warn', detail: run.error ?? null, canPause: false, canResume: false, canCancel: false };
  }
  if (run.status === 'waiting_for_user' && !state) return { text: 'Waiting for approval', tone: 'warn', detail: null, canPause: false, canResume: false, canCancel: true };
  switch (state) {
    case 'paused': return { text: 'Paused', tone: 'idle', detail: progress?.phase ? `Stopped after ${progress.phase}${count}` : null, canPause: false, canResume: true, canCancel: true };
    case 'paused-for-update': return { text: 'Paused for a Zoer update', tone: 'idle', detail: 'Continues by itself when the update is done.', canPause: false, canResume: false, canCancel: true };
    case 'resume-needed': return { text: 'Resume needed', tone: 'warn', detail: 'Zoer restarted during this step. Resume to continue from the last saved point.', canPause: false, canResume: true, canCancel: true };
    case 'needs-user': return { text: 'Needs you', tone: 'warn', detail: run.resumable?.lastError?.message ?? 'Review the run in Zoer, then resume it.', canPause: false, canResume: true, canCancel: true };
    case 'waiting': {
      const next = at(run.resumable?.nextStepAt), why = run.resumable?.lastError?.message;
      return { text: next ? `Waiting to retry at ${next}` : 'Waiting to retry', tone: 'busy', detail: why ? `The site asked to slow down or did not answer: ${why}` : null, canPause: true, canResume: false, canCancel: true };
    }
    default: return { text: `Collecting${progress?.phase ? ` · ${progress.phase}` : ''}${count}`, tone: 'busy', detail: null, canPause: !!run.resumable, canResume: false, canCancel: true };
  }
}
