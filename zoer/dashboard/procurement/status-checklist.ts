import { browserText, isNativeBrowser, scheduleSummary, type ScheduleBrowsers, type ScheduleRow } from './schedule-state';
import type { DocumentGap } from './status-data';
import { count as n, plural } from '../format';

/**
 * The Status page's setup checklist, as pure data: one step per thing that must be true for BC Bid to keep itself
 * current. Every step degrades on older Zoer (no browser names, no retry fields): it says what is unknown and where
 * to check, never a guessed "ready".
 */
export type StepTone = 'good' | 'warn' | 'idle' | 'busy';
export type StepAction = 'settings-browsers' | 'settings-schedules' | 'keep-documents' | 'capture-details' | 'open-browser';
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

export function downloadBrowserStep(browsers: ScheduleBrowsers | undefined): SetupStep {
  const base = { id: 'download-browser', title: 'Browser for downloads', actions: ['settings-browsers'] as StepAction[] };
  if (browsers === undefined) return { ...base, tone: 'idle', status: 'Not reported', detail: 'Attachment downloads need a native browser (Clearcote, Camoufox, Patchright or Playwright); Steel and Cloak cannot download. This Zoer version does not report which one is used; check Settings › Browsers.' };
  const own = browsers.downloadsUseCollection ? null : browsers.downloads, browser = own ?? browsers.collection;
  if (!browser) return { ...base, tone: 'warn', status: 'Not chosen', detail: 'Choose a native browser (Clearcote, Camoufox, Patchright or Playwright) for attachment downloads.' };
  const name = browserText(browser), shared = own ? '' : ' (the collection browser; no separate download browser is chosen)';
  if (browser.missing) return { ...base, tone: 'warn', status: 'Missing', detail: `${name}${shared} no longer exists in Zoer. Choose a native browser for downloads.` };
  if (!isNativeBrowser(browser)) return { ...base, tone: 'warn', status: 'Cannot download', detail: `${name}${shared} cannot download attachments. Choose a native browser (Clearcote, Camoufox, Patchright or Playwright) for downloads.` };
  if (browser.ready === false) return { ...base, tone: 'warn', status: 'Not ready', detail: `${name}${shared} is stopped, busy or under your control. Hand control back to the agent, then downloads continue.` };
  return { ...base, tone: 'good', status: 'Ready', detail: `${name}${shared} downloads attachments.` };
}

export function schedulesStep(rows: ScheduleRow[] | undefined, now = Date.now()): SetupStep {
  const base = { id: 'schedules', title: 'Schedules', actions: ['settings-schedules'] as StepAction[] };
  if (!rows) return { ...base, tone: 'idle', status: 'Loading…', detail: '' };
  const s = scheduleSummary(rows, now);
  if (!s.total) return { ...base, tone: 'warn', status: 'None saved', detail: 'Nothing runs by itself. Turn on the BC Bid schedules in Settings › Schedules.' };
  const parts = [s.stopped && `${s.stopped} paused and needing your review`, s.paused && `${s.paused} paused`, s.retrying && `${s.retrying} retrying`, s.waiting && `${s.waiting} waiting for you`].filter(Boolean);
  const tone: StepTone = s.stopped || s.waiting ? 'warn' : s.on === s.total && !s.retrying ? 'good' : s.on ? 'busy' : 'warn';
  return { ...base, tone, status: s.text, detail: parts.length ? `${parts.join(', ')}. Each schedule below says why.` : 'Every schedule is on.' };
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
  const base = { id: 'documents', title: 'Documents for open BC Bid notices', actions: ['keep-documents'] as StepAction[] };
  if (!gap) return { ...base, tone: 'idle', status: 'Loading…', detail: '' };
  if (!gap.withLinks) return { ...base, tone: 'idle', status: 'No links yet', detail: 'No open BC Bid notice has attachment links saved yet.' };
  if (!gap.missingNotices) return { ...base, tone: 'good', status: 'All saved', detail: `Every file of the ${plural(gap.withLinks, 'open notice')} with attachment links is saved.` };
  const missing = gap.links - gap.saved;
  const parts = missingFileParts(gap).map(([count, text]) => `${n(count)} ${text}`);
  return { ...base, tone: 'warn', status: `${n(gap.fullySaved)} of ${n(gap.withLinks)} notices complete`, detail: `${plural(missing, 'linked file')} missing on ${plural(gap.missingNotices, 'notice')}: ${parts.join(', ')}. “Keep documents current” downloads them, soonest closing first, and retries failures later.` };
}

export function detailsStep(gap: DocumentGap | undefined): SetupStep {
  const base = { id: 'details', title: 'Attachment links for open notices', actions: ['capture-details'] as StepAction[] };
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

export function browserCheckStep(gap: DocumentGap | undefined): SetupStep | null {
  if (!gap || (!gap.waiting && !gap.waitingNotices && !gap.checkPendingSince)) return null;
  const since = gap.checkPendingSince ? ` at ${new Date(gap.checkPendingSince).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}` : '';
  // Files, the unit Documents and Sources use too.
  const files = gap.waiting ? `; ${plural(gap.waiting, 'file of an open notice waits', 'files of open notices wait')} for it` : '';
  return { id: 'browser-check', title: 'Browser check', tone: 'warn', status: 'Waiting for you', actions: ['open-browser'],
    detail: `BC Bid asked for a browser check${since}${files}. Open the download browser in Zoer, complete the check, then hand control back; the next download run continues with the waiting files.` };
}

/** The whole checklist plus a one-line verdict for Home. */
export function setupChecklist(input: { browsers: ScheduleBrowsers | undefined; rows: ScheduleRow[] | undefined; gap: DocumentGap | undefined; now?: number }) {
  const steps = [collectionBrowserStep(input.browsers, input.rows), downloadBrowserStep(input.browsers), schedulesStep(input.rows, input.now), browserCheckStep(input.gap), documentsStep(input.gap), detailsStep(input.gap)].filter((step): step is SetupStep => !!step);
  const needs = steps.filter(step => step.tone === 'warn').length;
  return { steps, needs, verdict: needs ? `${plural(needs, 'thing needs', 'things need')} you` : steps.some(step => step.tone === 'idle') ? 'Running; some details not reported' : 'Everything is running' };
}
