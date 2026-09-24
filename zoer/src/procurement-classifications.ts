import { CLASSIFICATIONS_KEY, MAX_CLASSIFICATION_MAPPINGS, findClassificationMapping, readClassificationMappings, validateClassificationInput, type ClassificationMapping } from '../dashboard/procurement/classification-contract';

type Host = (method: string, input: any) => Promise<any>;

/** User-approved display mappings only; source records/documents are never rewritten. */
export async function updateProcurementClassifications(call: Host, raw: unknown, runId: string) {
  const input = validateClassificationInput(raw);
  if (typeof runId !== 'string' || !runId || runId.length > 150) throw Error('A valid durable run ID is required.');
  for (let attempt = 0; attempt < 4; attempt++) {
    const head = await call('catalog.read', { ids: [] });
    if (!head.primary) throw Error('The existing procurement catalog must be available before saving classification mappings.');
    const state = await call('catalog.workspace', { keys: [CLASSIFICATIONS_KEY] });
    const items = readClassificationMappings(state.entries.find((entry: any) => entry.key === CLASSIFICATIONS_KEY)?.value);
    const old = findClassificationMapping(items, input.sourceId, input.rawClassification);
    if (old?.lastRunId === runId) {
      if (old.version !== input.expectedVersion + 1 || old.archived !== (input.operation === 'mapping.archive') || (input.operation === 'mapping.upsert' && old.label !== input.label)) throw Error('This run already saved a different mapping change. Reload before retrying.');
      return { key: CLASSIFICATIONS_KEY, item: old, alreadyApplied: true };
    }
    if ((old?.version ?? 0) !== input.expectedVersion) throw Error('This classification mapping changed in another session. Reload and review it before saving again.');
    if (input.operation === 'mapping.archive' && !old) throw Error('The classification mapping no longer exists.');
    if (!old && items.length >= MAX_CLASSIFICATION_MAPPINGS) throw Error(`Up to ${MAX_CLASSIFICATION_MAPPINGS} classification mappings are supported, including archived entries.`);
    const item: ClassificationMapping = {
      ...(old ?? {}), sourceId: input.sourceId, rawClassification: input.rawClassification,
      label: input.operation === 'mapping.upsert' ? input.label! : old!.label,
      archived: input.operation === 'mapping.archive', version: (old?.version ?? 0) + 1,
      updatedAt: new Date().toISOString(), lastRunId: runId,
    };
    const next = old ? items.map(candidate => candidate === old ? item : candidate) : [...items, item];
    const value = { schemaVersion: 1, items: next };
    if (new TextEncoder().encode(JSON.stringify(value)).byteLength > 1_000_000) throw Error('Classification mappings exceed their 1 MB limit. Existing mappings were retained.');
    try {
      const receipt = await call('catalog.commit', { revision: head.revision, entries: [{ key: CLASSIFICATIONS_KEY, value }] });
      if (receipt.conflict) { if (attempt < 3) continue; throw Error('Catalog changed; reload and retry.'); }
      return { key: CLASSIFICATIONS_KEY, item, revision: receipt.revision };
    } catch (error) {
      if (attempt < 3 && /Catalog changed; (reload the snapshot|retry transaction)/.test((error as Error).message)) continue;
      throw error;
    }
  }
  throw Error('Catalog changed; reload and retry.');
}
