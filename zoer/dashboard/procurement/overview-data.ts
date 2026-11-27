import { scheduleKind, scheduleState, stopDiffers, stopMessage, stopReason, actionLabel, type ScheduleRow } from './schedule-state';
import type { SetupStep, StepAction, StepTone } from './status-checklist';
import { count as n, isActiveRun, plural, runStateText, scheduleStateText, when } from '../format';

/**
 * Operations › Overview as pure data (tests run these on the live shape): what needs the person, what runs now, the
 * schedules in three groups, and the last outcome per run type. Components only render what these return.
 */

// ---------------------------------------------------------------------------------------------
// Schedules: "Needs review" grouped by Zoer's reason, then "Off", then "On".
// ---------------------------------------------------------------------------------------------

/** Schedules Zoer turned off for one shared reason (nine at once after a plugin update), with Zoer's own message once. */
export interface StopGroup { reason: string; message: string | null; rows: ScheduleRow[] }
export function stopGroups(rows: readonly ScheduleRow[] | undefined, now = Date.now()): StopGroup[] {
  const groups = new Map<string, StopGroup>();
  for (const row of rows ?? []) {
    if (scheduleKind(row, now) !== 'stopped') continue;
    const error = row.error ?? '', reason = stopReason(error);
    const group = groups.get(reason) ?? { reason, message: stopDiffers(error) ? stopMessage(error) : null, rows: [] };
    group.rows.push(row); groups.set(reason, group);
  }
  return [...groups.values()].sort((a, b) => b.rows.length - a.rows.length);
}
export interface ScheduleSections { review: ScheduleRow[]; off: ScheduleRow[]; on: ScheduleRow[]; total: number; summary: string }
/** One list in the shared vocabulary (format.ts `scheduleStateText`): Needs review, Off, On. */
export function scheduleSections(rows: readonly ScheduleRow[] | undefined, now = Date.now()): ScheduleSections {
  const list = rows ?? [], of = (text: string) => list.filter(row => scheduleStateText(scheduleKind(row, now)) === text);
  const on = of('On');
  return { review: of('Needs review'), off: of('Off'), on, total: list.length, summary: `${n(on.length)} of ${plural(list.length, 'schedule')} on` };
}
/** One schedule line: "On · every hour · Next run Today 3:19 PM", "Off · was every day", "Needs review · Last scheduled run succeeded". */
export function scheduleLine(row: ScheduleRow, now = Date.now()) {
  const state = scheduleState(row, now), kind = scheduleStateText(scheduleKind(row, now));
  return { kind, tone: state.tone, status: state.status, detail: [kind === 'On' ? state.next : null, state.last].filter(Boolean).join(' · ') };
}

// ---------------------------------------------------------------------------------------------
// Needs you
// ---------------------------------------------------------------------------------------------

/** Where each row's owner lives, and what its link says. */
const OWNERS: Record<string, { to: string; label: string } | null> = {
  browsers: { to: '/documents', label: 'Operations › Documents' }, schedules: null,
  documents: { to: '/documents', label: 'Operations › Documents' }, details: { to: '/documents', label: 'Operations › Documents' },
  extraction: { to: '/documents', label: 'Operations › Documents' }, failures: { to: '/files?fileStatus=failed', label: 'Opportunities › Files' },
};
export interface Need { id: string; title: string; status: string; tone: StepTone; lines: string[]; actions: StepAction[]; owner: { to: string; label: string } | null }
const BROWSER_STEPS = ['collection-browser', 'download-browser', 'browser-check'];
/**
 * The checklist split into what needs the person (`needs`, one row each with its reason, action and owning page),
 * what is fine (`clear`, collapsed to "All clear (n)") and what is still loading or not reported (`unknown`). The
 * three browser steps become one row: a pending browser check names the browser and is the row's title.
 */
export function needsYou(steps: readonly SetupStep[]) {
  const browsers = steps.filter(step => BROWSER_STEPS.includes(step.id)), warnBrowsers = browsers.filter(step => step.tone === 'warn');
  const check = browsers.find(step => step.id === 'browser-check');
  const needs: Need[] = [], clear: SetupStep[] = [], unknown: SetupStep[] = [];
  if (warnBrowsers.length) needs.push({ id: 'browsers', title: check ? 'Browser check' : 'Browsers', status: check?.status ?? warnBrowsers.map(step => step.status).join(' · '), tone: 'warn',
    lines: (check ? [check, ...warnBrowsers.filter(step => step !== check)] : warnBrowsers).map(step => step.detail).filter(Boolean),
    actions: [...new Set(warnBrowsers.flatMap(step => step.actions))].sort((a, b) => (a === 'open-browser' ? -1 : 0) - (b === 'open-browser' ? -1 : 0)), owner: check ? OWNERS.browsers : null });
  for (const step of steps) {
    if (BROWSER_STEPS.includes(step.id) && step.tone === 'warn') continue;
    if (step.tone === 'warn') needs.push({ id: step.id, title: step.title, status: step.status, tone: step.tone, lines: step.detail ? [step.detail] : [], actions: step.actions, owner: OWNERS[step.id] ?? null });
    else if (step.tone === 'good' || step.tone === 'busy') clear.push(step);
    else unknown.push(step);
  }
  const verdict = needs.length ? `${plural(needs.length, 'thing needs', 'things need')} you` : unknown.length ? 'Nothing needs you so far; some checks not reported' : 'Nothing needs you';
  return { needs, clear, unknown, verdict };
}

// ---------------------------------------------------------------------------------------------
// Running now and last outcome per run type
// ---------------------------------------------------------------------------------------------

export type RunGroup = 'collection' | 'bc-bid' | 'downloads' | 'extraction' | 'reviews' | 'other';
/** Which run list (`/runs?kind=…`) an action's runs belong to. */
export function runGroup(actionId: string | undefined | null): RunGroup {
  const id = actionId ?? '';
  if (id === 'procurement.collect' || id === 'procurement.collect.browser') return 'collection';
  if (/^(scrape\.|awards\.|listing\.capture|detail\.capture)/.test(id)) return 'bc-bid';
  if (id.startsWith('documents.download')) return 'downloads';
  if (id.startsWith('documents.extract')) return 'extraction';
  if (/^(records\.(review|evidence)|procurement\.(pipeline|triage))/.test(id)) return 'reviews';
  return 'other';
}
export const RUN_GROUP_TEXT: Record<RunGroup, string> = { collection: 'Collection runs', 'bc-bid': 'BC Bid runs', downloads: 'Download runs', extraction: 'Text extraction runs', reviews: 'AI review runs', other: 'Other runs' };
export const runsHref = (group: RunGroup) => group === 'other' ? '/runs' : `/runs?kind=${group}`;

export interface WorkflowRun { id: string; status: string; actionId?: string | null; createdAt?: string | null }
export interface Running { id: string; group: RunGroup; label: string; state: string; since: string | null; progress: string | null }
/**
 * Runs whose workflow run is active in the host's run list (`state`), newest first. A batch or checkpoint marked
 * running whose run has ended is not running (populations.ts "Running"). `null` runs = the host could not answer.
 * `progress` adds what a run reports: collection runs their step, download and review batches their counts.
 */
export function runningNow(runs: readonly WorkflowRun[] | null | undefined, progress: Record<string, string | null | undefined> = {}, now = Date.now()): { known: boolean; items: Running[] } {
  if (!runs) return { known: false, items: [] };
  const items = runs.filter(run => isActiveRun(run.status)).sort((a, b) => String(b.createdAt ?? '').localeCompare(String(a.createdAt ?? '')))
    .map(run => ({ id: run.id, group: runGroup(run.actionId), label: actionLabel(run.actionId ?? ''), state: String(runStateText(run.status)), since: run.createdAt ? `Started ${when(run.createdAt, now)}` : null, progress: progress[run.id] ?? null }));
  return { known: true, items };
}
/** "12 of 40 done, 2 failed" for a batch row; null without a total. */
export function batchProgress(row: { completed?: unknown; failed?: unknown; total?: unknown } | undefined): string | null {
  const total = Number(row?.total) || 0;
  if (!total) return null;
  const failed = Number(row?.failed) || 0;
  return `${n(Number(row?.completed) || 0)} of ${n(total)} done${failed ? `, ${n(failed)} failed` : ''}`;
}

/** Run and batch statuses of work still going (a batch's `partial` and `stopped` are outcomes, not live). */
const LIVE_STATUSES = ['running', 'pending', 'queued', 'stopping', 'retry_scheduled', 'waiting_for_event', 'paused'];
export interface Outcome { group: RunGroup; title: string; tone: 'good' | 'warn' | 'busy' | 'idle'; status: string; at: string | null; detail: string | null; lastDone: string | null }
/** Plain-language outcome of the newest run of one list, and when the last one succeeded when that was earlier. */
export function runOutcome(group: RunGroup, runs: readonly { status: string; createdAt?: string | null; finishedAt?: string | null; error?: string | null }[] | null | undefined, now = Date.now()): Outcome {
  const title = RUN_GROUP_TEXT[group];
  if (!runs) return { group, title, tone: 'idle', status: 'Unknown', at: null, detail: 'This Zoer version does not list these runs.', lastDone: null };
  const sorted = [...runs].sort((a, b) => String(b.createdAt ?? '').localeCompare(String(a.createdAt ?? '')));
  const latest = sorted[0];
  if (!latest) return { group, title, tone: 'idle', status: 'No runs yet', at: null, detail: null, lastDone: null };
  const status = String(runStateText(latest.status)), success = sorted.find(run => run.status === 'succeeded');
  const tone = latest.status === 'succeeded' ? 'good' : ['cancelled', 'stopped'].includes(latest.status) ? 'idle' : LIVE_STATUSES.includes(latest.status) ? 'busy' : 'warn';
  return { group, title, tone, status, at: when(latest.finishedAt ?? latest.createdAt, now), detail: latest.status === 'succeeded' ? null : latest.error ?? null,
    lastDone: latest === success ? null : success ? `Last done ${when(success.finishedAt ?? success.createdAt, now)}` : 'No successful run in recent history' };
}

// ---------------------------------------------------------------------------------------------
// Pipeline coverage
// ---------------------------------------------------------------------------------------------

/**
 * A coverage bar's text and width: "4,076 of 7,148"; a stage below 1% reads as words ("Not started", "Just started ·
 * 1 of 7,148") instead of an empty bar; an unknown denominator shows the count alone.
 */
export function coverageBar(value: number, of?: number): { text: string; ratio: number | null; note: string | null } {
  if (of === undefined) return { text: n(value), ratio: null, note: 'total not known' };
  if (!of) return { text: n(value), ratio: null, note: null };
  const ratio = Math.min(1, value / of);
  if (value === 0) return { text: 'Not started', ratio: null, note: `0 of ${n(of)}` };
  if (ratio < 0.01) return { text: 'Just started', ratio: null, note: `${n(value)} of ${n(of)}` };
  return { text: `${n(value)} of ${n(of)}`, ratio, note: null };
}

