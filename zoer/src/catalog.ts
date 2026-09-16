import { isDeepStrictEqual } from 'node:util';
import { buildModel, type SavedDocument } from '../dashboard/model';
import { buildContractAwardImportKey, buildContractAwardSearchText, parseContractAwardValue } from '../../packages/shared/src/contractAwards';

type Host = (method: string, input: any) => Promise<any>;
const defaults = { descriptionText: '', detailFields: [], attachments: [], addenda: [], commodities: [], searchText: '' };
export const catalogRow = (kind: string, row: any) => ({ id: kind + ':' + (kind === 'award' ? row.importKey : row.sourceKey), kind, title: kind === 'award' ? row.opportunityDescription : row.description, data: kind==='award' ? {...row,attachmentLookup:row.opportunityId?{kind:'opportunity',field:'opportunityId',value:row.opportunityId}:null} : row });
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
    const ids = doc.records.map((row: any) => 'award:' + buildContractAwardImportKey(row));
    const previous = new Map((await call('catalog.read', { ids })).records.map((row: any) => [row.id, row.data]));
    records = doc.records.map((row: any) => {
      const importKey = buildContractAwardImportKey(row), old: any = previous.get('award:' + importKey);
      const candidate = catalogRow('award', { ...old, ...row, _id: importKey, _creationTime: old?._creationTime ?? time, importKey, contractValue: parseContractAwardValue(row.contractValueText), searchText: buildContractAwardSearchText(row), sourceFileName: doc.fileName ?? old?.sourceFileName, sourceUrl: doc.sourceUrl ?? row.sourceUrl ?? old?.sourceUrl ?? null, createdAt: old?.createdAt ?? time, updatedAt: old?.updatedAt ?? time, starred: old?.starred ?? row.starred === true });
      // Do not manufacture a change by replacing updatedAt on every backfill.
      // Canonical JSON also omits undefined properties absent from SQLite JSON.
      if (old && isDeepStrictEqual(JSON.parse(JSON.stringify(candidate.data)), old)) return null;
      candidate.data.updatedAt = time;
      return candidate;
    }).filter(Boolean);
    if (doc.checkpoint) entries.push({ key: doc.checkpointKey === 'checkpoint:awards:recent' ? doc.checkpointKey : 'checkpoint:awards', value: { ...doc.checkpoint, runId } });
    if (doc.legacyCheckpoint) entries.push({ key: 'checkpoint:awards:legacy', value: doc.legacyCheckpoint });
  } else if (doc.kind === 'detail') {
    const found = (await call('catalog.read', { match: { kind: 'opportunity', field: 'processId', value: doc.record.processId }, limit: 2 })).records;
    if (found.length !== 1) throw new Error('Detail does not match exactly one saved opportunity.');
    const row = { ...found[0].data, ...doc.record, starred: found[0].data.starred, lastRunId: runId };
    records = [catalogRow('opportunity', row)];
    const state = await call('catalog.workspace', { keys: ['checkpoint:full'] });
    const checkpoint = state.entries.find((entry: any) => entry.key === 'checkpoint:full')?.value;
    if (checkpoint?.pending?.some((item: any) => item.sourceKey === row.sourceKey)) entries.push({ key: 'checkpoint:full', value: { ...checkpoint, pending: checkpoint.pending.filter((item: any) => item.sourceKey !== row.sourceKey), detailsCompleted: checkpoint.detailsCompleted + 1 } });
  } else if (['listing', 'scrape'].includes(doc.kind)) {
    const previous = new Map((await call('catalog.read', { ids: (doc.records ?? []).map((row: any) => 'opportunity:' + row.sourceKey) })).records.map((row: any) => [row.id, row.data]));
    records = (doc.records ?? []).map((row: any) => {
      const old: any = previous.get('opportunity:' + row.sourceKey);
      const detail = old && !row.detailFields?.length ? { descriptionText: old.descriptionText, detailFields: old.detailFields, addenda: old.addenda, attachments: old.attachments } : {};
      return catalogRow('opportunity', { ...defaults, ...old, ...row, ...detail, starred: old?.starred ?? row.starred === true, lastRunId: runId });
    });
    if (doc.scope === 'all-current-public-opportunities') entries.push({ key: 'checkpoint:full', value: doc });
  } else throw new Error('Unsupported database document.');
  if (doc.kind !== 'star') {
    const previous = await call('catalog.workspace', { keys: ['run:' + runId] });
    const existing = previous.entries.find((entry: any) => entry.key === 'run:' + runId);
    if (doc.kind === 'scrape' || !existing) entries.push(metadata(doc, record));
    history = records.filter(row => row.kind === 'opportunity').map(row => ({ runId, id: row.data.sourceKey, data: row.data }));
  }
  // An optimistic revision check prevents concurrent runs from overwriting a
  // newer star or scrape. The caller retries the entire read/merge transaction.
  const committed=await call('catalog.commit', { revision: initial.revision, records, entries, history });
  if(committed.conflict) throw new Error('Catalog changed; retry transaction.');
  return 'catalog:' + runId;
}
