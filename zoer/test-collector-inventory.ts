import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { saveCatalogDocument } from './src/catalog';

// Exercise the host's actual byte-bounded SQLite reader, without a server or source requests.
const hostSource = process.env.ZOER_SOURCE_ROOT
  ? pathToFileURL(join(process.env.ZOER_SOURCE_ROOT, 'backend/src/plugin-catalog.ts')).href
  : new URL('../../zoer/backend/src/plugin-catalog.ts', import.meta.url).href;
const { PluginCatalog } = await import(hostSource);
const root = mkdtempSync(join(tmpdir(), 'collector-inventory-check-'));
const db = new PluginCatalog('collector-inventory-check', root);
try {
  const rows = Array.from({ length: 21877 }, (_, i) => {
    const importKey = `legacy-${String(i).padStart(5, '0')}`;
    return { id: `award:${importKey}`, kind: 'award', title: 'Original', data: {
      importKey, _id: importKey, opportunityId: `A-${i}`, contractNumber: ` C-${i} `,
      opportunityDescription: 'Original', issuingOrganization: 'Buyer', successfulSupplier: 'Supplier',
      contractValueText: '100.00', currency: 'CAD', starred: true,
      // The first 400 records exceed the byte page limit before the row limit.
      descriptionText: 'x'.repeat(i < 400 ? 20000 : 256),
    } };
  });
  db.db.transaction(() => { for (let i = 0; i < rows.length; i += 200) db.upsert(rows.slice(i, i + 200)); })();
  const checkpoint = { phase: 'paused', pending: ['retained-process'], complete: false };
  db.commit({ revision: 0, primary: true, entries: [{ key: 'checkpoint:full', value: checkpoint }] });
  let inventoryPages = 0, inventoryRows = 0, byteLimitedPages = 0, allReads = 0;
  const call = async (method: string, input: any): Promise<any> => {
    let result;
    if (method === 'catalog.read') {
      allReads++;
      result = db.workspaceRead(input);
      if (input.kind === 'award') {
        inventoryPages++;
        inventoryRows += result.records.length;
        if (result.records.length > 0 && result.records.length < 200 && result.next) byteLimitedPages++;
      }
    } else if (method === 'catalog.workspace') result = db.workspaceState(input);
    else if (method === 'catalog.commit') result = db.commit(input);
    else throw new Error(`Unexpected host method ${method}`);
    // Mirror the JSON worker channel, including its serialization cost.
    return JSON.parse(JSON.stringify(result));
  };
  const incoming = rows.slice(-200).map(row => ({ ...row.data,
    opportunityId: row.data.opportunityId.toLowerCase(), contractNumber: row.data.contractNumber.trim().toLowerCase(),
    opportunityDescription: 'Corrected', contractValueText: '1.2 million', starred: false,
  }));
  const start = performance.now();
  await saveCatalogDocument(call, { kind: 'awards', records: incoming }, 'first-page');
  const firstMs = performance.now() - start, firstPages = inventoryPages, firstReads = allReads;
  assert.equal(inventoryRows, 21877);
  assert.ok(byteLimitedPages >= 2, 'Real byte limits must truncate more than one inventory page');
  assert.equal(db.db.query("SELECT count(*) AS n FROM records WHERE kind='award'").get().n, 21877);
  const corrected = db.record(rows.at(-1)!.id).data;
  assert.equal(corrected.contractValue, 1200000);
  assert.equal(corrected.starred, true);
  assert.equal(corrected.importKey, rows.at(-1)!.data.importKey);
  const nextStart = performance.now();
  await saveCatalogDocument(call, { kind: 'awards', records: incoming }, 'second-page');
  const nextMs = performance.now() - nextStart, nextReads = allReads - firstReads;
  assert.equal(inventoryPages, firstPages, 'The next captured page must reuse the complete index');
  assert.deepEqual(db.workspaceState({ keys: ['checkpoint:full'] }).entries[0].value, checkpoint);
  const revision = db.workspaceRead({ ids: [] }).revision;
  db.commit({ revision, records: [{ ...rows.at(-1), id: 'award:other-case-variant', data: {
    ...rows.at(-1)!.data, importKey: 'other-case-variant', _id: 'other-case-variant',
  } }] });
  await assert.rejects(saveCatalogDocument(call, { kind: 'awards', records: [incoming.at(-1)] }, 'ambiguous'), /multiple saved/);
  assert.ok(inventoryPages > firstPages, 'Outside commits must invalidate the identity index');
  console.log(JSON.stringify({ awards: 21877, batch: 200, inventoryPages: firstPages, byteLimitedPages,
    firstReads, firstMs: Math.round(firstMs), nextInventoryPages: 0,
    nextReads, nextMs: Math.round(nextMs),
    // Includes the SQLite host, seeding fixture and collector in one process.
    testProcessRssMiB: Math.round(process.memoryUsage().rss / 1024 / 1024),
    verified: ['normalized legacy anchors', 'byte-bounded paging', 'one inventory per action', 'outside revision invalidation', 'ambiguity rejection', 'preserved physical IDs/stars/checkpoint'],
  }, null, 2));
} finally { db.db.close(); rmSync(root, { recursive: true, force: true }); rmSync(dirname(db.path), { recursive: true, force: true }); }
