import { MAX_PURSUITS, MAX_SEARCHES, PURSUITS_KEY, SEARCHES_KEY, readProcurementItems, validateProcurementStateInput, type Pursuit, type SavedSearch } from '../dashboard/procurement/state-contract';

type Host = (method: string, input: any) => Promise<any>;
const conflict = () => Error('This item changed in another session. Reload and review it before saving again.');

/** Updates only authorized workspace entries. Never provisions storage or rewrites source records. */
export async function updateProcurementState(call: Host, raw: unknown, runId: string) {
  const input = validateProcurementStateInput(raw);
  if (typeof runId !== 'string' || !runId || runId.length > 150) throw Error('A valid durable run ID is required.');
  const pursuit = input.operation === 'pursuit.upsert';
  const key = pursuit ? PURSUITS_KEY : SEARCHES_KEY;
  // Retry unrelated catalog revision changes; per-item versions still prevent lost edits.
  for (let attempt = 0; attempt < 4; attempt++) {
    const head = await call('catalog.read', { ids: [] });
    if (!head.primary) throw Error('The existing procurement catalog must be available before saving workspace state.');
    const state = await call('catalog.workspace', { keys: [key] });
    const items = readProcurementItems<Pursuit | SavedSearch>(state.entries.find((entry: any) => entry.key === key)?.value, pursuit ? 'pursuits' : 'searches');
    const index = items.findIndex(item => pursuit ? (item as Pursuit).recordId === input.recordId : (item as SavedSearch).id === input.id);
    const old = items[index];
    // Durable action retry after a confirmed commit is safe and does not increment twice.
    if (old?.lastRunId === runId) return { key, item: old, alreadyApplied: true };
    if ((old?.version ?? 0) !== input.expectedVersion) throw conflict();
    let item: Pursuit | SavedSearch;
    const version = (old?.version ?? 0) + 1, updatedAt = new Date().toISOString();
    if (input.operation === 'pursuit.upsert') {
      const result = await call('catalog.read', { ids: [input.recordId] });
      const record = result.records.find((record: any) => record.id === input.recordId);
      if (!record || !['opportunity', 'award'].includes(record.kind)) throw Error('The catalog record no longer exists.');
      const recordSource = record.data?.sourceId || 'bc-bid';
      if (recordSource !== input.sourceId) throw Error('The pursuit source does not match the saved catalog record.');
      if (index < 0 && items.length >= MAX_PURSUITS) throw Error(`The pursuit board supports up to ${MAX_PURSUITS} records.`);
      item = { recordId: input.recordId, sourceId: input.sourceId, title: String(record.title ?? record.data?.description ?? record.data?.opportunityDescription ?? input.recordId).slice(0, 20_000), stage: input.stage, notes: input.notes, version, updatedAt, lastRunId: runId };
    } else if (input.operation === 'search.archive') {
      if (!old) throw Error('The saved search no longer exists.');
      item = { ...old as SavedSearch, archived: true, version, updatedAt, lastRunId: runId };
    } else {
      if (index < 0 && items.length >= MAX_SEARCHES) throw Error(`Up to ${MAX_SEARCHES} saved searches are supported, including archived entries.`);
      item = { id: input.id, name: input.name, filters: input.filters, archived: false, version, updatedAt, lastRunId: runId };
    }
    const next = [...items];
    if (index < 0) next.push(item); else next[index] = item;
    const value = { schemaVersion: 1, items: next };
    if (new TextEncoder().encode(JSON.stringify(value)).byteLength > 1_000_000) throw Error('Procurement state exceeds its 1 MB limit. Shorten notes before adding more records.');
    try {
      const result = await call('catalog.commit', { revision: head.revision, entries: [{ key, value }] });
      if (result.conflict) { if (attempt < 3) continue; throw Error('Catalog changed; reload and retry.'); }
      return { key, item, revision: result.revision };
    } catch (error) {
      if (attempt < 3 && /Catalog changed; (reload the snapshot|retry transaction)/.test((error as Error).message)) continue;
      throw error;
    }
  }
  throw Error('Catalog changed; reload and retry.');
}
