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

import { portalRetry, researchRetry, verificationRetry } from '../zoer/dashboard/research-retry';
describe('History retries of portal work', () => {
  it('retries a portal queue pass as the portal queue on its recorded browser, never as a native download', () => {
    const batch = { id: 'run-p', kind: 'download', input: JSON.stringify({ recordIds: ['municipal:a'], deferExtraction: true, portalQueue: true, browserSessionId: 'br-kite' }) };
    expect(researchRetry(batch)).toEqual({ actionId: 'documents.download.portals', input: {}, browserSessionId: 'br-kite' });
    // An older pass without the marker is identified by its workflow run's action and runs on the Settings browser.
    const older = { id: 'run-o', kind: 'download', input: JSON.stringify({ recordIds: ['municipal:a'], deferExtraction: true }) };
    expect(researchRetry(older, '', 'documents.download.portals')).toEqual(portalRetry());
    expect(researchRetry(older).actionId).toBe('documents.download');
  });

  it('checks the same saved originals again, at most two, on the recorded browser', () => {
    expect(verificationRetry(['doc-1', 'doc-2', 'doc-1'], 'br-kite')).toEqual({ actionId: 'documents.download.portals', input: { verifyDocumentIds: ['doc-1', 'doc-2'] }, browserSessionId: 'br-kite' });
    expect(verificationRetry(['doc-1'], 'not a browser id')).toEqual({ actionId: 'documents.download.portals', input: { verifyDocumentIds: ['doc-1'] } });
  });
});
