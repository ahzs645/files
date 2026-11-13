// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { plainError, shortError, tidyMessage } from '../zoer/dashboard/error-text';
import { scheduleKind, scheduleLabel, scheduleState, scheduleSummary, type ScheduleRow } from '../zoer/dashboard/procurement/schedule-state';
import { reenableable, stoppedSchedules } from '../zoer/dashboard/procurement/source-schedules';
import { computeDocumentGap, lastCollectionText, lastCollections } from '../zoer/dashboard/procurement/status-data';
import { setupChecklist } from '../zoer/dashboard/procurement/status-checklist';
import { noticeFileRows } from '../zoer/dashboard/procurement/notice-files';
import { awardProgress } from '../zoer/dashboard/award-progress';
import { hostSettingsHref } from '../zoer/dashboard/navigation';

const row = (value: Partial<ScheduleRow>): ScheduleRow => ({ actionId: 'procurement.collect', enabled: true, intervalHours: 24, ...value });
/** The seven schedules on the live instance on 2026-11-13 (all off). */
const LIVE: ScheduleRow[] = [
  row({ actionId: 'scrape.sample', enabled: false, error: 'Restored from backup. Choose destination connections and review before enabling.' }),
  row({ presetId: 'p-cb', enabled: false, error: 'getaddrinfo EAI_AGAIN', body: { input: { sourceId: 'canadabuys' } } }),
  row({ presetId: 'p-bt', enabled: false, error: 'Scheduled action, permissions or settings changed. Review and save this schedule again.', body: { input: { sourceId: 'bidsandtenders' } } }),
  row({ presetId: 'p-ms', enabled: false, error: 'Scheduled action, permissions or settings changed. Review and save this schedule again.', body: { input: { sourceId: 'municipal-sites' } } }),
  row({ actionId: 'procurement.alerts', enabled: false, intervalHours: 6, error: 'Scheduled action, permissions or settings changed. Review and save this schedule again.' }),
  row({ actionId: 'procurement.collect.browser', enabled: false, error: 'Scheduled action, permissions or settings changed. Review and save this schedule again.', body: { input: { sourceId: 'browser-sites' }, resources: { browserSessionId: 'br-1' } } }),
  row({ actionId: 'scrape.full', enabled: false, error: 'Integration kubernetes worker failed to start: Waiting for prior plugin worker cleanup.', body: { input: {}, resources: { browserSessionId: 'br-1' } } }),
];

describe('plain-language errors', () => {
  it('explains the developer messages seen on the live instance', () => {
    expect(plainError('getaddrinfo EAI_AGAIN')).toMatch(/could not be reached/);
    expect(plainError("Integration action output did not match its JSON Schema: / must NOT have additional properties 'reconciliation'")).toMatch(/plugin bug/);
    expect(plainError('Integration kubernetes worker failed to start: Waiting for prior plugin worker cleanup.')).toMatch(/cleaning up the previous run/);
    expect(plainError('This browser transport does not support opportunity attachment controls yet. Select a native saved browser.')).toMatch(/native browser \(Clearcote, Camoufox, Patchright or Playwright\)/);
    expect(plainError('Run plan is stale: plugin config changed')).toMatch(/settings changed after this run was planned/);
    expect(plainError('Manual browser verification required. Open the attachment in the saved browser, complete the browser check manually, then retry.')).toMatch(/browser check/);
    expect(plainError('11 of 25 records failed: No attachment links saved for this record. Capture its details first, if available.. Saved results are retained.')).toBe('11 of 25 notices have no attachment links saved yet. Capture their details first; this is not a download failure.');
    expect(shortError('Manual browser verification required.')).toBe('Browser check needed. Complete it in the Zoer browser, then retry.');
  });
  it('shows local times, hides 9999-12-31 sentinels and fixes double full stops in unknown messages', () => {
    const text = tidyMessage('Download stopped. Recovery is scheduled for 2026-11-13T18:00:39.599Z.. Range 9999-12-31 to 9999-12-31.');
    expect(text).not.toMatch(/2026-11-13T|9999|\.\./);
    expect(text).toContain(new Date('2026-11-13T18:00:39.599Z').toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }));
    expect(awardProgress({ version: 2, ranges: [{ complete: true }, { from: '9999-12-31', to: '9999-12-31' }], active: 1, count: 10, pages: 2, page: 0 })).not.toMatch(/9999|Current range/);
  });
});

describe('one schedule count everywhere', () => {
  it('counts every row Zoer lists, including the stopped CanadaBuys and sample schedules', () => {
    expect(scheduleSummary(LIVE)).toMatchObject({ total: 7, on: 0, off: 7, stopped: 7, text: '0 of 7 schedules on' });
    expect(stoppedSchedules(LIVE)).toHaveLength(7);
    // CanadaBuys (network error) is re-enableable from the page now; browser and restored schedules are not.
    expect(reenableable(LIVE).map(item => item.presetId ?? item.actionId)).toEqual(['p-cb', 'p-bt', 'p-ms', 'procurement.alerts']);
    expect(LIVE.map(item => scheduleLabel(item, undefined, id => ({ canadabuys: 'CanadaBuys', bidsandtenders: 'bids&tenders (BC)', 'municipal-sites': 'BC local government websites' } as Record<string, string>)[id] ?? id)))
      .toEqual(['BC Bid · sample check', 'CanadaBuys', 'bids&tenders (BC)', 'BC local government websites', 'Alert checks', 'BC sites (your browser)', 'BC Bid · current opportunities']);
  });
  it('prefers the host state and mirrors its wording for retrying and waiting rows', () => {
    const now = Date.parse('2026-11-13T12:00:00Z');
    const retrying = row({ state: 'retrying', consecutiveFailures: 2, retryAt: '2026-11-13T14:00:00Z', error: 'getaddrinfo EAI_AGAIN' });
    expect(scheduleKind(retrying, now)).toBe('retrying');
    expect(scheduleState(retrying, now)).toMatchObject({ status: 'On · retrying', next: expect.stringContaining('(2 failed attempts in a row)') });
    expect(scheduleState(row({ state: 'waiting_for_user' }), now).status).toBe('On · waiting for you');
    expect(scheduleKind(row({ enabled: false, error: 'x', state: 'needs_attention' }), now)).toBe('stopped');
    expect(scheduleState(row({ enabled: false, error: 'getaddrinfo EAI_AGAIN' }), now).stopped).toMatch(/could not be reached/);
    expect(scheduleSummary([retrying, row({ state: 'scheduled' })], now)).toMatchObject({ on: 2, retrying: 1, text: '2 of 2 schedules on' });
  });
});

describe('Status checklist', () => {
  const gap = computeDocumentGap({ open: 3, withLinks: 2, noLinks: 1, waitingNotices: 0 },
    [{ id: 'o1', title: 'One', closing: '2026-12-01', links: JSON.stringify([{ url: 'a', name: 'A' }, { url: 'b', name: 'B' }]) }, { id: 'o2', title: 'Two', closing: '2026-11-20', links: [{ url: 'c', name: 'C' }] }],
    [{ recordId: 'o1', url: 'a', status: 'downloaded' }, { recordId: 'o1', url: 'b', status: 'failed', error: 'The saved browser is unavailable or under manual control.' }]);
  it('counts files per state and lists notices closing soonest first', () => {
    expect(gap).toMatchObject({ links: 3, saved: 1, failed: 1, never: 1, fullySaved: 0, missingNotices: 2 });
    expect(gap.notices.map(notice => notice.id)).toEqual(['o2', 'o1']);
  });
  it('degrades on older Zoer (no browser names) and names browsers on newer Zoer', () => {
    const old = setupChecklist({ browsers: undefined, rows: LIVE, gap });
    expect(old.steps.map(step => [step.id, step.tone])).toEqual([['collection-browser', 'idle'], ['download-browser', 'idle'], ['schedules', 'warn'], ['documents', 'warn'], ['details', 'warn']]);
    expect(old.verdict).toBe('3 things need you');
    const steel = { id: 'br-1', name: 'BC Bid test', provider: 'steel', native: false, ready: true };
    const fresh = setupChecklist({ browsers: { collection: steel, downloads: null }, rows: [row({ state: 'scheduled' })], gap: { ...gap, missingNotices: 0, noLinks: 0 } });
    expect(fresh.steps.find(step => step.id === 'collection-browser')).toMatchObject({ tone: 'good', detail: 'BC Bid test (Steel) runs BC Bid scrapes.' });
    expect(fresh.steps.find(step => step.id === 'download-browser')).toMatchObject({ tone: 'warn', status: 'Cannot download' });
    const native = setupChecklist({ browsers: { collection: steel, downloads: { id: 'br-2', name: 'Downloads', provider: 'camoufox', native: true, ready: true } }, rows: [], gap: undefined });
    expect(native.steps.find(step => step.id === 'download-browser')).toMatchObject({ tone: 'good', detail: 'Downloads (Camoufox) downloads attachments.' });
  });
});

describe('last successful collection: one helper', () => {
  it('merges run lists, never reads an unreadable source as never collected', () => {
    const runs = [{ runId: 'a', actionId: 'scrape.details', status: 'succeeded', createdAt: '2026-11-12T22:00:00Z', finishedAt: '2026-11-12T23:50:00Z', input: {} }];
    const capture = [{ id: 'b', actionId: 'scrape.full', status: 'failed', createdAt: '2026-11-12T15:00:00Z' }];
    const rows = lastCollections([{ key: 'procurement:source:canadabuys:collection', value: { lastSuccessAt: '2026-10-03T21:13:00Z' } }, { key: 'procurement:source:bidsandtenders:collection', value: 'garbage' }], runs, capture);
    expect(rows.find(item => item.id === 'bc-bid')).toMatchObject({ at: '2026-11-12T23:50:00Z', scope: 'Selected notice details', known: true });
    expect(rows.find(item => item.id === 'canadabuys')?.at).toBe('2026-10-03T21:13:00Z');
    expect(rows.find(item => item.id === 'bidsandtenders')?.known).toBe(false);
    expect(rows.find(item => item.id === 'municipal-sites')).toMatchObject({ known: true, at: null });
    expect(lastCollectionText({ known: true, at: null, scope: null })).toBe('Not recorded');
    expect(lastCollectionText({ known: false, at: null, scope: null })).toBe('Unknown');
  });
});

describe('notice files and settings links', () => {
  it('lists missing files first with their reasons', () => {
    const rows = noticeFileRows([{ url: 'a', name: 'A' }, { url: 'b', name: 'B' }, { url: 'c', name: 'C' }], [{ url: 'a', status: 'downloaded' }, { url: 'c', status: 'failed', error: 'Document exceeds the 150 MiB limit.' }]);
    expect(rows.map(item => [item.name, item.state])).toEqual([['C', 'failed'], ['B', 'never'], ['A', 'saved']]);
    expect(rows[0].reason).toMatch(/larger than Zoer saves/);
  });
  it('opens Zoer’s Settings at a section, over the current plugin page', () => {
    expect(hostSettingsHref('browsers', '/sources')).toBe(`${window.location.origin}/#/plugins/bc-bid-monitor/sources?hostSettings=browsers`);
    expect(hostSettingsHref('schedules', '/documents?tab=history')).toMatch(/#\/plugins\/bc-bid-monitor\/documents\?tab=history&hostSettings=schedules$/);
  });
});
