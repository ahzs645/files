import { afterEach, describe, expect, it, vi } from 'vitest';
const { host } = vi.hoisted(() => ({ host: vi.fn() }));
vi.mock('../zoer/dashboard/bridge', () => ({ host }));
import { runProcurementAction, saveProcurementState } from '../zoer/dashboard/procurement/state-client';
import { PURSUITS_KEY } from '../zoer/dashboard/procurement/state-contract';

afterEach(() => { host.mockReset(); vi.useRealTimers(); });
const input = { operation: 'pursuit.upsert' as const, recordId: 'opportunity:1', sourceId: 'bc-bid', stage: 'Watching' as const, notes: '', expectedVersion: 0 };
const saved = { recordId: input.recordId, sourceId: 'bc-bid', title: 'Roof', stage: 'Watching', notes: '', version: 1, updatedAt: '2026-09-22T12:00:00Z', lastRunId: 'run-1' };

describe('procurement durable action client', () => {
  it('waits for terminal success then verifies the exact saved run receipt', async () => {
    const calls: string[] = [];
    host.mockImplementation(async (method: string) => { calls.push(method); if (method === 'action') return { run: { id: 'run-1' } }; if (method === 'state') return { runs: [{ id: 'run-1', status: 'succeeded' }] }; if (method === 'catalog.workspace') return { entries: [{ key: PURSUITS_KEY, value: { schemaVersion: 1, items: [saved] } }] }; throw Error('unexpected'); });
    expect(await saveProcurementState(input)).toMatchObject({ pursuits: [saved] });
    expect(calls).toEqual(['action', 'state', 'catalog.workspace']);
  });
  it('does not report success when read-back points to a different version or run', async () => {
    host.mockImplementation(async (method: string) => method === 'action' ? { run: { id: 'run-1' } } : method === 'state' ? { runs: [{ id: 'run-1', status: 'succeeded' }] } : { entries: [{ key: PURSUITS_KEY, value: { schemaVersion: 1, items: [{ ...saved, version: 2, lastRunId: 'other-run' }] } }] });
    await expect(saveProcurementState(input)).rejects.toThrow('could not be verified');
  });
  it.each(['failed', 'cancelled', 'outcome_unknown'])('propagates %s without optimistic success', async status => {
    host.mockImplementation(async (method: string) => method === 'action' ? { run: { id: 'run-1' } } : { runs: [{ id: 'run-1', status, error: 'Specific failure' }] });
    await expect(saveProcurementState(input)).rejects.toThrow('Specific failure');
    expect(host.mock.calls.some(([method]) => method === 'catalog.workspace')).toBe(false);
  });
  it('places model selection at the action envelope and never resubmits a long-running action', async () => {
    vi.useFakeTimers();
    host.mockImplementation(async (method: string) => method === 'action' ? { run: { id: 'run-1' } } : { runs: [{ id: 'run-1', status: 'running' }] });
    const result = runProcurementAction('records.evidence', { recordIds: ['opportunity:1'], mode: 'requirements' }, undefined, { modelProfileId: 'model-profile' });
    const asserted = expect(result).rejects.toThrow('still running');
    await vi.advanceTimersByTimeAsync(151_000);
    await asserted;
    expect(host.mock.calls.filter(([method]) => method === 'action')).toEqual([['action', { actionId: 'records.evidence', input: { recordIds: ['opportunity:1'], mode: 'requirements' }, modelProfileId: 'model-profile' }]]);
  });
  it('refuses new work after the workspace closes', async () => {
    const controller = new AbortController(); controller.abort();
    await expect(runProcurementAction('procurement.state', input, controller.signal)).rejects.toThrow('Workspace closed');
    expect(host).not.toHaveBeenCalled();
  });
});
