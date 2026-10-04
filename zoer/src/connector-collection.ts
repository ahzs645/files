import { preserveSourceEnrichment } from '../dashboard/procurement/import-canadabuys';
import { nextImportBatch } from '../dashboard/procurement/import-batches';
import { connectorCollectionKey } from '../dashboard/procurement/source-adapters';
import { connectorById } from './connectors';
import { ConnectorError, crawlRefusal, isBudgetError, transientFailure, type TransientFailure } from './connectors/errors';
import type { ConnectorPortal, NetFetch, PortalResult, SourceConnector } from './connectors/types';
import { isPauseError } from './pause';
import { catalogTransaction, type Host } from './procurement-collection';

export interface ConnectorCollectionInput { sourceId: string; mode?: 'resume' | 'restart'; maxBatches?: number; portals?: string[] }
/**
 * `connector`: a connector outside `CONNECTORS` (the browser-collected sites, which `all` must not run), used when its
 * id is the requested `sourceId`. `stateExtras`: fields written into the source state with every update (the browser
 * sites' layout samples). `leaseUntil`: what to write as `leaseUntil` while this run works on the source (the resumable
 * slice deadline); defaults to 10 minutes from now.
 */
export interface ConnectorRunOptions { connector?: SourceConnector; stateExtras?: () => Record<string, unknown>; leaseUntil?: () => string }
const LEASE_MS = 10 * 60_000;
/** An interrupted attempt (pause, crash, cancel) is continued by a new run only while its listings are fresh. */
const RESUME_WINDOW_MS = 6 * 60 * 60_000;
const MAX_RECORD_BYTES = 250_000;
const encoder = new TextEncoder();
const bytes = (value: unknown) => encoder.encode(JSON.stringify(value)).byteLength;
const fail = (message: string, code: string): never => { throw new ConnectorError(code, message); };

/**
 * The connector's `NetFetch` over Zoer `network.fetch`. Cookies stay host-side (networkSession). No User-Agent: Zoer's
 * crawl policy sets `ZoerProcurement/<version> (compatible; Zoer)` and refuses a worker-supplied one.
 */
export function hostNetFetch(host: Host): NetFetch {
  return async request => {
    const method = request.method ?? 'GET', headers: Record<string, string> = {};
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
    return { status: response.status, headers: response.headers ?? {}, text, ...(Number.isInteger(response.retryAfterMs) ? { retryAfterMs: response.retryAfterMs } : {}) };
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

export const errorOf = (error: unknown) => ({
  code: typeof (error as any)?.code === 'string' && /^[a-z][a-z0-9_]{0,63}$/.test((error as any).code) ? (error as any).code : 'portal_failed',
  message: String((error as Error)?.message ?? error).slice(0, 2000),
});
const sameSet = (a: unknown, b: string[]) => Array.isArray(a) && a.length === b.length && b.every(id => a.includes(id));

/** The connector, its selected portals and their ids for a request; anything malformed is refused before any request. */
export function resolveConnectorRequest(input: ConnectorCollectionInput, options: ConnectorRunOptions = {}) {
  const connector = typeof input?.sourceId !== 'string' ? undefined : options.connector?.id === input.sourceId ? options.connector : connectorById(input.sourceId);
  const requested = input?.portals;
  if (!connector || (input.mode && !['resume', 'restart'].includes(input.mode))
    || (input.maxBatches !== undefined && (!Number.isInteger(input.maxBatches) || input.maxBatches < 1 || input.maxBatches > 20))
    || (requested !== undefined && (!Array.isArray(requested) || !requested.length || new Set(requested).size !== requested.length
      || requested.some(id => !connector.portals.some(portal => portal.id === id))))) throw new Error('Invalid procurement collection request.');
  const selected = connector.portals.filter(portal => !requested || requested.includes(portal.id));
  return { connector, selected, ids: selected.map(portal => portal.id) };
}

/** State writer for one source: every update checks this run still owns it and refreshes the extras. */
function sourceWriter(host: Host, connector: SourceConnector, runId: string, now: () => string, options: ConnectorRunOptions) {
  const key = connectorCollectionKey(connector.id);
  const lease = () => options.leaseUntil?.() ?? new Date(Date.parse(now()) + LEASE_MS).toISOString();
  const entries = (value: any) => [{ key, value: options.stateExtras ? { ...value, ...options.stateExtras() } : value }];
  const owned = (state: any) => { if (state.ownerRunId !== runId) fail('Another collection owns this source; resume after it finishes.', 'collection_conflict'); };
  const update = (build: (current: any, revision: number) => Promise<any> | any) => catalogTransaction(host, key, async (current, revision) => { owned(current); return build(current, revision); });
  return { key, lease, entries, update };
}

/**
 * Start a collection attempt for one source, or continue an interrupted one (paused, crashed or cancelled) for the same
 * portal set within 6 hours unless `mode: 'restart'`. Zoer's resumable lock (`sourceId`, group `collect`) keeps a second
 * run of this source from starting; `status`/`ownerRunId`/`leaseUntil` are still written for older readers, and still
 * refuse a source that a run under another lock key (`all` beside a single source) is collecting right now.
 */
export async function beginConnectorAttempt(host: Host, input: ConnectorCollectionInput, runId: string, now = () => new Date().toISOString(), options: ConnectorRunOptions = {}) {
  const { connector, ids } = resolveConnectorRequest(input, options);
  if (!(await host('catalog.read', { ids: [] })).primary) throw new Error('Initialize the existing procurement catalog before collecting.');
  const { key, lease, entries } = sourceWriter(host, connector, runId, now, options), attemptedAt = now();
  return catalogTransaction(host, key, async previous => {
    if (previous.status === 'running' && previous.ownerRunId !== runId && Date.parse(previous.leaseUntil) > Date.parse(attemptedAt)) fail(`A ${connector.label} collection is already running.`, 'collection_busy');
    const continuing = input.mode !== 'restart' && previous.attempt?.open === true && sameSet(previous.attempt.portals, ids)
      && Date.parse(attemptedAt) - Date.parse(previous.attempt.startedAt) < RESUME_WINDOW_MS;
    return { entries: entries({ ...previous, version: 1, sourceId: connector.id, status: 'running', ownerRunId: runId, lastAttemptedAt: attemptedAt,
      leaseUntil: lease(), error: null, portals: previous.portals ?? {}, attempt: continuing ? previous.attempt : { startedAt: attemptedAt, portals: ids, open: true } }) };
  });
}

/** A later slice of the same run takes the source again (running, new lease); another run's ownership is a conflict. */
export function claimConnectorSource(host: Host, connector: SourceConnector, runId: string, now = () => new Date().toISOString(), options: ConnectorRunOptions = {}) {
  const { update, entries, lease } = sourceWriter(host, connector, runId, now, options);
  return update(current => ({ entries: entries({ ...current, status: 'running', leaseUntil: lease(), error: null }) }));
}

/** Pause (Zoer update, user pause or cancel): committed portals stay, the attempt stays open and the next run continues it. */
export function markConnectorPaused(host: Host, connector: SourceConnector, runId: string, now = () => new Date().toISOString(), options: ConnectorRunOptions = {}, error: { code: string; message: string } | null = null) {
  const { update, entries } = sourceWriter(host, connector, runId, now, options);
  return update(current => ({ entries: entries({ ...current, status: 'paused', leaseUntil: null, error: error ? { ...error, at: now() } : null }) })).catch(() => undefined);
}

/** The run stopped on this source: record why (a spent budget is `network_budget`). */
export function markConnectorFailed(host: Host, connector: SourceConnector, runId: string, error: unknown, now = () => new Date().toISOString(), options: ConnectorRunOptions = {}) {
  const { update, entries } = sourceWriter(host, connector, runId, now, options);
  const failure = errorOf(error), code = isBudgetError(error) ? 'network_budget' : failure.code === 'portal_failed' ? 'collection_failed' : failure.code;
  return update(current => ({ entries: entries({ ...current, status: 'failed', leaseUntil: null, error: { ...failure, code, at: now() } }) })).catch(() => undefined);
}

export const portalDone = (entry: any, attempt: string) => entry?.attemptStartedAt === attempt && ['complete', 'incomplete'].includes(entry.status);

/**
 * One portal of an attempt (one resumable slice): fetch, merge and commit its records in bounded transactions with its
 * state entry, so a pause or crash afterwards never loses it and replaying the slice only refreshes the same rows.
 * A temporary failure (the site asked to slow down, Zoer's pacing, a server error) returns `retry` while `allowRetry`
 * holds, without touching the portal; any other failure is recorded on the portal. A pause, a spent budget or a lost
 * claim ends the slice.
 */
export async function collectConnectorPortal(host: Host, connector: SourceConnector, portal: ConnectorPortal, attempt: string, runId: string,
  now = () => new Date().toISOString(), options: ConnectorRunOptions = {}, allowRetry = false): Promise<{ state: any; retry?: TransientFailure }> {
  const { lease, entries, update } = sourceWriter(host, connector, runId, now, options), portalAttemptedAt = now();
  const savePortal = async (result: PortalResult) => {
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
    const result = await connector.collectPortal(hostNetFetch(host), portal, { now, runId });
    checkResult(connector, portal, result);
    return { state: await savePortal(result) };
  } catch (error) {
    // A pause, a spent request budget or a lost claim ends the slice; anything else is this portal's.
    if (isPauseError(error) || isBudgetError(error) || (error as any)?.code === 'collection_conflict') throw error;
    const transient = transientFailure(error);
    if (transient && allowRetry) {
      // Still this run's: older readers keep seeing it as collecting until the retry is due.
      const until = new Date(Date.parse(now()) + (transient.retryAfterMs ?? 0) + LEASE_MS).toISOString();
      return { retry: transient, state: await update(current => ({ entries: entries({ ...current, leaseUntil: until }) })) };
    }
    const site = { label: portal.label, url: portal.url, host: portal.host, browser: connector.id === 'browser-sites', visitTimeUtc: (portal as any).visitTimeUtc };
    const mapped: any = crawlRefusal(error, site) ?? error;
    // `waiting` (a person must act first) and `not-run` (deliberately skipped) keep the earlier counts like `failed`.
    const failure = errorOf(mapped), status = ['waiting', 'not-run'].includes(mapped?.portalStatus) ? mapped.portalStatus : 'failed';
    return { state: await update(current => ({ entries: entries({ ...current, leaseUntil: lease(), portals: { ...current.portals,
      [portal.id]: { ...current.portals?.[portal.id], status, attemptStartedAt: attempt, attemptedAt: portalAttemptedAt, error: failure } } }) })) };
  }
}

/** Close the attempt: per-portal outcome into the source status and error (CONNECTORS.md §4). */
export function finishConnectorAttempt(host: Host, connector: SourceConnector, ids: string[], attempt: string, runId: string, now = () => new Date().toISOString(), options: ConnectorRunOptions = {}) {
  const { update, entries } = sourceWriter(host, connector, runId, now, options);
  return update(current => {
    const portals = { ...current.portals };
    // Portals this attempt never reached; a portal it reached and skipped on purpose is `not-run` too.
    const unreached = ids.filter(id => portals[id]?.attemptStartedAt !== attempt);
    for (const id of unreached) portals[id] = { ...portals[id], status: 'not-run', attemptStartedAt: attempt };
    const statuses = ids.map(id => portals[id].status), complete = statuses.every(status => status === 'complete');
    const failed = statuses.filter(status => status === 'failed').length, partial = statuses.filter(status => status === 'incomplete').length, notRun = unreached.length;
    const waiting = statuses.filter(status => status === 'waiting').length;
    const disallowed = ids.filter(id => !unreached.includes(id) && portals[id].status === 'not-run' && portals[id].error?.code === 'robots_disallowed').length;
    const skipped = statuses.filter(status => status === 'not-run').length - notRun - disallowed;
    const problems = [failed && `${failed} failed`, waiting && `${waiting} waiting for you`, partial && `${partial} incomplete`, disallowed && `${disallowed} disallowed by robots.txt`,
      skipped && `${skipped} skipped`, notRun && `${notRun} not reached (the next run continues them)`].filter(Boolean).join(', ');
    const code = notRun ? 'time_budget' : failed ? 'portals_failed' : waiting ? 'waiting_for_user' : partial ? 'portals_incomplete' : disallowed ? 'robots_disallowed' : 'portals_skipped';
    return { entries: entries({ ...current, portals, status: complete ? 'complete' : 'incomplete', leaseUntil: null,
      attempt: { ...current.attempt, open: notRun > 0 },
      ...(complete ? { lastSuccessAt: now() } : {}),
      error: complete ? null : { code, message: `${problems} of ${ids.length} portal(s). Other portals were saved.`, at: now() } }) };
  });
}

/**
 * A whole source in one call: begin, every portal, finish. Used by tests and by the in-process fallback; Zoer runs
 * `procurement.collect` as resumable slices (collection-run.ts), one portal per slice. No retries here: a temporary
 * failure is recorded on its portal.
 */
export async function collectConnectorSource(host: Host, input: ConnectorCollectionInput, runId: string, now = () => new Date().toISOString(), options: ConnectorRunOptions = {}) {
  const { connector, selected, ids } = resolveConnectorRequest(input, options);
  let state = await beginConnectorAttempt(host, input, runId, now, options);
  const attempt = state.attempt.startedAt;
  try {
    for (const portal of selected) {
      if (portalDone(state.portals?.[portal.id], attempt)) continue;
      state = (await collectConnectorPortal(host, connector, portal, attempt, runId, now, options)).state;
    }
    return await finishConnectorAttempt(host, connector, ids, attempt, runId, now, options);
  } catch (error) {
    if (isPauseError(error)) { await markConnectorPaused(host, connector, runId, now, options); throw error; }
    if ((error as any)?.code !== 'collection_conflict') await markConnectorFailed(host, connector, runId, error, now, options);
    throw error;
  }
}

export type SourceOutcome = 'complete' | 'partial' | 'paused' | 'failed' | 'busy' | 'not-run';
export interface SourceRunResult {
  sourceId: string; outcome: SourceOutcome; status?: string;
  error?: { code: string; message: string } | null;
  portals?: { total: number; complete: number; incomplete: number; failed: number; notRun: number };
}

/** A source state as one outcome. A connector whose every portal failed this run failed, even though it returned. */
export function connectorOutcome(state: any, portalIds: string[]): SourceRunResult['portals'] & { outcome: SourceOutcome } {
  const statuses = portalIds.map(id => state.portals?.[id]?.status), by = (status: string) => statuses.filter(item => item === status).length;
  const counts = { total: portalIds.length, complete: by('complete'), incomplete: by('incomplete'), failed: by('failed'), notRun: by('not-run') };
  return { ...counts, outcome: state.status === 'complete' ? 'complete' : counts.failed === counts.total ? 'failed' : 'partial' };
}
