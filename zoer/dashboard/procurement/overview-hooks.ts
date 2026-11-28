import { useQuery } from '@tanstack/react-query';
import { host } from '../bridge';
import { useWorkspace } from '../backend';
import { useCapabilities } from '../capabilities';
import { readDocumentQueue } from '../document-queue';
import { EXTRACTION_FAILED_COUNT_SQL, PENDING_COUNT_SQL } from '../document-processing';
import { isActiveRun } from '../format';
import { sql } from './display';
import { findSchedule } from './schedule-state';
import { useScheduleBrowsers, useSchedules } from './ScheduleControl';
import { useRecentRuns, useWorkflowRuns } from './CollectionRuns';
import { DOCUMENT_GAP_KEY, lastCollections, paged, readDocumentGap } from './status-data';
import { SOURCE_SUMMARY_KEYS } from './source-summary';
import { setupChecklist, type ExtractionCounts } from './status-checklist';
import { FAILED_FILES_SQL, FAILED_TASKS_SQL, failedFiles, failureSummary, type FailureTask } from './source-health';
import { needsYou } from './overview-data';

/**
 * Shared reads for Operations › Overview and Home's one-line summary (kept apart from Status.tsx so Home can count what
 * needs the person without importing the page). Status.tsx re-exports the older hooks for other pages.
 */

/** The document gap of open BC Bid opportunities (one cached read; heavy, so refreshed every two minutes). */
export function useDocumentGap(enabled = true) {
  const schedules = useSchedules(), { data: browsers } = useScheduleBrowsers(enabled);
  const downloads = findSchedule(schedules.data, 'documents.download.missing');
  const browserId = (downloads?.enabled ? downloads.browser?.id ?? downloads.body?.resources?.browserSessionId : undefined)
    ?? (browsers?.downloadsUseCollection ? browsers.collection?.id : browsers?.downloads?.id ?? browsers?.collection?.id)
    ?? '';
  return useQuery({ queryKey: [...DOCUMENT_GAP_KEY, browserId], enabled: enabled && !schedules.isPending,
    queryFn: () => readDocumentGap(Date.now(), browserId, () => readDocumentQueue('open')), staleTime: 60_000, refetchInterval: 120_000 });
}

/** catalog.workspace values behind "last successful collection" and each source's collection state. */
export function useCollectionEntries() {
  return useQuery({ queryKey: ['catalog', 'procurement-status', 'collections'], queryFn: () => host('catalog.workspace', { keys: SOURCE_SUMMARY_KEYS }), refetchInterval: 30_000 });
}
/** Last successful collection per source (the same helper Sources uses). */
export function useLastCollections() {
  const { model } = useWorkspace(), recent = useRecentRuns(), entries = useCollectionEntries();
  return lastCollections(entries.data?.entries, recent.data ?? (recent.error ? [] : undefined), model?.captureRuns);
}

/** Actions whose runs use the BC Bid download browser (portal downloads use their own browser). */
const BC_DOWNLOAD_ACTIONS = ['documents.download', 'documents.download.all', 'documents.download.missing', 'documents.download.queue'];

/** Text extraction counts (document-processing.ts, the same statements Operations › Documents reads). */
export function useExtractionCounts(enabled = true) {
  return useQuery({ queryKey: ['catalog', 'procurement-overview', 'extraction'], enabled, refetchInterval: 60_000, queryFn: async (): Promise<ExtractionCounts> => {
    const [[failed], [pending]] = await Promise.all([sql(EXTRACTION_FAILED_COUNT_SQL), sql(PENDING_COUNT_SQL)]);
    return { failedFiles: Number(failed?.files ?? 0), failedNotices: Number(failed?.notices ?? 0), pendingFiles: Number(pending?.files ?? 0), pendingNotices: Number(pending?.notices ?? 0) };
  } });
}
/** The failure queue (same key and read as Sources, so one cached read): files not saved after an attempt, and failed review steps. */
export function useFailures(enabled = true) {
  return useQuery({ queryKey: ['catalog', 'procurement-source-failures'], enabled, refetchInterval: 60_000,
    queryFn: async () => [...failedFiles(await paged(FAILED_FILES_SQL, [])), ...await paged(FAILED_TASKS_SQL, []) as FailureTask[]] });
}

/**
 * Everything "Needs you" is built from. `checklist` keeps the older shape for pages that import `useSetupStatus`;
 * `overview` is the Needs you / All clear split and its verdict, the count Home's line shows.
 */
export function useOverviewStatus() {
  const { collection } = useCapabilities();
  const schedules = useSchedules(), browsers = useScheduleBrowsers(), gap = useDocumentGap(collection);
  const runs = useWorkflowRuns(collection), extraction = useExtractionCounts(collection), failures = useFailures(collection);
  const active = (runs.data ?? []).filter(run => isActiveRun(run.status));
  const checklist = setupChecklist({ browsers: browsers.data, rows: schedules.data, gap: gap.data,
    downloadActive: active.some(run => BC_DOWNLOAD_ACTIONS.includes(run.actionId ?? '')), extractionRunning: active.some(run => (run.actionId ?? '').startsWith('documents.extract')),
    extraction: extraction.data, failures: failures.data ? failureSummary(failures.data) : undefined });
  return { schedules, browsers, gap, runs, extraction, failures, checklist, overview: needsYou(checklist.steps) };
}
/** The checklist from today's reads; shared by Operations › Overview and older callers. */
export function useSetupStatus() {
  const { schedules, gap, checklist } = useOverviewStatus();
  return { schedules, gap, checklist };
}
