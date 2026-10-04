import { preserveSourceEnrichment } from '../dashboard/procurement/import-canadabuys';
import { nextImportBatch } from '../dashboard/procurement/import-batches';
import { connectorCollectionKey } from '../dashboard/procurement/source-adapters';
import { CONNECTORS, connectorById } from './connectors';
import { ConnectorError } from './connectors/errors';
import type { ConnectorPortal, NetFetch, PortalResult, SourceConnector } from './connectors/types';
import { isPauseError } from './pause';
import { catalogTransaction, collectCanadaBuys, type CollectionInput, type Host } from './procurement-collection';

export interface ConnectorCollectionInput { sourceId: string; mode?: 'resume' | 'restart'; maxBatches?: number; portals?: string[] }
/**
 * `softDeadlineAt` (epoch ms): no portal starts after it. Defaults to 7.5 minutes after this source started.
 * `connector`: a connector outside `CONNECTORS` (the browser-collected sites, which `all` must not run), used when its
 * id is the requested `sourceId`. `stateExtras`: fields written into the source state with every update (e.g. the
 * browser sites' per-host pacing and robots.txt readings).
 */
export interface ConnectorRunOptions { softDeadlineAt?: number; connector?: SourceConnector; stateExtras?: () => Record<string, unknown> }
const LEASE_MS = 10 * 60_000;
/** An interrupted attempt (pause, crash, time budget) is continued by `resume` only while its listings are fresh. */
const RESUME_WINDOW_MS = 6 * 60 * 60_000;
/** No new portal starts after this; the action timeout is 10 minutes and committed portals must stay committed. */
const SOFT_DEADLINE_MS = 7.5 * 60_000;
const MAX_RECORD_BYTES = 250_000;
const USER_AGENT = 'ZoerProcurement/0.32';
const encoder = new TextEncoder();
const bytes = (value: unknown) => encoder.encode(JSON.stringify(value)).byteLength;
const fail = (message: string, code: string): never => { throw new ConnectorError(code, message); };

/**
 * `procurement.collect` entry: CanadaBuys keeps its checksummed snapshot path, `all` runs every source in turn (the
 * one input Zoer's single schedule per action can hold), and any other id is a listing connector.
 */
export function collectProcurementSource(host: Host, input: any, runId: string, now = () => new Date().toISOString()) {
  if (input?.sourceId === 'all') return collectAllSources(host, input, runId, now);
  return input?.sourceId === 'canadabuys' ? collectCanadaBuys(host, input as CollectionInput, runId, now) : collectConnectorSource(host, input, runId, now);
}

/** The connector's `NetFetch` over Zoer `network.fetch`. Cookies stay host-side (networkSession), so none are handled here. */
export function hostNetFetch(host: Host): NetFetch {
  return async request => {
    const method = request.method ?? 'GET', headers: Record<string, string> = { 'user-agent': USER_AGENT };
    if (request.accept) headers.accept = request.accept;
    let bodyBase64: string | undefined;
    if (request.form) {
      if (method !== 'POST') throw new Error('A form body needs POST.');
      headers['content-type'] = 'application/x-www-form-urlencoded';
      bodyBase64 = Buffer.from(new URLSearchParams(request.form).toString(), 'utf8').toString('base64');
    }
    const response = await host('network.fetch', { url: request.url, method, headers, ...(bodyBase64 !== undefined ? { bodyBase64 } : {}) });
    if (!Number.isInteger(response?.status) || typeof response.bodyBase64 !== 'string' || !/^[A-Za-z0-9+/]*={0,2}$/.test(response.bodyBase64)) fail('Source response is malformed.', 'source_size');
    let text: string;
    try { text = new TextDecoder('utf-8', { fatal: true }).decode(Buffer.from(response.bodyBase64, 'base64')); }
    catch { return fail('Source response is not UTF-8 text.', 'source_encoding'); }
    return { status: response.status, headers: response.headers ?? {}, text };
  };
}

/** Connector output must use this connector's keys and this portal; anything else would write someone else's rows. */
function checkResult(connector: SourceConnector, portal: ConnectorPortal, result: PortalResult) {
  if (!result || result.portalId !== portal.id || !Array.isArray(result.records) || !Array.isArray(result.warnings)) fail('Connector returned an invalid portal result.', 'connector_invalid');
  const prefix = `${connector.id}:${portal.id}:`, keys = new Set<string>();
  for (const record of result.records) {
    if (record?.sourceId !== connector.id || typeof record.sourceKey !== 'string' || !record.sourceKey.startsWith(prefix) || record.sourceKey.length > 1000
      || typeof record.description !== 'string' || keys.has(record.sourceKey)) fail(`Connector returned an invalid or duplicate record for ${portal.id}.`, 'connector_invalid');
    keys.add(record.sourceKey);
  }
}

/** The 250 kB record limit: drop redundant presentation copies first (source text stays in sourceDescriptionText), else exclude. */
function boundRecords(records: any[]) {
  const kept: any[] = [], excluded: Array<{ sourceKey: string; bytes: number }> = [];
  for (const record of records) {
    let row = record;
    if (bytes(row) > MAX_RECORD_BYTES) row = { ...row, descriptionText: '', searchText: [row.externalId, row.description, row.issuedBy, row.status, row.type, row.region].filter(Boolean).join(' ') };
    if (bytes(row) > MAX_RECORD_BYTES && row.rawSourceData && typeof row.rawSourceData === 'object') row = { ...row, rawSourceData: { ...row.rawSourceData, Description: '(kept in sourceDescriptionText)' } };
    const size = bytes(row);
    if (size > MAX_RECORD_BYTES) excluded.push({ sourceKey: row.sourceKey, bytes: size }); else kept.push(row);
  }
  return { kept, excluded };
}

/** Readback proves the expected rows were written, not merely that their ids existed. */
function verifySaved(expected: any[], saved: Array<{ id: string; data: any }>, sourceId: string) {
  if (saved.length !== expected.length || new Set(saved.map(row => row.id)).size !== saved.length) fail('Collection receipt has missing or duplicate records.', 'receipt_mismatch');
  const actual = new Map(saved.map(row => [row.id, row.data]));
  for (const record of expected) {
    const data = actual.get(`opportunity:${record.sourceKey}`);
    if (!data || data.sourceId !== sourceId || ['sourceKey', 'processId', 'externalId', 'description', 'sourceDescriptionText', 'sourceRetrievedAt'].some(field => data[field] !== record[field])) {
      fail(`Collection receipt does not match ${record.sourceKey}.`, 'receipt_mismatch');
    }
  }
}

const errorOf = (error: unknown) => ({
  code: typeof (error as any)?.code === 'string' && /^[a-z][a-z0-9_]{0,63}$/.test((error as any).code) ? (error as any).code : 'portal_failed',
  message: String((error as Error)?.message ?? error).slice(0, 2000),
});
/** Zoer's per-run request budget is shared by every portal and source, so running out ends the whole run. */
const isBudgetError = (error: unknown) => (error as any)?.code === 'network_limit' || /budget exhausted|network_limit/i.test(String((error as Error)?.message ?? ''));
const sameSet = (a: unknown, b: string[]) => Array.isArray(a) && a.length === b.length && b.every(id => a.includes(id));

/**
 * Collect every selected portal of a connector into the catalog (CONNECTORS.md §4). Each portal is fetched, then
 * merged and committed in its own bounded transactions together with its state entry, so a failure or pause
 * keeps every portal saved before it. Saved records are never deleted and keep stars and enrichment.
 */
export async function collectConnectorSource(host: Host, input: ConnectorCollectionInput, runId: string, now = () => new Date().toISOString(), options: ConnectorRunOptions = {}) {
  const connector = typeof input?.sourceId !== 'string' ? undefined : options.connector?.id === input.sourceId ? options.connector : connectorById(input.sourceId);
  const requested = input?.portals;
  if (!connector || (input.mode && !['resume', 'restart'].includes(input.mode))
    || (input.maxBatches !== undefined && (!Number.isInteger(input.maxBatches) || input.maxBatches < 1 || input.maxBatches > 20))
    || (requested !== undefined && (!Array.isArray(requested) || !requested.length || new Set(requested).size !== requested.length
      || requested.some(id => !connector.portals.some(portal => portal.id === id))))) throw new Error('Invalid procurement collection request.');
  const selected = connector.portals.filter(portal => !requested || requested.includes(portal.id)), ids = selected.map(portal => portal.id);
  if (!(await host('catalog.read', { ids: [] })).primary) throw new Error('Initialize the existing procurement catalog before collecting.');
  const key = connectorCollectionKey(connector.id), attemptedAt = now();
  const entries = (value: any) => [{ key, value: options.stateExtras ? { ...value, ...options.stateExtras() } : value }];
  const lease = () => new Date(Date.parse(now()) + LEASE_MS).toISOString();
  const owned = (state: any) => { if (state.ownerRunId !== runId) fail('Another collection owns this source; resume after it finishes.', 'collection_conflict'); };
  const update = (build: (current: any, revision: number) => Promise<any> | any) => catalogTransaction(host, key, async (current, revision) => { owned(current); return build(current, revision); });

  let state = await catalogTransaction(host, key, async previous => {
    if (previous.status === 'running' && previous.ownerRunId !== runId && Date.parse(previous.leaseUntil) > Date.parse(attemptedAt)) fail(`A ${connector.label} collection is already running.`, 'collection_busy');
    const continuing = input.mode !== 'restart' && previous.attempt?.open === true && sameSet(previous.attempt.portals, ids)
      && Date.parse(attemptedAt) - Date.parse(previous.attempt.startedAt) < RESUME_WINDOW_MS;
    return { entries: entries({ ...previous, version: 1, sourceId: connector.id, status: 'running', ownerRunId: runId, lastAttemptedAt: attemptedAt,
      leaseUntil: lease(), error: null, portals: previous.portals ?? {}, attempt: continuing ? previous.attempt : { startedAt: attemptedAt, portals: ids, open: true } }) };
  });
  const attempt = state.attempt.startedAt, softDeadline = options.softDeadlineAt ?? Date.parse(attemptedAt) + SOFT_DEADLINE_MS;
  const done = (entry: any) => entry?.attemptStartedAt === attempt && ['complete', 'incomplete'].includes(entry.status);
  const fetch = hostNetFetch(host);
  /** Merge and commit one portal's records in bounded batches; its state entry is written with the last batch. */
  const savePortal = async (portal: ConnectorPortal, result: PortalResult, portalAttemptedAt: string) => {
    const { kept, excluded } = boundRecords(result.records);
    const finish = (current: any) => {
      const short = result.totalReported !== undefined && kept.length < result.totalReported;
      const complete = !excluded.length && !short, previous = current.portals?.[portal.id] ?? {};
      return { ...current, leaseUntil: lease(), portals: { ...current.portals, [portal.id]: {
        status: complete ? 'complete' : 'incomplete', attemptStartedAt: attempt, attemptedAt: portalAttemptedAt,
        retrievedAt: kept[0]?.sourceRetrievedAt ?? portalAttemptedAt, recordCount: kept.length,
        ...(result.totalReported !== undefined ? { totalReported: result.totalReported } : {}),
        lastSuccessAt: complete ? now() : previous.lastSuccessAt,
        warnings: result.warnings.slice(0, 10).map(warning => String(warning).slice(0, 500)),
        ...(excluded.length ? { excluded } : {}),
        error: complete ? null : excluded.length
          ? { code: 'source_records_excluded', message: `${excluded.length} notice(s) exceed the 250 kB record limit and were not saved.` }
          : { code: 'source_incomplete', message: `The portal reported ${result.totalReported} open notices; ${kept.length} were saved.` },
      } } };
    };
    if (!kept.length) return update(current => ({ entries: entries(finish(current)) }));
    let saved: any;
    for (let offset = 0; offset < kept.length;) {
      const proposed = nextImportBatch(kept, offset), last = offset + proposed.length >= kept.length;
      saved = await update(async (current, revision) => {
        const existing: any[] = [];
        for (let i = 0; i < proposed.length; i += 4) existing.push(...(await host('catalog.read', { ids: proposed.slice(i, i + 4).map(row => `opportunity:${row.sourceKey}`), revision })).records);
        const merged = preserveSourceEnrichment(proposed, existing, connector.id), previous = new Map(existing.map(row => [row.id, row.data]));
        const rows = merged.map(row => {
          const old = previous.get(`opportunity:${row.sourceKey}`);
          // Enrichment is kept: extracted description text (when it differs from the old source text), detail
          // fields, downloaded files, addenda, stars, and a place refined by something other than the portal owner.
          const enriched = old ? {
            descriptionText: old.descriptionText !== undefined && old.descriptionText !== old.sourceDescriptionText ? old.descriptionText : row.descriptionText,
            detailFields: old.detailFields ?? row.detailFields, attachments: old.attachments ?? row.attachments, addenda: old.addenda ?? row.addenda,
            ...(old.place && old.place.method !== 'portal' ? { place: old.place } : {}),
          } : {};
          return { id: `opportunity:${row.sourceKey}`, kind: 'opportunity', title: row.description, data: { ...old, ...row, ...enriched, starred: old?.starred ?? false, lastRunId: runId } };
        });
        verifySaved(merged, rows, connector.id);
        return { records: rows, history: rows.map(row => ({ runId, id: row.data.sourceKey, data: row.data })),
          entries: entries(last ? finish(current) : { ...current, leaseUntil: lease() }) };
      });
      offset += proposed.length;
    }
    return saved;
  };

  try {
    for (const portal of selected) {
      if (done(state.portals[portal.id])) continue;
      if (Date.parse(now()) > softDeadline) break;
      const portalAttemptedAt = now();
      try {
        const result = await connector.collectPortal(fetch, portal, { now, runId });
        checkResult(connector, portal, result);
        state = await savePortal(portal, result, portalAttemptedAt);
      } catch (error) {
        // A pause, a spent request budget or a lost checkpoint ends the run; anything else (source, schema, catalog
        // conflict) fails only this portal.
        if (isPauseError(error) || isBudgetError(error) || (error as any)?.code === 'collection_conflict') throw error;
        // `waiting` (a person must act first) and `not-run` (deliberately skipped) keep the earlier counts like `failed`.
        const failure = errorOf(error), status = ['waiting', 'not-run'].includes((error as any)?.portalStatus) ? (error as any).portalStatus : 'failed';
        state = await update(current => ({ entries: entries({ ...current, leaseUntil: lease(), portals: { ...current.portals,
          [portal.id]: { ...current.portals?.[portal.id], status, attemptStartedAt: attempt, attemptedAt: portalAttemptedAt, error: failure } } }) }));
      }
    }
    return await update(current => {
      const portals = { ...current.portals };
      // Portals this attempt never reached (time limit); a portal it reached and skipped on purpose is `not-run` too.
      const unreached = ids.filter(id => portals[id]?.attemptStartedAt !== attempt);
      for (const id of unreached) portals[id] = { ...portals[id], status: 'not-run', attemptStartedAt: attempt };
      const statuses = ids.map(id => portals[id].status), complete = statuses.every(status => status === 'complete');
      const failed = statuses.filter(status => status === 'failed').length, partial = statuses.filter(status => status === 'incomplete').length, notRun = unreached.length;
      const waiting = statuses.filter(status => status === 'waiting').length, skipped = statuses.filter(status => status === 'not-run').length - notRun;
      const problems = [failed && `${failed} failed`, waiting && `${waiting} waiting for you`, partial && `${partial} incomplete`, skipped && `${skipped} skipped`, notRun && `${notRun} not reached before the time limit (resume continues them)`].filter(Boolean).join(', ');
      return { entries: entries({ ...current, portals, status: complete ? 'complete' : 'incomplete', leaseUntil: null,
        attempt: { ...current.attempt, open: notRun > 0 },
        ...(complete ? { lastSuccessAt: now() } : {}),
        error: complete ? null : { code: notRun ? 'time_budget' : failed ? 'portals_failed' : waiting ? 'waiting_for_user' : partial ? 'portals_incomplete' : 'portals_skipped', message: `${problems} of ${ids.length} portal(s). Other portals were saved.`, at: now() } }) };
    });
  } catch (error) {
    if (isPauseError(error)) {
      // Paused for a Zoer update: committed portals stay; the re-run resumes this attempt with the remaining portals.
      await update(current => ({ entries: entries({ ...current, status: 'paused', leaseUntil: null, error: null }) })).catch(() => undefined);
      throw error;
    }
    const failure = errorOf(error), code = isBudgetError(error) ? 'network_budget' : failure.code === 'portal_failed' ? 'collection_failed' : failure.code;
    await update(current => ({ entries: entries({ ...current, status: 'failed', leaseUntil: null, error: { ...failure, code, at: now() } }) })).catch(() => undefined);
    throw error;
  }
}

/** No CanadaBuys batch starts after this share of the run, so the connectors after it still run within the timeout. */
const CANADABUYS_SHARE_MS = 4 * 60_000;
export type SourceOutcome = 'complete' | 'partial' | 'paused' | 'failed' | 'busy' | 'not-run';
export interface SourceRunResult {
  sourceId: string; outcome: SourceOutcome; status?: string;
  error?: { code: string; message: string } | null;
  portals?: { total: number; complete: number; incomplete: number; failed: number; notRun: number };
}

/** A source state as one outcome. A connector whose every portal failed this run failed, even though it returned. */
function connectorOutcome(state: any, portalIds: string[]): SourceRunResult['portals'] & { outcome: SourceOutcome } {
  const statuses = portalIds.map(id => state.portals?.[id]?.status), by = (status: string) => statuses.filter(item => item === status).length;
  const counts = { total: portalIds.length, complete: by('complete'), incomplete: by('incomplete'), failed: by('failed'), notRun: by('not-run') };
  return { ...counts, outcome: state.status === 'complete' ? 'complete' : counts.failed === counts.total ? 'failed' : 'partial' };
}

/**
 * `sourceId: 'all'`: CanadaBuys, then every connector in `CONNECTORS`, each under its own state key and lease
 * (CONNECTORS.md §4). One failing source is recorded in its own state and in this output and does not stop the
 * others. Only a Zoer pause or a spent request budget (shared by every source) ends the run early.
 *
 * Schedules: Zoer turns a schedule off when a run fails or when a step output has a numeric `failed` above zero.
 * Partial failures must not do that (one portal down would stop every scheduled collection), so the output keeps
 * its counts under `summary`, and the run fails only when every source that ran failed.
 */
export async function collectAllSources(host: Host, input: any, runId: string, now = () => new Date().toISOString()) {
  if (!input || typeof input !== 'object' || Object.keys(input).some(key => !['sourceId', 'mode', 'maxBatches'].includes(key))
    || (input.mode !== undefined && !['resume', 'restart'].includes(input.mode))
    || (input.maxBatches !== undefined && (!Number.isInteger(input.maxBatches) || input.maxBatches < 1 || input.maxBatches > 20))) throw new Error('Invalid procurement collection request.');
  if (!(await host('catalog.read', { ids: [] })).primary) throw new Error('Initialize the existing procurement catalog before collecting.');
  const startedAt = now(), started = Date.parse(startedAt), softDeadlineAt = started + SOFT_DEADLINE_MS;
  const sources: SourceRunResult[] = [];
  const failure = (sourceId: string, error: unknown): SourceRunResult => {
    // A pause or a spent budget is the run's, not this source's: rethrow so Zoer pauses or reports the run.
    if (isPauseError(error) || isBudgetError(error)) throw error;
    const { code, message } = errorOf(error);
    return { sourceId, outcome: code === 'collection_busy' ? 'busy' : 'failed', error: { code: code === 'portal_failed' ? 'collection_failed' : code, message } };
  };
  try {
    // A changed daily file restarts from its beginning; the same file continues where the last run stopped.
    // Without an explicit cap, CanadaBuys keeps going until its time share ends: a fixed 20-batch cap covered about
    // half of a ~880-notice daily file, and each new file restarts from the top, so the rest was never imported.
    const state = await collectCanadaBuys(host, { sourceId: 'canadabuys', mode: input.mode, maxBatches: input.maxBatches ?? 20 }, runId, now,
      { restartOnChange: true, stopAt: started + CANADABUYS_SHARE_MS, batchLimit: input.maxBatches ?? 10_000 });
    sources.push({ sourceId: 'canadabuys', status: state.status, outcome: state.status === 'complete' ? 'complete' : state.status === 'paused' ? 'paused' : 'partial', error: state.error ? { code: state.error.code, message: state.error.message } : null });
  } catch (error) { sources.push(failure('canadabuys', error)); }
  for (const connector of CONNECTORS) {
    if (Date.parse(now()) > softDeadlineAt) { sources.push({ sourceId: connector.id, outcome: 'not-run', error: { code: 'time_budget', message: 'Not reached before the time limit; the next run collects it.' } }); continue; }
    try {
      const state = await collectConnectorSource(host, { sourceId: connector.id, ...(input.mode ? { mode: input.mode } : {}) }, runId, now, { softDeadlineAt });
      const { outcome, ...portals } = connectorOutcome(state, connector.portals.map(portal => portal.id));
      sources.push({ sourceId: connector.id, status: state.status, outcome, error: state.error ? { code: state.error.code, message: state.error.message } : null, portals });
    } catch (error) { sources.push(failure(connector.id, error)); }
  }
  const count = (outcome: SourceOutcome) => sources.filter(source => source.outcome === outcome).length;
  const summary = { total: sources.length, complete: count('complete'), partial: count('partial'), paused: count('paused'), failedSources: count('failed'), busy: count('busy'), notRun: count('not-run') };
  const ran = sources.filter(source => source.outcome !== 'busy' && source.outcome !== 'not-run');
  if (ran.length && ran.every(source => source.outcome === 'failed')) {
    throw new Error(`Every source failed: ${ran.map(source => `${source.sourceId} (${source.error?.code ?? 'failed'})`).join(', ')}. Saved notices are kept.`);
  }
  return { sourceId: 'all', status: summary.complete === summary.total ? 'complete' : 'incomplete', startedAt, finishedAt: now(), summary, sources };
}
