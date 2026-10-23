import { describe, expect, it } from 'vitest';
import { buildLegacyContractAwardImportKey, normalizeContractAwardImportRecord } from '../packages/shared/src/contractAwards';
import { assertAwardIdentityIndexReady, backfillAwardIdentityBatch, resolveAwardImportIdentity } from '../convex/contractAwardIdentityMigration';
import { backfillIdentityBatch, importBatch } from '../convex/contractAwards';

const backfill = (db: any) => (backfillIdentityBatch as any)._handler({ db }, {});
const importRecords = (db: any, records: any[]) => (importBatch as any)._handler({ db }, { records, fileName: 'correction.json' });

const original = normalizeContractAwardImportRecord({ opportunityId: 'Ab-123', contractNumber: 'Contract-a', opportunityDescription: 'Old title', successfulSupplier: 'Original supplier' } as any);
function database(input: any[]) {
  const rows = input.map(row => structuredClone(row));
  const reads: number[] = [], patches: any[] = [];
  const db = {
    query: (table: string) => {
      expect(table).toBe('contractAwards');
      let predicates: Array<[string, unknown]> = [];
      return { withIndex: (_index: string, select: (q: any) => unknown) => {
        const q: any = { eq: (field: string, value: unknown) => { predicates.push([field, value]); return q; } };
        select(q);
        return { take: async (limit: number) => { reads.push(limit); return rows.filter(row => predicates.every(([field, value]) => row[field] === value)).slice(0, limit).map(row => structuredClone(row)); } };
      } };
    },
    patch: async (id: string, value: any) => { patches.push({ id, value }); Object.assign(rows.find(row => row._id === id)!, value); },
    insert: async (_table: string, value: any) => { const id = `inserted-${rows.length}`; rows.push({ ...value, _id: id }); return id; },
  };
  return { db: db as any, rows, reads, patches };
}

describe('bounded legacy Convex award identity migration', () => {
  it('blocks imports until every legacy row is indexed, then adopts case variants beyond the first batch', async () => {
    const target = { ...original, _id: 'retained-id', importKey: buildLegacyContractAwardImportKey(original), createdAt: 1, updatedAt: 2, starred: true };
    const fixture = database([...Array.from({ length: 405 }, (_, i) => ({ ...original, _id: `filler-${i}`, opportunityId: `FILLER-${i}`, importKey: `legacy-${i}` })), target]);
    const correction = { ...original, opportunityId: 'AB-123', contractNumber: 'CONTRACT-A', opportunityDescription: 'Corrected title', successfulSupplier: 'Corrected supplier' };
    await expect(importRecords(fixture.db, [correction])).rejects.toThrow('migration is incomplete');
    expect(fixture.patches).toHaveLength(0);
    expect(await backfill(fixture.db)).toEqual({ updated: 200, done: false });
    await expect(importRecords(fixture.db, [correction])).rejects.toThrow('migration is incomplete');
    expect(await backfill(fixture.db)).toEqual({ updated: 200, done: false });
    expect(await backfill(fixture.db)).toEqual({ updated: 6, done: true });
    await assertAwardIdentityIndexReady(fixture.db);
    expect(await backfill(fixture.db)).toEqual({ updated: 0, done: true });
    const result = await resolveAwardImportIdentity(fixture.db, correction);
    expect(result.importKey).toBe(target.importKey);
    expect(result.previous).toMatchObject({ _id: target._id, starred: true, createdAt: 1, updatedAt: 2 });
    expect(fixture.rows.at(-1)).toMatchObject(target);
    expect(fixture.patches.every(patch => Object.keys(patch.value).sort().join(',') === 'identityKey,identityStatus,identityVersion')).toBe(true);
    expect(await importRecords(fixture.db, [correction])).toMatchObject({ inserted: 0, updated: 1 });
    expect(fixture.rows).toHaveLength(406);
    expect(fixture.rows.at(-1)).toMatchObject({ _id: target._id, importKey: target.importKey, starred: true, createdAt: 1, opportunityDescription: 'Corrected title' });
    expect(Math.max(...fixture.reads)).toBe(200);
  });

  it('rejects ambiguous physical legacy IDs after case-normalized indexing', async () => {
    const fixture = database([
      { ...original, _id: 'one', importKey: 'legacy-one' },
      { ...original, opportunityId: 'AB-123', contractNumber: 'CONTRACT-A', _id: 'two', importKey: 'legacy-two' },
    ]);
    await backfill(fixture.db);
    const patchesBeforeImport = fixture.patches.length;
    await expect(importRecords(fixture.db, [{ ...original, opportunityDescription: 'Correction' }])).rejects.toThrow('multiple saved records');
    expect(fixture.patches).toHaveLength(patchesBeforeImport);
  });

  it('preserves source namespaces and case-sensitive source award IDs', async () => {
    const fixture = database([
      { ...original, sourceId: 'Other', sourceAwardId: 'Ab', _id: 'one', importKey: 'source-one' },
      { ...original, sourceId: 'Other', sourceAwardId: 'ab', _id: 'two', importKey: 'source-two' },
    ]);
    await backfillAwardIdentityBatch(fixture.db);
    expect((await resolveAwardImportIdentity(fixture.db, { ...original, sourceId: 'other', sourceAwardId: 'Ab' })).previous?._id).toBe('one');
    expect((await resolveAwardImportIdentity(fixture.db, { ...original, sourceId: 'other', sourceAwardId: 'ab' })).previous?._id).toBe('two');
    expect((await resolveAwardImportIdentity(fixture.db, { ...original, sourceAwardId: 'Ab' })).previous).toBeUndefined();
  });
});
