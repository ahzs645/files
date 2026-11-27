// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Operations › Documents, Opportunities › Files and Operations › Runs: what each number and run state means.
const bridge = vi.hoisted(() => ({ host: vi.fn(async (_method: string, _input?: any): Promise<any> => ({})) }));
vi.mock('../zoer/dashboard/bridge', () => ({
  host: (method: string, input?: unknown) => bridge.host(method, input),
  subscribeHost: () => () => {}, guardHost: () => {}, bindNativeHost: () => () => {},
}));
vi.mock('../zoer/dashboard/backend', async original => ({
  ...await original<typeof import('../zoer/dashboard/backend')>(),
  useWorkspace: () => ({ model: undefined }), refresh: async () => {}, refreshAfterChange: async () => {},
}));
vi.mock('../zoer/dashboard/procurement/NoticeView', () => ({ NoticeView: () => null }));

import { DocumentFiles, DocumentStats } from '../zoer/dashboard/DocumentInventory';
import { downloadRunState, downloadRunTitle, downloadThroughput, durationText, aboutText, rateText, retryableRuns, runScopeKey, type RunFileStats } from '../zoer/dashboard/document-run';
import { BROWSER_CHECK_REASON, groupByReason, unsavedFailures, type FailedRow } from '../zoer/dashboard/document-processing';
import { failedFiles } from '../zoer/dashboard/procurement/source-health';
import { uniquePostings } from '../zoer/dashboard/RecordPicker';
import { groupVerificationRuns, verificationRuns, type VerificationTask } from '../zoer/dashboard/verification-runs';
import { missingParts, remainingFiles } from '../zoer/dashboard/BulkDocuments';
import { navigatePlugin } from '../zoer/dashboard/navigation';
import { act } from 'react';

const view = (node: React.ReactNode) => render(<QueryClientProvider client={new QueryClient()}>{node}</QueryClientProvider>);
const GUID = 'fa3876c0-1111-2222-3333-444455556666';
const bcbid = (order: 'ab' | 'ba') => `https://bcbid.gov.bc.ca/page.aspx/en/fil/download_public/${GUID}?${order === 'ab' ? 'a=1&b=2' : 'b=2&a=1'}`;
const CHECK = 'Manual browser verification required.', STALL = 'Document download did not start. The attachment page is open in the saved browser.';
/** One file saved under another spelling of its link, one held by a browser check, two stalled, and one stalled twice. */
const ROWS: FailedRow[] = [
  { id: 'saved', recordId: 'opportunity:1', url: bcbid('ab'), status: 'downloaded', updatedAt: '2026-11-27T10:00:00Z', name: 'Map.zip' },
  { id: 'saved-elsewhere', recordId: 'opportunity:1', url: bcbid('ba'), status: 'failed', error: STALL, updatedAt: '2026-11-27T09:00:00Z', name: 'Map.zip' },
  { id: 'check', recordId: 'opportunity:1', url: 'https://example.org/a.pdf', status: 'failed', error: CHECK, updatedAt: '2026-11-27T11:00:00Z', name: 'A.pdf' },
  { id: 'stall-1', recordId: 'opportunity:2', url: 'https://example.org/b.pdf', status: 'failed', error: STALL, updatedAt: '2026-11-27T08:00:00Z', name: 'B.pdf' },
  { id: 'stall-2', recordId: 'opportunity:2', url: 'https://example.org/c.pdf?y=2&x=1', status: 'failed', error: STALL, updatedAt: '2026-11-27T08:00:00Z', name: 'C.pdf' },
  { id: 'stall-2-again', recordId: 'opportunity:2', url: 'https://example.org/c.pdf?x=1&y=2', status: 'failed', error: STALL, updatedAt: '2026-11-27T12:00:00Z', name: 'C.pdf' },
];

beforeEach(() => { bridge.host.mockReset(); bridge.host.mockImplementation(async () => ({})); });
afterEach(cleanup);

describe('stat tiles', () => {
  it('"Download failed" counts files still not saved (the failure queue), not failed rows', () => {
    const files = unsavedFailures(ROWS);
    expect(files.map(row => row.id).sort()).toEqual(['check', 'stall-1', 'stall-2-again']);
    // The same population as the failure queue on Sources.
    expect(failedFiles(ROWS.map(row => ({ ...row, updatedAt: row.updatedAt ?? null })))).toHaveLength(files.length);
    expect(ROWS.filter(row => row.status === 'failed')).toHaveLength(5);
  });
  it('every tile names what it counts and where it links, and the failed tile shows files', async () => {
    bridge.host.mockImplementation(async (method: string, input?: any) => method !== 'catalog.query' ? {}
      : String(input.statement).includes('sum(status=') ? { rows: [{ files: 7204, downloaded: 6030, failed: 1174, readable: 5620, pending: 164, extractFailed: 37, unreadable: 209, bytes: 8_912_896_000 }] }
      : String(input.statement).includes("WHERE d.record_id IN (SELECT record_id FROM documents WHERE status='failed')") ? { rows: input.parameters[0] === 0 ? ROWS : [] } : { rows: [] });
    view(<DocumentStats onShowPending={() => {}} />);
    const tiles = await screen.findByLabelText('Saved files');
    const tile = (label: string) => within(tiles).getByText(label).closest('div')!;
    expect(await within(tiles).findByText('3')).toBeTruthy();
    expect(tile('Download failed').textContent).toContain('1 waiting for you · open in Files');
    expect(within(tile('Download failed')).getByRole('link').getAttribute('href')).toMatch(/\/files\?fileStatus=failed$/);
    expect(within(tile('Files saved')).getByRole('link', { name: '6,030' }).getAttribute('href')).toMatch(/\/files$/);
    expect(tile('Text failed').textContent).toContain('open in Files');
    expect(within(tile('Text pending')).getByRole('button').getAttribute('aria-label')).toBe('164 Text pending: go to Text extraction');
    // Every tile has its hint line, so the row is one height.
    expect(tiles.querySelectorAll('.doc-stat-hint')).toHaveLength(7);
    expect(tile('Storage').textContent).toContain('GiB');
  });
});

describe('Opportunities › Files', () => {
  it('groups failed files by reason, badges browser-check files "Waiting for you" with no Retry, and says what the list holds', async () => {
    bridge.host.mockImplementation(async (method: string, input?: any) => method === 'catalog.query' ? { rows: input.parameters[0] === 0 ? ROWS : [] } : {});
    act(() => navigatePlugin('/files?fileStatus=failed'));
    view(<DocumentFiles onDetails={() => {}} downloadRunning={false} processingRunning={false} fileTransferControls />);
    expect(await screen.findByText('3 files not saved after a failed download, on 2 opportunities · 1 waiting for a browser check')).toBeTruthy();
    const groups = [...document.querySelectorAll('.pc-file-group')].map(group => group.textContent);
    expect(groups).toHaveLength(2);
    expect(groups[0]).toContain(`Waiting for you · 1 file · ${BROWSER_CHECK_REASON}`);
    expect(groups[1]).toMatch(/^Download failed · 2 files · The download did not finish/);
    // The reason is in the group header, not repeated on each row.
    expect(document.querySelectorAll('.research-file-warning')).toHaveLength(0);
    const held = screen.getByText('A.pdf').closest('article')!;
    expect(held.querySelector('.doc-chip')!.textContent).toBe('Waiting for you');
    expect([...held.querySelectorAll('button')].map(button => button.textContent)).toEqual(['Open']);
    expect(screen.getByText('B.pdf').closest('article')!.querySelector('.doc-chip')!.textContent).toBe('Download failed');
    expect(screen.getByText('1–3 of 3')).toBeTruthy();
  });
  it('groupByReason puts files held by a browser check first', () => {
    const groups = groupByReason(unsavedFailures(ROWS));
    expect(groups.map(group => [group.waiting, group.rows.length])).toEqual([[true, 1], [false, 2]]);
  });
});

describe('download run states', () => {
  const batch = (status: string, error: string | null = null, input: object = { queueScope: 'open' }) => ({ id: 'r1', kind: 'download', status, input: JSON.stringify(input), completed: 367, failed: 0, total: 466, error, updated_at: '2026-11-27T21:33:28Z' });
  const stuck: RunFileStats = { runId: 'r1', saved: 22, checks: 159, firstAt: '2026-11-27T16:10:30Z', lastAt: '2026-11-27T21:25:49Z', lastSavedAt: '2026-11-27T16:26:43Z', checksSinceSave: 159 };
  it('a person\'s Stop is "Stopped" in neutral, with why it was stuck', () => {
    const state = downloadRunState(batch('stopped', 'Run was interrupted. Retry / resume keeps saved results.'), { run: { id: 'r1', status: 'cancelled', error: 'Stopped from plugin dashboard.' }, stats: stuck });
    expect(state).toMatchObject({ state: 'Stopped', tone: 'neutral', active: false, resumable: true });
    expect(state.detail).toBe('Stopped by you while BC Bid was asking for a browser check (159 browser checks in a row, no file saved for 4 h 59 min).');
    expect(downloadRunState(batch('stopped'), {}).detail).toBe('');
  });
  it('a run that ended without a Stop is "Interrupted" (resumable), a real failure "Failed"', () => {
    expect(downloadRunState(batch('failed', 'Run was interrupted. Retry / resume keeps saved results.'))).toMatchObject({ state: 'Interrupted', tone: 'warning', resumable: true });
    expect(downloadRunState(batch('running'), { run: { id: 'r1', status: 'outcome_unknown' } })).toMatchObject({ state: 'Interrupted', active: false });
    expect(downloadRunState(batch('failed', 'The saved browser closed.'))).toMatchObject({ state: 'Failed', tone: 'error', detail: 'The saved browser closed.' });
    expect(downloadRunState(batch('partial', 'x'))).toMatchObject({ state: 'Partly failed', tone: 'warning' });
    expect(downloadRunState(batch('succeeded'))).toMatchObject({ state: 'Done', resumable: false });
  });
  it('an active run held by browser checks is "Waiting for you", not running or cooling down', () => {
    expect(downloadRunState(batch('running'), { run: { id: 'r1', status: 'running' }, stats: stuck })).toMatchObject({ state: 'Waiting for you', tone: 'warning', active: true });
    expect(downloadRunState(batch('running'), { run: { id: 'r1', status: 'running' }, stats: { ...stuck, checksSinceSave: 1 } })).toMatchObject({ state: 'Running', active: true });
    expect(downloadRunState(batch('waiting_for_user'))).toMatchObject({ state: 'Waiting for you', active: true });
  });
  it('names what a run downloaded and keeps Retry for the newest run of each scope', () => {
    expect(downloadRunTitle(batch('stopped'))).toBe('Missing files · open opportunities');
    expect(downloadRunTitle(batch('stopped', null, { recordIds: ['a', 'b', 'c'] }))).toBe('3 chosen opportunities');
    expect(downloadRunTitle(batch('stopped', null, { portalQueue: true }))).toBe('Portal documents');
    const rows = [{ ...batch('stopped'), id: 'new' }, { ...batch('stopped'), id: 'old' }, { ...batch('failed', 'x', { recordIds: ['a'] }), id: 'picked' }, { ...batch('succeeded', null, { recordIds: ['b'] }), id: 'done' }];
    expect([...retryableRuns(rows, row => runScopeKey(row), row => downloadRunState(row))]).toEqual(['new', 'picked']);
  });
});

describe('throughput', () => {
  const now = Date.parse('2026-11-27T21:30:00Z'), start = '2026-11-27T16:09:16Z';
  it('measures files per hour, how long nothing was saved, and the estimate from the run itself', () => {
    const stuck = downloadThroughput({ runId: 'r', saved: 22, checks: 159, firstAt: null, lastAt: null, lastSavedAt: '2026-11-27T16:26:43Z', checksSinceSave: 159 }, start, now, 988);
    expect(stuck.heldByCheck).toBe(true);
    expect(rateText(stuck.perHour!)).toBe('4.1 files per hour');
    expect(durationText(stuck.quietMs!)).toBe('5 h 3 min');
    expect(aboutText(stuck.etaMs!)).toBe('about 10 days');
    const healthy = downloadThroughput({ runId: 'r', saved: 60, checks: 0, firstAt: null, lastAt: null, lastSavedAt: '2026-11-27T21:29:00Z' }, '2026-11-27T20:30:00Z', now, 120);
    expect([rateText(healthy.perHour!), healthy.quietMs, healthy.heldByCheck, aboutText(healthy.etaMs!)]).toEqual(['60 files per hour', null, false, 'about 2 hours']);
  });
  it('leaves out what it cannot measure: no rate in the first 15 minutes, no estimate under 3 files', () => {
    const early = downloadThroughput({ runId: 'r', saved: 2, checks: 0, firstAt: null, lastAt: null, lastSavedAt: '2026-11-27T21:29:00Z' }, '2026-11-27T21:20:00Z', now, 100);
    expect([early.perHour, early.etaMs, early.quietMs]).toEqual([null, null, null]);
    expect(downloadThroughput(undefined, undefined, now, 100)).toMatchObject({ saved: 0, perHour: null, quietMs: null, etaMs: null });
  });
  it('shows the three missing-file buckets that need action first', () => {
    const queue = { notices: 0, withLinks: 466, withoutLinks: 223, needsDetails: 0, fullySaved: 367, files: 3359, saved: 2371, neverTried: 451, retryDue: 528, retryScheduled: 3, waitingForBrowser: 1, skipped: 3, unavailable: 1, exhausted: 1, nextRetryAt: null };
    expect(missingParts(queue)).toEqual({ main: ['451 never tried', '528 ready to retry', '1 waiting for a browser check'], more: ['3 scheduled for retry', '3 skipped', '1 unavailable', '1 retry limit reached'] });
    expect(remainingFiles(queue)).toBe(983);
  });
});

describe('record picker', () => {
  it('shows a re-posted opportunity once, preferring its open posting', () => {
    const row = (id: string, status: string, closingDate: string, description = '26-045 Reflective Civic Address Signs') => ({ id, title: description, data: { catalogId: id, sourceId: 'bc-bid', opportunityId: 'RDN26-045', sourceKey: id, status, closingDate } });
    const rows = uniquePostings([row('opportunity:235678', 'Closed', '2026-10-01'), row('opportunity:235883', 'Open', '2099-01-01'), row('opportunity:9', 'Open', '2099-01-01', 'Another notice')]);
    expect(rows.map(item => [item.id, item.postings])).toEqual([['opportunity:235883', 2], ['opportunity:9', 1]]);
  });
});

describe('saved-original checks', () => {
  it('collapses repeats of one check into a group with a count and the latest run', () => {
    const task = (run: string, file: string, at: string, status = 'succeeded'): VerificationTask => ({ id: `${run}-${file}`, run_id: run, record_id: 'opportunity:1', source_id: file, status, updated_at: at });
    const tasks = [task('v3', 'a', '2026-11-18T23:45:00Z'), task('v3', 'b', '2026-11-18T23:45:00Z'), task('v2', 'a', '2026-11-18T23:23:00Z'), task('v2', 'b', '2026-11-18T23:23:00Z'),
      task('v1', 'a', '2026-11-18T22:58:00Z', 'failed'), task('v1', 'b', '2026-11-18T22:58:00Z'), task('v0', 'c', '2026-11-26T20:19:00Z')];
    const groups = groupVerificationRuns(verificationRuns(tasks));
    expect(groups.map(group => [group.latest.runId, group.count])).toEqual([['v0', 1], ['v3', 2], ['v1', 1]]);
  });
});
