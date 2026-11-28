import { browserText, isNativeBrowser, scheduleLabel, scheduleSummary, type ScheduleBrowsers, type ScheduleRow } from './schedule-state';
import type { DocumentGap } from './status-data';
import { count as n, plural, when } from '../format';

/**
 * Operations › Overview's checklist, as pure data: one step per thing that must be true for the pipeline to keep
 * itself current. Every step degrades on older Zoer (no browser names, no retry fields): it says what is unknown and where
 * to check, never a guessed "ready".
 */
export type StepTone = 'good' | 'warn' | 'idle' | 'busy';
export type StepAction = 'settings-browsers' | 'settings-schedules' | 'download-missing' | 'capture-details' | 'open-browser';
export interface SetupStep { id: string; title: string; tone: StepTone; status: string; detail: string; actions: StepAction[] }


export function collectionBrowserStep(browsers: ScheduleBrowsers | undefined, rows: ScheduleRow[] | undefined): SetupStep {
  const base = { id: 'collection-browser', title: 'Browser for collection', actions: ['settings-browsers'] as StepAction[] };
  if (browsers === undefined) {
    const bound = (rows ?? []).some(row => row.body?.resources?.browserSessionId);
    return { ...base, tone: 'idle', status: bound ? 'Chosen' : 'Not reported', detail: bound
      ? 'A saved browser is attached to the BC Bid schedules. This Zoer version does not report its name here; Settings › Browsers shows it.'
      : 'This Zoer version does not report which browser BC Bid uses. Check Settings › Browsers.' };
  }
  const browser = browsers.collection;
  if (!browser) return { ...base, tone: 'warn', status: 'Not chosen', detail: 'Choose the saved browser BC Bid scrapes run in.' };
  if (browser.missing) return { ...base, tone: 'warn', status: 'Missing', detail: `${browserText(browser)} no longer exists in Zoer. Choose another saved browser.` };
  if (browser.ready === false) return { ...base, tone: 'warn', status: 'Not ready', detail: `${browserText(browser)} is stopped, busy or under your control. Hand control back to the agent or choose another browser.` };
  return { ...base, tone: 'good', status: 'Ready', detail: `${browserText(browser)} runs BC Bid scrapes.` };
}

/** The download schedules this plugin runs on the BC Bid download browser (the legacy one and the queue). */
const DOWNLOAD_SCHEDULES = ['documents.download.missing', 'documents.download.queue', 'documents.download.all'];
const STOPPED_RESPONDING = /stopped responding|did not recover/i;

/**
 * The download browser. Zoer's "ready" flag is current, but a download schedule Zoer stopped because this browser
 * stopped responding contradicts a plain "Ready", so that case says both. A pending browser check is its own step
 * (`browserCheckStep`); this step then only says the browser waits there.
 */
export function downloadBrowserStep(browsers: ScheduleBrowsers | undefined, rows?: ScheduleRow[], gap?: DocumentGap): SetupStep {
  const base = { id: 'download-browser', title: 'Browser for downloads', actions: ['settings-browsers'] as StepAction[] };
  if (browsers === undefined) return { ...base, tone: 'idle', status: 'Not reported', detail: 'Attachment downloads need a native browser (Clearcote, Camoufox, Patchright or Playwright); Steel and Cloak cannot download. This Zoer version does not report which one is used; check Settings › Browsers.' };
  const own = browsers.downloadsUseCollection ? null : browsers.downloads, browser = own ?? browsers.collection;
  if (!browser) return { ...base, tone: 'warn', status: 'Not chosen', detail: 'Choose a native browser (Clearcote, Camoufox, Patchright or Playwright) for attachment downloads.' };
  const name = browserText(browser), shared = own ? '' : ' (the collection browser; no separate download browser is chosen)';
  if (browser.missing) return { ...base, tone: 'warn', status: 'Missing', detail: `${name}${shared} no longer exists in Zoer. Choose a native browser for downloads.` };
  if (!isNativeBrowser(browser)) return { ...base, tone: 'warn', status: 'Cannot download', detail: `${name}${shared} cannot download attachments. Choose a native browser (Clearcote, Camoufox, Patchright or Playwright) for downloads.` };
  if (browser.ready === false) return { ...base, tone: 'warn', status: 'Not ready', detail: `${name}${shared} is stopped, busy or under your control. Hand control back to the agent, then downloads continue.` };
  if (gap?.checkPendingSince) return { ...base, tone: 'warn', status: 'Waiting at a browser check', detail: '' };
  const stopped = (rows ?? []).find(row => DOWNLOAD_SCHEDULES.includes(row.actionId) && !row.enabled && STOPPED_RESPONDING.test(row.error ?? '') && (!row.browser || row.browser.id === browser.id));
  if (stopped) return { ...base, tone: 'warn', status: 'Stopped responding earlier', actions: ['open-browser'],
    detail: `${name} stopped responding during a scheduled download, so Zoer turned “${scheduleLabel(stopped)}” off. Zoer reports the browser ready now: open it in Zoer and check that BC Bid loads before downloads run again.` };
  return { ...base, tone: 'good', status: 'Ready', detail: `${name}${shared} downloads attachments.` };
}

export function schedulesStep(rows: ScheduleRow[] | undefined, now = Date.now()): SetupStep {
  const base = { id: 'schedules', title: 'Schedules', actions: ['settings-schedules'] as StepAction[] };
  if (!rows) return { ...base, tone: 'idle', status: 'Loading…', detail: '' };
  const s = scheduleSummary(rows, now);
  if (!s.total) return { ...base, tone: 'warn', status: 'None saved', detail: 'Nothing runs by itself. Turn on the BC Bid schedules in Settings › Schedules.' };
  const parts = [s.stopped && `${n(s.stopped)} need review`, s.paused && `${n(s.paused)} off`, s.retrying && `${n(s.retrying)} retrying`, s.waiting && `${n(s.waiting)} waiting for you`].filter(Boolean);
  const tone: StepTone = s.stopped || s.waiting ? 'warn' : s.on === s.total && !s.retrying ? 'good' : s.on ? 'busy' : 'warn';
  return { ...base, tone, status: s.stopped ? `${n(s.stopped)} of ${plural(s.total, 'schedule')} need review` : s.text, detail: parts.length ? `${s.text}; ${parts.join(', ')}.` : 'Every schedule is on.' };
}

/**
 * Why linked files are missing, in Documents › Download's words: the host downloader's buckets when this Zoer reports
 * them, else the plugin's own split (never tried / tried, not saved / waiting for a browser check).
 */
export function missingFileParts(gap: DocumentGap): [number, string][] {
  const q = gap.queue;
  const parts: [number, string][] = q ? [[q.neverTried, 'never tried'], [q.retryDue, 'ready to retry'], [q.retryScheduled, 'scheduled for retry'],
    [q.waitingForBrowser, 'waiting for a browser check'], [q.skipped, 'skipped'], [q.unavailable, 'unavailable'], [q.exhausted, 'retry limit reached']]
    : [[gap.never, 'never tried'], [gap.failed, 'tried, not saved'], [gap.waiting, 'waiting for a browser check']];
  return parts.filter(([count]) => count > 0);
}

export function documentsStep(gap: DocumentGap | undefined): SetupStep {
  const base = { id: 'documents', title: 'Documents for open BC Bid opportunities', actions: ['download-missing'] as StepAction[] };
  if (!gap) return { ...base, tone: 'idle', status: 'Loading…', detail: '' };
  if (!gap.withLinks) return { ...base, tone: 'idle', status: 'No links yet', detail: 'No open BC Bid notice has attachment links saved yet.' };
  if (!gap.missingNotices) return { ...base, tone: 'good', status: 'Every file saved', detail: `Every file of the ${plural(gap.withLinks, 'open notice')} with attachment links is saved.` };
  const missing = gap.links - gap.saved;
  const parts = missingFileParts(gap).map(([count, text]) => `${n(count)} ${text}`);
  return { ...base, tone: 'warn', status: `${n(gap.fullySaved)} of ${n(gap.withLinks)} have every file`, detail: `${n(gap.fullySaved)} of ${n(gap.withLinks)} open BC Bid opportunities with attachment links have every file saved. ${plural(missing, 'linked file')} missing on ${plural(gap.missingNotices, 'opportunity', 'opportunities')}: ${parts.join(', ')}.` };
}

export function detailsStep(gap: DocumentGap | undefined): SetupStep {
  const base = { id: 'details', title: 'Attachment links for open opportunities', actions: ['capture-details'] as StepAction[] };
  if (!gap) return { ...base, tone: 'idle', status: 'Loading…', detail: '' };
  const noFiles = gap.noFiles ? ` ${plural(gap.noFiles, 'open notice')} ${gap.noFiles === 1 ? 'has' : 'have'} no public files on BC Bid after a complete capture.` : '';
  const remaining = gap.noLinks + gap.detailsWithLinks;
  if (!remaining) return { ...base, tone: 'good', status: 'All captured', detail: `Every open BC Bid notice has a current detail capture.${noFiles}` };
  const parts = [
    gap.noLinks ? `${n(gap.noLinks)} without attachment links` : '',
    gap.detailsWithLinks ? `${n(gap.detailsWithLinks)} with links and missing or stale details` : '',
  ].filter(Boolean).join(', ');
  return { ...base, tone: 'warn', status: `${n(remaining)} need details`, detail: `Open BC Bid notices still to capture include ${parts}. Capture up to 50 per run, soonest closing first.${noFiles}` };
}

/**
 * BC Bid's browser check on the download browser: which browser, since when, what waits behind it, and what happens
 * after it. "Continues" is said only while a download run is active (`downloadActive`); otherwise nothing resumes by
 * itself and the person starts downloads again.
 */
export function browserCheckStep(gap: DocumentGap | undefined, browsers?: ScheduleBrowsers, downloadActive = false, now = Date.now()): SetupStep | null {
  if (!gap || (!gap.waiting && !gap.waitingNotices && !gap.checkPendingSince)) return null;
  const browser = browsers ? browsers.downloadsUseCollection ? browsers.collection : browsers.downloads ?? browsers.collection : undefined;
  const where = browser ? ` in ${browserText(browser)}, the download browser` : ' in the download browser';
  const since = gap.checkPendingSince ? `, ${when(gap.checkPendingSince, now)}` : '';
  const missing = Math.max(0, gap.links - gap.saved);
  const held = gap.waiting ? ` (${plural(gap.waiting, 'file of an open opportunity', 'files of open opportunities')} hit the check)` : '';
  const blocked = missing ? ` BC Bid attachment downloads stop at it, so ${plural(missing, 'missing file')} of open opportunities wait${held}.` : gap.waiting ? ` ${plural(gap.waiting, 'file of an open opportunity waits', 'files of open opportunities wait')} for it.` : '';
  const next = downloadActive ? ' Complete the check in Zoer and hand control back; the active download run then continues.'
    : ' Complete the check in Zoer and hand control back. No download run is active, so start one afterwards under Operations › Documents.';
  return { id: 'browser-check', title: 'Browser check', tone: 'warn', status: 'Waiting for you', actions: ['open-browser'],
    detail: `BC Bid asked for a browser check${where}${since}.${blocked}${next}` };
}

export interface ExtractionCounts { failedFiles: number; failedNotices: number; pendingFiles: number; pendingNotices: number }
/** Text extraction: failures always need the person; waiting files only when nothing will extract them (schedule not on, no run). */
export function extractionStep(counts: ExtractionCounts | undefined, scheduleOn: boolean | undefined, running = false): SetupStep | null {
  const base = { id: 'extraction', title: 'Text extraction', actions: [] as StepAction[] };
  if (!counts) return null;
  const stalled = counts.pendingFiles > 0 && scheduleOn === false && !running;
  const parts = [
    counts.failedFiles ? `${plural(counts.failedFiles, 'saved file')} on ${plural(counts.failedNotices, 'opportunity', 'opportunities')} failed text extraction.` : '',
    counts.pendingFiles ? `${plural(counts.pendingFiles, 'saved file waits', 'saved files wait')} for text${running ? '; extraction is running.' : scheduleOn ? '; the schedule extracts them.' : scheduleOn === false ? ' and the text extraction schedule is not on, so nothing extracts them until you turn it on or extract them under Operations › Documents.' : '.'}` : '',
  ].filter(Boolean);
  if (!counts.failedFiles && !stalled) return { ...base, tone: 'good', status: counts.pendingFiles ? `${n(counts.pendingFiles)} waiting` : 'Up to date', detail: parts.join(' ') || 'Every saved file has been through text extraction.' };
  return { ...base, tone: 'warn', status: [counts.failedFiles && `${n(counts.failedFiles)} failed`, stalled && `${n(counts.pendingFiles)} waiting`].filter(Boolean).join(' · '), detail: parts.join(' ') };
}

export interface FailureCounts { files: number; fileNotices: number; waitingFiles: number; otherNotices: number }
/** The failure queue (source-health.ts `failedFiles`): files not saved after a download attempt, any source, open or closed. */
export function failuresStep(counts: FailureCounts | undefined): SetupStep | null {
  if (!counts) return null;
  const base = { id: 'failures', title: 'Failure queue', actions: [] as StepAction[] };
  if (!counts.files) return { ...base, tone: 'good', status: 'Empty', detail: 'No file is left unsaved after a download attempt.' };
  return { ...base, tone: 'warn', status: `${plural(counts.files, 'file')} not saved`, detail: `${plural(counts.files, 'file')} on ${plural(counts.fileNotices, 'opportunity', 'opportunities')} were not saved after a download attempt (all sources, open and closed${counts.waitingFiles ? `; ${n(counts.waitingFiles)} wait for a browser check` : ''}). Retry them under Opportunities › Files.` };
}

/** The whole checklist plus a one-line verdict. Steps for extraction and the failure queue appear only when their counts are passed. */
export function setupChecklist(input: { browsers: ScheduleBrowsers | undefined; rows: ScheduleRow[] | undefined; gap: DocumentGap | undefined; now?: number;
  downloadActive?: boolean; extraction?: ExtractionCounts; extractionRunning?: boolean; failures?: FailureCounts }) {
  const extractOn = input.rows ? !!input.rows.find(row => row.actionId === 'documents.extract.pending' && !row.presetId)?.enabled : undefined;
  const steps = [collectionBrowserStep(input.browsers, input.rows), downloadBrowserStep(input.browsers, input.rows, input.gap), schedulesStep(input.rows, input.now),
    browserCheckStep(input.gap, input.browsers, input.downloadActive, input.now), documentsStep(input.gap), detailsStep(input.gap),
    extractionStep(input.extraction, extractOn, input.extractionRunning), failuresStep(input.failures)].filter((step): step is SetupStep => !!step);
  const needs = steps.filter(step => step.tone === 'warn').length;
  return { steps, needs, verdict: needs ? `${plural(needs, 'thing needs', 'things need')} you` : steps.some(step => step.tone === 'idle') ? 'Running; some details not reported' : 'Everything is running' };
}
