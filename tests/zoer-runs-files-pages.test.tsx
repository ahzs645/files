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
    // One download, one extraction and one review batch, each in its own list.
    expect(await screen.findAllByText('1/1 done')).toHaveLength(3);
    expect(headings()).toEqual(['Collection runs', 'BC Bid runs', 'Download runs', 'Text extraction runs', 'AI review runs']);
    const bcBid = screen.getByRole('heading', { name: 'BC Bid runs' }).closest('section')!;
    expect(within(bcBid).getByRole('link', { name: 'Open BC Bid runs' }).getAttribute('href')).toMatch(/#\/plugins\/bc-bid-monitor\/scraper\/history$/);
    expect(screen.getByRole('group', { name: 'Run kind' })).toBeTruthy();
  });
  it('shows one list for a kind, keeping download and extraction batches apart', async () => {
    act(() => navigatePlugin('/runs?kind=downloads'));
    view(<RunsPage />);
    expect(await screen.findByText('1/1 done')).toBeTruthy();
    expect(headings()).toEqual(['Download runs']);
    act(() => navigatePlugin('/runs?kind=extraction'));
    expect(headings()).toEqual(['Text extraction runs']);
    expect(screen.getAllByText('1/1 done')).toHaveLength(1);
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
