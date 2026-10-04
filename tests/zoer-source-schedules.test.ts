import { describe, expect, it } from 'vitest';
import { BIDSANDTENDERS_PORTALS } from '../zoer/dashboard/procurement/portals';
import { connectorStatus, portalRows, portalSummaryText, readConnectorCollection } from '../zoer/dashboard/procurement/source-overview';
import { sourceErrorText } from '../zoer/dashboard/procurement/source-errors';
import { browserSiteRows, browserSummaryText } from '../zoer/dashboard/procurement/browser-source-overview';
import type { ScheduleRow } from '../zoer/dashboard/procurement/schedule-state';
import {
  COLLECT_ACTION, ensureSourcePreset, legacyAllSchedule, liveRunFor, migrateAllSchedule, reenableStopped, reenableable, runRetryPreset, runState,
  saveSourceSchedule, sourceSchedule, type Preset, type RecentRun,
} from '../zoer/dashboard/procurement/source-schedules';
import { BUNDLE_MAX_BYTES, bundleEntries, downloadDocumentBundle, safeSegment } from '../zoer/dashboard/document-bundle';

/** Presets, schedules and actions as Zoer's bridge keeps them (S6), recording every call. */
function fakeHost() {
  const presets: Preset[] = [], calls: Array<[string, any]> = [];
  let next = 0;
  const host = async (method: string, input: any = {}): Promise<any> => {
    calls.push([method, structuredClone(input)]);
    if (method === 'presets.list') return { presets: presets.filter(preset => !input.actionId || preset.actionId === input.actionId) };
    if (method === 'presets.save') {
      if (input.id) { const preset = presets.find(item => item.id === input.id)!; Object.assign(preset, input); return { preset }; }
      const preset = { id: `pr_${String(++next).padStart(32, '0')}`, ...input };
      presets.push(preset); return { preset };
    }
    if (method === 'schedules.save' || method === 'action') return { ok: true };
    throw new Error('Unexpected ' + method);
  };
  return { host, presets, calls, saves: () => calls.filter(([method]) => method === 'schedules.save').map(([, input]) => input) };
}
const row = (value: Partial<ScheduleRow>): ScheduleRow => ({ actionId: COLLECT_ACTION, enabled: true, intervalHours: 24, ...value });
const UPDATED = 'Plugin or settings changed. Review and save this schedule again.';
const LABELS = { canadabuys: 'CanadaBuys', bidsandtenders: 'bids&tenders', 'municipal-sites': 'BC local government websites' };

describe('one schedule per source on presets (S6)', () => {
  it('creates a source preset once and schedules it by presetId', async () => {
    const zoer = fakeHost();
    const first = await ensureSourcePreset(zoer.host, 'bidsandtenders', 'bids&tenders');
    expect(first).toMatchObject({ actionId: COLLECT_ACTION, name: 'Collect bids&tenders', input: { sourceId: 'bidsandtenders' }, externalRef: 'source:bidsandtenders' });
    expect((await ensureSourcePreset(zoer.host, 'bidsandtenders', 'bids&tenders')).id).toBe(first.id);
    await saveSourceSchedule(zoer.host, 'bidsandtenders', 'bids&tenders', true, 12);
    expect(zoer.saves()).toEqual([{ actionId: COLLECT_ACTION, presetId: first.id, enabled: true, intervalHours: 12 }]);
    expect(zoer.presets).toHaveLength(1);
    const rows = [row({ presetId: first.id, intervalHours: 12 })];
    expect(sourceSchedule(rows, zoer.presets, 'bidsandtenders')).toBe(rows[0]);
    expect(sourceSchedule(rows, zoer.presets, 'canadabuys')).toBeUndefined();
    // CanadaBuys' preset imports the whole daily file (no maxBatches).
    expect((await ensureSourcePreset(zoer.host, 'canadabuys', 'CanadaBuys')).input).toEqual({ sourceId: 'canadabuys' });
  });

  it('replaces the 0.33 "all sources" schedule with one per source at the same interval, and turns the old one off', async () => {
    const zoer = fakeHost(), legacy = row({ intervalHours: 6, body: { input: { sourceId: 'all' } } });
    expect(legacyAllSchedule([row({ presetId: 'pr_' + '1'.repeat(32) }), legacy])).toBe(legacy);
    await migrateAllSchedule(zoer.host, legacy, LABELS);
    expect(zoer.presets.map(preset => preset.externalRef)).toEqual(['source:canadabuys', 'source:bidsandtenders', 'source:municipal-sites']);
    expect(zoer.saves()).toEqual([
      ...zoer.presets.map(preset => ({ actionId: COLLECT_ACTION, presetId: preset.id, enabled: true, intervalHours: 6 })),
      { actionId: COLLECT_ACTION, input: { sourceId: 'all' }, enabled: false, intervalHours: 6 },
    ]);
    // Already off (the upgrade turned it off): nothing to turn off.
    const off = fakeHost();
    await migrateAllSchedule(off.host, { ...legacy, enabled: false, error: UPDATED }, LABELS);
    expect(off.saves()).toHaveLength(3);
  });

  it('turns schedules stopped by the update on again, except the legacy "all" row and browser schedules', async () => {
    const zoer = fakeHost(), preset = 'pr_' + '2'.repeat(32);
    const rows = [
      row({ presetId: preset, enabled: false, error: UPDATED, intervalHours: 12 }),
      row({ actionId: 'procurement.alerts', enabled: false, error: UPDATED, body: { input: {} } }),
      row({ enabled: false, error: UPDATED, body: { input: { sourceId: 'all' } } }),
      row({ actionId: 'scrape.full', enabled: false, error: UPDATED }),
      row({ presetId: 'pr_' + '3'.repeat(32), enabled: false }),
    ];
    expect(reenableable(rows)).toEqual([rows[0], rows[1]]);
    expect(await reenableStopped(zoer.host, rows)).toBe(2);
    expect(zoer.saves()).toEqual([
      { actionId: COLLECT_ACTION, presetId: preset, enabled: true, intervalHours: 12 },
      { actionId: 'procurement.alerts', input: {}, enabled: true, intervalHours: 24 },
    ]);
  });

  it('"Retry problem portals" is a preset with the portals, updated when they change and run by presetId', async () => {
    const zoer = fakeHost();
    await runRetryPreset(zoer.host, 'bidsandtenders', 'bids&tenders', ['nanaimo', 'burnaby']);
    await runRetryPreset(zoer.host, 'bidsandtenders', 'bids&tenders', ['nanaimo', 'burnaby']);
    await runRetryPreset(zoer.host, 'bidsandtenders', 'bids&tenders', ['surrey']);
    expect(zoer.presets).toEqual([expect.objectContaining({ name: 'Retry problem portals · bids&tenders', externalRef: 'retry:bidsandtenders', input: { sourceId: 'bidsandtenders', portals: ['surrey'] } })]);
    expect(zoer.calls.filter(([method]) => method === 'action').map(([, input]) => input)).toEqual(Array(3).fill({ actionId: COLLECT_ACTION, presetId: zoer.presets[0].id }));
    expect(zoer.calls.filter(([method, input]) => method === 'presets.save' && input.id)).toHaveLength(1);
  });
});

const run = (value: Partial<RecentRun>): RecentRun => ({ runId: 'r1', actionId: COLLECT_ACTION, status: 'running', createdAt: '2026-10-04T10:00:00Z', input: { sourceId: 'bidsandtenders' }, ...value });

describe('collection runs in plain words (runs.recent, S1)', () => {
  it('says what a resumable run is doing and what can be done about it', () => {
    expect(runState(run({ resumable: { state: 'running', progress: { phase: 'bids&tenders (BC): City of Burnaby', done: 3, total: 25 } } }))).toMatchObject({ text: 'Collecting · bids&tenders (BC): City of Burnaby · 3 of 25', tone: 'busy', canPause: true, canResume: false });
    expect(runState(run({ status: 'retry_scheduled', resumable: { state: 'waiting', nextStepAt: '2026-10-04T10:05:00Z', lastError: { code: 'source_rate_limited', message: 'Burnaby search returned HTTP 429.' } } }))).toMatchObject({ text: expect.stringMatching(/^Waiting to retry at /), canPause: true, detail: expect.stringContaining('HTTP 429') });
    expect(runState(run({ status: 'waiting_for_user', resumable: { state: 'paused' } }))).toMatchObject({ text: 'Paused', canResume: true, canPause: false });
    expect(runState(run({ status: 'waiting_for_user', resumable: { state: 'resume-needed' } }))).toMatchObject({ text: 'Resume needed', tone: 'warn', canResume: true });
    expect(runState(run({ resumable: { state: 'paused-for-update' } }))).toMatchObject({ text: 'Paused for a Zoer update', canResume: false });
    expect(runState(run({ status: 'succeeded' }))).toMatchObject({ text: 'Finished', canCancel: false });
    expect(runState(run({ status: 'failed', error: 'Every source failed' }))).toMatchObject({ text: 'Failed', detail: 'Every source failed' });
  });
  it('a live run of the source (or of all sources) decides the source status over its saved state', () => {
    const runs = [run({ status: 'succeeded', input: { sourceId: 'canadabuys' } }), run({ runId: 'r2', input: { sourceId: 'all' }, resumable: { state: 'paused' } })];
    expect(liveRunFor(runs, 'canadabuys')?.runId).toBe('r2');
    expect(liveRunFor(runs, 'browser-sites')).toBeUndefined();
    const stale = readConnectorCollection({ version: 1, status: 'running', leaseUntil: '2026-10-04T09:00:00Z', portals: {} }, 'bidsandtenders');
    expect(connectorStatus(stale, Date.parse('2026-10-04T10:00:00Z')).text).toBe('Stopped unexpectedly');
    expect(connectorStatus(stale, Date.parse('2026-10-04T10:00:00Z'), runs[1]).text).toBe('Paused');
  });
});

describe('robots.txt disallows collection: an honest state, not a failure (S4)', () => {
  it('shows a disallowed portal as such, not as a problem to retry', () => {
    const state = readConnectorCollection({ version: 1, sourceId: 'bidsandtenders', status: 'incomplete', portals: {
      nanaimo: { status: 'not-run', lastSuccessAt: '2026-10-01T10:00:00Z', recordCount: 7, error: { code: 'robots_disallowed', message: "City of Nanaimo's robots.txt does not allow automated collection of this page" } },
      burnaby: { status: 'complete', retrievedAt: '2026-10-04T10:00:00Z', recordCount: 9 },
    }, error: { code: 'robots_disallowed', message: '1 disallowed by robots.txt of 2 portal(s). Other portals were saved.' } }, 'bidsandtenders');
    const rows = portalRows(BIDSANDTENDERS_PORTALS.filter(portal => ['nanaimo', 'burnaby'].includes(portal.id)), state);
    expect(rows.find(item => item.id === 'nanaimo')).toMatchObject({ status: 'disallowed', statusText: 'robots.txt disallows collection', problem: false, counts: '7 listed earlier' });
    expect(rows.find(item => item.id === 'nanaimo')!.errorText).toMatch(/robots\.txt disallows collection/);
    expect(portalSummaryText(rows)).toBe('1 of 2 portals collected in the last run · 1 disallowed by robots.txt');
    expect(connectorStatus(state).text).toBe('Some portals disallow collection (robots.txt)');
    expect(sourceErrorText(state!.error)!.text).toBe('1 of 2 portals was not collected because its robots.txt disallows it. The other portals were saved; see the list below.');
  });
  it('browser sites: disallowed (0.34 not-run, or failed as older versions saved it) is its own status', () => {
    const state = readConnectorCollection({ version: 1, status: 'incomplete', portals: {
      civicinfo: { status: 'not-run', error: { code: 'robots_disallowed', message: 'x' } }, whistler: { status: 'failed', error: { code: 'robots_disallowed', message: 'y' } },
    } }, 'browser-sites');
    const rows = browserSiteRows(state);
    expect(rows.filter(item => item.status === 'disallowed').map(item => item.site.id)).toEqual(['civicinfo', 'whistler']);
    expect(browserSummaryText(rows)).toContain('2 disallowed by robots.txt');
  });
});

describe('Download all documents (zip export bundle, S2)', () => {
  it('names zip entries safely: a folder per notice, no slashes or hidden names, duplicates numbered', () => {
    expect(safeSegment('../../etc/passwd')).toBe('_.._etc_passwd');
    expect(safeSegment('.hidden')).toBe('hidden');
    expect(safeSegment('a\u0000b/c\\d')).toBe('a_b_c_d');
    expect(safeSegment('')).toBe('file');
    expect(safeSegment('x'.repeat(150) + '.pdf')).toHaveLength(100);
    expect(safeSegment('x'.repeat(150) + '.pdf').endsWith('.pdf')).toBe(true);
    const entries = bundleEntries([{ id: 'opportunity:bidsandtenders:nanaimo:1', sourceKey: 'bidsandtenders:nanaimo:1' }], [
      { id: 'd1', recordId: 'opportunity:bidsandtenders:nanaimo:1', name: 'Spec.pdf', bytes: 1 },
      { id: 'd2', recordId: 'opportunity:bidsandtenders:nanaimo:1', name: 'spec.pdf', bytes: 1 },
      { id: 'd3', recordId: 'opportunity:other', name: 'Addendum', bytes: 1 },
    ]);
    expect(entries).toEqual([
      { name: 'bidsandtenders:nanaimo:1/Spec.pdf', catalogFileId: 'd1' },
      { name: 'bidsandtenders:nanaimo:1/spec (2).pdf', catalogFileId: 'd2' },
      { name: 'other/Addendum', catalogFileId: 'd3' },
    ]);
  });

  function bundleHost(documents: any[], options: { failArchive?: boolean } = {}) {
    const calls: Array<[string, any]> = [];
    let files = 0;
    const host = async (method: string, input: any = {}): Promise<any> => {
      calls.push([method, input]);
      if (method === 'catalog.query') return { rows: input.statement.includes('FROM documents') ? documents : [{ id: 'opportunity:a', data: JSON.stringify({ sourceKey: 'a', description: 'Notice A' }) }, { id: 'opportunity:b', data: { sourceKey: 'b', description: 'Notice B' } }] };
      if (method === 'catalog.files.put') return { id: `tmp-${++files}` };
      if (method === 'archive.create') { if (options.failArchive) throw new Error('A file changed while it was read.'); return { target: { catalogFileId: 'zip-1' }, bytes: 4096, sha256: 'f'.repeat(64), entries: input.sources.length }; }
      if (method === 'catalog.download' || method === 'catalog.files.delete') return { ok: true };
      throw new Error('Unexpected ' + method);
    };
    return { host, calls };
  }

  it('zips the saved files with the notices as CSV and a manifest, downloads it and leaves nothing behind', async () => {
    const zoer = bundleHost([{ id: 'd1', recordId: 'opportunity:a', name: 'Spec.pdf', bytes: 1000 }]);
    const result = await downloadDocumentBundle(zoer.host, ['opportunity:a', 'opportunity:b'], { scope: 'ticked notices', now: new Date('2026-10-04T12:00:00Z') });
    expect(result).toEqual({ name: 'procurement-documents-2-notices-2026-10-04.zip', documents: 1, bytes: 4096, withoutFiles: 1 });
    const archive = zoer.calls.find(([method]) => method === 'archive.create')![1];
    expect(archive).toMatchObject({ format: 'zip', target: { catalog: { name: 'procurement-documents-2-notices-2026-10-04.zip' } } });
    expect(archive.sources).toEqual([{ name: 'opportunities.csv', catalogFileId: 'tmp-1' }, { name: 'opportunities.manifest.json', catalogFileId: 'tmp-2' }, { name: 'a/Spec.pdf', catalogFileId: 'd1' }]);
    const manifest = JSON.parse(await (zoer.calls.filter(([method]) => method === 'catalog.files.put')[1][1].file as Blob).text());
    expect(manifest).toMatchObject({ file: 'opportunities.csv', scope: 'ticked notices', rowsExported: 2, totalMatching: 2, truncated: false });
    expect(manifest.notes.join(' ')).toContain('1 notice has no saved documents');
    expect(zoer.calls.find(([method]) => method === 'catalog.download')![1]).toEqual({ id: 'zip-1', name: 'procurement-documents-2-notices-2026-10-04.zip' });
    expect(zoer.calls.filter(([method]) => method === 'catalog.files.delete').map(([, input]) => input.id)).toEqual(['tmp-1', 'tmp-2', 'zip-1']);
  });

  it('cleans up after a failed archive and refuses empty or oversized bundles before uploading anything', async () => {
    const failing = bundleHost([{ id: 'd1', recordId: 'opportunity:a', name: 'Spec.pdf', bytes: 10 }], { failArchive: true });
    await expect(downloadDocumentBundle(failing.host, ['opportunity:a'], { scope: 'one notice' })).rejects.toThrow('A file changed');
    expect(failing.calls.filter(([method]) => method === 'catalog.files.delete').map(([, input]) => input.id)).toEqual(['tmp-1', 'tmp-2']);
    const none = bundleHost([]);
    await expect(downloadDocumentBundle(none.host, ['opportunity:a'], { scope: 'one notice' })).rejects.toThrow(/has saved documents yet/);
    const big = bundleHost([{ id: 'd1', recordId: 'opportunity:a', name: 'Plans.zip', bytes: BUNDLE_MAX_BYTES + 1 }]);
    await expect(downloadDocumentBundle(big.host, ['opportunity:a'], { scope: 'one notice' })).rejects.toThrow(/Choose fewer notices/);
    for (const zoer of [none, big]) expect(zoer.calls.some(([method]) => method === 'catalog.files.put')).toBe(false);
  });
});
