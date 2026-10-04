import { describe, expect, it } from 'vitest';
import { BIDSANDTENDERS_PORTALS } from '../zoer/dashboard/procurement/portals';
import { PORTAL_COUNT_SQL, connectorStatus, filterPortals, portalRows, portalSummary, portalSummaryText, readConnectorCollection } from '../zoer/dashboard/procurement/source-overview';
import { findSchedule, intervalText, parseInterval, scheduleState, stopReason, type ScheduleRow } from '../zoer/dashboard/procurement/schedule-state';

const now = Date.parse('2026-10-03T19:00:00Z');
const state = (portals: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({ version: 1, sourceId: 'bidsandtenders', status: 'incomplete', ownerRunId: 'run-1', leaseUntil: null, lastAttemptedAt: '2026-10-03T12:00:00Z', lastSuccessAt: '2026-10-02T12:00:00Z', error: null, portals, ...extra });

describe('connector collection state (CONNECTORS.md §4)', () => {
  it('treats a missing key as never collected and malformed state as unreadable, not as zero', () => {
    expect(readConnectorCollection(undefined, 'bidsandtenders')).toBeNull();
    expect(() => readConnectorCollection({ version: 2, status: 'complete' }, 'bidsandtenders')).toThrow(/not readable/);
    expect(() => readConnectorCollection({ version: 1, status: 'done' }, 'bidsandtenders')).toThrow(/not readable/);
    const parsed = readConnectorCollection(state({ nanaimo: { status: 'complete', retrievedAt: '2026-10-03T12:00:00Z', recordCount: 12, totalReported: 14 }, bogus: 'x' }), 'bidsandtenders')!;
    expect(parsed.portals.nanaimo).toMatchObject({ status: 'complete', recordCount: 12, totalReported: 14 });
    expect(parsed.portals.bogus).toBeUndefined();
  });
  it('reports source status honestly, including a lease that expired while "running"', () => {
    expect(connectorStatus(undefined)).toEqual({ tone: 'idle', text: 'Status unknown' });
    expect(connectorStatus(null)).toEqual({ tone: 'idle', text: 'Not collected yet' });
    const read = (extra: Record<string, unknown>) => readConnectorCollection(state({}, extra), 'bidsandtenders');
    expect(connectorStatus(read({ status: 'running', leaseUntil: '2026-10-03T20:00:00Z' }), now).text).toBe('Collecting');
    expect(connectorStatus(read({ status: 'running', leaseUntil: '2026-10-03T18:00:00Z' }), now)).toEqual({ tone: 'warn', text: 'Stopped unexpectedly' });
    expect(connectorStatus(read({ status: 'incomplete' }), now).text).toBe('Some portals failed');
    expect(connectorStatus(read({ status: 'complete' }), now).tone).toBe('good');
  });
});

describe('portal rows and summaries', () => {
  const parsed = readConnectorCollection(state({
    nanaimo: { status: 'complete', retrievedAt: '2026-10-03T12:00:00Z', recordCount: 12, totalReported: 14 },
    burnaby: { status: 'failed', retrievedAt: '2026-10-03T12:00:00Z', lastSuccessAt: '2026-09-30T12:00:00Z', error: { code: 'http_503', message: 'Portal returned 503' } },
    surrey: { status: 'failed', error: { code: 'token_missing' } },
    sidney: { status: 'not-run', lastSuccessAt: '2026-09-30T12:00:00Z', recordCount: 2 },
    vernon: { status: 'not-run' },
  }), 'bidsandtenders');
  const rows = portalRows(BIDSANDTENDERS_PORTALS, parsed, new Map([['nanaimo', 30]]));
  const row = (id: string) => rows.find(item => item.id === id)!;
  it('one row per portal, with counts that are never invented', () => {
    expect(rows).toHaveLength(BIDSANDTENDERS_PORTALS.length);
    expect(row('nanaimo')).toMatchObject({ status: 'complete', statusText: 'Collected', counts: '12 listed · portal reports 14', saved: 30, problem: false, lastSuccessAt: '2026-10-03T12:00:00Z' });
    expect(row('burnaby')).toMatchObject({ status: 'failed', problem: true, counts: 'Last attempt failed', error: 'http_503: Portal returned 503', lastSuccessAt: '2026-09-30T12:00:00Z' });
    expect(row('surrey')).toMatchObject({ counts: 'Never collected', error: 'token_missing' });
    // Skipped by a single-portal run, but collected before: not a problem.
    expect(row('sidney')).toMatchObject({ statusText: 'Not in last run', problem: false, counts: '2 listed' });
    expect(row('vernon')).toMatchObject({ statusText: 'Not collected yet', problem: true });
    expect(row('abbotsford')).toMatchObject({ statusText: 'Not collected yet', problem: true, saved: 0 });
    expect(row('comoxvalleyrd').place).toBe('Comox Valley RD');
    expect(row('nanaimo').place).toBe('Nanaimo');
  });
  it('unknown state stays unknown; unknown saved counts stay null', () => {
    const unknown = portalRows(BIDSANDTENDERS_PORTALS, undefined);
    expect(unknown.every(item => item.status === 'unknown' && item.counts === 'Unknown' && item.saved === null && !item.problem)).toBe(true);
    expect(portalSummaryText(unknown)).toBe(`${BIDSANDTENDERS_PORTALS.length} portals · status unknown`);
  });
  it('summarizes and filters to problems', () => {
    const total = BIDSANDTENDERS_PORTALS.length;
    expect(portalSummary(rows)).toMatchObject({ total, complete: 1, failed: 2, notRun: total - 3 });
    expect(portalSummaryText(rows)).toBe(`1 of ${total} portals collected in the last run · 2 failed · ${total - 4} not collected yet`);
    expect(filterPortals(rows, '', true).map(item => item.id)).not.toContain('sidney');
    expect(filterPortals(rows, '', true)).toHaveLength(total - 2);
    expect(filterPortals(rows, 'metro vancouver', false).map(item => item.id)).toEqual(expect.arrayContaining(['burnaby', 'coquitlam', 'metrovancouver']));
    expect(filterPortals(rows, 'burnaby', true).map(item => item.id)).toEqual(['burnaby']);
    expect(filterPortals(rows, 'okanagan', false).map(item => item.id).sort()).toEqual(['lakecountry', 'rdco', 'vernon', 'westkelowna']);
  });
  it('saved counts per portal use only reader-allowed SQL', () => {
    const functions = [...PORTAL_COUNT_SQL.matchAll(/([a-z_][a-z0-9_]*)\s*\(/gi)].map(m => m[1]!.toLowerCase());
    expect(functions.every(name => ['count', 'json_extract'].includes(name))).toBe(true);
    expect(PORTAL_COUNT_SQL.match(/\?/g)).toHaveLength(1);
  });
});

describe('schedules', () => {
  const row = (extra: Partial<ScheduleRow>): ScheduleRow => ({ actionId: 'procurement.collect', enabled: true, intervalHours: 24, nextRunAt: '2026-10-04T06:00:00Z', body: { input: { sourceId: 'canadabuys' } }, ...extra });
  it('describes intervals and accepts only whole hours 1–720', () => {
    expect([1, 6, 24, 48, 168, 336, 720].map(intervalText)).toEqual(['Every hour', 'Every 6 hours', 'Every day', 'Every 2 days', 'Every week', 'Every 2 weeks', 'Every 30 days']);
    expect(['12', ' 6 ', '0', '721', '1.5', '-3', 'abc', ''].map(parseInterval)).toEqual([12, 6, null, null, null, null, null, null]);
  });
  it('tells a paused schedule from one Zoer stopped, and says why in plain words', () => {
    expect(scheduleState(undefined).status).toBe('Not scheduled');
    expect(scheduleState(row({}), now)).toMatchObject({ tone: 'good', status: 'On · every day' });
    expect(scheduleState(row({}), now).next).toMatch(/^Next run /);
    expect(scheduleState(row({ nextRunAt: '2026-10-03T18:00:00Z' }), now).next).toMatch(/^Due now; starts when no other run/);
    expect(scheduleState(row({ lastStatus: 'pending' }), now)).toMatchObject({ tone: 'busy', next: 'Running now', last: 'Last scheduled run is running' });
    expect(scheduleState(row({ enabled: false, intervalHours: 12 }), now)).toMatchObject({ tone: 'idle', status: 'Paused · was every 12 hours', stopped: null });
    const stopped = scheduleState(row({ enabled: false, lastStatus: 'failed', error: 'CanadaBuys returned HTTP 503.' }), now);
    expect(stopped).toMatchObject({ tone: 'warn', status: 'Stopped by Zoer', error: 'CanadaBuys returned HTTP 503.', last: 'Last scheduled run failed' });
    expect(stopped.stopped).toMatch(/did not succeed/);
    expect(stopReason('Plugin or settings changed. Review and save this schedule again.')).toMatch(/plugin was updated/);
    expect(stopReason('Scheduled batch has failed records. Review its batch history.')).toMatch(/failed items/);
    expect(stopReason('Restored from backup. Choose destination connections and review before enabling.')).toMatch(/backup/);
  });
  it('finds the action’s own schedule, not one bound to a preset', () => {
    const rows = [row({ presetId: 'pr_' + 'a'.repeat(32) }), row({}), row({ actionId: 'procurement.alerts', body: { input: {} } })];
    expect(findSchedule(rows, 'procurement.collect')).toBe(rows[1]);
    expect(findSchedule(rows, 'procurement.alerts')).toBe(rows[2]);
    expect(stopReason('Preset changed or removed. Review this schedule.')).toMatch(/saved collection it runs was changed or removed/);
  });
});

describe('bids&tenders collector additions (CONNECTORS.md changes)', () => {
  it('reads partly collected portals and the time-budget stop', () => {
    const parsed = readConnectorCollection(state({ richmond: { status: 'incomplete', retrievedAt: '2026-10-03T12:00:00Z', recordCount: 40, totalReported: 43, error: { code: 'records_excluded', message: '3 notices over 250 kB' } } }, { error: { code: 'time_budget', message: '1 of 25 portal(s).' } }), 'bidsandtenders');
    const row = portalRows(BIDSANDTENDERS_PORTALS, parsed).find(item => item.id === 'richmond')!;
    expect(row).toMatchObject({ status: 'incomplete', statusText: 'Partly collected', problem: true, counts: '40 listed · portal reports 43', lastSuccessAt: '2026-10-03T12:00:00Z', error: 'records_excluded: 3 notices over 250 kB' });
    expect(connectorStatus(parsed, now).text).toBe('Stopped at the time limit; next run continues');
    expect(portalSummaryText(portalRows(BIDSANDTENDERS_PORTALS, parsed))).toMatch(/^1 of 25 portals collected in the last run · 1 partly · 24 not collected yet$/);
  });
});
