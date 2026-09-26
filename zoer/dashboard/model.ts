import { buyerSearchMatches, annotateBuyerRecord, resolveBuyer, BUYER_MAPPING_VERSION } from './market/buyers';
import { queryBuyerProfiles } from './buyer-profiles';
import { buildMarketView } from './market/model';
import { buildContractAwardImportKey, buildContractAwardSearchText, parseContractAwardValue } from '../../packages/shared/src/contractAwards';
import { buildContractAwardAnalysisOverview, buildContractAwardEntityProfile, buildContractAwardEntityOptions } from '../../convex/contractAwardsAnalysisHelpers';

export interface WorkspaceState { runs: any[]; artifacts: any[]; runsTruncated?: boolean }
export interface SavedDocument { record: { id: string; runId: string; createdAt: string }; document: any }
const emptyCounts = () => ({ listingCount: 0, detailCount: 0, opportunityCount: 0, addendaCount: 0, attachmentCount: 0, pageCount: 0, failedDetails: 0 });
const defaults = { descriptionText: '', detailFields: [], attachments: [], addenda: [], commodities: [], searchText: '' };
export function buildModel(state: WorkspaceState, documents: SavedDocument[]) {
  const opportunities = new Map<string, any>();
  const awards = new Map<string, any>();
  const stars = new Map<string, boolean>();
  let awardCheckpoint: any = null;
  const byRun = new Map<string, any>();
  const history = new Map<string, Map<string, any>>();
  const heartbeat = new Map<string, string>();
  for (const { record, document: doc } of [...documents].sort((a, b) => a.record.createdAt.localeCompare(b.record.createdAt))) {
    if (doc.version !== 1) continue;
    heartbeat.set(record.runId, record.createdAt);
    if (doc.kind === 'star') stars.set(doc.entity + ':' + doc.key, doc.starred === true);
    if (doc.scope === 'public-award-history' && doc.checkpoint) awardCheckpoint = { ...doc.checkpoint, runId: record.runId };
    if (doc.kind === 'scrape' && doc.knownKeys) history.set(record.runId, new Map(doc.knownKeys.map((key: string) => [key, opportunities.get(key)]).filter((entry: any[]) => entry[1])));
    if (doc.kind === 'scrape' || !byRun.has(record.runId)) byRun.set(record.runId, doc);
    if (['listing', 'scrape'].includes(doc.kind)) {
      for (const row of doc.records ?? []) {
        const previous = opportunities.get(row.sourceKey);
        // A later listing-only capture must not erase previously fetched detail fields.
        const detail = previous ? { descriptionText: previous.descriptionText, detailFields: previous.detailFields, addenda: previous.addenda, attachments: previous.attachments } : {};
        const next = { ...defaults, ...previous, ...row, ...(!row.detailFields?.length ? detail : {}), lastRunId: record.runId };
        opportunities.set(row.sourceKey, next);
        if (!history.has(record.runId)) history.set(record.runId, new Map());
        history.get(record.runId)!.set(row.sourceKey, next);
      }
    } else if (doc.kind === 'detail') {
      const found = [...opportunities.values()].find(row => row.processId === doc.record?.processId);
      if (found) {
        const next = { ...found, ...doc.record, lastRunId: record.runId };
        opportunities.set(found.sourceKey, next);
        if (!history.has(record.runId)) history.set(record.runId, new Map());
        history.get(record.runId)!.set(found.sourceKey, next);
      }
    } else if (doc.kind === 'awards') {
      for (const row of doc.records ?? []) {
        const importKey = buildContractAwardImportKey(row);
        const time = Date.parse(record.createdAt);
        awards.set(importKey, { ...row, _id: importKey, _creationTime: time, importKey, contractValue: parseContractAwardValue(row.contractValueText), searchText: buildContractAwardSearchText(row), sourceFileName: doc.fileName, sourceUrl: doc.sourceUrl ?? null, createdAt: awards.get(importKey)?.createdAt ?? time, updatedAt: time });
      }
    }
  }
  const runs = state.runs.filter(run => ['scrape.full', 'scrape.sample', 'listing.capture', 'detail.capture'].includes(run.actionId)).map(run => {
    const doc = byRun.get(run.id);
    const full = doc?.scope === 'all-current-public-opportunities';
    const rows = [...(history.get(run.id)?.values() ?? [])];
    const counts = { ...emptyCounts(), listingCount: doc?.listingCount ?? doc?.recordsCount ?? doc?.records?.length ?? 0, detailCount: doc?.detailsCompleted ?? (doc?.kind === 'detail' ? 1 : 0), opportunityCount: Math.max(rows.length, doc?.knownKeys?.length ?? doc?.recordsCount ?? 0),
      addendaCount: rows.reduce((sum, row) => sum + row.addenda.length, 0), attachmentCount: rows.reduce((sum, row) => sum + row.attachments.length, 0), failedDetails: doc?.failures?.length ?? 0, pageCount: doc ? (doc.currentPage ?? 1) + (doc.detailsCompleted ?? 0) : 0 };
    const status = ['succeeded', 'failed', 'cancelled'].includes(run.status) ? run.status : run.status === 'outcome_unknown' ? 'failed' : run.cancelRequestedAt ? 'stopping' : 'running';
    const phase = status === 'succeeded' ? 'complete' : status === 'failed' ? 'failed' : status === 'cancelled' ? 'cancelled' : status === 'stopping' ? 'stopping' : doc?.phase ?? (doc ? 'detail' : 'listing');
    const interrupted = run.status === 'outcome_unknown';
    const message = run.queueReason || (interrupted ? 'Interrupted before completion was confirmed. Saved progress is retained; resume the saved scrape to continue.' : run.error) || (status === 'succeeded' ? `${counts.listingCount} listings · ${counts.detailCount} details · ${full ? 'all current public opportunities' : 'bounded capture'}` : status === 'cancelled' ? 'Stopped by operator' : doc ? `Saved ${counts.listingCount} listings across ${doc.currentPage ?? 1} pages · ${counts.detailCount} details${full ? ` · ${doc.pending?.length ?? 0} remaining` : ""}` : 'Opening BC Bid and collecting the listing page');
    return { _id: run.id, status, trigger: 'manual', startedAt: Date.parse(run.createdAt), completedAt: run.completedAt ? Date.parse(run.completedAt) : null,
      cancellationRequested: !!run.cancelRequestedAt, counts, errorMessage: interrupted ? null : run.error || doc?.error, errorCode: interrupted ? 'scrape_interrupted' : status === 'failed' ? 'scrape_failed' : null,
      progress: { phase, message, percent: status === 'succeeded' ? 100 : full ? (doc.phase === "listing" ? 10 : 30 + 69 * counts.detailCount / Math.max(1, counts.listingCount)) : doc ? Math.min(90, 20 + counts.detailCount * 20) : 0, current: counts.detailCount, total: full ? counts.listingCount : doc?.detailLimit ?? 3,
        pagesCompleted: doc?.currentPage ?? counts.pageCount, totalPages: doc?.totalPages ?? null, listingsDiscovered: counts.listingCount, detailsCompleted: counts.detailCount, detailsTotal: full ? counts.listingCount : doc?.detailLimit ?? null,
        batchesCompleted: doc ? 1 : 0, batchesTotal: null, heartbeatAt: Date.parse(heartbeat.get(run.id) ?? doc?.capturedAt ?? run.createdAt) } };
  }).sort((a, b) => b.startedAt - a.startedAt);
  const awardRuns = state.runs.filter(run => run.actionId === 'awards.history').sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return { stars, awardCheckpoint, awardRecentCheckpoint: null as any, awardRuns, opportunities: [...opportunities.values()].map(row => ({ ...row, starred: stars.get('opportunity:' + row.sourceKey) === true })), awards: [...awards.values()].map(row => ({ ...row, starred: stars.get('award:' + row.importKey) === true })), runs, history, runsTruncated: state.runsTruncated };
}
export type Model = ReturnType<typeof buildModel>;
export function queryModel(model: Model, name: string, args: any = {}): any {
  const { opportunities, runs, awards } = model;
  // A saved "Open" status goes stale; a passed closing date wins.
  const today = new Date().toISOString().slice(0, 10);
  const notClosed = (row: { closingDate?: string }) => !row.closingDate || row.closingDate.slice(0, 10) >= today;
  if (name === 'dashboard.summary') return { total: opportunities.length, open: opportunities.filter(row => /open/i.test(row.status) && notClosed(row)).length,
    closingSoon: opportunities.filter(row => { const time = Date.parse(row.closingDate); return time >= Date.now() && time <= Date.now() + 7 * 86400000; }).length,
    organizations: new Set(opportunities.map(row => resolveBuyer(row.issuedBy).organization)).size, buyerMappingVersion: BUYER_MAPPING_VERSION,
    statusOptions: [...new Set(opportunities.map(row => row.status).filter(Boolean))].sort(), typeOptions: [...new Set(opportunities.map(row => row.type).filter(Boolean))].sort(),
    latestRun: runs[0] ?? null, latestSuccessfulRun: runs.find(run => run.status === 'succeeded') ?? null };
  if (name === 'scrapeRuns.active') return runs.find(run => ['running', 'stopping'].includes(run.status)) ?? null;
  if (name === 'scrapeRuns.listRecent') return runs.slice(0, args.limit ?? 25);
  if (name === 'opportunities.getByProcessId') { const row = opportunities.find(row => (row.processId ?? row.sourceKey) === args.processId); return row ? annotateBuyerRecord(row, 'opportunity') : null; }
  if (name === 'opportunities.listByRunId') return [...(model.history.get(args.runId)?.values() ?? [])].slice(0, args.limit ?? 50).map(row => ({ ...annotateBuyerRecord(row, 'opportunity'), detailFieldCount: row.detailFields.length, addendaCount: row.addenda.length, attachmentCount: row.attachments.length }));
  if (name === 'opportunities.list') {
    const rows = opportunities.filter(row => (!args.starredOnly || row.starred) && (!args.status || row.status === args.status) && (!args.type || row.type === args.type) && (!args.issuedBy || row.issuedBy === args.issuedBy)
      && (!args.closingBefore || !row.closingDate || row.closingDate <= args.closingBefore)
      && (!args.upcoming || (!!row.closingDate && notClosed(row)))
      && (!args.organization || annotateBuyerRecord(row, 'opportunity', args.buyerLevel).buyer === args.organization)
      && (!args.search || buyerSearchMatches(resolveBuyer(row.issuedBy), args.search) || [row.description, row.opportunityId, row.issuedBy, row.searchText].join(' ').toLowerCase().includes(args.search.toLowerCase())))
      .sort((a, b) => (a.closingDate ?? '9999').localeCompare(b.closingDate ?? '9999') || a.description.localeCompare(b.description));
    const offset = Math.max(0, Number(args.cursor) || 0), limit = Math.min(200, args.limit ?? 50);
    return { items: rows.slice(offset, offset + limit).map(row => annotateBuyerRecord(row, 'opportunity')), nextCursor: offset + limit < rows.length ? String(offset + limit) : null, total: rows.length };
  }
  if (name === 'contractAwards.summary') { const latest = [...awards].sort((a, b) => b.updatedAt - a.updatedAt)[0]; return { total: awards.length, organizations: new Set(awards.map(row => resolveBuyer(row.issuingOrganization).organization)).size, suppliers: new Set(awards.map(row => row.successfulSupplier).filter(Boolean)).size, latestImportAt: latest?.updatedAt ?? null, latestImportFile: latest?.sourceFileName ?? null }; }
  if (name === 'contractAwards.list') { const rows = awards.filter(row => (!args.organization || annotateBuyerRecord(row, 'award', args.buyerLevel).buyer === args.organization) && (!args.search || buyerSearchMatches(resolveBuyer(row.issuingOrganization), args.search) || row.searchText.includes(args.search.toLowerCase()))).sort((a,b) => b.updatedAt - a.updatedAt); const limit = args.limit ?? 200; return { items: rows.slice(0, limit).map(row => annotateBuyerRecord(row, 'award')), nextCursor: rows.length > limit ? 'truncated' : null, hasMore: rows.length > limit, total: rows.length }; }
  if (name === 'contractAwardsAnalysis.market') return buildMarketView(awards, args.view, args.filters, args.options);
  if (['overview','supplierProfile','organizationProfile','entityOptions'].some(key => name === 'contractAwardsAnalysis.' + key)) return queryBuyerProfiles(awards, name, args);
  if (name === 'contractAwardsImport.status') return { status: 'idle', logLines: [], totals: { filesCompleted: 0, batchesCompleted: 0, inserted: 0, updated: 0 }, totalFiles: 0 };
  throw new Error(`Unsupported dashboard query: ${name}`);
}
