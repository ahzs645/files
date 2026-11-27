import { fileSize } from './file-size';

/**
 * Saved-original checks (`documents.download.portals` with `verifyDocumentIds`). The host records each
 * file as an `attachment-verification` task with its phase and byte counts while it transfers, apart from
 * download attempts, so these runs have no download batch of their own.
 */
export const VERIFICATION_TASK_KIND = 'attachment-verification';
export const VERIFICATION_TASKS_SQL = "SELECT id,run_id,record_id,source_id,status,error,updated_at,json_extract(result,'$.browserSessionId') browserSessionId,json_extract(result,'$.name') name,json_extract(result,'$.phase') phase,json_extract(result,'$.receivedBytes') receivedBytes,json_extract(result,'$.expectedBytes') expectedBytes,json_extract(result,'$.sha256') sha256 FROM research_tasks WHERE kind='attachment-verification' ORDER BY updated_at DESC LIMIT 60";

export interface VerificationTask { id: string; run_id: string; record_id: string; source_id?: string; browserSessionId?: string | null; status: string; error?: string | null; updated_at: string; name?: string | null; phase?: string | null; receivedBytes?: number | null; expectedBytes?: number | null; sha256?: string | null }
export interface VerificationRun { runId: string; status: 'running' | 'failed' | 'stopped' | 'succeeded'; updatedAt: string; files: VerificationTask[] }

/** One entry per run, newest first; files keep the order the run checked them. */
export function verificationRuns(tasks: readonly VerificationTask[]): VerificationRun[] {
  const runs = new Map<string, VerificationTask[]>();
  for (const task of tasks) runs.set(task.run_id, [...(runs.get(task.run_id) ?? []), task]);
  return [...runs].map(([runId, files]) => {
    const statuses = files.map(file => file.status);
    const status = statuses.includes('running') ? 'running' : statuses.includes('failed') ? 'failed'
      : statuses.includes('interrupted') ? 'stopped' : 'succeeded';
    const ordered = [...files].sort((a, b) => a.updated_at.localeCompare(b.updated_at));
    return { runId, status, updatedAt: ordered.at(-1)!.updated_at, files: ordered } satisfies VerificationRun;
  }).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

/** "Copying from browser · 4.0 MiB of 10.4 MiB" while in flight; the outcome afterwards. */
export function verificationFileText(file: VerificationTask): string {
  const expected = typeof file.expectedBytes === 'number' ? file.expectedBytes : undefined;
  if (file.status === 'running') {
    const received = typeof file.receivedBytes === 'number' ? file.receivedBytes : undefined;
    const bytes = received !== undefined ? `${fileSize(received)}${expected !== undefined ? ` of ${fileSize(expected)}` : ''}` : expected !== undefined ? fileSize(expected) : '';
    return [file.phase || 'Starting', bytes].filter(Boolean).join(' · ');
  }
  if (file.status === 'succeeded') return `Matches the saved original${expected !== undefined ? ` · ${fileSize(expected)}` : ''}`;
  if (file.status === 'interrupted') return 'Stopped';
  return file.error || file.phase || 'Failed';
}

/** Repeats of one check: the same files with the same outcome, shown once with how often and when last. */
export interface VerificationGroup { latest: VerificationRun; count: number; runIds: string[] }
const fileSet = (run: VerificationRun) => JSON.stringify(run.files.map(file => file.source_id || file.name || file.record_id).sort());
/**
 * Saved-original checks grouped by file set and outcome, newest first: checking the same two files three times reads
 * "checked 3 times", not three identical entries. A running check is never merged.
 */
export function groupVerificationRuns(runs: readonly VerificationRun[]): VerificationGroup[] {
  const groups = new Map<string, VerificationGroup>();
  for (const run of runs) {
    const key = run.status === 'running' ? `running:${run.runId}` : `${run.status}:${fileSet(run)}`;
    const group = groups.get(key);
    if (group) { group.count++; group.runIds.push(run.runId); } else groups.set(key, { latest: run, count: 1, runIds: [run.runId] });
  }
  return [...groups.values()];
}
