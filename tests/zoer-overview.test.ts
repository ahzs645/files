// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { actionLabel, scheduleLabel, stopDiffers, stopMessage, stopReason, type ScheduleBrowsers, type ScheduleRow } from '../zoer/dashboard/procurement/schedule-state';
import { reenableable } from '../zoer/dashboard/procurement/source-schedules';
import { computeDocumentGap } from '../zoer/dashboard/procurement/status-data';
import { downloadBrowserStep, setupChecklist } from '../zoer/dashboard/procurement/status-checklist';
import { coverageBar, needsYou, runOutcome, runningNow, scheduleSections, stopGroups } from '../zoer/dashboard/procurement/overview-data';
import { nextVisit, visitSeen, VISIT_GAP_MS } from '../zoer/dashboard/review-workspace/today-data';

vi.mock('../zoer/dashboard/procurement/display', () => ({ sourceName: (id: string) => id, sql: async () => [] }));
const { profileState } = await import('../zoer/dashboard/review-workspace/home-data');

/** The thirteen schedules on the live host on 2026-11-27 (findings/raw/schedules.json, signatures left out). */
const CHANGED = 'Scheduled action, permissions or settings changed. Review and save this schedule again.';
const SCRAPER = { id: 'br-scraper', name: 'BC Bid scraper (Clearcote, Oct 1)', provider: 'clearcote', native: true, ready: true };
const PACING = { id: 'br-pacing', name: '30s pacing test', provider: 'clearcote', native: true, ready: true };
const KITESURF = { id: 'br-kite', name: 'Kitesurf', provider: 'clearcote', native: true, ready: true };
const off = (actionId: string, error: string, extra: Partial<ScheduleRow> = {}): ScheduleRow => ({ actionId, enabled: false, intervalHours: 24, state: 'needs_attention', lastStatus: 'succeeded', error, ...extra });
const LIVE: ScheduleRow[] = [
  off('scrape.sample', 'Restored from backup. Choose destination connections and review before enabling.', { lastStatus: 'failed', browser: null, body: { input: { detailLimit: 1 }, resources: {} } }),
  off('documents.download.missing', '"BC Bid downloads (30s pacing test)" stopped responding and did not recover after one automatic restart. Open it in Zoer, check that BC Bid loads, then retry.',
    { intervalHours: 1, lastStatus: 'waiting_for_user', consecutiveFailures: 2, browser: PACING, body: { input: { scope: 'all' }, resources: { browserSessionId: PACING.id } } }),
  off('scrape.details', CHANGED, { intervalHours: 6, browser: SCRAPER, body: { input: { missing: { limit: 50, stale: true } }, resources: { browserSessionId: SCRAPER.id } } }),
  off('awards.history', CHANGED, { browser: SCRAPER, body: { input: {}, resources: { browserSessionId: SCRAPER.id } } }),
  off('scrape.full', CHANGED, { lastStatus: 'waiting_for_user', consecutiveFailures: 4, warning: 'Last run stopped for a browser check.', browser: SCRAPER, body: { input: {}, resources: { browserSessionId: SCRAPER.id } } }),
  off('procurement.collect', CHANGED, { presetId: 'pr_cb', body: { input: { sourceId: 'canadabuys' }, resources: {} } }),
  off('procurement.collect', CHANGED, { presetId: 'pr_bt', body: { input: { sourceId: 'bidsandtenders' }, resources: {} } }),
  off('procurement.collect', CHANGED, { presetId: 'pr_ms', body: { input: { sourceId: 'municipal-sites' }, resources: {} } }),
  off('procurement.alerts', CHANGED, { intervalHours: 6, body: { input: {}, resources: {} } }),
  off('procurement.collect.browser', CHANGED, { browser: KITESURF, body: { input: { sourceId: 'browser-sites' }, resources: { browserSessionId: KITESURF.id } } }),
  off('documents.extract.pending', CHANGED, { intervalHours: 1, body: { input: {}, resources: {} } }),
  { actionId: 'documents.download.portals', enabled: true, intervalHours: 1, state: 'scheduled', lastStatus: 'succeeded', nextRunAt: '2026-11-27T23:19:00Z', browser: KITESURF, body: { input: {}, resources: { browserSessionId: KITESURF.id } } },
  { actionId: 'procurement.publisher.sweep', enabled: true, intervalHours: 24, state: 'scheduled', lastStatus: 'succeeded', nextRunAt: '2026-11-28T21:17:00Z', body: { input: { catalogOnly: true }, resources: {} } },
];
const BROWSERS: ScheduleBrowsers = { collection: SCRAPER, downloads: PACING, downloadsUseCollection: false };
const NOW = Date.parse('2026-11-27T22:30:00Z');
const QUEUE = { notices: 689, withLinks: 466, withoutLinks: 223, needsDetails: 0, fullySaved: 367, files: 3359, saved: 2371, neverTried: 451, retryDue: 528, retryScheduled: 3, waitingForBrowser: 1, skipped: 3, unavailable: 1, exhausted: 1, nextRetryAt: null };
const GAP = { ...computeDocumentGap({ open: 689, withLinks: 466, noFiles: 223 }, [], [], [], QUEUE), checkPendingSince: '2026-11-27T21:23:00Z' };

describe('schedules on Operations › Overview', () => {
  it('names every schedule, never a raw action id', () => {
    expect(LIVE.slice(-2).map(row => scheduleLabel(row))).toEqual(['Portal documents · keep current', 'Linked publisher checks']);
    expect(scheduleLabel({ actionId: 'some.new.action', enabled: true, intervalHours: 1 })).toBe('Some new action');
    expect(actionLabel('documents.download.queue')).toBe('BC Bid · download missing files');
  });
  it('shows Zoer’s own message when it is not one the plugin explains, and no generic sentence', () => {
    const own = LIVE[1].error!;
    expect(stopReason(own)).toBe(stopMessage(own));
    expect(stopReason(own)).toMatch(/^“?"?BC Bid downloads \(30s pacing test\)"? stopped responding/);
    expect(stopDiffers(own)).toBe(false);
    expect(stopReason(CHANGED)).not.toMatch(/Compatible version/);
    expect(stopDiffers(CHANGED)).toBe(true);
  });
  it('groups the nine schedules a plugin update stopped under one reason, largest group first', () => {
    const groups = stopGroups(LIVE, NOW);
    expect(groups.map(group => group.rows.length)).toEqual([9, 1, 1]);
    expect(groups[0]).toMatchObject({ reason: stopReason(CHANGED), message: CHANGED });
    expect(groups[1].message).toBe('Restored from backup. Choose destination connections and review before enabling.');
    expect(groups[2]).toMatchObject({ message: null });
    // Non-browser schedules are turned on here (text extraction included); browser ones in Zoer's Settings.
    expect(reenableable(groups[0].rows).map(row => row.presetId ?? row.actionId)).toEqual(['pr_cb', 'pr_bt', 'pr_ms', 'procurement.alerts', 'documents.extract.pending']);
  });
  it('lists Needs review, Off and On, and counts like Zoer', () => {
    const sections = scheduleSections(LIVE, NOW);
    expect([sections.review.length, sections.off.length, sections.on.length, sections.summary]).toEqual([11, 0, 2, '2 of 13 schedules on']);
    expect(scheduleSections([{ ...LIVE[12] }, { ...LIVE[12], enabled: false, state: 'off', error: undefined }], NOW)).toMatchObject({ review: [], off: [expect.anything()], summary: '1 of 2 schedules on' });
  });
});

describe('Needs you on the live shape', () => {
  const checklist = setupChecklist({ browsers: BROWSERS, rows: LIVE, gap: GAP, now: NOW, downloadActive: false,
    extraction: { failedFiles: 0, failedNotices: 0, pendingFiles: 192, pendingNotices: 40 }, failures: { files: 8, fileNotices: 5, waitingFiles: 1, otherNotices: 0 } });
  const result = needsYou(checklist.steps);
  it('has one row each for the browser check, schedules, documents, waiting text and the failure queue', () => {
    expect(result.needs.map(need => [need.id, need.title, need.status])).toEqual([
      ['browsers', 'Browser check', 'Waiting for you'],
      ['schedules', 'Schedules', '11 of 13 schedules need review'],
      ['documents', 'Documents for open BC Bid notices', '367 of 466 have every file'],
      ['extraction', 'Text extraction', '192 waiting'],
      ['failures', 'Failure queue', '8 files not saved'],
    ]);
    expect(result.verdict).toBe('5 things need you');
    expect(result.clear.map(step => step.id)).toEqual(['collection-browser', 'details']);
  });
  it('names the browser and the time, says what waits behind the check, and never claims downloads continue', () => {
    const browser = result.needs[0];
    expect(browser.lines[0]).toMatch(/^BC Bid asked for a browser check in 30s pacing test \(Clearcote\), the download browser, .+\. BC Bid attachment downloads stop at it, so 988 missing files of open notices wait/);
    expect(browser.lines.join(' ')).not.toMatch(/continue/);
    expect(browser.actions[0]).toBe('open-browser');
    expect(browser.owner).toEqual({ to: '/documents', label: 'Operations › Documents' });
  });
  it('never calls the download browser plainly "Ready" while its schedule says it stopped responding', () => {
    const step = downloadBrowserStep(BROWSERS, LIVE);
    expect(step).toMatchObject({ tone: 'warn', status: 'Stopped responding earlier' });
    expect(step.detail).toMatch(/30s pacing test \(Clearcote\) stopped responding during a scheduled download, so Zoer turned “BC Bid · keep documents current” off/);
    expect(downloadBrowserStep(BROWSERS, LIVE.slice(2)).status).toBe('Ready');
  });
  it('links the failure queue to Opportunities › Files and documents to Operations › Documents', () => {
    expect(result.needs.find(need => need.id === 'failures')!.owner).toEqual({ to: '/files?fileStatus=failed', label: 'Opportunities › Files' });
    expect(result.needs.find(need => need.id === 'documents')!.owner!.to).toBe('/documents');
  });
  it('is all clear when nothing warns', () => {
    const fine = needsYou(setupChecklist({ browsers: BROWSERS, rows: [LIVE[12]], gap: { ...GAP, checkPendingSince: null, waiting: 0, missingNotices: 0 }, now: NOW }).steps);
    expect(fine).toMatchObject({ needs: [], verdict: 'Nothing needs you' });
  });
});

describe('Running now', () => {
  it('says nothing is running when no workflow run is active, and ignores ended runs', () => {
    expect(runningNow([{ id: 'a', actionId: 'documents.download.queue', status: 'cancelled' }, { id: 'b', actionId: 'procurement.collect', status: 'succeeded' }], {}, NOW)).toEqual({ known: true, items: [] });
    expect(runningNow(null)).toEqual({ known: false, items: [] });
  });
  it('lists active runs by kind with their progress', () => {
    const now = runningNow([{ id: 'q', actionId: 'documents.download.queue', status: 'running', createdAt: '2026-11-27T22:00:00Z' }, { id: 'x', actionId: 'documents.extract.pending', status: 'waiting_for_user', createdAt: '2026-11-27T21:00:00Z' }], { q: '12 of 40 done' }, NOW);
    expect(now.items.map(item => [item.group, item.label, item.state, item.progress])).toEqual([
      ['downloads', 'BC Bid · download missing files', 'Running', '12 of 40 done'], ['extraction', 'Text extraction of saved files', 'Waiting for you', null]]);
  });
  it('reports the last outcome of a list and when it last succeeded', () => {
    expect(runOutcome('downloads', [{ status: 'cancelled', createdAt: '2026-11-27T20:00:00Z' }, { status: 'succeeded', createdAt: '2026-11-26T03:47:00Z' }], NOW)).toMatchObject({ status: 'Stopped', tone: 'idle', lastDone: expect.stringMatching(/^Last done /) });
    expect(runOutcome('extraction', [{ status: 'partial', createdAt: '2026-11-27T20:00:00Z' }], NOW)).toMatchObject({ status: 'Partly failed', tone: 'warn' });
  });
});

describe('Pipeline coverage bars', () => {
  it('reads a stage under 1% as words, not an empty bar', () => {
    expect(coverageBar(1, 7148)).toEqual({ text: 'Just started', ratio: null, note: '1 of 7,148' });
    expect(coverageBar(0, 7148)).toMatchObject({ text: 'Not started', ratio: null });
    expect(coverageBar(4076, 7148)).toMatchObject({ text: '4,076 of 7,148', ratio: 4076 / 7148 });
  });
});

describe('Home: last visit', () => {
  const T = Date.parse('2026-11-27T20:00:00Z');
  it('keeps the window through reloads within a visit and moves it only after a 30-minute gap', () => {
    const first = nextVisit(null, T);
    expect(first).toMatchObject({ first: true, since: T - 86_400_000, seen: T });
    const reload = nextVisit(JSON.stringify(first), T + 5 * 60_000);
    expect(reload).toMatchObject({ since: first.since, first: true });
    // A long stay keeps being seen, so a reload after it is the same visit.
    const stayed = visitSeen(reload, T + 50 * 60_000);
    expect(nextVisit(JSON.stringify(stayed), T + 70 * 60_000).since).toBe(first.since);
    // Back after a longer gap: the new window starts when the previous visit was last seen.
    expect(nextVisit(JSON.stringify(stayed), T + 50 * 60_000 + VISIT_GAP_MS + 1)).toMatchObject({ since: T + 50 * 60_000, first: false });
  });
  it('reads the older bare timestamp and ignores unreadable or future markers', () => {
    expect(nextVisit(String(T), T + 60_000)).toMatchObject({ since: T, first: false });
    expect(nextVisit('garbage', T)).toMatchObject({ first: true });
    expect(nextVisit(JSON.stringify({ since: T + 1e9, seen: T + 1e9 }), T)).toMatchObject({ first: true });
  });
});

describe('Home: profile prompt', () => {
  it('says create, publish or choose according to the real state', () => {
    expect(profileState([], 0, false)).toEqual({ state: 'none' });
    expect(profileState([{ name: 'dssdf', published: false }], 0, false)).toEqual({ state: 'draft-only', draftName: 'dssdf' });
    expect(profileState([{ name: 'Acme', published: true }, { name: 'dssdf', published: false }], 1, false)).toEqual({ state: 'unchosen' });
    expect(profileState([{ name: 'Acme', published: true }], 1, true)).toEqual({ state: 'chosen' });
  });
});
