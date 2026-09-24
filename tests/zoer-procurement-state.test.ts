import { describe, expect, it } from 'vitest';
import { updateProcurementState } from '../zoer/src/procurement-state';
import { MAX_PURSUITS, MAX_SEARCHES, PURSUITS_KEY, SEARCHES_KEY, readProcurementItems, validateProcurementFilters } from '../zoer/dashboard/procurement/state-contract';

const filters = { source: '', kind: 'all' as const, search: 'roof', region: 'BC', category: '', classification: '', buyer: '', supplier: '', deadline: 'week' as const, shortlist: false };
const pursuit = { operation: 'pursuit.upsert', expectedVersion: 0, recordId: 'opportunity:123', sourceId: 'bc-bid', stage: 'Watching', notes: 'Internal requirement checklist' };
const search = { operation: 'search.upsert', expectedVersion: 0, id: 'roofs', name: 'Roof work', filters };
function database() {
  let revision = 1, primary = true;
  const entries = new Map<string, any>([['checkpoint:full', { important: 'retain' }]]);
  const records = new Map<string, any>([['opportunity:123', { id: 'opportunity:123', kind: 'opportunity', title: 'Roof repair', data: { starred: true, status: 'Open', attachments: ['existing.pdf'] } }], ['opportunity:canadabuys:A', { id: 'opportunity:canadabuys:A', kind: 'opportunity', title: 'Federal roof', data: { sourceId: 'canadabuys' } }]]);
  const commits: any[] = [];
  const call = async (method: string, input: any): Promise<any> => {
    if (method === 'catalog.read') return { primary, revision, records: [...records.values()].filter(row => input.ids.includes(row.id)).map(row => structuredClone(row)) };
    if (method === 'catalog.workspace') return { revision, entries: input.keys.flatMap((key: string) => entries.has(key) ? [{ key, value: structuredClone(entries.get(key)) }] : []) };
    if (method === 'catalog.commit') {
      if (input.revision !== revision) throw Error('Catalog changed; reload the snapshot.');
      commits.push(structuredClone(input));
      for (const item of input.entries ?? []) entries.set(item.key, structuredClone(item.value));
      return { revision: ++revision };
    }
    throw Error(`Unexpected host call: ${method}`);
  };
  return { call, entries, records, commits, bump: () => revision++, unavailable: () => { primary = false; } };
}

describe('procurement workspace state', () => {
  it('stores internal pursuit separately while preserving source data, stars, documents and checkpoints', async () => {
    const db = database(), original = structuredClone([...db.records]);
    await updateProcurementState(db.call, pursuit, 'run-1');
    expect(db.entries.get(PURSUITS_KEY)).toMatchObject({ schemaVersion: 1, items: [{ recordId: pursuit.recordId, sourceId: 'bc-bid', title: 'Roof repair', stage: 'Watching', notes: pursuit.notes, version: 1 }] });
    await updateProcurementState(db.call, { ...pursuit, expectedVersion: 1, stage: 'Submitted' }, 'run-2');
    expect(db.entries.get(PURSUITS_KEY).items[0]).toMatchObject({ stage: 'Submitted', version: 2 });
    expect([...db.records]).toEqual(original);
    expect(db.entries.get('checkpoint:full')).toEqual({ important: 'retain' });
    expect(db.commits.every(commit => !commit.records && !commit.history && !commit.primary && !commit.migration)).toBe(true);
  });

  it('rejects unknown records, mismatched sources and invalid fields before any write', async () => {
    for (const input of [
      { ...pursuit, recordId: 'opportunity:missing' }, { ...pursuit, sourceId: 'canadabuys' },
      { ...pursuit, sourceId: '../bc-bid' }, { ...pursuit, stage: 'Open' }, { ...pursuit, notes: 'x'.repeat(4001) },
      { ...pursuit, expectedVersion: -1 }, { ...pursuit, expectedVersion: 0.5 }, { ...pursuit, recordId: 'checkpoint:full' },
    ]) {
      const db = database();
      await expect(updateProcurementState(db.call, input, 'bad-run')).rejects.toThrow();
      expect(db.commits).toHaveLength(0);
    }
    const db = database();
    await updateProcurementState(db.call, { ...pursuit, recordId: 'opportunity:canadabuys:A', sourceId: 'canadabuys' }, 'federal-run');
    expect(db.entries.get(PURSUITS_KEY).items[0].sourceId).toBe('canadabuys');
  });

  it('handles unrelated catalog changes without losing edits to a different pursuit', async () => {
    const db = database(); let concurrent = false;
    const call = async (method: string, input: any) => {
      if (method === 'catalog.commit' && !concurrent) {
        concurrent = true;
        await updateProcurementState(db.call, { ...pursuit, recordId: 'opportunity:canadabuys:A', sourceId: 'canadabuys' }, 'other-record');
      }
      return db.call(method, input);
    };
    await updateProcurementState(call, pursuit, 'my-record');
    expect(db.entries.get(PURSUITS_KEY).items).toHaveLength(2);
    expect(db.entries.get(PURSUITS_KEY).items.map((item: any) => item.recordId)).toEqual(['opportunity:canadabuys:A', 'opportunity:123']);
  });

  it('rejects same-item concurrent edits rather than silently overwriting notes', async () => {
    const db = database(); await updateProcurementState(db.call, pursuit, 'initial');
    let concurrent = false;
    const call = async (method: string, input: any) => {
      if (method === 'catalog.commit' && !concurrent) {
        concurrent = true;
        await updateProcurementState(db.call, { ...pursuit, expectedVersion: 1, notes: 'Other editor notes' }, 'other-editor');
      }
      return db.call(method, input);
    };
    await expect(updateProcurementState(call, { ...pursuit, expectedVersion: 1, notes: 'My stale notes' }, 'stale-editor')).rejects.toThrow('another session');
    expect(db.entries.get(PURSUITS_KEY).items[0].notes).toBe('Other editor notes');
  });

  it('does not reapply a durable run and stops after bounded catalog conflicts', async () => {
    const db = database();
    await updateProcurementState(db.call, pursuit, 'one-run');
    expect(await updateProcurementState(db.call, pursuit, 'one-run')).toMatchObject({ alreadyApplied: true });
    expect(db.commits).toHaveLength(1);
    let attempts = 0;
    const call = async (method: string, input: any) => { if (method === 'catalog.commit') { attempts++; db.bump(); } return db.call(method, input); };
    await expect(updateProcurementState(call, search, 'never-commit')).rejects.toThrow('Catalog changed');
    expect(attempts).toBe(4);
    expect(db.entries.has(SEARCHES_KEY)).toBe(false);
  });

  it('saves all filters, archives without deleting notices, and restores with an explicit version', async () => {
    const db = database();
    const complete = { ...filters, source: 'canadabuys', kind: 'award', buyer: 'Federal buyer', supplier: 'Supplier', category: 'Construction', classification: '["UNSPSC:72100000"]', shortlist: true };
    await updateProcurementState(db.call, { ...search, filters: complete }, 'search-save');
    expect(db.entries.get(SEARCHES_KEY).items[0]).toMatchObject({ filters: complete, archived: false, version: 1 });
    await updateProcurementState(db.call, { operation: 'search.archive', expectedVersion: 1, id: search.id }, 'search-archive');
    expect(db.entries.get(SEARCHES_KEY).items[0]).toMatchObject({ archived: true, filters: complete, version: 2 });
    await expect(updateProcurementState(db.call, { ...search, expectedVersion: 1 }, 'stale-search')).rejects.toThrow('another session');
    await updateProcurementState(db.call, { ...search, expectedVersion: 2 }, 'search-restore');
    expect(db.entries.get(SEARCHES_KEY).items[0]).toMatchObject({ archived: false, version: 3 });
    expect(db.records.size).toBe(2);
    expect(db.commits.every(commit => commit.entries[0].key === SEARCHES_KEY)).toBe(true);
  });

  it('validates saved-search fields and defaults older supplier filters without enabling alerts', () => {
    const { supplier: omitted, ...old } = filters;
    expect(validateProcurementFilters(old).supplier).toBe('');
    expect(validateProcurementFilters(filters)).not.toHaveProperty('alerts');
    for (const invalid of [{ ...filters, enabled: true }, { ...filters, source: 'BC Bid' }, { ...filters, deadline: 'yesterday' }, { ...filters, shortlist: 'true' }, { ...filters, search: 'x'.repeat(1001) }]) expect(() => validateProcurementFilters(invalid)).toThrow();
  });

  it('accepts older saved filters and validates exact classification without trimming source values', () => {
    const { classification: omitted, ...old } = filters;
    expect(validateProcurementFilters(old).classification).toBe('');
    expect(validateProcurementFilters({ ...old, classification: ' ["72100000"] ' }).classification).toBe(' ["72100000"] ');
    for (const classification of ['x'.repeat(12001), ['72100000'], 42]) expect(() => validateProcurementFilters({ ...old, classification })).toThrow('classification');
    const oldEntry = { id: 'old-search', name: 'Old search', filters: old, version: 1, updatedAt: '2026-09-22T12:00:00Z', lastRunId: 'old', archived: false };
    expect(readProcurementItems({ schemaVersion: 1, items: [oldEntry] }, 'searches')).toHaveLength(1);
  });

  it('retains invalid existing state and refuses unavailable storage', async () => {
    const db = database(); db.entries.set(PURSUITS_KEY, { schemaVersion: 99, items: [] });
    await expect(updateProcurementState(db.call, pursuit, 'do-not-replace')).rejects.toThrow('existing data was retained');
    expect(db.entries.get(PURSUITS_KEY).schemaVersion).toBe(99);
    db.unavailable();
    await expect(updateProcurementState(db.call, search, 'no-provisioning')).rejects.toThrow('catalog must be available');
    expect(db.commits).toHaveLength(0);
    expect(() => readProcurementItems({ schemaVersion: 1, items: [{ id: 'bad' }] }, 'searches')).toThrow();
  });

  it('enforces item count limits without truncation', async () => {
    const db = database();
    const version = { version: 1, lastRunId: 'seed', updatedAt: '2026-09-22T12:00:00Z' };
    db.entries.set(SEARCHES_KEY, { schemaVersion: 1, items: Array.from({ length: MAX_SEARCHES }, (_, n) => ({ ...version, id: `saved-${n}`, name: `Saved ${n}`, filters, archived: false })) });
    await expect(updateProcurementState(db.call, search, 'over-limit')).rejects.toThrow('50 saved searches');
    db.entries.set(PURSUITS_KEY, { schemaVersion: 1, items: Array.from({ length: MAX_PURSUITS }, (_, n) => ({ ...version, recordId: `opportunity:seed-${n}`, title: 'Existing', sourceId: 'bc-bid', stage: 'Watching', notes: '' })) });
    await expect(updateProcurementState(db.call, pursuit, 'over-limit-2')).rejects.toThrow('200 records');
    expect(db.commits).toHaveLength(0);
  });
});
