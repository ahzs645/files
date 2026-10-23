import { filterReferenceRecords, sourceMetadata } from './source-metadata';
import { isDeepStrictEqual } from 'node:util';
import { createHash } from 'node:crypto';
import { publicationBuyerMetadata } from './publication-metadata';
import { buildModel, type SavedDocument } from '../dashboard/model';
import { enrichNotice } from '../dashboard/procurement/enrich';
import { classifyCatalogRecords } from './taxonomy';
import { listingDetailRefresh } from './detail-policy';
import { buildContractAwardImportKey, buildLegacyContractAwardImportKey, buildContractAwardSearchText, contractAwardIdentity, deduplicateContractAwards, normalizeContractAwardImportRecord, parseContractAwardMoney, reconcileContractAwardIdentity } from '../../packages/shared/src/contractAwards';

type Host = (method: string, input: any) => Promise<any>;
type AwardInventory = { revision: number; byIdentity: Map<string, Set<string>>; byId: Map<string, string> };
// A worker keeps the same host channel for the whole action. Reuse its complete
// identity index across captured pages, but invalidate on any outside revision.
const awardInventories = new WeakMap<Host, AwardInventory>();
function indexAward(inventory: AwardInventory, id: string, data: any) {
  const prior = inventory.byId.get(id);
  if (prior) inventory.byIdentity.get(prior)?.delete(id);
  inventory.byId.delete(id);
  const identity = contractAwardIdentity(data);
  if (identity.status === 'legacy_unresolved') return;
  inventory.byId.set(id, identity.key);
  if (!inventory.byIdentity.has(identity.key)) inventory.byIdentity.set(identity.key, new Set());
  inventory.byIdentity.get(identity.key)!.add(id);
}
const defaults = { descriptionText: '', detailFields: [], attachments: [], addenda: [], commodities: [], searchText: '' };
export const catalogRow = (kind: 'award' | 'opportunity', row: any) => ({ id: kind + ':' + (kind === 'award' ? row.importKey : row.sourceKey), kind, title: kind === 'award' ? row.opportunityDescription : row.description,
  data: { ...row, ...publicationBuyerMetadata(kind, row), ...(kind === 'award' ? { attachmentLookup: row.opportunityId ? { kind: 'opportunity', field: 'opportunityId', value: row.opportunityId } : null } : {}) } });
export function metadata(doc: any, record: any) {
  const { records, ...summary } = doc;
  return { key: 'run:' + record.runId, value: { record, document: { ...summary, knownKeys: doc.knownKeys ?? records?.map((row: any) => row.sourceKey).filter(Boolean), recordsCount: records?.length ?? 0 } } };
}
export async function migrateCatalog(call: Host) {
  if ((await call('catalog.read', { ids: [] })).primary) return { alreadyMigrated: true };
  const documents: SavedDocument[] = [];
  let offset: number | null = 0;
  do { const page = await call('catalog.legacy', { offset }); documents.push(...page.documents); offset = page.next; } while (offset !== null);
  const model = buildModel({ runs: [], artifacts: [] }, documents);
  const byRun = new Map<string, SavedDocument>();
  for (const item of documents) if (item.document.kind === 'scrape' || !byRun.has(item.record.runId)) byRun.set(item.record.runId, item);
  let revision = (await call('catalog.read', { ids: [] })).revision;
  const commit = async (value: any) => { const result=await call('catalog.commit', { revision, migration:true, ...value }); if(result.conflict) throw new Error('Database changed during migration; retry safely.'); revision=result.revision; };
  const rows = [...model.opportunities.map(row => catalogRow('opportunity', row)), ...model.awards.map(row => catalogRow('award', row))];
  // Merge migration rows into the existing catalog; documents/tags/reviews are
  // separate tables and are never replaced by this compatibility migration.
  for (let i = 0; i < rows.length; i += 50) {
    const batch = rows.slice(i, i + 50);
    const old = await call('catalog.read', { ids: batch.map(row => row.id) });
    const previous = new Map(old.records.map((row: any) => [row.id, row.data]));
    await commit({ records: batch.map(row => ({ ...row, data: { ...(previous.get(row.id) as any), ...row.data } })) });
  }
  for (const [runId, history] of model.history) {
    const rows = [...history.values()];
    for (let i = 0; i < rows.length; i += 50) await commit({ history: rows.slice(i, i + 50).map(row => ({ runId, id: row.sourceKey, data: row })) });
  }
  for (const item of byRun.values()) await commit({ entries: [metadata(item.document, item.record)] });
  const full = [...documents].reverse().find(item => item.document.scope === 'all-current-public-opportunities' && item.document.kind === 'scrape');
  if (full) {
    const checkpoint = structuredClone(full.document);
    const completed = new Set(documents.filter(item => item.record.runId === full.record.runId && item.document.kind === 'detail').map(item => item.document.sourceKey));
    const before = checkpoint.pending.length;
    checkpoint.pending = checkpoint.pending.filter((row: any) => !completed.has(row.sourceKey));
    checkpoint.detailsCompleted += before - checkpoint.pending.length;
    await commit({ entries: [{ key: 'checkpoint:full', value: checkpoint }] });
  }
  await commit({ entries: [{ key: 'checkpoint:awards', value: model.awardCheckpoint }], primary: true });
  return { migrated: rows.length, sourceArtifacts: documents.length };
}

export async function saveCatalogDocument(call: Host, doc: any, runId: string) {
  const initial = await call('catalog.read', { ids: [] });
  if (!initial.primary) throw new Error('Open BC Bid to complete its database migration before scraping.');
  const now = new Date().toISOString(), time = Date.parse(now);
  const record = { id: runId, runId, createdAt: now };
  let records: any[] = [], history: any[] = [], entries: any[] = [];
  if (doc.kind === 'star') {
    const id = doc.entity + ':' + doc.key;
    const found = (await call('catalog.read', { ids: [id] })).records[0];
    if (!found) throw new Error('The saved bid no longer exists.');
    records = [{ ...found, data: { ...found.data, starred: doc.starred } }];
  } else if (doc.kind === 'awards') {
    deduplicateContractAwards(doc.records);
    const ids = new Set<string>(doc.records.flatMap((row: any) => [buildContractAwardImportKey(row), buildLegacyContractAwardImportKey(row)]).map((key: string) => 'award:' + key));
    const previous = new Map<string, any>();
    // Legacy keys contained mutable facts. Page once over the complete award inventory:
    // exact field lookups miss normalized anchors and can silently omit byte-limited matches.
    // Cache only identity-to-ID references, not complete source records.
    const wanted = new Set<string>(doc.records.map((row: any) => contractAwardIdentity(row)).filter((identity: any) => identity.status !== 'legacy_unresolved').map((identity: any) => identity.key));
    if (wanted.size) {
      let inventory = awardInventories.get(call);
      if (!inventory || inventory.revision !== initial.revision) {
        inventory = { revision: initial.revision, byIdentity: new Map(), byId: new Map() };
        let after = '';
        while (true) {
          const page = await call('catalog.read', { kind: 'award', after, limit: 200 });
          if (page.revision !== initial.revision) throw new Error('Catalog changed; retry transaction.');
          for (const item of page.records) indexAward(inventory, item.id, item.data);
          if (!page.next) break;
          if (typeof page.next !== 'string' || page.next <= after) throw new Error('Award identity inventory did not advance; retry safely.');
          after = page.next;
        }
        awardInventories.set(call, inventory);
      }
      for (const key of wanted) for (const id of inventory.byIdentity.get(key) ?? []) ids.add(id);
    }
    const requestedIds = [...ids];
    for (let offset = 0, size = 200; offset < requestedIds.length;) {
      let page;
      try { page = await call('catalog.read', { ids: requestedIds.slice(offset, offset + size) }); }
      catch (error) {
        if (size <= 1 || !/Record lookup too large/.test(String(error))) throw error;
        size = Math.max(1, Math.floor(size / 2)); continue;
      }
      if (page.revision !== initial.revision) throw new Error('Catalog changed; retry transaction.');
      for (const row of page.records) previous.set(row.id, row.data);
      offset += size;
    }
    records = doc.records.map((row: any) => {
      const { importKey, previous: old, identity } = reconcileContractAwardIdentity(row, [...previous.values()]);
      const contractValueParsed = parseContractAwardMoney(row.contractValueText, { currency: row.currency });
      const sourceRevision = createHash('sha256').update(JSON.stringify(normalizeContractAwardImportRecord(row))).digest('hex');
      const candidate = catalogRow('award', { ...old, ...row, _id: importKey, _creationTime: old?._creationTime ?? time, importKey, identityKey: identity.key, identityStatus: identity.status, identityVersion: identity.version, sourceRevision,
        contractValueParsed, contractValue: contractValueParsed.value, searchText: buildContractAwardSearchText(row), sourceFileName: doc.fileName ?? old?.sourceFileName, sourceUrl: doc.sourceUrl ?? row.sourceUrl ?? old?.sourceUrl ?? null, createdAt: old?.createdAt ?? time, updatedAt: old?.updatedAt ?? time, starred: old?.starred ?? row.starred === true });
      // Do not manufacture a change by replacing updatedAt on every backfill.
      // Canonical JSON also omits undefined properties absent from SQLite JSON.
      if (old && isDeepStrictEqual(JSON.parse(JSON.stringify(candidate.data)), old)) return null;
      candidate.data.updatedAt = time;
      candidate.data.observedAt = typeof doc.capturedAt === 'string' ? doc.capturedAt : now;
      candidate.data.collectionRunId = runId;
      return candidate;
    }).filter(Boolean);
    if (doc.checkpoint) entries.push({ key: doc.checkpointKey === 'checkpoint:awards:recent' ? doc.checkpointKey : 'checkpoint:awards', value: { ...doc.checkpoint, runId } });
    if (doc.legacyCheckpoint) entries.push({ key: 'checkpoint:awards:legacy', value: doc.legacyCheckpoint });
  } else if (doc.kind === 'detail') {
    const found = (await call('catalog.read', doc.scope === 'bcbid-historical' && doc.sourceKey
      ? { ids: ['opportunity:' + doc.sourceKey] }
      : { match: { kind: 'opportunity', field: 'processId', value: doc.record.processId }, limit: 2 })).records;
    if (doc.scope === 'bcbid-historical' && found.some((row: any) => row.kind !== 'opportunity' || row.data.processId !== doc.record.processId)) throw new Error('Historical detail does not match its saved source key.');
    if (found.length !== 1) throw new Error('Detail does not match exactly one saved opportunity.');
    const status = doc.record.detailFields?.find((field: any) => /^status$/i.test(field.label.trim()))?.value?.trim();
    // Place and contacts are re-derived from the merged row: the detail page adds the fields they come from.
    const row = enrichNotice(sourceMetadata({ ...found[0].data, ...doc.record,
      ...listingDetailRefresh(found[0].data, doc.record, true, doc.detailCaptureVersion),
      ...(status ? { status } : {}), starred: found[0].data.starred, lastRunId: runId }, doc));
    records = [catalogRow('opportunity', row)];
    // A targeted refresh never edits the full crawl's progress; that crawl refetches its own pending details.
    const state = ['bcbid-targeted', 'bcbid-historical'].includes(doc.scope) ? { entries: [] } : await call('catalog.workspace', { keys: ['checkpoint:full'] });
    const checkpoint = state.entries.find((entry: any) => entry.key === 'checkpoint:full')?.value;
    if (checkpoint?.pending?.some((item: any) => item.sourceKey === row.sourceKey)) entries.push({ key: 'checkpoint:full', value: { ...checkpoint, pending: checkpoint.pending.filter((item: any) => item.sourceKey !== row.sourceKey), detailsCompleted: checkpoint.detailsCompleted + 1 } });
  } else if (['listing', 'scrape'].includes(doc.kind)) {
    const previous = new Map((await call('catalog.read', { ids: (doc.records ?? []).map((row: any) => 'opportunity:' + row.sourceKey) })).records.map((row: any) => [row.id, row.data]));
    records = (doc.records ?? []).map((row: any) => {
      const old: any = previous.get('opportunity:' + row.sourceKey);
      const detail = old && !row.detailFields?.length ? { descriptionText: old.descriptionText, detailFields: old.detailFields, addenda: old.addenda, attachments: old.attachments,
        // A listing's flattened label cell must not erase the last captured
        // authoritative tables. A subsequent detail capture replaces them.
        ...(old.commodityTablesCaptured || old.commoditySourceProvenance ? { commodities: old.commodities, mainCommodity: old.mainCommodity, commodityTablesCaptured: old.commodityTablesCaptured } : {}) } : {};
      // Persist before the detail queue runs. A cap, skipped detail or failure
      // must remain retryable even after this merge updates the listing values.
      const refresh = listingDetailRefresh(old, row, doc.kind === 'scrape' && Boolean(row.detailFields?.length), doc.detailCaptureVersion);
      return catalogRow('opportunity', enrichNotice(sourceMetadata({ ...defaults, ...old, ...row, ...detail, ...refresh,
        starred: old?.starred ?? row.starred === true, lastRunId: runId }, doc)));
    });
    if (doc.scope === 'all-current-public-opportunities') entries.push({ key: 'checkpoint:full', value: doc });
  } else throw new Error('Unsupported database document.');
  if (doc.kind !== 'star' && records.some(row => row.kind === 'opportunity')) {
    const known = await call('catalog.read', { ids: ['reference-release:BCBID:filters:20261010'] });
    if (!known.records.length) records.push(...filterReferenceRecords());
  }
  if (doc.historicalCheckpoint) entries.push({ key: 'checkpoint:historical', value: { ...doc.historicalCheckpoint, runId } });
  if (doc.historicalReferences) records.push(...doc.historicalReferences);
  if (records.length > 200) throw new Error('Historical reference batch exceeds the catalog limit.');
  if (doc.kind !== 'star') {
    const previous = await call('catalog.workspace', { keys: ['run:' + runId] });
    const existing = previous.entries.find((entry: any) => entry.key === 'run:' + runId);
    if (doc.kind === 'scrape' || !existing) entries.push(metadata(doc, record));
    history = records.filter(row => row.kind === 'opportunity').map(row => ({ runId, id: row.data.sourceKey, data: row.data }));
  }
  // An optimistic revision check prevents concurrent runs from overwriting a
  // newer star or scrape. The caller retries the entire read/merge transaction.
  const classified = doc.kind === 'star' ? { records, links: [] } : await classifyCatalogRecords(call, records);
  // Stage immutable links first. They become current only when the opportunity's
  // fingerprint is published below; interrupted/retried staging is harmless.
  let revision = initial.revision;
  for (let offset = 0; offset < classified.links.length; offset += 200) {
    const receipt = await call('catalog.commit', { revision, records: classified.links.slice(offset, offset + 200) });
    if (receipt.conflict) throw new Error('Catalog changed; retry transaction.');
    revision = receipt.revision;
  }
  const committed=await call('catalog.commit', { revision, records: classified.records, entries, history });
  if(committed.conflict) throw new Error('Catalog changed; retry transaction.');
  const inventory = awardInventories.get(call);
  if (inventory?.revision === initial.revision) {
    for (const row of classified.records) if (row.kind === 'award') indexAward(inventory, row.id, row.data);
    inventory.revision = committed.revision;
  }
  return 'catalog:' + runId;
}
