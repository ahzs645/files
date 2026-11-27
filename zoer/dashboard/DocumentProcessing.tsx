import { useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Button } from '../../apps/dashboard/src/components/ui/Button';
import { BatchProgress } from './BatchProgress';
import { host } from './bridge';
import { DOCUMENT_STATS_SQL, EXTRACTION_FAILED_COUNT_SQL, PENDING_COUNT_SQL } from './document-processing';
import { useWorkspace, refreshAfterChange } from './backend';
import { plural } from './format';
import { ScheduleBadge, useSchedules } from './procurement/ScheduleControl';
import { PluginLink, SettingsLink } from './procurement/Status';
import { findSchedule } from './procurement/schedule-state';

/**
 * Text extraction (OCR included) for files a download saved without reading them. It is its own run:
 * it needs no browser, so it can start while a download is running or any time later, and a download
 * can start while it runs. Its progress is here; its history is under Operations › Runs › Text extraction runs.
 */
export function DocumentProcessing({ supported, collection, batches, tasks = [], onChanged }: {
  /** The host saves downloads without text and answers `documents.extract.pending`. */ supported: boolean;
  /** The host lets this workspace start runs. */ collection: boolean;
  /** Extraction batches only. */ batches: any[]; tasks?: any[];
  onChanged: () => Promise<void>; /** Kept for callers; the card shows its own errors. */ onError?: (message: string) => void;
}) {
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [message, setMessage] = useState('');
  const starting = useRef(false);
  const pending = useQuery({ queryKey: ['procurement', 'document-pending'], enabled: supported, queryFn: () => host('catalog.query', { statement: PENDING_COUNT_SQL, parameters: [] }), refetchInterval: 10000 });
  const row = pending.data?.rows?.[0], files = Number(row?.files ?? 0), notices = Number(row?.notices ?? 0);
  // Read and failed: "0 waiting" alone would hide them.
  const failures = useQuery({ queryKey: ['procurement', 'document-extraction-failed'], enabled: supported, queryFn: () => host('catalog.query', { statement: EXTRACTION_FAILED_COUNT_SQL, parameters: [] }), refetchInterval: 10000 });
  const failedFiles = Number(failures.data?.rows?.[0]?.files ?? 0), failedNotices = Number(failures.data?.rows?.[0]?.notices ?? 0);
  // "No text" is the stat row's count (the same cached read): read, and nothing usable came out.
  const stats = useQuery({ queryKey: ['procurement', 'document-stats'], enabled: supported, queryFn: () => host('catalog.query', { statement: DOCUMENT_STATS_SQL, parameters: [] }), refetchInterval: 10000 });
  const noText = stats.data?.rows?.[0] ? Number(stats.data.rows[0].unreadable ?? 0) : null;
  const {model} = useWorkspace();
  const schedules = useSchedules();
  const running = batches.some(batch => batch.status === 'running')
    || (model?.workflowRuns ?? []).some(run => ['documents.extract.pending','documents.extract'].includes(run.actionId)
      && !['succeeded','failed','cancelled','outcome_unknown'].includes(run.status));
  const start = async (retryFailed = false) => {
    if (starting.current) return; starting.current = true; setBusy(true); setError(''); setMessage('');
    try {
      await host('action', { actionId: 'documents.extract.pending', input: retryFailed ? { retryFailed: true } : {} });
      const total = retryFailed ? failedFiles : files;
      setMessage(`Text extraction ${retryFailed ? 'retry ' : ''}started for ${plural(total, 'file')}. You can leave this page.`);
      await Promise.all([onChanged(), pending.refetch(), failures.refetch(), refreshAfterChange()]);
    } catch (e) { setError((e as Error).message); } finally { starting.current = false; setBusy(false); }
  };
  // One primary: Extract text now while files wait; never a disabled primary.
  const canStart = !busy && !running && files > 0;
  return <section className="zoer-history doc-download" aria-label="Text extraction">
      <h2>Text extraction</h2>
      {!supported ? <p className="research-note">This Zoer host extracts text during download. Nothing waits for extraction here.</p> : <>
        {collection && <div className="research-toolbar research-stack">
          <Button variant={canStart ? 'primary' : 'ghost'} disabled={!canStart} onClick={() => void start()}>{busy ? 'Starting…' : running ? 'Extraction running…' : 'Extract text now'}</Button>
          {failedFiles > 0 && <Button variant="ghost" disabled={busy || running} onClick={() => void start(true)}>Retry failed files</Button>}
        </div>}
        <ul className="pc-extraction-counts">
          <li>{pending.isPending ? <span role="status">Counting files waiting for text…</span> : pending.error ? <span role="alert">{(pending.error as Error).message}</span>
            : files ? <><strong>{plural(files, 'file')}</strong> from {plural(notices, 'opportunity', 'opportunities')} {files === 1 ? 'is' : 'are'} saved and waiting for text.</>
            : <>No files are waiting for text.</>}</li>
          {failedFiles > 0 && <li data-tone="warning"><strong>Text extraction failed for {plural(failedFiles, 'file')}</strong> from {plural(failedNotices, 'opportunity', 'opportunities')}. The originals are saved; a retry reads them again without downloading. <PluginLink to="/files?fileStatus=extractFailed">Show files and errors</PluginLink></li>}
          {noText !== null && noText > 0 && <li><strong>{plural(noText, 'file')}</strong> with no text: scans, drawings or unsupported files, kept as originals. <PluginLink to="/files?fileStatus=unreadable">Show in Files</PluginLink></li>}
        </ul>
        <p className="research-note">Text extraction and OCR use saved originals and can run during a download. AI reviews extract any pending files for the opportunity first.</p>
        <div className="procurement-actions">
          {collection && schedules.isSuccess && <ScheduleBadge row={findSchedule(schedules.data,'documents.extract.pending')} />}
          {collection && <SettingsLink section="schedules">Manage extraction schedule</SettingsLink>}
          <PluginLink to="/runs?kind=extraction">Text extraction runs</PluginLink>
        </div>
      </>}
      {message && <p role="status">{message}</p>}{error && <p role="alert">{error}</p>}
      <BatchProgress batches={batches} tasks={tasks} />
    </section>;
}
