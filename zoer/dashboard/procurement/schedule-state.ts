/**
 * Plain-language state for Zoer plugin schedules (host `schedules.read` rows). Zoer schedules are an interval in
 * whole hours (1–720), one row per action and saved preset, turn themselves off after any failed run or when the
 * plugin, the saved input or the preset changes, and wait while another run of this plugin is active.
 */

export interface ScheduleRow {
  actionId: string; enabled: boolean; intervalHours: number; nextRunAt?: string;
  /** Zoer 0.34+ (presets, S6): one schedule per `(actionId, presetId)`; absent on the action's own schedule. */
  presetId?: string;
  body?: { input?: Record<string, unknown> }; lastRunId?: string; lastStatus?: string; error?: string;
}

export const SCHEDULE_PRESETS = [[6, '6 hours'], [12, '12 hours'], [24, 'Daily'], [168, 'Weekly']] as const;
export const MIN_INTERVAL = 1, MAX_INTERVAL = 720;

export function intervalText(hours: number): string {
  if (!Number.isInteger(hours) || hours < MIN_INTERVAL) return 'Unknown interval';
  if (hours === 1) return 'Every hour';
  if (hours === 24) return 'Every day';
  if (hours === 168) return 'Every week';
  if (hours % 168 === 0) return `Every ${hours / 168} weeks`;
  if (hours % 24 === 0) return `Every ${hours / 24} days`;
  return `Every ${hours} hours`;
}

/** Whole hours 1–720 only, as the host requires; anything else is null (the form shows why). */
export function parseInterval(text: string): number | null {
  if (!/^\s*\d+\s*$/.test(text)) return null;
  const hours = Number(text);
  return hours >= MIN_INTERVAL && hours <= MAX_INTERVAL ? hours : null;
}

const RUN_STATUS: Record<string, string> = { succeeded: 'succeeded', failed: 'failed', cancelled: 'was cancelled', outcome_unknown: 'ended with an unknown outcome', pending: 'is running' };

/** Why Zoer turned a schedule off, in words a person can act on. The host's own message is kept alongside. */
export function stopReason(error: string): string {
  if (/preset changed or removed/i.test(error)) return 'Zoer turned this schedule off because the saved collection it runs was changed or removed. Turn it on again here to use the current one.';
  if (/plugin or settings changed/i.test(error)) return 'Zoer turned this schedule off because the plugin was updated or the scheduled settings changed. It pauses schedules on any change so a new version never runs unattended before you look. Check the settings and turn it on again.';
  if (/restored from backup/i.test(error)) return 'This schedule was restored from a backup and left off. Check it and turn it on again when you are ready.';
  if (/failed records/i.test(error)) return 'Zoer turned this schedule off because the last scheduled run finished with failed items. Check the failures, then turn it on again.';
  if (/unavailable or disabled/i.test(error)) return 'Zoer turned this schedule off because the plugin was disabled or unavailable when it was due. Turn it on again once the plugin is enabled.';
  if (/previous scheduled run is missing/i.test(error)) return 'Zoer turned this schedule off because it could not find the previous scheduled run. Check run history, then turn it on again.';
  return 'Zoer turned this schedule off because the last scheduled run did not succeed. It stops after any failure so a broken source is not retried unattended. Fix the cause, then turn it on again.';
}

export type ScheduleTone = 'good' | 'busy' | 'warn' | 'idle';
export interface ScheduleState { tone: ScheduleTone; status: string; next: string | null; last: string | null; stopped: string | null; error: string | null }

const at = (value: unknown) => typeof value === 'string' && Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : null;

/**
 * Summary for one schedule row. `undefined` = no schedule saved. A disabled row with an error was stopped by Zoer,
 * a disabled row without one was paused by a person; the two are never shown alike.
 */
export function scheduleState(row: ScheduleRow | undefined, now = Date.now()): ScheduleState {
  if (!row) return { tone: 'idle', status: 'Not scheduled', next: null, last: null, stopped: null, error: null };
  const last = row.lastStatus ? `Last scheduled run ${RUN_STATUS[row.lastStatus] ?? row.lastStatus}` : null;
  if (!row.enabled) {
    if (row.error) return { tone: 'warn', status: 'Stopped by Zoer', next: null, last, stopped: stopReason(row.error), error: row.error };
    return { tone: 'idle', status: `Paused · was ${intervalText(row.intervalHours).toLowerCase()}`, next: null, last, stopped: null, error: null };
  }
  const due = row.nextRunAt ? Date.parse(row.nextRunAt) : NaN;
  const next = !Number.isFinite(due) ? 'Next run not recorded' : row.lastStatus === 'pending' ? 'Running now' : due <= now ? 'Due now; starts when no other run of this plugin is active' : `Next run ${at(row.nextRunAt)}`;
  return { tone: row.lastStatus === 'pending' ? 'busy' : 'good', status: `On · ${intervalText(row.intervalHours).toLowerCase()}`, next, last, stopped: null, error: null };
}

/** The action's own schedule (not one bound to a preset), if any. */
export const findSchedule = (rows: ScheduleRow[] | undefined, actionId: string) => rows?.find(row => row.actionId === actionId && !row.presetId);
