import { useQuery } from '@tanstack/react-query';
import { host } from './bridge';
import { useWorkspace } from './backend';
import { RUN_CHECKS_SINCE_SQL, RUN_FILE_STATS_SQL, type RunFileStats } from './document-run';

/** The workflow-run fields the run lists read; `runs.recent` and the workspace run list both provide them. */
export type RunInfo = { id: string; actionId?: string; status: string; createdAt?: string; error?: string | null; cancelRequestedAt?: unknown; resumable?: { nextStepAt?: string | null } | null };
const DOWNLOAD_ACTIONS = ['documents.download.queue', 'documents.download', 'documents.download.all', 'documents.download.missing', 'documents.download.portals', 'documents.extract.pending', 'documents.extract'];

/**
 * Download and text extraction runs by id: the workspace run list (newest 100 runs of any action) plus `runs.recent` per
 * action, because hourly runs of other actions push older download runs out of the shared list. Older Zoer without the
 * action filter answers with an error; the workspace list alone is used then.
 */
export function useDownloadRuns(enabled = true): Map<string, RunInfo> {
  const { model } = useWorkspace();
  const recent = useQuery({ queryKey: ['catalog', 'procurement-download-runs'], enabled, retry: false, refetchInterval: 30_000, queryFn: async () => {
    const lists = await Promise.all(DOWNLOAD_ACTIONS.map(actionId => host('runs.recent', { actionId, limit: 20 }).then(result => (result?.runs ?? []) as any[], () => [])));
    return lists.flat().filter(run => DOWNLOAD_ACTIONS.includes(run?.actionId)).map((run): RunInfo => ({ id: run.runId, actionId: run.actionId, status: run.status, createdAt: run.createdAt, error: run.error ?? null, resumable: run.resumable ?? null }));
  } });
  const runs = new Map<string, RunInfo>();
  for (const run of recent.data ?? []) if (run.id) runs.set(run.id, run);
  // The workspace list is polled more often and carries cancelRequestedAt; its fields win where it has them (its summary
  // leaves some out, e.g. the error, so a missing value never erases what runs.recent said).
  for (const run of (model?.workflowRuns ?? []) as RunInfo[]) runs.set(run.id, { ...runs.get(run.id), ...Object.fromEntries(Object.entries(run).filter(([, value]) => value !== undefined && value !== null)) } as RunInfo);
  return runs;
}

/**
 * Saved files and browser checks per download run (its file attempts). One grouped read for the listed runs, plus the
 * checks since the last saved file for runs whose latest attempt came after their last save.
 */
export function useRunFileStats(runIds: readonly string[], active = false) {
  const ids = [...new Set(runIds)].slice(0, 30);
  return useQuery({ queryKey: ['catalog', 'procurement-run-file-stats', ids], enabled: ids.length > 0, refetchInterval: active ? 15_000 : 60_000, queryFn: async () => {
    const { rows } = await host('catalog.query', { statement: RUN_FILE_STATS_SQL(ids.length), parameters: ids });
    const stats = new Map<string, RunFileStats>();
    for (const row of rows ?? []) stats.set(String(row.runId), { runId: String(row.runId), saved: Number(row.saved) || 0, checks: Number(row.checks) || 0, firstAt: row.firstAt ?? null, lastAt: row.lastAt ?? null, lastSavedAt: row.lastSavedAt ?? null });
    // Only runs that ended (or are) on checks after their last saved file need the second read.
    await Promise.all([...stats.values()].filter(item => item.checks > 0 && String(item.lastAt ?? '') > String(item.lastSavedAt ?? '')).slice(0, 8).map(async item => {
      const { rows: [row] } = await host('catalog.query', { statement: RUN_CHECKS_SINCE_SQL, parameters: [item.runId, item.lastSavedAt ?? ''] });
      item.checksSinceSave = Number(row?.checks) || 0;
    }));
    return stats;
  } });
}
