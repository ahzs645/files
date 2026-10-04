import { BROWSER_COLLECT_ACTION, BROWSER_SITES, BROWSER_SOURCE_ID } from '../dashboard/procurement/browser-sites';
import { COLLECTION_KEY, connectorCollectionKey } from '../dashboard/procurement/source-adapters';
import { CONNECTORS } from './connectors';
import { browserSitesConnector, type BrowserCapture, type LayoutSample } from './connectors/browser-sites';
import { isBudgetError, transientFailure, type TransientFailure } from './connectors/errors';
import type { SourceConnector } from './connectors/types';
import {
  beginConnectorAttempt, claimConnectorSource, collectConnectorPortal, connectorOutcome, errorOf, finishConnectorAttempt, markConnectorFailed,
  markConnectorPaused, portalDone, resolveConnectorRequest, type ConnectorCollectionInput, type ConnectorRunOptions, type SourceRunResult, type SourceOutcome,
} from './connector-collection';
import { isPauseError, ZoerPausedError } from './pause';
import { catalogTransaction, collectCanadaBuys, type Host } from './procurement-collection';

/**
 * `procurement.collect` and `procurement.collect.browser` as Zoer resumable actions (host service S1,
 * docs/plugin-shared-services.md §4 and §15.1). Each slice is one fresh worker that does one unit of work and returns:
 *
 * - one portal of a connector (bids&tenders, municipal-sites) or one site of the browser sources;
 * - one CanadaBuys pass: download the daily CSV and import batches for at most four minutes (a manual run with
 *   `maxBatches` does exactly that many batches in one slice, as before).
 *
 * The checkpoint only says where the run is (source, attempt, portal index, `all` results so far; well under 64 KiB);
 * the real cursors stay in the catalog workspace state (`procurement:source:<id>:collection`, CanadaBuys `receipt`),
 * written in the same transactions as the records. A slice that runs again after a crash, a deploy pause or a retry
 * therefore re-collects at most the portal it was on and merges the same rows again. Zoer holds the lock
 * `resumable:bc-bid-monitor:collect:<sourceId>`, so a second run of one source cannot start.
 *
 * Temporary failures (HTTP 429/5xx, the host's Retry-After block, Zoer's pacing `crawl_wait`, a dropped connection)
 * return `retry` with the host's `retryAfterMs` up to PORTAL_RETRIES times per portal; after that the portal is
 * recorded as failed and the run goes on, so one busy site never fails a scheduled run.
 */
export const PORTAL_RETRIES = 3;
/** Time a CanadaBuys slice spends importing batches before it hands over (well inside the 10-minute slice). */
const CANADABUYS_SLICE_MS = 4 * 60_000;
const LEASE_MS = 10 * 60_000;

export interface ResumableRequest { step: number; checkpoint: unknown; attempt: number; deadlineAt: string; cancelling?: true; resumedAfter?: string; lastError?: { code: string; message: string } }
export interface CollectProgress { phase: string; done?: number; total?: number; unit?: 'items' | 'rows'; message?: string }
export interface CollectCheckpoint {
  v: 1; action: 'collect' | 'browser'; sourceId: string; startedAt: string;
  /** Sources this run collects, in order (`all`: CanadaBuys, then every connector). */
  sources: string[]; index: number;
  /** Connector attempt of the current source (its `attempt.startedAt`), null before it began. */
  attemptStartedAt: string | null; portalIndex: number;
  /** CanadaBuys passes done for the current source. */
  cbSlices: number;
  /** `all`: outcome per finished source (messages shortened). */
  results: SourceRunResult[];
}
export type SliceEnvelope =
  | { resumable: 'continue'; checkpoint: CollectCheckpoint; progress?: CollectProgress }
  | { resumable: 'done'; output: unknown; progress?: CollectProgress }
  | { resumable: 'retry'; checkpoint: CollectCheckpoint; error: { code: string; message: string }; retryAfterMs?: number }
  | { paused: true; checkpoint: CollectCheckpoint | null };
export interface SliceDeps { now?: () => string; capture?: BrowserCapture }

const short = (text: string, max: number) => text.length > max ? `${text.slice(0, max - 1)}…` : text;
const progress = (phase: string, done?: number, total?: number, unit: CollectProgress['unit'] = 'items'): CollectProgress =>
  ({ phase: short(phase, 80), ...(done !== undefined ? { done, total, unit } : {}) });
const LABELS: Record<string, string> = { canadabuys: 'CanadaBuys', [BROWSER_SOURCE_ID]: 'Browser sites' };
const labelOf = (sourceId: string) => LABELS[sourceId] ?? CONNECTORS.find(connector => connector.id === sourceId)?.label ?? sourceId;

function validAllInput(input: any) {
  if (!input || typeof input !== 'object' || Object.keys(input).some(key => !['sourceId', 'mode', 'maxBatches'].includes(key))
    || (input.mode !== undefined && !['resume', 'restart'].includes(input.mode))
    || (input.maxBatches !== undefined && (!Number.isInteger(input.maxBatches) || input.maxBatches < 1 || input.maxBatches > 20))) throw new Error('Invalid procurement collection request.');
}
function validCanadaBuysInput(input: any) {
  if (input.mode && !['resume', 'restart'].includes(input.mode)) throw new Error('Invalid CanadaBuys collection request.');
  if (input.maxBatches !== undefined && (!Number.isInteger(input.maxBatches) || input.maxBatches < 1 || input.maxBatches > 20)) throw new Error('Invalid CanadaBuys collection request.');
}
export function validBrowserCollectionInput(input: any): input is { sourceId: typeof BROWSER_SOURCE_ID; sites?: string[] } {
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(key => !['sourceId', 'sites'].includes(key)) || input.sourceId !== BROWSER_SOURCE_ID) return false;
  const sites = input.sites;
  return sites === undefined || (Array.isArray(sites) && sites.length > 0 && new Set(sites).size === sites.length && sites.every((id: unknown) => typeof id === 'string' && BROWSER_SITES.some(site => site.id === id)));
}

/** First slice: check the request and the catalog, then plan the run. Nothing is fetched yet. */
async function start(host: Host, actionId: string, input: any, now: () => string): Promise<CollectCheckpoint> {
  let sources: string[], action: CollectCheckpoint['action'] = 'collect';
  if (actionId === BROWSER_COLLECT_ACTION) {
    if (!validBrowserCollectionInput(input)) throw new Error('Invalid browser collection request: use { sourceId: "browser-sites", sites?: [site ids] }.');
    action = 'browser'; sources = [BROWSER_SOURCE_ID];
  } else if (input?.sourceId === 'all') { validAllInput(input); sources = ['canadabuys', ...CONNECTORS.map(connector => connector.id)]; }
  else if (input?.sourceId === 'canadabuys') { validCanadaBuysInput(input); sources = ['canadabuys']; }
  else { resolveConnectorRequest(input); sources = [input.sourceId]; }
  if (!(await host('catalog.read', { ids: [] })).primary) throw new Error('Initialize the existing procurement catalog before collecting.');
  return { v: 1, action, sourceId: input.sourceId, startedAt: now(), sources, index: 0, attemptStartedAt: null, portalIndex: 0, cbSlices: 0, results: [] };
}

/** A checkpoint this version wrote for this request; anything else starts over (the catalog state keeps the progress). */
function readCheckpoint(value: any, actionId: string, input: any): CollectCheckpoint | null {
  if (!value || typeof value !== 'object' || value.v !== 1 || value.sourceId !== input?.sourceId || value.action !== (actionId === BROWSER_COLLECT_ACTION ? 'browser' : 'collect')) return null;
  if (!Array.isArray(value.sources) || !Number.isInteger(value.index) || value.index < 0 || value.index >= value.sources.length || !Number.isInteger(value.portalIndex)
    || !Number.isInteger(value.cbSlices) || !Array.isArray(value.results) || (value.attemptStartedAt !== null && typeof value.attemptStartedAt !== 'string')) return null;
  return value as CollectCheckpoint;
}

interface Run { host: Host; actionId: string; input: any; runId: string; now: () => string; resumable: ResumableRequest; deps: SliceDeps; cp: CollectCheckpoint }
const all = (run: Run) => run.cp.sourceId === 'all';
const leaseFor = (run: Run) => () => {
  const deadline = Date.parse(run.resumable.deadlineAt);
  return new Date(Number.isFinite(deadline) ? deadline : Date.parse(run.now()) + LEASE_MS).toISOString();
};
const retryEnvelope = (cp: CollectCheckpoint, failure: TransientFailure): SliceEnvelope =>
  ({ resumable: 'retry', checkpoint: cp, error: { code: failure.code, message: short(failure.message, 2000) }, ...(failure.retryAfterMs !== undefined ? { retryAfterMs: failure.retryAfterMs } : {}) });

/** The connector request for the current source of the run. */
function connectorRequest(run: Run, sourceId: string): { input: ConnectorCollectionInput; options: ConnectorRunOptions; layoutSamples?: Record<string, LayoutSample> } {
  const options: ConnectorRunOptions = { leaseUntil: leaseFor(run) };
  if (run.cp.action === 'browser') {
    if (!run.deps.capture) throw new Error('Select a running Zoer browser session.');
    const layoutSamples: Record<string, LayoutSample> = {};
    const connector: SourceConnector = browserSitesConnector({ capture: run.deps.capture, layoutSamples });
    // Only layout samples are kept with the state; robots.txt readings and pacing are Zoer's now (no `browser.robots`/`browser.pacing`).
    options.connector = connector; options.stateExtras = () => ({ browser: { layoutSamples: { ...layoutSamples } } });
    return { input: { sourceId: BROWSER_SOURCE_ID, ...(run.input.sites ? { portals: run.input.sites } : {}) }, options, layoutSamples };
  }
  return { input: all(run) ? { sourceId, ...(run.input.mode ? { mode: run.input.mode } : {}) } : run.input, options };
}

/** Next source, or the run's output when this was the last one. */
async function advance(run: Run, result: SourceRunResult, state: any): Promise<SliceEnvelope> {
  const cp = run.cp;
  if (all(run)) cp.results.push({ ...result, ...(result.error ? { error: { code: result.error.code, message: short(result.error.message, 300) } } : {}) });
  cp.index++; cp.attemptStartedAt = null; cp.portalIndex = 0; cp.cbSlices = 0;
  if (cp.index < cp.sources.length) return { resumable: 'continue', checkpoint: cp, progress: progress(`${labelOf(cp.sources[cp.index])}: starting`, cp.index, cp.sources.length) };
  if (cp.action === 'browser') return { resumable: 'done', output: browserOutput(run, state), progress: progress('Browser sites: done') };
  if (!all(run)) return { resumable: 'done', output: state, progress: progress(`${labelOf(cp.sourceId)}: done`) };
  const sources = cp.results, count = (outcome: SourceOutcome) => sources.filter(source => source.outcome === outcome).length;
  const summary = { total: sources.length, complete: count('complete'), partial: count('partial'), paused: count('paused'), failedSources: count('failed'), busy: count('busy'), notRun: count('not-run') };
  const ran = sources.filter(source => source.outcome !== 'busy' && source.outcome !== 'not-run');
  // Only when every source that ran failed does the run fail (and Zoer stops the schedule).
  if (ran.length && ran.every(source => source.outcome === 'failed')) {
    throw new Error(`Every source failed: ${ran.map(source => `${source.sourceId} (${source.error?.code ?? 'failed'})`).join(', ')}. Saved notices are kept.`);
  }
  // Deliberately no top-level `failed`: Zoer reads a numeric `failed` as failed records and would stop the schedule.
  return { resumable: 'done', output: { sourceId: 'all', status: summary.complete === summary.total ? 'complete' : 'incomplete', startedAt: cp.startedAt, finishedAt: run.now(), summary, sources }, progress: progress('All sources: done') };
}

function browserOutput(run: Run, state: any) {
  const ids: string[] = run.input.sites ?? BROWSER_SITES.map(site => site.id);
  const count = (test: (entry: any) => boolean) => ids.filter(id => test(state.portals?.[id])).length;
  return {
    sourceId: BROWSER_SOURCE_ID, status: state.status, startedAt: run.cp.startedAt, finishedAt: run.now(),
    summary: {
      total: ids.length,
      collected: count(entry => entry?.status === 'complete' || entry?.status === 'incomplete'),
      waitingForYou: count(entry => entry?.status === 'waiting'),
      outsideVisitingHours: count(entry => entry?.status === 'not-run' && entry?.error?.code === 'outside_visit_window'),
      disallowedByRobots: count(entry => entry?.status === 'not-run' && entry?.error?.code === 'robots_disallowed'),
      notRun: count(entry => entry?.status === 'not-run' && !['outside_visit_window', 'robots_disallowed'].includes(entry?.error?.code)),
      failedSites: count(entry => entry?.status === 'failed'),
    },
    // Counts only for sites collected in this run; a waiting or failed site keeps its earlier count in the state only.
    sites: ids.map(id => { const entry = state.portals?.[id]; return { id, status: entry?.status ?? 'not-run', ...(['complete', 'incomplete'].includes(entry?.status) ? { recordCount: entry.recordCount } : {}), error: entry?.error ?? null }; }),
  };
}

/** One CanadaBuys pass. A failure is retried while temporary; in `all` a lasting failure is that source's result. */
async function canadaBuysSlice(run: Run): Promise<SliceEnvelope> {
  const { host, runId, now, cp } = run, maxBatches = run.input.maxBatches as number | undefined;
  const first = cp.cbSlices === 0, sliceStart = Date.parse(now()), deadline = Date.parse(run.resumable.deadlineAt);
  const stopAt = Math.min(sliceStart + CANADABUYS_SLICE_MS, Number.isFinite(deadline) ? deadline - 2 * 60_000 : Infinity);
  const canRetry = run.resumable.attempt < PORTAL_RETRIES;
  const options = { leaseUntil: leaseFor(run), deferFailure: (error: unknown) => canRetry && !!transientFailure(error) };
  let state: any;
  try {
    // `maxBatches` (manual runs, older schedules): exactly that many batches in this one slice, as before.
    // Without it (per-source schedules, `all`): pass after pass until the file is in; a new daily file starts over.
    state = maxBatches !== undefined
      ? await collectCanadaBuys(host, { sourceId: 'canadabuys', mode: run.input.mode, maxBatches }, runId, now, all(run) ? { ...options, restartOnChange: true, stopAt: sliceStart + CANADABUYS_SLICE_MS, batchLimit: maxBatches } : options)
      : await collectCanadaBuys(host, { sourceId: 'canadabuys', mode: first ? run.input.mode : 'resume', maxBatches: 20 }, runId, now, { ...options, restartOnChange: true, stopAt, batchLimit: 10_000 });
  } catch (error) {
    if (isPauseError(error)) throw error;
    const transient = canRetry ? transientFailure(error) : null;
    if (transient) return retryEnvelope(cp, transient);
    if (!all(run) || isBudgetError(error)) throw error;
    const { code, message } = errorOf(error);
    return advance(run, { sourceId: 'canadabuys', outcome: code === 'collection_busy' ? 'busy' : 'failed', error: { code: code === 'portal_failed' ? 'collection_failed' : code, message } }, null);
  }
  if (state.status === 'paused' && maxBatches === undefined) {
    cp.cbSlices++;
    const receipt = state.receipt ?? {};
    return { resumable: 'continue', checkpoint: cp, progress: progress('CanadaBuys: importing the daily file', Number.isInteger(receipt.offset) ? receipt.offset : undefined, Number.isInteger(receipt.totalRecords) ? receipt.totalRecords : undefined, 'rows') };
  }
  return advance(run, { sourceId: 'canadabuys', status: state.status, outcome: state.status === 'complete' ? 'complete' : state.status === 'paused' ? 'paused' : 'partial', error: state.error ? { code: state.error.code, message: state.error.message } : null }, state);
}

/** One portal (or site) of a connector source, beginning or finishing its attempt in the same slice when due. */
async function connectorSlice(run: Run, sourceId: string): Promise<SliceEnvelope> {
  const { host, runId, now, cp } = run;
  const request = connectorRequest(run, sourceId);
  const { connector, selected, ids } = resolveConnectorRequest(request.input, request.options);
  if (request.layoutSamples) {
    // Layout samples from earlier runs stay until that site parses again.
    const key = connectorCollectionKey(BROWSER_SOURCE_ID), saved = (await host('catalog.workspace', { keys: [key] })).entries?.find((entry: any) => entry.key === key)?.value;
    for (const [id, sample] of Object.entries<any>(saved?.browser?.layoutSamples ?? {})) if (BROWSER_SITES.some(site => site.id === id) && typeof sample?.page === 'string') request.layoutSamples[id] = sample;
  }
  try {
    let state: any;
    if (cp.attemptStartedAt === null) {
      try { state = await beginConnectorAttempt(host, request.input, runId, now, request.options); }
      catch (error) {
        // In `all`, a source another run is collecting right now is left to that run.
        if (all(run) && (error as any)?.code === 'collection_busy') return advance(run, { sourceId, outcome: 'busy', error: errorOf(error) }, null);
        throw error;
      }
      cp.attemptStartedAt = state.attempt.startedAt; cp.portalIndex = 0;
    } else state = await claimConnectorSource(host, connector, runId, now, request.options);
    const attempt = cp.attemptStartedAt!;
    let index = cp.portalIndex;
    while (index < ids.length && portalDone(state.portals?.[ids[index]], attempt)) index++;
    if (index < ids.length) {
      const result = await collectConnectorPortal(host, connector, selected[index], attempt, runId, now, request.options, run.resumable.attempt < PORTAL_RETRIES);
      if (result.retry) { cp.portalIndex = index; return retryEnvelope(cp, result.retry); }
      cp.portalIndex = index + 1;
      if (cp.portalIndex < ids.length) return { resumable: 'continue', checkpoint: cp, progress: progress(`${connector.label}: ${selected[index].label}`, cp.portalIndex, ids.length) };
    }
    const final = await finishConnectorAttempt(host, connector, ids, attempt, runId, now, request.options);
    const { outcome, ...portals } = connectorOutcome(final, ids);
    return advance(run, { sourceId, status: final.status, outcome, error: final.error ? { code: final.error.code, message: final.error.message } : null, portals }, final);
  } catch (error) {
    if (isPauseError(error)) { await markConnectorPaused(host, connector, runId, now, request.options); throw error; }
    if ((error as any)?.code === 'collection_conflict') throw error;
    if ((error as any)?.code !== 'collection_busy') await markConnectorFailed(host, connector, runId, error, now, request.options);
    if (!all(run) || isBudgetError(error)) throw error;
    const { code, message } = errorOf(error);
    return advance(run, { sourceId, outcome: 'failed', error: { code: code === 'portal_failed' ? 'collection_failed' : code, message } }, null);
  }
}

/** Cleanup slice after a cancel: the source this run was on says so honestly, and the next run continues it. */
async function cancelSlice(run: Run): Promise<SliceEnvelope> {
  const sourceId = run.cp.sources[run.cp.index], key = sourceId === 'canadabuys' ? COLLECTION_KEY : connectorCollectionKey(sourceId);
  await catalogTransaction(run.host, key, async current => {
    if (current.ownerRunId !== run.runId || current.status !== 'running') return { entries: [{ key, value: current }] };
    return { entries: [{ key, value: { ...current, status: 'paused', leaseUntil: null, error: { code: 'cancelled', message: 'The collection was cancelled. Saved notices are kept; the next run continues where it stopped.', at: run.now() } } }] };
  }).catch(() => undefined);
  return { resumable: 'done', output: { sourceId: run.cp.sourceId, status: 'cancelled' } };
}

/**
 * One resumable slice of `procurement.collect` or `procurement.collect.browser`. A Zoer pause (deploy drain, user pause)
 * returns `{ paused: true, checkpoint }`; temporary source failures return `retry`; a request or catalog problem
 * throws (the run fails, as before).
 */
export async function collectionSlice(host: Host, actionId: string, input: any, runId: string, resumable: ResumableRequest, deps: SliceDeps = {}): Promise<SliceEnvelope> {
  const now = deps.now ?? (() => new Date().toISOString());
  const saved = readCheckpoint(resumable.checkpoint, actionId, input);
  if (resumable.cancelling) return saved ? cancelSlice({ host, actionId, input, runId, now, resumable, deps, cp: structuredClone(saved) }) : { resumable: 'done', output: { sourceId: input?.sourceId, status: 'cancelled' } };
  const cp = saved ? structuredClone(saved) : await start(host, actionId, input, now);
  const run: Run = { host, actionId, input, runId, now, resumable, deps, cp };
  try {
    const sourceId = cp.sources[cp.index];
    return sourceId === 'canadabuys' ? await canadaBuysSlice(run) : await connectorSlice(run, sourceId);
  } catch (error) {
    if (isPauseError(error)) return { paused: true, checkpoint: cp };
    throw error;
  }
}

/**
 * The whole run in this process, slice after slice: for hosts that do not run the action as resumable and for tests.
 * There are no retries (a temporary failure is recorded on its portal); a pause is rethrown.
 */
export async function runCollection(host: Host, actionId: string, input: any, runId: string, deps: SliceDeps = {}) {
  const now = deps.now ?? (() => new Date().toISOString());
  let checkpoint: unknown = null;
  for (let step = 1; step <= 10_000; step++) {
    const envelope = await collectionSlice(host, actionId, input, runId, { step, checkpoint, attempt: PORTAL_RETRIES, deadlineAt: new Date(Date.parse(now()) + LEASE_MS).toISOString() }, deps);
    if ('paused' in envelope) throw new ZoerPausedError();
    if (envelope.resumable === 'done') return envelope.output;
    checkpoint = envelope.checkpoint;
  }
  throw new Error('Collection did not finish within 10,000 slices.');
}

/** `procurement.collect` in one call (tests, older hosts): CanadaBuys, a connector, or `all`. */
export const collectProcurementSource = (host: Host, input: any, runId: string, now?: () => string) => runCollection(host, 'procurement.collect', input, runId, { now });
export async function collectAllSources(host: Host, input: any, runId: string, now?: () => string) {
  validAllInput(input);
  if (input.sourceId !== 'all') throw new Error('Invalid procurement collection request.');
  return runCollection(host, 'procurement.collect', input, runId, { now }) as Promise<any>;
}
/** `procurement.collect.browser` in one call (tests, older hosts). */
export const collectBrowserSources = (host: Host, input: unknown, runId: string, deps: { capture: BrowserCapture; now?: () => string }) => runCollection(host, BROWSER_COLLECT_ACTION, input, runId, deps) as Promise<any>;
