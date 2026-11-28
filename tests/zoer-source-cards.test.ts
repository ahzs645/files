import { describe, expect, it } from 'vitest';
import { BIDSANDTENDERS_PORTALS } from '../zoer/dashboard/procurement/portals';
import { lastCollected, portalRows, readConnectorCollection } from '../zoer/dashboard/procurement/source-overview';
import { browserSiteRows, nextVisitWindow } from '../zoer/dashboard/procurement/browser-source-overview';
import { sourceErrorText } from '../zoer/dashboard/procurement/source-errors';
import {
  browserTableRows, canadaBuysReceipt, checkpointStatus, checkpointText, collectionErrorText, connectorTableRows, lastCollectedSlot, operationsLine, portalDisclosure, scheduleSlot,
} from '../zoer/dashboard/procurement/source-cards';
import { collectionRunRow, emptyRunsText, runWord } from '../zoer/dashboard/procurement/collection-run-rows';
import type { ScheduleRow } from '../zoer/dashboard/procurement/schedule-state';
import type { RecentRun } from '../zoer/dashboard/procurement/source-schedules';
import { when } from '../zoer/dashboard/format';

const now = Date.parse('2026-11-27T20:00:00Z');
const row = (extra: Partial<ScheduleRow>): ScheduleRow => ({ actionId: 'procurement.collect', enabled: true, intervalHours: 24, ...extra });

describe('source card: next run slot (schedule vocabulary)', () => {
  it('says "Needs review" with the real reason when Zoer turned the schedule off', () => {
    const slot = scheduleSlot(row({ enabled: false, error: 'The scheduled action, permissions or settings changed.' }), now);
    expect(slot).toMatchObject({ text: 'Needs review', tone: 'warn', badge: true, reason: 'A plugin update changed what this schedule is approved to run, so Zoer turned it off.' });
    expect(slot.detail).toContain('Zoer’s message: The scheduled action, permissions or settings changed.');
  });
  it('says "Off" when the person turned it off, and never "Paused"', () => {
    expect(scheduleSlot(row({ enabled: false }), now)).toMatchObject({ text: 'Off', badge: false, reason: null });
    expect(scheduleSlot(row({ enabled: false, state: 'off', error: 'x' }), now).text).toBe('Off');
  });
  it('says "On · next run …" with the shared timestamp, and states running, due and unscheduled plainly', () => {
    const next = '2026-11-28T09:00:00.000Z';
    expect(scheduleSlot(row({ nextRunAt: next }), now).text).toBe(`On · next run ${when(next, now)}`);
    expect(scheduleSlot(row({ nextRunAt: '2026-11-27T19:00:00Z' }), now).text).toBe('On · due now');
    expect(scheduleSlot(row({ lastStatus: 'pending', nextRunAt: next }), now).text).toBe('On · running now');
    expect(scheduleSlot(row({}), now).text).toBe('On · next run not recorded');
    expect(scheduleSlot(undefined, now)).toMatchObject({ text: 'Not scheduled', badge: false });
    expect(scheduleSlot(row({ nextRunAt: next }), now).text).not.toMatch(/\d{4}-\d{2}-\d{2}T/);
  });
});

describe('source card: last collected', () => {
  const state = (portals: Record<string, unknown>, extra: Record<string, unknown> = {}) => readConnectorCollection({ version: 1, sourceId: 'browser-sites', status: 'incomplete', ownerRunId: 'run-9',
    lastSuccessAt: '2026-11-18T21:59:00Z', attempt: { startedAt: '2026-11-26T08:22:14Z', portals: Object.keys(portals), open: false }, portals, ...extra }, 'browser-sites');
  it('uses the newest site success and explains an older whole-source date (Nov 26 sites, Nov 18 card)', () => {
    const parsed = state({
      civicinfo: { status: 'complete', attemptStartedAt: '2026-11-26T08:22:14Z', retrievedAt: '2026-11-26T08:22:30Z', lastSuccessAt: '2026-11-26T08:22:30Z', recordCount: 16 },
      kelowna: { status: 'complete', attemptStartedAt: '2026-11-26T08:22:14Z', retrievedAt: '2026-11-26T08:22:50Z', lastSuccessAt: '2026-11-26T08:22:50Z', recordCount: 10 },
      bcferries: { status: 'not-run', attemptStartedAt: '2026-11-26T08:22:14Z', error: { code: 'outside_visit_window', message: 'x' } },
    });
    expect(lastCollected(parsed)).toMatchObject({ at: '2026-11-26T08:22:50Z', collected: 2, total: 3, allAt: '2026-11-18T21:59:00Z' });
    const slot = lastCollectedSlot(parsed, 'site', now);
    expect(slot.text).toBe(when('2026-11-26T08:22:50Z', now));
    expect(slot.note).toBe(`2 of 3 sites in the last run; all 3 last ${when('2026-11-18T21:59:00Z', now)}`);
  });
  it('adds no note when every portal was collected, and never shows unknown as never', () => {
    const parsed = state({ a: { status: 'complete', attemptStartedAt: '2026-11-26T08:22:14Z', lastSuccessAt: '2026-11-26T08:23:00Z' } }, { status: 'complete', lastSuccessAt: '2026-11-26T08:23:05Z' });
    expect(lastCollectedSlot(parsed, 'portal', now)).toEqual({ text: when('2026-11-26T08:23:05Z', now), note: null });
    expect(lastCollectedSlot(undefined, 'portal', now).text).toBe('Unknown');
    expect(lastCollectedSlot(null, 'portal', now).text).toBe('Never');
  });
});

describe('portal tables: collapsed unless a portal has a problem', () => {
  const read = (portals: Record<string, unknown>) => readConnectorCollection({ version: 1, sourceId: 'bidsandtenders', status: 'complete', portals }, 'bidsandtenders');
  const all = Object.fromEntries(BIDSANDTENDERS_PORTALS.map(portal => [portal.id, { status: 'complete', retrievedAt: '2026-11-26T08:30:00Z', recordCount: 1 }]));
  it('is collapsed behind "33 portals · 0 problems" when all is well', () => {
    const rows = connectorTableRows(portalRows(BIDSANDTENDERS_PORTALS, read(all)), now);
    expect(portalDisclosure(rows, 'portal')).toEqual({ summary: '33 portals · 0 problems', open: false, problems: 0 });
  });
  it('opens by itself when one portal failed, and names the count', () => {
    const rows = connectorTableRows(portalRows(BIDSANDTENDERS_PORTALS, read({ ...all, burnaby: { status: 'failed', error: { code: 'source_http_error', message: 'HTTP 503' } } })), now);
    expect(portalDisclosure(rows, 'portal')).toEqual({ summary: '33 portals · 1 problem', open: true, problems: 1 });
  });
  it('does not claim "0 problems" while the state is unknown', () => {
    const rows = connectorTableRows(portalRows(BIDSANDTENDERS_PORTALS, undefined), now);
    expect(portalDisclosure(rows, 'portal', false)).toEqual({ summary: '33 portals · status unknown', open: false, problems: 0 });
  });
  it('browser sites: a site waiting for a check is a problem; one outside its visiting hours is not', () => {
    const parsed = readConnectorCollection({ version: 1, sourceId: 'browser-sites', status: 'incomplete', portals: {
      chilliwack: { status: 'waiting', error: { code: 'browser_check', message: 'check' } },
      bcferries: { status: 'not-run', error: { code: 'outside_visit_window', message: 'BC Ferries asks automated visitors to come between 09:00–12:00 UTC (its robots.txt Visit-time). Nothing was loaded; collect it again inside that window. The next window opens 2026-11-26T09:00:00.000Z. https://www.bcferries.com/our-company/procurement' } },
    } }, 'browser-sites');
    const rows = browserTableRows(browserSiteRows(parsed, undefined, now), now);
    expect(rows.find(item => item.id === 'chilliwack')!.problem).toBe(true);
    const ferries = rows.find(item => item.id === 'bcferries')!;
    expect(ferries.problem).toBe(false);
    expect(ferries.message).not.toMatch(/\d{4}-\d{2}-\d{2}T|https?:/);
    expect(ferries.message).toContain(`next window opens ${when(nextVisitWindow('0900-1200', now), now)}`);
    expect(portalDisclosure(rows, 'site')).toMatchObject({ summary: '7 sites · 1 problem', open: true });
  });
  it('computes the next visiting window from the site, not the saved hint', () => {
    expect(nextVisitWindow('0900-1200', Date.parse('2026-11-27T08:00:00Z'))!.toISOString()).toBe('2026-11-27T09:00:00.000Z');
    expect(nextVisitWindow('0900-1200', Date.parse('2026-11-27T20:00:00Z'))!.toISOString()).toBe('2026-11-28T09:00:00.000Z');
    expect(sourceErrorText({ code: 'outside_visit_window', message: 'BC Ferries asks automated visitors to come between 09:00–12:00 UTC. The next window opens 2026-11-26T09:00:00.000Z. https://x' })!.text).not.toMatch(/\d{4}-\d{2}-\d{2}T|https?:/);
  });
});

describe('BC Bid and CanadaBuys details in plain words', () => {
  it('never shows scope ids, sentinel dates or "unrecorded time"', () => {
    expect(checkpointText({ label: 'Award history', range: '1900-01-01 to 2026-11-26', checkpointTime: 'Not recorded' }, now)).toBe('Award history · all dates to Nov 26, 2026');
    expect(checkpointText({ label: 'Recent awards', range: '2026-08-15 to 2026-09-14', checkpointTime: 'Not recorded' }, now)).toBe('Recent awards · Aug 15, 2026 to Sep 14, 2026');
    expect(checkpointText({ label: 'Current opportunities', range: '', checkpointTime: '2026-11-26T08:39:00Z' }, now)).toBe(`Current opportunities · saved ${when('2026-11-26T08:39:00Z', now)}`);
    expect(checkpointStatus('Completed recorded scope')).toEqual({ text: 'Done', tone: 'good' });
    expect(checkpointStatus('Needs attention · incomplete').text).toBe('Needs attention');
  });
  it('names the collection browser for a scrape browser check', () => {
    expect(collectionErrorText('Manual browser verification required.')).toMatch(/collection browser/);
    expect(collectionErrorText('Manual browser verification required.')).not.toMatch(/download browser/);
  });
  it('labels the CanadaBuys receipt for people', () => {
    const rows = canadaBuysReceipt({ retrievedAt: '2026-11-26T08:22:20Z', importedAt: '2026-11-26T08:22:40Z', totalSourceRecords: 1200, totalRecords: 914, excludedCount: 0, byteCount: 3_500_000, sha256: 'ab'.repeat(32) }, now);
    expect(rows.map(([name]) => name)).toEqual(['Downloaded', 'Imported', 'Rows in file', 'Opportunities read', 'Excluded', 'File size']);
    expect(rows.find(([name]) => name === 'Rows in file')![1]).toBe('1,200');
    expect(rows.find(([name]) => name === 'File size')![1]).toBe('3.3 MiB');
    expect(JSON.stringify(rows)).not.toMatch(/sha256|retrievedAt|null/);
  });
});

describe('the page’s one operations line', () => {
  it('counts schedules needing review, missing files and failed downloads, linking failures to Files', () => {
    const rows = [...Array.from({ length: 11 }, () => row({ enabled: false, error: 'x' })), row({}), row({})];
    expect(operationsLine({ schedules: rows, missingFiles: 988, failedFiles: 1092 })).toEqual([
      { text: '11 of 13 schedules need review' }, { text: '988 files missing on open BC Bid opportunities' }, { text: '1,092 failed downloads', to: '/files?fileStatus=failed' },
    ]);
    expect(operationsLine({ schedules: [row({ enabled: false, error: 'x' }), row({})] })[0].text).toBe('1 of 2 schedules needs review');
    expect(operationsLine({ schedules: [row({})], missingFiles: 0, failedFiles: 0 })).toEqual([]);
  });
});

describe('collection run rows (shared run words, what each run collected)', () => {
  const run = (extra: Partial<RecentRun>): RecentRun => ({ runId: 'r1', actionId: 'procurement.collect', status: 'succeeded', createdAt: '2026-11-26T08:23:12Z', finishedAt: '2026-11-26T08:38:09Z', input: { sourceId: 'bidsandtenders' }, ...extra });
  const owned = (runId: string, failed = 0) => readConnectorCollection({ version: 1, sourceId: 'bidsandtenders', status: 'complete', ownerRunId: runId, attempt: { startedAt: '2026-11-26T08:23:13Z', portals: BIDSANDTENDERS_PORTALS.map(portal => portal.id) },
    portals: Object.fromEntries(BIDSANDTENDERS_PORTALS.map((portal, i) => [portal.id, i < failed ? { status: 'failed', attemptStartedAt: '2026-11-26T08:23:13Z' } : { status: 'complete', attemptStartedAt: '2026-11-26T08:23:13Z', recordCount: 10 }])) }, 'bidsandtenders');
  it('says Done, portals done of total and opportunities saved for the newest run of a source', () => {
    const line = collectionRunRow(run({}), { state: owned('r1') }, now);
    expect(line).toMatchObject({ title: 'bids&tenders (BC)', word: 'Done', tone: 'good', parts: ['33 of 33 portals', '330 opportunities saved'] });
    expect(line.details[0]).toBe(`Started ${when('2026-11-26T08:23:12Z', now)} · finished ${when('2026-11-26T08:38:09Z', now)} (15 min)`);
  });
  it('says Partly failed when portals of its attempt failed', () => {
    expect(collectionRunRow(run({}), { state: owned('r1', 2) }, now)).toMatchObject({ word: 'Partly failed', parts: ['31 of 33 portals', '310 opportunities saved'] });
  });
  it('an older run shows what it was asked to collect, never a guessed count', () => {
    const line = collectionRunRow(run({ runId: 'old' }), { state: owned('r1') }, now);
    expect(line.parts).toEqual(['33 portals']);
    expect(line.details).toContain('Counts are kept for the newest run of each source only.');
  });
  it('uses Stopped, Interrupted, Failed and Waiting for you, never Finished, Cancelled or Outcome unknown', () => {
    expect(runWord(run({ status: 'cancelled' }), now).word).toBe('Stopped');
    expect(runWord(run({ status: 'outcome_unknown' }), now).word).toBe('Interrupted');
    expect(runWord(run({ status: 'failed' }), now).word).toBe('Failed');
    expect(runWord(run({ status: 'running', finishedAt: undefined, resumable: { state: 'needs-user' } }), now)).toMatchObject({ word: 'Waiting for you', canResume: true });
    expect(runWord(run({ status: 'running', finishedAt: undefined, resumable: { state: 'paused' } }), now)).toMatchObject({ word: 'Interrupted', canResume: true, canCancel: true });
    expect(runWord(run({ status: 'pending', finishedAt: undefined }), now).word).toBe('Queued');
    const live = collectionRunRow(run({ status: 'running', finishedAt: undefined, resumable: { state: 'running', progress: { phase: 'bids&tenders (BC): City of Burnaby', done: 5, total: 33, unit: 'items' } } }), {}, now);
    expect(live).toMatchObject({ word: 'Running', parts: ['5 of 33 portals'], canPause: true });
  });
  it('takes no counts from state another run wrote, and none for CanadaBuys', () => {
    expect(collectionRunRow(run({ runId: 'r2' }), { state: owned('r1') }, now).parts).toEqual(['33 portals']);
    expect(collectionRunRow(run({ runId: 'c1', input: { sourceId: 'canadabuys' } }), {}, now).parts).toEqual([]);
  });
  it('never says no collection has run when a source reports a collection', () => {
    expect(emptyRunsText('2026-11-26T08:42:00Z', now)).toBe(`No recent runs in Zoer’s run list; last collection ${when('2026-11-26T08:42:00Z', now)}.`);
    expect(emptyRunsText(null, now)).toBe('No collection run in Zoer’s run list yet.');
  });
});
