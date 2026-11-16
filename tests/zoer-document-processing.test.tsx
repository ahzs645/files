// @vitest-environment jsdom
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The dashboard talks to Zoer through one bridge function; every test answers it here.
const bridge = vi.hoisted(() => ({ host: vi.fn(async (_method: string, _input?: any): Promise<any> => ({})) }));
vi.mock('../zoer/dashboard/bridge', () => ({
  host: (method: string, input?: unknown) => bridge.host(method, input),
  subscribeHost: () => () => {}, guardHost: () => {}, bindNativeHost: () => () => {},
}));

import { DocumentProcessing } from '../zoer/dashboard/DocumentProcessing';
import { DocumentFiles } from '../zoer/dashboard/DocumentInventory';
import { PENDING_EXTRACTION, processingRetry, splitDocumentBatches, workbenchExclusions } from '../zoer/dashboard/document-processing';
import { askScopeText, documentCounts, documentSummary, noTextMessage, textState, textStateDetail } from '../zoer/dashboard/procurement/ai';
import { NoText } from '../zoer/dashboard/procurement/NoText';
import { SECTION_VIEWS } from '../zoer/dashboard/review-workspace/nav';
import { preflightScopeText, summarizePreflight } from '../zoer/dashboard/review-workspace/selection';

const root = process.cwd();
const manifest = JSON.parse(readFileSync(join(root, 'zoer/manifest.json'), 'utf8'));
const action = (id: string) => manifest.integration.actions.find((item: any) => item.id === id);
const batch = (id: string, input: unknown, status = 'succeeded', kind = 'download') => ({ id, kind, status, input: typeof input === 'string' ? input : JSON.stringify(input), completed: 1, failed: 0, total: 2, error: null, updated_at: '2026-11-16T20:00:00Z' });
const PENDING_RUN = { recordIds: ['opportunity:1', 'opportunity:2'], extractOnly: true, pendingOnly: true };
const view = (node: React.ReactNode) => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{node}</QueryClientProvider>);
/** Answers `catalog.query` by statement and records every other call. */
function hostWith(queries: (statement: string) => any[] | undefined, action: (method: string, input: any) => any = () => ({})) {
  bridge.host.mockImplementation(async (method: string, input?: any) => method === 'catalog.query' ? { rows: queries(String(input.statement)) ?? [] } : action(method, input));
}
const calls = (method: string) => bridge.host.mock.calls.filter(([name]) => name === method).map(([, input]) => input);
beforeEach(() => { bridge.host.mockReset(); });
afterEach(cleanup);

describe('manifest and README', () => {
  it('AC-011: the three download actions defer text extraction by default', () => {
    for (const id of ['documents.download', 'documents.download.all', 'documents.download.missing'])
      expect(action(id).inputSchema.properties.deferExtraction, id).toEqual({ type: 'boolean', default: true });
  });
  it('AC-016: declares documents.extract.pending, version 0.41.0, and documents the behaviour', () => {
    const pending = action('documents.extract.pending');
    expect(pending.execution).toEqual({ kind: 'host-action', handler: 'documents.extract.pending.v1' });
    expect(pending.requiredCapabilities).toEqual(['artifact-store']);
    expect(pending.inputSchema).toEqual({ type: 'object', additionalProperties: false, properties: { limit: { type: 'integer', minimum: 1, maximum: 3000 } } });
    expect(Object.keys(pending.outputSchema.properties)).toEqual(['selected', 'files', 'completed', 'failed', 'remaining']);
    expect(pending.outputSchema.required).toEqual(['selected', 'files', 'completed', 'failed', 'remaining']);
    expect(pending.outputSchema.additionalProperties).toBe(false);
    expect(manifest.version).toBe('0.41.0');
    const readme = readFileSync(join(root, 'zoer/README.md'), 'utf8');
    expect(readme).toContain('Downloads save files without extracting text');
    expect(readme).toContain('**Documents → Processing** extracts text later');
    expect(readme).toContain('can run during a download');
    expect(readme).toContain('Files show "Text pending" until then');
    expect(readme).toContain("extracts a notice's pending files first, so its preflight estimate is a lower bound");
  });
});

describe('download and extraction batches', () => {
  const batches = [batch('d1', { recordIds: ['a'], force: false }, 'running'), batch('p1', PENDING_RUN), batch('r1', { recordIds: ['a'], extractOnly: true }), batch('bad', '{not json'), batch('ai', { recordIds: ['a'], extractOnly: true }, 'succeeded', 'review')];
  it('AC-012: extraction batches are apart from downloads; reviews are in neither; unparsable input is a download', () => {
    const { downloads, processing } = splitDocumentBatches(batches);
    expect(downloads.map(item => item.id)).toEqual(['d1', 'bad']);
    expect(processing.map(item => item.id)).toEqual(['p1', 'r1']);
  });
  it('AC-014: a running extraction is not a running download, and a running download is not a running extraction', () => {
    const extracting = splitDocumentBatches([batch('p', PENDING_RUN, 'running'), batch('d', { recordIds: ['a'] })]);
    expect(extracting.downloads.some(item => item.status === 'running')).toBe(false);
    expect(extracting.processing.some(item => item.status === 'running')).toBe(true);
    const downloading = splitDocumentBatches(batches);
    expect(downloading.processing.some(item => item.status === 'running')).toBe(false);
  });
  it('AC-024: Retry continues a pending run with what is still pending, and repeats a Re-extract run for its notices', () => {
    expect(processingRetry(batch('p1', PENDING_RUN))).toEqual({ actionId: 'documents.extract.pending', input: {} });
    expect(processingRetry(batch('r1', { recordIds: ['a', 'b'], extractOnly: true }))).toEqual({ actionId: 'documents.extract', input: { recordIds: ['a', 'b'] } });
  });
});

describe('Processing tab', () => {
  const pendingRows = (files: number, notices: number) => (statement: string) => statement.includes('count(DISTINCT record_id)') ? [{ files, notices }] : undefined;
  const props = { supported: true, collection: true, batches: [] as any[], tasks: [], onChanged: async () => {}, onError: () => {} };
  it('AC-013: lists Download, Processing, Files, History in the section navigation', () => {
    expect(SECTION_VIEWS.documents!.map(([id, label, route]) => [id, label, route])).toEqual([['download', 'Download', '/documents'], ['processing', 'Processing', '/documents?tab=processing'], ['files', 'Files', '/documents?tab=files'], ['history', 'History', '/documents?tab=history']]);
  });
  it('AC-013: shows the pending count and starts documents.extract.pending', async () => {
    hostWith(pendingRows(7, 3));
    const changed = vi.fn(async () => {});
    view(<DocumentProcessing {...props} onChanged={changed} />);
    expect(await screen.findByText('7 files')).toBeTruthy();
    expect(screen.getByText(/from 3 notices are saved and waiting for text/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Extract text now' }));
    await waitFor(() => expect(calls('action')).toEqual([{ actionId: 'documents.extract.pending', input: {} }]));
    await waitFor(() => expect(changed).toHaveBeenCalled());
    expect(await screen.findByText(/Text extraction started for 7 files/)).toBeTruthy();
  });
  it('AC-013: shows the running extraction\'s progress', async () => {
    hostWith(pendingRows(2, 1));
    view(<DocumentProcessing {...props} batches={[batch('p1', PENDING_RUN, 'running')]} tasks={[{ id: 't', run_id: 'p1', status: 'running', phase: 'Extracting text', name: 'Scan.pdf' }]} />);
    expect(await screen.findByText(/Text extraction in progress · 1\/2 records complete/)).toBeTruthy();
    expect(screen.getByText(/Extracting text · Scan\.pdf/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Extraction running…' })).toBeDisabled();
  });
  it('AC-013: on a host without the capability it says so and offers no start button', () => {
    hostWith(() => undefined);
    view(<DocumentProcessing {...props} supported={false} />);
    expect(screen.getByText(/This Zoer host extracts text during download\./)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Extract text now' })).toBeNull();
    expect(calls('catalog.query')).toEqual([]);
  });
  it('AC-014: the start button is enabled while a download is running (downloads are not passed to it)', async () => {
    hostWith(pendingRows(4, 2));
    const { processing } = splitDocumentBatches([batch('d1', { recordIds: ['a'] }, 'running')]);
    view(<DocumentProcessing {...props} batches={processing} />);
    await screen.findByText('4 files');
    expect(screen.getByRole('button', { name: 'Extract text now' })).toBeEnabled();
  });
  it('a failed start shows the error and enables the button again', async () => {
    hostWith(pendingRows(1, 1), method => { if (method === 'action') throw new Error('Approval is required.'); return {}; });
    view(<DocumentProcessing {...props} />);
    await screen.findByText('1 file');
    fireEvent.click(screen.getByRole('button', { name: 'Extract text now' }));
    expect((await screen.findByRole('alert')).textContent).toBe('Approval is required.');
    expect(screen.getByRole('button', { name: 'Extract text now' })).toBeEnabled();
  });
  it('AC-024: Stop cancels a running extraction; Retry of a stopped pending run starts documents.extract.pending', async () => {
    hostWith(pendingRows(2, 1));
    const first = view(<DocumentProcessing {...props} batches={[batch('p1', PENDING_RUN, 'running')]} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Stop' }));
    await waitFor(() => expect(calls('cancel')).toEqual([{ id: 'p1' }]));
    first.unmount();
    view(<DocumentProcessing {...props} batches={[batch('p1', PENDING_RUN, 'stopped')]} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(calls('action')).toEqual([{ actionId: 'documents.extract.pending', input: {} }]));
  });
});

describe('Files list', () => {
  const rows = [
    { id: 'pending', record_id: 'opportunity:1', name: 'Pending.pdf', status: 'downloaded', bytes: 10, chars: null, error: PENDING_EXTRACTION, title: 'Notice' },
    { id: 'scan', record_id: 'opportunity:1', name: 'Scan.pdf', status: 'downloaded', bytes: 10, chars: 0, error: 'No text layer; OCR found nothing', title: 'Notice' },
    { id: 'failed', record_id: 'opportunity:1', name: 'Missing.pdf', status: 'failed', bytes: 0, chars: null, error: 'Download did not start.', title: 'Notice' },
  ];
  const files = (extra: Record<string, unknown>) => { hostWith(statement => statement.includes('FROM documents d JOIN records r') ? rows : undefined); return view(<DocumentFiles onDetails={() => {}} downloadRunning={false} processingRunning={false} fileTransferControls {...extra} />); };
  const row = (name: string) => screen.getByText(name).closest('article')!;
  it('AC-030: a pending row has the "Text pending" chip and no warning; other errors still show as warnings', async () => {
    files({});
    await screen.findByText('Pending.pdf');
    expect(row('Pending.pdf').querySelector('.doc-chip')!.textContent).toBe('Text pending');
    expect(row('Pending.pdf').querySelector('.research-file-warning')).toBeNull();
    expect(row('Scan.pdf').querySelector('.doc-chip')!.textContent).toBe('No text');
    expect(row('Scan.pdf').querySelector('.research-file-warning')!.textContent).toContain('No text layer');
    expect(row('Missing.pdf').querySelector('.research-file-warning')).not.toBeNull();
  });
  const button = (name: string, label: string) => Array.from(row(name).querySelectorAll('button')).find(item => item.textContent === label)!;
  it('AC-014: a running download disables only Retry', async () => {
    files({ downloadRunning: true });
    await screen.findByText('Pending.pdf');
    expect(button('Missing.pdf', 'Retry')).toBeDisabled();
    expect(button('Scan.pdf', 'Re-extract')).toBeEnabled();
  });
  it('AC-014: a running extraction disables only Re-extract', async () => {
    files({ processingRunning: true });
    await screen.findByText('Pending.pdf');
    expect(button('Scan.pdf', 'Re-extract')).toBeDisabled();
    expect(button('Missing.pdf', 'Retry')).toBeEnabled();
  });
});

describe('"Text pending" wording outside Documents', () => {
  const readable = { id: 'r', status: 'downloaded', text_length: 120, error: null };
  const pending = { id: 'p', status: 'downloaded', text_length: null, error: PENDING_EXTRACTION };
  const scan = { id: 's', status: 'downloaded', text_length: 0, error: 'No text layer' };
  it('AC-035: notice counts, summary, per-file detail, preview and Ask-AI text name pending files apart', () => {
    const counts = documentCounts([readable, pending, scan], [{ url: 'a' }, { url: 'b' }, { url: 'c' }]);
    expect(counts).toMatchObject({ downloaded: 3, usable: 1, pending: 1, savedWithoutText: 1 });
    expect(documentSummary(counts).endsWith('; 1 contains usable text; 1 text pending')).toBe(true);
    expect([pending, scan, readable].map(textState)).toEqual(['pending', 'none', 'readable']);
    expect(textStateDetail(pending)).toBe(' · Text pending');
    expect(textStateDetail(scan)).toBe(' · Saved; no usable text extracted');
    expect(noTextMessage(pending).startsWith('Text pending.')).toBe(true);
    expect(noTextMessage(scan).startsWith('Saved; no usable text extracted.')).toBe(true);
    const ask = askScopeText({ readable: 1, textless: 1, pending: 2 });
    expect(ask).toContain('2 saved files waiting for text are extracted first.');
    expect(ask).toContain('1 saved file has no usable text and is not read.');
    expect(askScopeText({ readable: 0, textless: 0, pending: 1 })).not.toContain('no saved document has usable text');
  });
  it('AC-037: the notice text preview of a pending file says "Text pending", not "no usable text"', () => {
    // NoText is what NoticeView's text preview renders for a saved file whose text is empty.
    const preview = render(<NoText doc={pending} />);
    expect(preview.container.textContent).toMatch(/^Text pending\./);
    expect(preview.container.textContent).not.toContain('no usable text');
    preview.unmount();
    expect(render(<NoText doc={scan} />).container.textContent).toMatch(/^Saved; no usable text extracted\./);
    expect(readFileSync(join(root, 'zoer/dashboard/procurement/NoticeView.tsx'), 'utf8')).toContain('if (!text.data) return <NoText doc={doc} />;');
  });
  it('AC-036: the batch preflight names pending files and keeps them out of the estimate', () => {
    const records = [{ id: 'a', readableDocs: 1, calls: 2, current: false, pendingDocs: 3 }, { id: 'b', readableDocs: 0, calls: 0, current: false }];
    const summary = summarizePreflight('extract', records, false);
    expect(summary).toMatchObject({ pendingDocs: 3, estimatedCalls: 4 });
    expect(preflightScopeText('extract', summary).endsWith(' · 3 files text pending, extracted when the run starts')).toBe(true);
    expect(preflightScopeText('extract', { ...summary, pendingDocs: 0 })).not.toContain('text pending');
    expect(preflightScopeText('triage', summarizePreflight('triage', records, false))).toBe('All 2 use the saved notice only.');
  });
  it('AC-032: the workbench preflight lists a pending file as extracted when the stage runs', () => {
    expect(workbenchExclusions([{ name: 'Pending.pdf', status: 'downloaded', cp: 0, pending: true }, { name: 'Scan.pdf', status: 'downloaded', cp: 0 }, { name: 'Missing.pdf', status: 'failed', cp: 0 }, { name: 'Readable.pdf', status: 'downloaded', cp: 40 }]))
      .toEqual(['Pending.pdf: Text pending; extracted when this stage runs', 'Scan.pdf: Saved; no usable text extracted', 'Missing.pdf: download failed']);
  });
  it('AC-025: every no-text condition is built in document-processing.ts', () => {
    const dashboard = join(root, 'zoer/dashboard');
    const sources = (dir: string): string[] => readdirSync(dir).flatMap(name => { const path = join(dir, name); return statSync(path).isDirectory() ? sources(path) : /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : []; });
    const literal = /coalesce\(length\((?:d\.)?text\),0\)=0/;
    expect(sources(dashboard).filter(path => literal.test(readFileSync(path, 'utf8'))).map(path => path.slice(dashboard.length + 1))).toEqual([]);
    for (const [file, name] of [['review-workspace/home-data.ts', 'noTextSql('], ['review-workspace/queue.ts', 'NO_TEXT_SQL'], ['procurement/Sources.tsx', 'NO_TEXT_SQL']])
      expect(readFileSync(join(dashboard, file), 'utf8'), file).toContain(name);
  });
});
