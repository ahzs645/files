// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Operations › Runs and Opportunities › Files compose existing lists; the bridge answers every host call here.
const bridge = vi.hoisted(() => ({ host: vi.fn(async (_method: string, _input?: any): Promise<any> => ({})) }));
vi.mock('../zoer/dashboard/bridge', () => ({
  host: (method: string, input?: unknown) => bridge.host(method, input),
  subscribeHost: () => () => {}, guardHost: () => {}, bindNativeHost: () => () => {},
}));
vi.mock('../zoer/dashboard/backend', async original => ({
  ...await original<typeof import('../zoer/dashboard/backend')>(),
  useWorkspace: () => ({ model: undefined }), refresh: async () => {}, refreshAfterChange: async () => {},
}));
// The shared stand-in Btn drops its handlers; the kind filter falls back to Btn toggles on hosts without FilterChips.
vi.mock('@zoer/plugin-ui/controls', () => ({
  Btn: ({ children, size: _size, variant: _variant, ...props }: any) => <button type="button" {...props}>{children}</button>,
  // Newer host exports read through host-ui and RunsPage; absent here, so their local fallbacks render.
  StatusBadge: undefined, EmptyState: undefined, ActionMenu: undefined, Tooltip: undefined, FilterChips: undefined,
}));
// Only opened for a chosen notice; it imports host UI that the test runner cannot resolve.
vi.mock('../zoer/dashboard/procurement/NoticeView', () => ({ NoticeView: () => null }));

import { RunsPage, runKindOf, runKinds } from '../zoer/dashboard/RunsPage';
import { FilesPage } from '../zoer/dashboard/FilesPage';
import { navigatePlugin, usePluginLocation } from '../zoer/dashboard/navigation';
import { resetCapabilities } from '../zoer/dashboard/capabilities';

const FULL = { collection: true, writes: true, ai: true };
const batch = (id: string, kind: string, input: object) => ({ id, kind, status: 'succeeded', input: JSON.stringify(input), completed: 1, failed: 0, total: 1, error: null, updated_at: '2026-11-20T10:00:00Z' });
const STATE = { prompts: [], batches: [batch('d1', 'download', { recordIds: ['a'] }), batch('p1', 'download', { recordIds: ['a'], extractOnly: true, pendingOnly: true }), batch('r1', 'review', { recordIds: ['a'], promptId: 'p' })] };
let location = '';
function Location() { location = usePluginLocation(); return null; }
const view = (node: React.ReactNode) => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><Location />{node}</QueryClientProvider>);
const headings = () => screen.getAllByRole('heading', { level: 2 }).map(heading => heading.textContent);

beforeEach(() => {
  bridge.host.mockReset();
  bridge.host.mockImplementation(async (method: string) => method === 'catalog.state' ? STATE : method === 'catalog.query' ? { rows: [] } : method === 'runs.recent' ? { runs: [] } : {});
});
afterEach(() => { cleanup(); resetCapabilities(); });

describe('Operations › Runs', () => {
  it('lists the run kinds a host can show and falls back to every list', () => {
    expect(runKinds(FULL)).toEqual(['all', 'collection', 'bc-bid', 'downloads', 'extraction', 'reviews']);
    expect(runKinds({ collection: true, writes: false, ai: false })).toEqual(['all', 'collection', 'bc-bid', 'downloads', 'extraction']);
    expect(runKinds({ collection: false, writes: true, ai: true })).toEqual(['all', 'reviews']);
    expect(runKindOf('downloads', FULL)).toBe('downloads');
    expect(runKindOf('nonsense', FULL)).toBe('all');
    expect(runKindOf('reviews', { collection: true, writes: false, ai: false })).toBe('all');
  });
  it('stacks every run list under its name for kind=all, with BC Bid runs linking to their own page', async () => {
    act(() => navigatePlugin('/runs'));
    view(<RunsPage />);
    // One download, one extraction and one review batch, each in its own list and its own unit.
    expect(await screen.findByText('1 of 1 opportunity done')).toBeTruthy();
    expect(screen.getByText('1 of 1 file read')).toBeTruthy();
    expect(screen.getByText('1 of 1 opportunity reviewed')).toBeTruthy();
    expect(headings()).toEqual(['Collection runs', 'BC Bid runs', 'Download runs', 'Text extraction runs', 'AI review runs']);
    const bcBid = screen.getByRole('heading', { name: 'BC Bid runs' }).closest('section')!;
    expect(within(bcBid).getByRole('link', { name: 'Open BC Bid runs' }).getAttribute('href')).toMatch(/#\/plugins\/bc-bid-monitor\/scraper\/history$/);
    expect(screen.getByRole('group', { name: 'Run kind' })).toBeTruthy();
  });
  it('shows one list for a kind, keeping download and extraction batches apart', async () => {
    act(() => navigatePlugin('/runs?kind=downloads'));
    view(<RunsPage />);
    expect(await screen.findByText('1 of 1 opportunity done')).toBeTruthy();
    expect(headings()).toEqual(['Download runs']);
    act(() => navigatePlugin('/runs?kind=extraction'));
    expect(headings()).toEqual(['Text extraction runs']);
    expect(screen.getAllByText('1 of 1 file read')).toHaveLength(1);
    expect(screen.queryByText('1 of 1 opportunity done')).toBeNull();
  });
  it('switches kinds through the filter and keeps All as a bare /runs', async () => {
    act(() => navigatePlugin('/runs?kind=collection&record=r1'));
    view(<RunsPage />);
    expect(screen.getByRole('button', { name: 'Collection' }).getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: 'AI reviews' }));
    expect(location).toBe('/runs?kind=reviews&record=r1');
    expect(headings()).toEqual(['AI review runs']);
    fireEvent.click(screen.getByRole('button', { name: 'All' }));
    expect(location).toBe('/runs?record=r1');
  });
});

describe('Opportunities › Files', () => {
  it('honours the redirected Files tab query keys', async () => {
    act(() => navigatePlugin('/files?fileStatus=failed&record=r1'));
    view(<FilesPage />);
    expect((await screen.findByRole('combobox', { name: 'File coverage' }) as HTMLSelectElement).value).toBe('failed');
    // The library has no stat-tile row.
    expect(document.querySelector('.research-metrics')).toBeNull();
  });
});

describe('Operations › Runs: download runs tell the truth', () => {
  const QUEUE_INPUT = { queueScope: 'open', scopeAt: 1 };
  // The Nov 27 run: started 8:09, 22 files saved by 8:26, then 159 browser checks until a person pressed Stop at 1:33.
  const f3d5 = { id: 'f3d5', kind: 'download', status: 'stopped', input: JSON.stringify(QUEUE_INPUT), completed: 367, failed: 0, total: 466, error: 'Run was interrupted. Retry / resume keeps saved results.', updated_at: '2026-11-27T21:33:28Z' };
  const older = (id: string, updated: string) => ({ ...f3d5, id, completed: 0, total: 490, updated_at: updated });
  const answer = (batches: any[], runs: any[], stats: any[], checks = 0) => bridge.host.mockImplementation(async (method: string, input?: any) => {
    if (method === 'catalog.state') return { prompts: [], batches };
    if (method === 'runs.recent') return { runs: runs.filter(run => !input?.actionId || run.actionId === input.actionId) };
    if (method === 'catalog.query') return { rows: String(input.statement).includes('GROUP BY run_id') ? stats : String(input.statement).includes("status='waiting_for_user' AND updated_at>?") ? [{ checks }] : [] };
    return {};
  });
  it('reads the stopped run as "Stopped" by you, with what it downloaded, and offers Retry only on the newest run', async () => {
    answer([f3d5, older('e7f7', '2026-11-27T17:03:20Z'), older('b7e7', '2026-11-26T16:05:00Z')],
      [{ runId: 'f3d5', actionId: 'documents.download.queue', status: 'cancelled', createdAt: '2026-11-27T16:09:16Z', error: 'Stopped from plugin dashboard.' }],
      [{ runId: 'f3d5', saved: 22, checks: 159, firstAt: '2026-11-27T16:10:30Z', lastAt: '2026-11-27T21:25:49Z', lastSavedAt: '2026-11-27T16:26:43Z' }], 159);
    act(() => navigatePlugin('/runs?kind=downloads'));
    view(<RunsPage />);
    const row = (await screen.findByText('22 files saved · 367 of 466 opportunities complete')).closest('article')!;
    expect(within(row).getByText('Stopped')).toBeTruthy();
    expect(within(row).getByText('Missing files · open opportunities')).toBeTruthy();
    expect(await within(row).findByText('Stopped by you while BC Bid was asking for a browser check (159 browser checks in a row, no file saved for 4 h 59 min).')).toBeTruthy();
    // No red alerts for history, and one Retry: the newest run of the scope.
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByText(/Run was interrupted/)).toBeNull();
    expect(screen.getAllByRole('button', { name: 'Retry' })).toHaveLength(1);
    expect(within(row).getByRole('button', { name: 'Retry' })).toBeTruthy();
  });
  it('collapses repeats of the same saved-original check into one row with a count and the latest time', async () => {
    const check = (runId: string, at: string) => ['a', 'b'].map(file => ({ id: `${runId}-${file}`, run_id: runId, record_id: 'opportunity:1', source_id: file, status: 'succeeded', updated_at: at, name: `${file}.pdf`, expectedBytes: 1024 }));
    bridge.host.mockImplementation(async (method: string, input?: any) => method === 'catalog.state' ? { prompts: [], batches: [] }
      : method === 'catalog.query' ? { rows: String(input.statement).includes('attachment-verification') ? [...check('v3', '2026-11-18T23:45:00Z'), ...check('v2', '2026-11-18T23:23:00Z'), ...check('v1', '2026-11-18T22:58:00Z')] : [] } : {});
    act(() => navigatePlugin('/runs?kind=downloads'));
    view(<RunsPage />);
    const section = (await screen.findByRole('heading', { name: 'Saved-original checks' })).closest('section')!;
    expect(within(section).getAllByText('Matches')).toHaveLength(1);
    expect(within(section).getByText(/Checked 3 times · latest/)).toBeTruthy();
    expect(within(section).getAllByRole('button', { name: 'Check again' })).toHaveLength(1);
  });
  it('lists collection runs read by action, so download runs cannot push them out', async () => {
    answer([], [{ runId: 'c1', actionId: 'procurement.collect', status: 'succeeded', createdAt: '2026-11-27T10:00:00Z', input: { sourceId: 'canadabuys' } }], []);
    act(() => navigatePlugin('/runs?kind=collection'));
    view(<RunsPage />);
    expect(await screen.findByText('CanadaBuys')).toBeTruthy();
    expect(screen.queryByText(/No collection run/)).toBeNull();
    expect(bridge.host.mock.calls.some(([method, input]) => method === 'runs.recent' && input?.actionId === 'procurement.collect')).toBe(true);
  });
});
