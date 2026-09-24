import { describe, expect, it } from 'vitest';
import { CLASSIFICATIONS_KEY, MAX_CLASSIFICATION_MAPPINGS, classificationKey, readClassificationMappings } from '../zoer/dashboard/procurement/classification-contract';
import { updateProcurementClassifications } from '../zoer/src/procurement-classifications';

const input = { operation: 'mapping.upsert', sourceId: 'canadabuys', rawClassification: '[{"scheme":"UNSPSC","code":"72100000"}]', label: 'Building maintenance', expectedVersion: 0 };
function database() {
  let revision = 1, primary = true;
  const records = [{ id: 'opportunity:existing', data: { sourceId: 'canadabuys', classificationCodes: [{ scheme: 'UNSPSC', code: '72100000' }], starred: true, attachments: ['saved.pdf'] } }];
  const entries = new Map<string, any>([['checkpoint:full', { retained: true }], ['procurement:pursuits', { unchanged: true }]]);
  const commits: any[] = [];
  const call = async (method: string, body: any): Promise<any> => {
    if (method === 'catalog.read') return { revision, primary, records: [] };
    if (method === 'catalog.workspace') return { entries: body.keys.flatMap((key: string) => entries.has(key) ? [{ key, value: structuredClone(entries.get(key)) }] : []) };
    if (method === 'catalog.commit') {
      if (body.revision !== revision) throw Error('Catalog changed; reload the snapshot.');
      commits.push(structuredClone(body));
      for (const entry of body.entries ?? []) entries.set(entry.key, structuredClone(entry.value));
      return { revision: ++revision };
    }
    throw Error(`Unexpected host method ${method}`);
  };
  return { call, entries, records, commits, bump: () => { revision++; }, unavailable: () => { primary = false; } };
}

describe('explicit source classification mappings', () => {
  it('namespaces exact raw values by source and leaves records, documents and other state unchanged', async () => {
    const db = database(), before = structuredClone(db.records);
    await updateProcurementClassifications(db.call, input, 'federal');
    await updateProcurementClassifications(db.call, { ...input, sourceId: 'bc-bid', label: 'BC-specific interpretation' }, 'provincial');
    const mappings = readClassificationMappings(db.entries.get(CLASSIFICATIONS_KEY));
    expect(mappings).toHaveLength(2);
    expect(mappings.map(item => item.rawClassification)).toEqual([input.rawClassification, input.rawClassification]);
    expect(mappings.map(item => item.label)).toEqual(['Building maintenance', 'BC-specific interpretation']);
    expect(db.records).toEqual(before);
    expect(db.entries.get('checkpoint:full')).toEqual({ retained: true });
    expect(db.entries.get('procurement:pursuits')).toEqual({ unchanged: true });
    expect(db.commits.every(commit => Object.keys(commit).sort().join(',') === 'entries,revision' && commit.entries.length === 1 && commit.entries[0].key === CLASSIFICATIONS_KEY)).toBe(true);
    expect(classificationKey('a', 'b:c')).not.toBe(classificationKey('a:b', 'c'));
  });

  it('archives and restores a display mapping without deleting its original value or resetting version', async () => {
    const db = database();
    await updateProcurementClassifications(db.call, input, 'create');
    await updateProcurementClassifications(db.call, { ...input, operation: 'mapping.archive', expectedVersion: 1 }, 'archive');
    expect(db.entries.get(CLASSIFICATIONS_KEY).items[0]).toMatchObject({ archived: true, label: input.label, rawClassification: input.rawClassification, version: 2 });
    await updateProcurementClassifications(db.call, { ...input, label: 'Reviewed label', expectedVersion: 2 }, 'restore');
    expect(db.entries.get(CLASSIFICATIONS_KEY).items[0]).toMatchObject({ archived: false, label: 'Reviewed label', version: 3 });
  });

  it('preserves another mapping saved during a catalog conflict', async () => {
    const db = database(); let changed = false;
    const call = async (method: string, body: any) => {
      if (method === 'catalog.commit' && !changed) { changed = true; await updateProcurementClassifications(db.call, { ...input, rawClassification: 'other raw value', label: 'Other' }, 'concurrent-other'); }
      return db.call(method, body);
    };
    await updateProcurementClassifications(call, input, 'mine');
    expect(db.entries.get(CLASSIFICATIONS_KEY).items.map((item: any) => item.rawClassification)).toEqual(['other raw value', input.rawClassification]);
  });

  it('rejects a stale same-item edit rather than overwriting an approved label', async () => {
    const db = database(); await updateProcurementClassifications(db.call, input, 'initial'); let changed = false;
    const call = async (method: string, body: any) => {
      if (method === 'catalog.commit' && !changed) { changed = true; await updateProcurementClassifications(db.call, { ...input, label: 'Other reviewer', expectedVersion: 1 }, 'other-editor'); }
      return db.call(method, body);
    };
    await expect(updateProcurementClassifications(call, { ...input, label: 'Stale label', expectedVersion: 1 }, 'mine')).rejects.toThrow('another session');
    expect(db.entries.get(CLASSIFICATIONS_KEY).items[0]).toMatchObject({ label: 'Other reviewer', version: 2 });
  });

  it('replays one durable run safely and rejects reuse with a different label', async () => {
    const db = database();
    await updateProcurementClassifications(db.call, input, 'one-run');
    expect(await updateProcurementClassifications(db.call, input, 'one-run')).toMatchObject({ alreadyApplied: true });
    await expect(updateProcurementClassifications(db.call, { ...input, label: 'Different' }, 'one-run')).rejects.toThrow('different mapping change');
    expect(db.commits).toHaveLength(1);
  });

  it('retains unknown sources and refuses corrupt saved schemas, duplicate identities and invalid input', async () => {
    const db = database();
    await updateProcurementClassifications(db.call, { ...input, sourceId: 'future-source' }, 'custom');
    expect(readClassificationMappings(db.entries.get(CLASSIFICATIONS_KEY))[0].sourceId).toBe('future-source');
    const item = db.entries.get(CLASSIFICATIONS_KEY).items[0];
    expect(() => readClassificationMappings({ schemaVersion: 1, items: [item, item] })).toThrow('Duplicate');
    db.entries.set(CLASSIFICATIONS_KEY, { schemaVersion: 99, items: [] });
    await expect(updateProcurementClassifications(db.call, input, 'no-replace')).rejects.toThrow('existing data was retained');
    expect(db.entries.get(CLASSIFICATIONS_KEY).schemaVersion).toBe(99);
    for (const invalid of [{ ...input, sourceId: 'all' }, { ...input, rawClassification: '' }, { ...input, expectedVersion: -1 }, { ...input, label: ' ' }, { ...input, label: 'x'.repeat(161) }, { ...input, rawClassification: 'x'.repeat(12001) }]) {
      const empty = database(); await expect(updateProcurementClassifications(empty.call, invalid, 'bad')).rejects.toThrow(); expect(empty.commits).toHaveLength(0);
    }
  });

  it('enforces 500 entries including archives and permits editing an existing entry at the limit', async () => {
    const db = database();
    db.entries.set(CLASSIFICATIONS_KEY, { schemaVersion: 1, items: Array.from({ length: MAX_CLASSIFICATION_MAPPINGS }, (_, index) => ({ sourceId: 'canadabuys', rawClassification: `raw-${index}`, label: `Label ${index}`, version: 1, updatedAt: '2026-09-22T00:00:00Z', archived: true, lastRunId: `old-${index}` })) });
    await expect(updateProcurementClassifications(db.call, input, 'too-many')).rejects.toThrow('500');
    await updateProcurementClassifications(db.call, { ...input, rawClassification: 'raw-0', expectedVersion: 1 }, 'restore-existing');
    expect(db.entries.get(CLASSIFICATIONS_KEY).items).toHaveLength(500);
    expect(db.entries.get(CLASSIFICATIONS_KEY).items[0]).toMatchObject({ version: 2, archived: false });
  });

  it('does not provision a database and stops after bounded unrelated revision conflicts', async () => {
    const db = database(); db.unavailable();
    await expect(updateProcurementClassifications(db.call, input, 'offline')).rejects.toThrow('catalog must be available');
    expect(db.commits).toHaveLength(0);
    const busy = database(); let attempts = 0;
    const call = async (method: string, body: any) => { if (method === 'catalog.commit') { attempts++; busy.bump(); } return busy.call(method, body); };
    await expect(updateProcurementClassifications(call, input, 'busy')).rejects.toThrow('Catalog changed');
    expect(attempts).toBe(4); expect(busy.commits).toHaveLength(0);
  });
});
