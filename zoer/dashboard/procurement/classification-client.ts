import { host } from '../bridge';
import { runProcurementAction } from './state-client';
import { CLASSIFICATIONS_KEY, findClassificationMapping, readClassificationMappings, type ClassificationMappingInput } from './classification-contract';

export async function readClassificationState() {
  const state = await host('catalog.workspace', { keys: [CLASSIFICATIONS_KEY] });
  return readClassificationMappings(state.entries.find((entry: any) => entry.key === CLASSIFICATIONS_KEY)?.value);
}

/** Verify the exact durable run after success, rather than trusting a toast alone. */
export async function saveClassificationMapping(input: ClassificationMappingInput, signal?: AbortSignal) {
  const run = await runProcurementAction('procurement.classifications', input, signal);
  const items = await readClassificationState();
  const item = findClassificationMapping(items, input.sourceId, input.rawClassification);
  if (!item || item.version !== input.expectedVersion + 1 || item.lastRunId !== run.id || item.archived !== (input.operation === 'mapping.archive') || (input.operation === 'mapping.upsert' && item.label !== input.label?.trim())) throw Error('The mapping save completed but its current value changed or could not be verified. Reload and review it.');
  return items;
}
