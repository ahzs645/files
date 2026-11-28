import { describe, expect, it, vi } from 'vitest';

vi.mock('../zoer/dashboard/procurement/display', () => ({ sourceName: (id: string) => id, sql: async () => [] }));
const { sourceSummary, SOURCE_SUMMARY_KEYS } = await import('../zoer/dashboard/procurement/source-summary');
const { when } = await import('../zoer/dashboard/format');

const NOW = Date.parse('2026-11-27T22:00:00Z');
const run = (extra: Record<string, unknown>) => ({ runId: 'r1', actionId: 'scrape.full', status: 'succeeded', createdAt: '2026-11-26T14:00:00Z', finishedAt: '2026-11-26T14:39:00Z', input: {}, ...extra });

describe('one source summary for Operations › Overview and Operations › Sources', () => {
  it('reads every BC Bid checkpoint, so a browser check on current opportunities is "Needs attention" on both pages', () => {
    expect(SOURCE_SUMMARY_KEYS).toEqual(expect.arrayContaining(['checkpoint:full', 'checkpoint:awards', 'checkpoint:awards:recent']));
    const entries = [{ key: 'checkpoint:full', value: { error: 'BC Bid asked for a browser check', phase: 'list' } }];
    const summary = sourceSummary('bc-bid', { entries, runs: [run({ actionId: 'scrape.awards' })] as any, schedules: [], now: NOW });
    expect(summary.status).toEqual({ tone: 'warn', text: 'Needs attention' });
    expect(summary.schedule).toMatchObject({ text: 'Not scheduled' });
  });

  it('dates a browser-sites collection by its newest site, with the older whole-run date as a note', () => {
    const state = { version: 1, status: 'incomplete', lastSuccessAt: '2026-11-18T21:59:00Z', error: { code: 'portals_skipped' },
      attempt: { startedAt: '2026-11-26T08:00:00Z', portals: ['a', 'b'] },
      portals: { a: { status: 'complete', lastSuccessAt: '2026-11-26T08:23:00Z', attemptStartedAt: '2026-11-26T08:00:00Z' }, b: { status: 'not-run', error: { code: 'outside_hours' }, attemptStartedAt: '2026-11-26T08:00:00Z' } } };
    const summary = sourceSummary('browser-sites', { entries: [{ key: 'procurement:source:browser-sites:collection', value: state }], schedules: [], now: NOW });
    expect(summary.last.text).toBe(when('2026-11-26T08:23:00Z', NOW));
    expect(summary.last.note).toContain(`all 2 last ${when('2026-11-18T21:59:00Z', NOW)}`);
  });

  it('says Loading or Unknown while reads are pending or failed, never "Not collected"', () => {
    expect(sourceSummary('canadabuys', { entries: undefined, now: NOW })).toMatchObject({ status: { text: 'Loading…' }, last: { text: 'Loading…' }, schedule: 'Loading…' });
    expect(sourceSummary('bidsandtenders', { entries: undefined, entriesError: true, schedulesError: true, now: NOW })).toMatchObject({ status: { text: 'Unknown' }, last: { text: 'Unknown' }, schedule: 'Unknown' });
  });
});
