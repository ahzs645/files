import { host } from '../bridge';
import { HIDDEN_PREFIX, PURSUITS_KEY, SEARCHES_KEY, readProcurementItems, validateProcurementStateInput, type ProcurementStateInput, type Pursuit, type SavedSearch } from './state-contract';
import { sql } from './display';

export async function readProcurementState() {
  const state = await host('catalog.workspace', { keys: [PURSUITS_KEY, SEARCHES_KEY] });
  const value = (key: string) => state.entries.find((entry: any) => entry.key === key)?.value;
  return { pursuits: readProcurementItems<Pursuit>(value(PURSUITS_KEY), 'pursuits'), searches: readProcurementItems<SavedSearch>(value(SEARCHES_KEY), 'searches') };
}

/** Await a durable action; callers remain responsible for verifying their resulting data. */
export async function runProcurementAction(actionId: string, input: unknown, signal?: AbortSignal, options?: { modelProfileId?: string }) {
  if (signal?.aborted) throw Error('Workspace closed. A previously started save may still finish.');
  const { run } = await host('action', { actionId, input, ...(options?.modelProfileId ? { modelProfileId: options.modelProfileId } : {}) });
  if (!run?.id) throw Error('No durable save run was returned. Refresh before retrying.');
  const deadline = Date.now() + 150_000;
  while (Date.now() < deadline) {
    if (signal?.aborted) throw Error('Workspace closed. The save continues in run history.');
    const state = await host('state', { summary: true });
    const current = state.runs.find((candidate: any) => candidate.id === run.id);
    if (current?.status === 'succeeded') return current;
    if (current && ['failed', 'cancelled', 'outcome_unknown'].includes(current.status)) throw Error(current.error || 'The procurement save did not complete.');
    await new Promise(resolve => setTimeout(resolve, 800));
  }
  throw Error('Saving is still running. Check run history and refresh before retrying.');
}

/** Read back the exact run's receipt before declaring success. */
export async function saveProcurementState(input: ProcurementStateInput, signal?: AbortSignal) {
  const run = await runProcurementAction('procurement.state', input, signal);
  const saved = await readProcurementState();
  const item = input.operation === 'pursuit.upsert' ? saved.pursuits.find(item => item.recordId === input.recordId) : saved.searches.find(item => item.id === input.id);
  if (!item || item.lastRunId !== run.id || item.version !== input.expectedVersion + 1) throw Error('The save finished, but its current value changed or could not be verified. Refresh and review it.');
  return saved;
}

/**
 * Hide (or show again) notices in default lists, then read the hidden keys back by record id and require this run's
 * receipt on every one before reporting success.
 */
export async function setHiddenNotices(recordIds: string[], hidden: boolean, signal?: AbortSignal) {
  const input = validateProcurementStateInput({ operation: 'hidden.set', recordIds, hidden });
  if (input.operation !== 'hidden.set') throw Error('Invalid hidden-notice change.');
  const run = await runProcurementAction('procurement.state', input, signal);
  const rows = await sql(`SELECT json_extract(data,'$.recordId') AS recordId, json_extract(data,'$.hidden') AS hidden, json_extract(data,'$.lastRunId') AS runId FROM workspace_state WHERE key LIKE '${HIDDEN_PREFIX}%' AND json_extract(data,'$.recordId') IN (${input.recordIds.map(() => '?').join(',')})`, input.recordIds);
  const verified = input.recordIds.every(id => rows.some(row => row.recordId === id && Number(row.hidden) === (hidden ? 1 : 0) && row.runId === run.id));
  if (!verified) throw Error('The change finished, but it could not be verified. Refresh and check the list.');
  return input.recordIds;
}
