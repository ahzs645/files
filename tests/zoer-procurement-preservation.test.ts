import { describe, expect, it } from 'vitest';
import { saveCatalogDocument } from '../zoer/src/catalog';
import { parseCanadaBuysCsv, preserveCanadaBuysEnrichment, verifyCanadaBuysImportReceipt } from '../zoer/dashboard/procurement/import-canadabuys';

/** Isolated host boundary: only catalog reads/merges; no real host, database or filesystem. */
function mockCatalog(initial: any[]) {
  const records = new Map(initial.map(row => [row.id, structuredClone(row)]));
  const entries = new Map<string, any>();
  const history = new Map<string, any>();
  const calls: { method: string; input: any }[] = [];
  const documents = new Map([
    ['bc-document', { catalogId: 'opportunity:123', fileId: 'bc.pdf', extraction: 'Preserved BC document text', tags: ['reviewed'] }],
    ['canada-document', { catalogId: 'opportunity:canadabuys:tender:123:', fileId: 'canada.pdf', extraction: 'Preserved Canada document text', tags: ['shortlist'] }],
  ]);
  let revision = 1;
  async function call(method: string, input: any) {
    calls.push({ method, input: structuredClone(input) });
    if (method === 'catalog.read') return {
      primary: true, revision,
      records: [...records.values()].filter(row => input.ids.includes(row.id)).map(row => structuredClone(row)),
    };
    if (method === 'catalog.workspace') return {
      entries: [...entries].filter(([key]) => input.keys.includes(key)).map(([key, value]) => ({ key, value: structuredClone(value) })),
    };
    if (method === 'catalog.commit') {
      if (input.revision !== revision) return { conflict: true };
      for (const row of input.records ?? []) records.set(row.id, structuredClone(row));
      for (const entry of input.entries ?? []) entries.set(entry.key, structuredClone(entry.value));
      for (const row of input.history ?? []) history.set(`${row.runId}:${row.id}`, structuredClone(row));
      return { revision: ++revision };
    }
    throw new Error(`Unexpected non-catalog operation: ${method}`);
  }
  return { call, records, documents, calls, history };
}

describe('CanadaBuys import preserves existing catalog data', () => {
  it('updates only its namespaced row, retaining saved stars, provenance and separate documents on repeat imports', async () => {
    const provenance = { fileName: 'canadabuys.csv', sha256: 'b'.repeat(64), importedAt: '2026-09-22T12:00:00Z' };
    const parsed = parseCanadaBuysCsv('referenceNumber-numeroReference,title-titre-eng\n123,Updated Canada title', provenance);
    const canadaId = 'opportunity:canadabuys:tender:123:';
    const bc = { id: 'opportunity:123', kind: 'opportunity', title: 'Existing BC tender', data: {
      sourceKey: '123', processId: '123', opportunityId: '123', description: 'Existing BC tender', starred: true,
      detailFields: [{ label: 'Scope', value: 'Existing BC scope' }],
      attachments: [{ id: 'bc.pdf', url: 'https://bcbid.gov.bc.ca/bc.pdf' }], addenda: [{ title: 'BC addendum' }],
      sourceFileName: 'bc-history.json', annotations: ['Keep existing review'],
    } };
    const previousCanada = { id: canadaId, kind: 'opportunity', title: 'Old Canada title', data: {
      ...parsed.records[0], description: 'Old Canada title', starred: true, annotations: ['Existing Canada review'],
      attachments: [{ documentId: 'canada-document', url: 'https://example.ca/canada.pdf' }], addenda: [{ title: 'Existing Canada addendum' }],
    } };
    const host = mockCatalog([bc, previousCanada]);
    const bcBefore = structuredClone(host.records.get(bc.id));
    const documentsBefore = structuredClone(host.documents);
    // Reuse the same source file in two distinct runs: no duplicate catalog identity or lost star.
    for (const runId of ['canada-import-one', 'canada-import-two']) {
      const existing = await host.call('catalog.read', { ids: [canadaId] });
      const records = preserveCanadaBuysEnrichment(parsed.records, existing.records);
      await saveCatalogDocument(host.call, { kind: 'listing', fileName: provenance.fileName, records }, runId);
      expect(host.records.size).toBe(2);
      expect(host.records.get(bc.id)).toEqual(bcBefore);
      expect(host.records.get(canadaId)).toMatchObject({ id: canadaId, title: 'Updated Canada title', data: {
        sourceId: 'canadabuys', sourceKey: 'canadabuys:tender:123:', processId: 'canadabuys:tender:123:',
        opportunityId: 'canadabuys:tender:123:', externalId: '123', starred: true,
        sourceFileName: provenance.fileName, sourceFileSha256: provenance.sha256, importedAt: provenance.importedAt,
        annotations: ['Existing Canada review'], lastRunId: runId,
        attachments: previousCanada.data.attachments, addenda: previousCanada.data.addenda,
      } });
      expect(host.documents).toEqual(documentsBefore);
    }
    const commits = host.calls.filter(call => call.method === 'catalog.commit');
    expect(commits).toHaveLength(2);
    expect(commits.map(call => call.input.records.map((row: any) => row.id))).toEqual([[canadaId], [canadaId]]);
    expect(new Set(host.calls.map(call => call.method))).toEqual(new Set(['catalog.read', 'catalog.workspace', 'catalog.commit']));
    // No document payload or delete/reset operation is hidden inside a catalog commit.
    for (const commit of commits) expect(Object.keys(commit.input).sort()).toEqual(['entries', 'history', 'records', 'revision']);
    expect(host.history.size).toBe(2);
    expect([...host.history.values()].every(row => row.id === parsed.records[0].sourceKey)).toBe(true);
  });
  it('preserves newest enrichment and star changes made after frontend preparation, using the existing worker transaction', async () => {
    const parsed = parseCanadaBuysCsv('referenceNumber-numeroReference,title-titre-eng,tenderDescription-descriptionAppelOffres-eng\n123,Current CSV title,Current CSV description', {
      fileName: 'current.csv', sha256: 'c'.repeat(64), importedAt: '2026-09-22T12:30:00Z',
    });
    const id = `opportunity:${parsed.records[0].sourceKey}`;
    const host = mockCatalog([{ id, kind: 'opportunity', title: 'Old title', data: {
      ...parsed.records[0], starred: true, detailFields: [{ label: 'Old', value: 'Old' }],
      attachments: [{ documentId: 'old-document' }], addenda: [],
    } }]);
    const prepared = preserveCanadaBuysEnrichment(parsed.records, [...host.records.values()]);
    expect(prepared[0].detailFields).toEqual([]);
    // Simulate another completed action between UI preparation and worker acquisition of its revision.
    const newest = { ...host.records.get(id).data, starred: false,
      descriptionText: 'New extracted detail text', detailFields: [{ label: 'Latest detail', value: 'Keep latest' }],
      attachments: [{ documentId: 'newest-document' }], addenda: [{ title: 'Newest addendum' }],
    };
    host.records.set(id, { ...host.records.get(id), data: newest });
    await saveCatalogDocument(host.call, { kind: 'listing', records: prepared }, 'concurrent-import');
    const saved = host.records.get(id);
    expect(saved.data).toMatchObject({ starred: false, description: 'Current CSV title',
      descriptionText: newest.descriptionText, detailFields: newest.detailFields, attachments: newest.attachments, addenda: newest.addenda,
      sourceDescriptionText: 'Current CSV description', sourceFields: parsed.records[0].detailFields,
    });
    expect(() => verifyCanadaBuysImportReceipt(prepared, [saved])).not.toThrow();
  });
});
