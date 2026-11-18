// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// A download that Zoer parked for a scheduled automatic retry (BC Bid browser recovery) used to
// show "Download running…" with no Stop anywhere: the batch is `paused`, the run `retry_scheduled`.
const bridge = vi.hoisted(() => ({ host: vi.fn(async (_method: string, _input?: any): Promise<any> => ({})) }));
const QUEUE = vi.hoisted(() => ({ notices: 3, withLinks: 3, withoutLinks: 0, needsDetails: 0, fullySaved: 1, files: 6, saved: 2, neverTried: 4, retryDue: 0, retryScheduled: 0, waitingForBrowser: 0, skipped: 0, unavailable: 0, exhausted: 0, nextRetryAt: null }));
vi.mock('../zoer/dashboard/bridge', () => ({
  // The download section counts the queue first; tests that do not set it up get one with work to do.
  host: (method: string, input?: unknown) => method === 'catalog.documentQueue' ? Promise.resolve(QUEUE) : bridge.host(method, input),
  subscribeHost: () => () => {}, guardHost: () => {}, bindNativeHost: () => () => {},
}));
const workspace = vi.hoisted(() => ({ model: undefined as any, refresh: vi.fn(async () => {}), reload: vi.fn(async () => {}) }));
vi.mock('../zoer/dashboard/backend', async original => ({
  ...await original<typeof import('../zoer/dashboard/backend')>(),
  useWorkspace: () => ({ model: workspace.model }), refresh: () => workspace.refresh(), refreshAfterChange: () => workspace.reload(),
}));
vi.mock('../zoer/dashboard/document-scope', async original => ({
  ...await original<typeof import('../zoer/dashboard/document-scope')>(),
  readDocumentCandidates: async () => [{ id: 'opportunity:1', data: { status: 'Open', closingDate: '2099-01-01', attachments: [{}, {}], detailsCaptured: true } }],
}));
// The page test starts a download from a stand-in picker; the statistics strip has its own tests.
vi.mock('../zoer/dashboard/RecordPicker', () => ({
  RecordPicker: ({ setSelection, actions }: any) => <div><button type="button" onClick={() => setSelection(new Set(['opportunity:1']))}>Pick one</button>{actions}</div>,
}));
// Only opened for a chosen notice; it imports host UI that the test runner cannot resolve.
vi.mock('../zoer/dashboard/procurement/NoticeView', () => ({ NoticeView: () => null }));
vi.mock('../zoer/dashboard/DocumentInventory', async original => ({
  ...await original<typeof import('../zoer/dashboard/DocumentInventory')>(), DocumentStats: () => null,
}));

import { BatchHistory } from '../zoer/dashboard/BatchHistory';
import { BulkDocuments } from '../zoer/dashboard/BulkDocuments';
import { Documents } from '../zoer/dashboard/Documents';
import { DocumentFiles } from '../zoer/dashboard/DocumentInventory';
import { activeDocumentDownload, activeDownloadBatch, batchPause, documentDownloadActive, retryTimeText } from '../zoer/dashboard/document-run';
import { buildModel } from '../zoer/dashboard/model';

const RETRY_AT = '2099-11-18T08:18:40.419Z', PAUSED_AT = '2026-11-18T07:48:40Z';
const RECOVERY = `Download stopped. Automatic browser recovery is scheduled for ${RETRY_AT}. Saved files are retained.`;
const batch = (status: string, error: string | null = null, kind = 'download') => ({ id: 'run-1', kind, status, input: JSON.stringify({ recordIds: ['opportunity:1'], force: false, deferExtraction: true, checkpointGeneration: 'run-1' }), completed: 203, failed: 2, total: 492, error, updated_at: PAUSED_AT });
const run = (status: string, extra: object = {}) => ({ id: 'run-1', actionId: 'documents.download.all', status, createdAt: '2026-11-18T07:34:07Z', ...extra });
const modelWith = (...runs: any[]) => buildModel({ runs, artifacts: [] }, []);
const view = (node: React.ReactNode) => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{node}</QueryClientProvider>);
const calls = (method: string) => bridge.host.mock.calls.filter(([name]) => name === method).map(([, input]) => input);
/** A run of another batch: with `createdAt` before the pause it is an outdated run list, after it a current one. */
const other = (createdAt: string) => ({ id: 'other', actionId: 'procurement.alerts', status: 'succeeded', createdAt });
const history = (item: any) => view(<BatchHistory title="Download history" kind={item.kind} links={false} batches={[item]} onChanged={async () => {}} onError={() => {}} />);

beforeEach(() => { bridge.host.mockReset(); bridge.host.mockImplementation(async () => ({})); workspace.refresh.mockClear(); workspace.reload.mockClear(); workspace.model = undefined; });
afterEach(cleanup);

describe('what a paused batch is waiting for', () => {
  it('AC-040: a scheduled automatic retry is told apart from an update pause and from a run that ended', () => {
    expect(batchPause(batch('running'), [run('running')])).toBeNull();
    expect(batchPause(batch('paused', RECOVERY), [run('retry_scheduled', { error: RECOVERY })])).toEqual({ state: 'retry', retryAt: RETRY_AT, error: RECOVERY });
    // The host reports the retry time on resumable runs; it wins over the message text.
    expect(batchPause(batch('paused', RECOVERY), [run('retry_scheduled', { error: RECOVERY, resumable: { nextStepAt: '2026-11-18T09:00:00Z' } })])).toMatchObject({ state: 'retry', retryAt: '2026-11-18T09:00:00Z' });
    expect(batchPause(batch('paused'), [run('retry_scheduled')])).toMatchObject({ state: 'retry', retryAt: null });
    expect(batchPause(batch('paused', 'Paused for Zoer update'), [run('waiting_for_event', { paused: true })])).toMatchObject({ state: 'update' });
    for (const status of ['succeeded', 'failed', 'cancelled', 'outcome_unknown'])
      expect(batchPause(batch('paused', RECOVERY), [run(status, { error: 'Stopped from plugin dashboard.' })]), status).toEqual({ state: 'ended', retryAt: null, error: 'Stopped from plugin dashboard.' });
    // The host returns every active run, so a run list newer than the batch that lacks its run means the run ended.
    expect(batchPause(batch('paused', RECOVERY), [other('2026-11-18T07:48:41Z')])).toEqual({ state: 'ended', retryAt: null, error: null });
    // Before the run list has loaded, only the batch's own message can say it waits for a retry.
    expect(batchPause(batch('paused', RECOVERY))).toMatchObject({ state: 'retry', retryAt: RETRY_AT });
    expect(batchPause(batch('paused', 'Paused for Zoer update'))).toMatchObject({ state: 'update' });
  });
  it('AC-046: a run list that is not newer than the batch never makes it ended', () => {
    for (const runs of [[], [other('2026-11-18T07:00:00Z')], [other(PAUSED_AT)], [{ ...other(''), createdAt: undefined }]] as any[][]) {
      expect(batchPause(batch('paused', RECOVERY), runs), JSON.stringify(runs)).toEqual({ state: 'retry', retryAt: RETRY_AT, error: RECOVERY });
      expect(batchPause(batch('paused', 'Paused for Zoer update'), runs)).toEqual({ state: 'update', retryAt: null, error: 'Paused for Zoer update' });
    }
    // Without a readable batch time nothing proves the list is newer.
    expect(batchPause({ ...batch('paused', RECOVERY), updated_at: null }, [other('2026-11-18T09:00:00Z')])).toMatchObject({ state: 'retry' });
  });
  it('AC-046: the stoppable download batch is known from the batch list alone', () => {
    const stale = [other('2026-11-18T07:00:00Z')];
    expect(activeDownloadBatch([batch('succeeded'), batch('running')], stale)).toEqual({ id: 'run-1', waiting: false, retryAt: null });
    expect(activeDownloadBatch([batch('paused', RECOVERY)], stale)).toEqual({ id: 'run-1', waiting: true, retryAt: RETRY_AT });
    expect(activeDownloadBatch([batch('paused', 'Paused for Zoer update')])).toEqual({ id: 'run-1', waiting: false, retryAt: null });
    expect(activeDownloadBatch([batch('paused', RECOVERY)], [run('cancelled')])).toBeNull();
    expect(activeDownloadBatch([batch('failed'), batch('stopped'), batch('partial'), batch('waiting_for_user')], stale)).toBeNull();
    expect(activeDownloadBatch()).toBeNull();
  });
  it('AC-040: the blocking download run is reported with whether it only waits for a retry', () => {
    expect(activeDocumentDownload([])).toBeNull();
    expect(activeDocumentDownload([run('failed'), run('cancelled')])).toBeNull();
    expect(activeDocumentDownload([run('failed'), { ...run('running'), id: 'run-2' }])).toEqual({ id: 'run-2', waiting: false, retryAt: null });
    expect(activeDocumentDownload([run('retry_scheduled', { error: RECOVERY })])).toEqual({ id: 'run-1', waiting: true, retryAt: RETRY_AT });
    expect(documentDownloadActive([run('retry_scheduled')])).toBe(true);
    expect(retryTimeText(RETRY_AT)).toBe(new Date(RETRY_AT).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }));
    expect(retryTimeText(null)).toBe(''); expect(retryTimeText('soon')).toBe('');
    // A time that has passed is not announced as upcoming.
    expect(retryTimeText('2026-11-18T08:18:40Z', Date.parse('2026-11-18T08:18:41Z'))).toBe('');
    expect(retryTimeText('2026-11-18T08:18:40Z', Date.parse('2026-11-18T08:00:00Z'))).not.toBe('');
  });
  it('AC-040: the model exposes every returned run, also of actions it does not otherwise list', () => {
    const review = { id: 'review-1', actionId: 'records.review', status: 'waiting_for_event', createdAt: '2026-11-18T07:00:00Z' };
    expect(modelWith(run('retry_scheduled'), review).workflowRuns.map((item: any) => item.id)).toEqual(['run-1', 'review-1']);
  });
});

describe('Download history', () => {
  it('AC-041: a download waiting for its automatic retry reads "Waiting to retry" and Stop cancels its run', async () => {
    workspace.model = modelWith(run('retry_scheduled', { error: RECOVERY }));
    history(batch('paused', RECOVERY));
    expect(screen.getByText('Waiting to retry')).toBeInTheDocument();
    expect(screen.queryByText('Paused for update')).toBeNull();
    expect(screen.getByRole('status')).toHaveTextContent(`Nothing is downloading. Zoer retries automatically at ${retryTimeText(RETRY_AT)}; Stop ends the wait and keeps what is saved.`);
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Stop' }));
    await waitFor(() => expect(calls('cancel')).toEqual([{ id: 'run-1' }]));
    await waitFor(() => expect(workspace.reload).toHaveBeenCalledTimes(1));
  });
  it('AC-046: with a run list older than the batch it still reads "Waiting to retry" with Stop, never "Stopped" with Retry', () => {
    workspace.model = modelWith(other('2026-11-18T07:00:00Z'), { ...run('cancelled'), id: 'earlier-attempt' });
    history(batch('paused', RECOVERY));
    expect(screen.getByText('Waiting to retry')).toBeInTheDocument();
    expect(screen.queryByText('Stopped')).toBeNull();
    expect(screen.getByRole('alert')).toHaveTextContent('Automatic browser recovery is scheduled');
    expect(screen.getByRole('button', { name: 'Stop' })).toBeEnabled();
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
  });
  it('AC-046: an update-paused extraction or review batch with an outdated run list offers no Retry', () => {
    workspace.model = modelWith(other('2026-11-18T07:00:00Z'));
    const extraction = history({ ...batch('paused', 'Paused for Zoer update'), input: JSON.stringify({ recordIds: ['opportunity:1'], extractOnly: true, pendingOnly: true }) });
    expect(screen.getByText('Paused for update')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
    extraction.unmount();
    history(batch('paused', 'Paused for Zoer update', 'review'));
    expect(screen.getByText('Paused for update')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Stop' })).toBeNull();
  });
  it('AC-041: a waiting batch that downloads nothing does not speak of downloading', () => {
    workspace.model = modelWith(run('retry_scheduled'));
    history(batch('paused', null, 'review'));
    expect(screen.getByRole('status')).toHaveTextContent('Nothing is running. Zoer retries automatically; Stop ends the wait and keeps what is saved.');
  });
  it('AC-042: once that run has ended the batch reads "Stopped" and Retry resumes it', async () => {
    workspace.model = modelWith(run('cancelled'));
    bridge.host.mockImplementation(async (method: string) => method === 'state' ? { runs: [run('cancelled')] } : {});
    history(batch('paused', RECOVERY));
    expect(screen.getByText('Stopped')).toBeInTheDocument();
    expect(screen.queryByText('Waiting to retry')).toBeNull();
    // The message about a scheduled recovery no longer applies.
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Stop' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(calls('action')).toEqual([{ actionId: 'documents.download', input: { recordIds: ['opportunity:1'], force: false, resumeRunId: 'run-1' }, modelProfileId: '' }]));
    // AC-047: the new run must reach the run list without waiting for the next poll.
    await waitFor(() => expect(workspace.reload).toHaveBeenCalledTimes(1));
  });
  it('AC-042: an update pause keeps "Paused for update" with neither Stop nor Retry', () => {
    workspace.model = modelWith(run('waiting_for_event', { paused: true }));
    history(batch('paused', 'Paused for Zoer update'));
    expect(screen.getByText('Paused for update')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Stop' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
  });
  it('AC-042: a running batch still offers Stop, and a failed one Retry', () => {
    workspace.model = modelWith(run('running'));
    const first = history(batch('running'));
    expect(screen.getByRole('button', { name: 'Stop' })).toBeEnabled();
    first.unmount();
    workspace.model = modelWith(run('failed'));
    history(batch('failed', 'The saved browser closed.'));
    expect(screen.getByRole('button', { name: 'Retry' })).toBeEnabled();
    expect(screen.getByRole('alert')).toHaveTextContent('The saved browser closed.');
  });
});

describe('Download all attachments', () => {
  const section = (running = false) => view(<BulkDocuments running={running} onStarted={async () => {}} />);
  it('AC-043: a download waiting for its retry says so and can be stopped from the section', async () => {
    workspace.model = modelWith(run('retry_scheduled', { error: RECOVERY }));
    const onStarted = vi.fn(async () => {});
    view(<BulkDocuments running={false} onStarted={onStarted} />);
    expect(await screen.findByRole('button', { name: 'Download paused…' })).toBeDisabled();
    expect(screen.getByText(/The download is paused and nothing is transferring\./)).toHaveTextContent(`Zoer retries automatically at ${retryTimeText(RETRY_AT)}`);
    fireEvent.click(screen.getByRole('button', { name: 'Stop download' }));
    await waitFor(() => expect(calls('cancel')).toEqual([{ id: 'run-1' }]));
    await waitFor(() => expect(screen.getByText(/Download stopped\. Saved files are kept/)).toBeInTheDocument());
    expect(onStarted).toHaveBeenCalledTimes(1);
    expect(workspace.reload).toHaveBeenCalledTimes(1);
  });
  it('AC-046: a download batch the run list does not know yet can be stopped from the section', async () => {
    workspace.model = modelWith(other('2026-11-18T07:00:00Z'));
    view(<BulkDocuments running activeBatch={{ id: 'run-1', waiting: false, retryAt: null }} onStarted={async () => {}} />);
    expect(await screen.findByRole('button', { name: 'Download running…' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Stop download' }));
    await waitFor(() => expect(calls('cancel')).toEqual([{ id: 'run-1' }]));
  });
  it('AC-046: a paused batch the run list does not know yet shows the wait and Stop download', async () => {
    workspace.model = modelWith(other('2026-11-18T07:00:00Z'));
    view(<BulkDocuments running={false} activeBatch={{ id: 'run-1', waiting: true, retryAt: RETRY_AT }} onStarted={async () => {}} />);
    expect(await screen.findByText(/The download is paused and nothing is transferring\./)).toHaveTextContent(`at ${retryTimeText(RETRY_AT)}`);
    expect(screen.getByRole('button', { name: 'Stop download' })).toBeEnabled();
  });
  it('AC-043: a transferring download keeps "Download running…" and also offers Stop download', async () => {
    workspace.model = modelWith(run('running'));
    section(true);
    expect(await screen.findByRole('button', { name: 'Download running…' })).toBeDisabled();
    expect(screen.queryByText(/The download is paused/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Stop download' }));
    await waitFor(() => expect(calls('cancel')).toEqual([{ id: 'run-1' }]));
  });
  it('AC-043: a refused stop shows the error and leaves the control usable', async () => {
    workspace.model = modelWith(run('retry_scheduled', { error: RECOVERY }));
    bridge.host.mockImplementation(async (method: string) => { if (method === 'cancel') throw new Error('Workspace run not found'); return {}; });
    section();
    fireEvent.click(await screen.findByRole('button', { name: 'Stop download' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Workspace run not found');
    expect(screen.getByRole('button', { name: 'Stop download' })).toBeEnabled();
  });
  it('AC-044: after the run has ended a new download can start and there is nothing to stop', async () => {
    workspace.model = modelWith(run('cancelled'));
    section();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Download missing files' })).toBeEnabled());
    expect(screen.queryByRole('button', { name: 'Stop download' })).toBeNull();
    expect(screen.queryByText(/The download is paused/)).toBeNull();
  });
});

it('AC-048: the Stop controls shipped in 0.41.1; later releases keep them', () => {
  const [major, minor, patch] = JSON.parse(readFileSync(join(process.cwd(), 'zoer/manifest.json'), 'utf8')).version.split('.').map(Number);
  expect(major * 1e6 + minor * 1e3 + patch).toBeGreaterThanOrEqual(41001);
});
it('AC-045: the README documents the paused state and where to stop it', () => {
  const readme = readFileSync(join(process.cwd(), 'zoer/README.md'), 'utf8');
  expect(readme).toContain('**Stop download**');
  expect(readme).toContain('Waiting to retry');
});

describe('run state follows downloads started from the dashboard', () => {
  const catalog = (batches: any[]) => bridge.host.mockImplementation(async (method: string, input?: any) =>
    method === 'catalog.state' ? { prompts: [], batches, fileTransferControls: true, deferredExtraction: true }
      : method === 'catalog.query' ? { rows: String(input.statement).includes('FROM documents d JOIN records r') ? [{ id: 'doc-1', record_id: 'opportunity:1', name: 'Missing.pdf', status: 'failed', bytes: 0, chars: null, error: 'Download did not start.', title: 'Notice' }] : [] }
      : method === 'state' ? { runs: [] } : {});
  it('AC-047: Download selected reloads the run list, and the page passes the paused batch to the section', async () => {
    workspace.model = modelWith(other('2026-11-18T07:00:00Z'));
    catalog([batch('paused', RECOVERY)]);
    view(<Documents />);
    // The run list does not know run-1, yet the section offers to stop it.
    expect(await screen.findByRole('button', { name: 'Stop download' })).toBeEnabled();
    expect(screen.getByText(/The download is paused and nothing is transferring\./)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Pick one' }));
    fireEvent.click(screen.getByRole('button', { name: 'Download selected' }));
    await waitFor(() => expect(calls('action')).toEqual([{ actionId: 'documents.download', input: { recordIds: ['opportunity:1'], force: false } }]));
    await waitFor(() => expect(workspace.reload).toHaveBeenCalledTimes(1));
  });
  it('AC-047: a per-file download retry reloads the run list', async () => {
    catalog([]);
    view(<DocumentFiles onDetails={() => {}} downloadRunning={false} processingRunning={false} fileTransferControls />);
    const row = (await screen.findByText('Missing.pdf')).closest('article')!;
    fireEvent.click(Array.from(row.querySelectorAll('button')).find(item => item.textContent === 'Retry')!);
    await waitFor(() => expect(calls('action')).toHaveLength(1));
    await waitFor(() => expect(workspace.reload).toHaveBeenCalledTimes(1));
  });
});

describe('refreshAfterChange', () => {
  it('AC-047: waits for a refresh already in flight and then reads the state again', async () => {
    const { refresh, refreshAfterChange } = await vi.importActual<typeof import('../zoer/dashboard/backend')>('../zoer/dashboard/backend');
    let release = () => {};
    const gate = new Promise<void>(resolve => { release = resolve; });
    let reads = 0;
    bridge.host.mockImplementation(async (method: string) => {
      if (method === 'state') { if (++reads === 1) await gate; return { runs: [] }; }
      throw new Error('stop after the state read');
    });
    const first = refresh();
    const after = refreshAfterChange();
    await Promise.resolve();
    expect(reads).toBe(1);
    release();
    await first; await after;
    expect(reads).toBe(2);
  });
});
