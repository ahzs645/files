import { describe, expect, it } from 'vitest';
import { verificationFileText, verificationRuns, type VerificationTask } from '../zoer/dashboard/verification-runs';

const task = (over: Partial<VerificationTask>): VerificationTask => ({ id: 't', run_id: 'run-a', record_id: 'municipal:x', status: 'succeeded', updated_at: '2026-11-18T23:00:00Z', ...over });

describe('saved-original checks', () => {
  it('shows a file in flight with its phase and bytes, then its outcome', () => {
    const zip = task({ id: 'zip', name: 'Tender ZIP', status: 'running', phase: 'Copying from browser', receivedBytes: 4 * 1048576, expectedBytes: 10_924_972 });
    expect(verificationFileText(zip)).toBe('Copying from browser · 4.0 MiB of 10.4 MiB');
    expect(verificationFileText({ ...zip, receivedBytes: null })).toBe('Copying from browser · 10.4 MiB');
    expect(verificationFileText({ ...zip, status: 'succeeded' })).toBe('Matches the saved original · 10.4 MiB');
    expect(verificationFileText({ ...zip, status: 'failed', error: 'The current portal file differs from its saved original.' })).toContain('differs');
  });

  it('groups files by run, newest run first, with one status per run', () => {
    const runs = verificationRuns([
      task({ id: 'b2', run_id: 'run-b', status: 'running', updated_at: '2026-11-18T23:05:02Z' }),
      task({ id: 'b1', run_id: 'run-b', status: 'succeeded', updated_at: '2026-11-18T23:05:01Z' }),
      task({ id: 'a1', run_id: 'run-a', status: 'failed', updated_at: '2026-11-18T22:00:00Z' }),
      task({ id: 'c1', run_id: 'run-c', status: 'interrupted', updated_at: '2026-11-18T21:00:00Z' }),
    ]);
    expect(runs.map(run => [run.runId, run.status])).toEqual([['run-b', 'running'], ['run-a', 'failed'], ['run-c', 'stopped']]);
    expect(runs[0].files.map(file => file.id)).toEqual(['b1', 'b2']);
  });
});
