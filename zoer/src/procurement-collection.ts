import { createHash } from 'node:crypto';
import { parseCanadaBuysCsv, preserveCanadaBuysEnrichment, verifyCanadaBuysImportReceipt } from '../dashboard/procurement/import-canadabuys';
import { nextImportBatch } from '../dashboard/procurement/import-batches';
import { CANADABUYS_DATASET_URL, CANADABUYS_DOCUMENTATION_URL, COLLECTION_KEY, canadaBuysClosingAt } from '../dashboard/procurement/source-adapters';

type Host = (method: string, input: any) => Promise<any>;
export interface CollectionInput { sourceId: 'canadabuys'; mode?: 'resume' | 'restart'; maxBatches?: number }
const MAX_BYTES = 20 * 1024 * 1024;
const LEASE_MS = 10 * 60_000;
class CollectionError extends Error { constructor(message: string, readonly code: string) { super(message); } }
const fail = (message: string, code: string): never => { throw new CollectionError(message, code); };

/** A state-only or record+cursor transaction, retried against current catalog revision. */
async function transaction(host: Host, build: (state: any, revision: number) => Promise<any>) {
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const state = await host('catalog.workspace', { keys: [COLLECTION_KEY] });
      const value = await build(state.entries.find((entry: any) => entry.key === COLLECTION_KEY)?.value ?? {}, state.revision);
      const result = await host('catalog.commit', { revision: state.revision, ...value });
      if (!result.conflict) return value.entries[0].value;
    } catch (error) {
      if (!String((error as Error).message).includes('Catalog changed')) throw error;
    }
  }
  throw new CollectionError('Catalog changed repeatedly; resume the collection safely.', 'catalog_conflict');
}

export async function collectCanadaBuys(host: Host, input: CollectionInput, runId: string, now = () => new Date().toISOString()) {
  if (input.sourceId !== 'canadabuys' || (input.mode && !['resume', 'restart'].includes(input.mode)) ||
    !Number.isInteger(input.maxBatches ?? 1) || (input.maxBatches ?? 1) < 1 || (input.maxBatches ?? 1) > 20) throw new Error('Invalid CanadaBuys collection request.');
  if (!(await host('catalog.read', { ids: [] })).primary) throw new Error('Initialize the existing procurement catalog before collecting.');
  const attemptedAt = now();
  const stateEntry = (value: any) => [{ key: COLLECTION_KEY, value }];
  const owned = (state: any) => { if (state.ownerRunId !== runId) fail('Another collection owns this checkpoint; resume after it finishes.', 'collection_conflict'); };
  let state = await transaction(host, async previous => {
    if (previous.status === 'running' && previous.ownerRunId !== runId && Date.parse(previous.leaseUntil) > Date.parse(attemptedAt)) fail('A CanadaBuys collection is already running.', 'collection_busy');
    const value = { ...previous, version: 1, sourceId: 'canadabuys', status: 'running', ownerRunId: runId,
      lastAttemptedAt: attemptedAt, leaseUntil: new Date(Date.parse(attemptedAt) + LEASE_MS).toISOString(), error: null };
    return { entries: stateEntry(value) };
  });
  try {
    const response = await host('network.fetch', { url: CANADABUYS_DATASET_URL, method: 'GET', headers: { accept: 'text/csv', 'user-agent': 'ZoerProcurement/0.24' } });
    if (response.status !== 200) fail(`CanadaBuys returned HTTP ${response.status}. Saved records and the previous checkpoint are retained.`, response.status === 403 ? 'source_forbidden' : 'source_http_error');
    if (typeof response.bodyBase64 !== 'string' || response.bodyBase64.length > Math.ceil(MAX_BYTES / 3) * 4 + 4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(response.bodyBase64)) fail('Source response is malformed or exceeds 20 MiB.', 'source_size');
    const bytes = Buffer.from(response.bodyBase64, 'base64');
    if (bytes.length > MAX_BYTES) fail('CanadaBuys source exceeds the 20 MiB collection limit.', 'source_size');
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    const resuming = input.mode !== 'restart' && state.receipt;
    if (resuming && state.receipt.sha256 !== sha256) fail('The CanadaBuys snapshot changed. Restart collection to merge the new snapshot from its beginning; existing records remain saved.', 'source_changed');
    const importedAt = resuming ? state.receipt.importedAt : attemptedAt;
    let parsed: ReturnType<typeof parseCanadaBuysCsv>;
    try { parsed = parseCanadaBuysCsv(new TextDecoder('utf-8', { fatal: true }).decode(bytes), { fileName: 'openTenderNotice-ouvertAvisAppelOffres.csv', sha256, importedAt }, { oversized: 'exclude' }); }
    catch (error) { fail(`CanadaBuys schema/CSV validation failed: ${(error as Error).message}`, 'source_schema'); }
    const required = ['tenderStatus-appelOffresStatut-eng', 'tenderClosingDate-appelOffresDateCloture', 'contractingEntityName-nomEntitContractante-eng'];
    if ((!parsed!.records.length && !parsed!.excluded.length) || required.some(key => !parsed!.headers.includes(key))) {
      fail('CanadaBuys snapshot is empty or required status, closing-date or buyer columns changed. Previous records are retained for review.', 'source_schema');
    }
    const records = parsed!.records.map(record => ({ ...record,
      sourceRetrievedAt: attemptedAt, sourceLastModified: response.headers?.['last-modified'] ?? null,
      sourceClosingTimezone: 'UTC-05:00', sourceTimezoneDocumentation: CANADABUYS_DOCUMENTATION_URL,
      ...(canadaBuysClosingAt(record.closingDate) ? { closingAt: canadaBuysClosingAt(record.closingDate) } : {}),
    }));
    if (resuming && state.receipt.offset > 0 && state.receipt.parserVersion !== 2) fail('The source parser changed; restart this source snapshot to avoid skipping records.', 'cursor_invalid');
    const offset = resuming ? state.receipt.offset : 0;
    if (!Number.isInteger(offset) || offset < 0 || offset > records.length) fail('Saved collection cursor is invalid; restart this source.', 'cursor_invalid');
    const receipt = { sha256, importedAt, retrievedAt: attemptedAt, sourceUrl: CANADABUYS_DATASET_URL,
      lastModified: response.headers?.['last-modified'] ?? null, etag: response.headers?.etag ?? null,
      byteCount: bytes.length, parserVersion: 2, totalRecords: records.length, totalSourceRecords: records.length + parsed!.excluded.length, duplicateCount: parsed!.duplicateCount,
      excludedCount: parsed!.excluded.length, excluded: parsed!.excluded, coverageComplete: parsed!.excluded.length === 0,
      warnings: parsed!.warnings, offset, coverage: `Downloaded federal open-tender snapshot only; ${parsed!.excluded.length} oversized notice(s) excluded. Missing and previously closed records are retained.` };
    state = await transaction(host, async current => { owned(current); return { entries: stateEntry({ ...current, receipt }) }; });
    for (let n = 0; n < (input.maxBatches ?? 1) && state.receipt.offset < records.length; n++) {
      const start = state.receipt.offset;
      state = await transaction(host, async (current, revision) => {
        owned(current);
        if (current.receipt?.sha256 !== sha256 || current.receipt.offset !== start) fail('Collection cursor advanced elsewhere; resume safely.', 'collection_conflict');
        const proposed = nextImportBatch(records, start), existing: any[] = [];
        for (let i = 0; i < proposed.length; i += 4) existing.push(...(await host('catalog.read', { ids: proposed.slice(i, i + 4).map(row => `opportunity:${row.sourceKey}`), revision })).records);
        const batch = nextImportBatch(preserveCanadaBuysEnrichment(proposed, existing), 0);
        const previous = new Map(existing.map(row => [row.id, row.data]));
        const saved = batch.map(row => {
          const old = previous.get(`opportunity:${row.sourceKey}`);
          return { id: `opportunity:${row.sourceKey}`, kind: 'opportunity', title: row.description, data: { ...old, ...row,
            ...(old ? { descriptionText: old.descriptionText, detailFields: old.detailFields, attachments: old.attachments, addenda: old.addenda } : {}),
            starred: old?.starred ?? false, lastRunId: runId } };
        });
        // These exact rows and cursor are committed together; a failed batch never advances its receipt.
        verifyCanadaBuysImportReceipt(batch, saved);
        const timestamp = now(), value = { ...current, receipt: { ...current.receipt, offset: start + batch.length },
          leaseUntil: new Date(Date.parse(timestamp) + LEASE_MS).toISOString() };
        return { records: saved, history: saved.map(row => ({ runId, id: row.data.sourceKey, data: row.data })), entries: stateEntry(value) };
      });
    }
    return await transaction(host, async current => {
      owned(current); const finished = current.receipt.offset === current.receipt.totalRecords, complete = finished && current.receipt.excludedCount === 0;
      return { entries: stateEntry({ ...current, status: complete ? 'complete' : finished ? 'incomplete' : 'paused', leaseUntil: null,
        ...(complete ? { lastSuccessAt: now(), lastSuccessReceipt: current.receipt } : {}),
        error: finished && !complete ? { code: 'source_records_excluded', message: `${current.receipt.excludedCount} oversized notice(s) were excluded. Coverage is incomplete; the checksummed receipt records every excluded CSV row.`, at: now() } : null }) };
    });
  } catch (error) {
    const message = (error as Error).message.slice(0, 2000), code = error instanceof CollectionError ? error.code : 'collection_failed';
    await transaction(host, async current => { owned(current); return { entries: stateEntry({ ...current, status: 'failed', leaseUntil: null, error: { code, message, at: now() } }) }; });
    throw error;
  }
}
