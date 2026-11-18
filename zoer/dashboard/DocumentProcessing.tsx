import { useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Button } from '../../apps/dashboard/src/components/ui/Button';
import { BatchHistory } from './BatchHistory';
import { BatchProgress } from './BatchProgress';
import { host } from './bridge';
import { EXTRACTION_FAILED_COUNT_SQL, PENDING_COUNT_SQL } from './document-processing';
import { patchPluginQuery } from './navigation';
import { useWorkspace, refreshAfterChange } from './backend';
import { ScheduleBadge, useSchedules } from './procurement/ScheduleControl';
import { SettingsLink } from './procurement/Status';
import { findSchedule } from './procurement/schedule-state';

/**
 * Text extraction (OCR included) for files a download saved without reading them. It is its own run:
 * it needs no browser, so it can start while a download is running or any time later, and a download
 * can start while it runs. Its progress and history are here only, never on Download or History.
 */
export function DocumentProcessing({ supported, collection, batches, tasks = [], onChanged, onError }: {
  /** The host saves downloads without text and answers `documents.extract.pending`. */ supported: boolean;
  /** The host lets this workspace start runs. */ collection: boolean;
  /** Extraction batches only. */ batches: any[]; tasks?: any[];
  onChanged: () => Promise<void>; onError: (message: string) => void;
}) {
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [message, setMessage] = useState('');
  const starting = useRef(false);
  const pending = useQuery({ queryKey: ['procurement', 'document-pending'], enabled: supported, queryFn: () => host('catalog.query', { statement: PENDING_COUNT_SQL, parameters: [] }), refetchInterval: 10000 });
  const row = pending.data?.rows?.[0], files = Number(row?.files ?? 0), notices = Number(row?.notices ?? 0);
  // Read and failed: "0 waiting" alone would hide them.
  const failures = useQuery({ queryKey: ['procurement', 'document-extraction-failed'], enabled: supported, queryFn: () => host('catalog.query', { statement: EXTRACTION_FAILED_COUNT_SQL, parameters: [] }), refetchInterval: 10000 });
  const failedFiles = Number(failures.data?.rows?.[0]?.files ?? 0), failedNotices = Number(failures.data?.rows?.[0]?.notices ?? 0);
  const {model} = useWorkspace();
  const schedules = useSchedules();
  const running = batches.some(batch => batch.status === 'running')
    || (model?.workflowRuns ?? []).some(run => ['documents.extract.pending','documents.extract'].includes(run.actionId)
      && !['succeeded','failed','cancelled','outcome_unknown'].includes(run.status));
  const start = async (retryFailed = false) => {
    if (starting.current) return; starting.current = true; setBusy(true); setError(''); setMessage('');
    try {
      await host('action', { actionId: 'documents.extract.pending', input: retryFailed ? { retryFailed: true } : {} });
      const count = retryFailed ? failedFiles : files;
      setMessage(`Text extraction ${retryFailed ? 'retry ' : ''}started for ${count.toLocaleString()} ${count === 1 ? 'file' : 'files'}. You can leave this page.`);
      await Promise.all([onChanged(), pending.refetch(), failures.refetch(), refreshAfterChange()]);
    } catch (e) { setError((e as Error).message); } finally { starting.current = false; setBusy(false); }
  };
  return <>
    <section className="zoer-history doc-download" aria-label="Text extraction">
      <h2>Text extraction</h2>
      {!supported ? <p className="research-note">This Zoer host extracts text during download. Nothing waits for processing here.</p> : <>
        <div className="research-toolbar research-stack">
          {collection && <Button disabled={busy || running || !files} onClick={() => void start()}>{busy ? 'Starting…' : running ? 'Extraction running…' : 'Extract text now'}</Button>}
          {collection && failedFiles > 0 && <Button variant="secondary" disabled={busy || running} onClick={() => void start(true)}>Retry failed files</Button>}
          <Button variant="ghost" disabled={pending.isFetching} onClick={() => void pending.refetch()}>Refresh</Button>
        </div>
        {pending.isPending ? <p role="status">Counting files waiting for text…</p> : pending.error ? <p role="alert">{(pending.error as Error).message}</p>
          : files ? <p><strong>{files.toLocaleString()} {files === 1 ? 'file' : 'files'}</strong> from {notices.toLocaleString()} {notices === 1 ? 'notice' : 'notices'} {files === 1 ? 'is' : 'are'} saved and waiting for text.</p>
          : <p>No files are waiting for text.</p>}
        {failedFiles > 0 && <p role="status" data-tone="bad"><strong>Text extraction failed for {failedFiles.toLocaleString()} {failedFiles === 1 ? 'file' : 'files'}</strong> from {failedNotices.toLocaleString()} {failedNotices === 1 ? 'notice' : 'notices'}. The originals are saved; a retry reads them again without downloading. <button type="button" className="doc-stat-link" onClick={() => patchPluginQuery({ tab: 'files', fileStatus: 'extractFailed' }, 'push')}>Show files and errors</button></p>}
        <p className="research-note">Text extraction and OCR use saved originals and can run during a download. AI reviews extract any pending files for the notice first.</p>
        {collection && <div className="research-toolbar">
          {schedules.isSuccess && <ScheduleBadge row={findSchedule(schedules.data,'documents.extract.pending')} />}
          <SettingsLink section="schedules">Manage extraction schedule</SettingsLink>
        </div>}
      </>}
      {message && <p role="status">{message}</p>}{error && <p role="alert">{error}</p>}
    </section>
    <BatchProgress batches={batches} tasks={tasks} />
    <BatchHistory title="Processing history" kind="download" links={false} batches={batches} tasks={tasks} onChanged={onChanged} onError={onError} />
  </>;
}
