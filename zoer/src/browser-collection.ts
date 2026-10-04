import { BROWSER_SITES, BROWSER_SOURCE_ID } from '../dashboard/procurement/browser-sites';
import { connectorCollectionKey } from '../dashboard/procurement/source-adapters';
import { collectConnectorSource } from './connector-collection';
import { browserSitesConnector, ROBOTS_TTL_MS, type BrowserCapture, type RobotsCacheEntry } from './connectors/browser-sites';
import { createPacer } from './connectors/pacing';
import type { Host } from './procurement-collection';

/** No site starts after this; the action timeout is 20 minutes and a paced site takes well under a minute. */
const SOFT_DEADLINE_MS = 15 * 60_000;
export interface BrowserCollectionInput { sourceId: typeof BROWSER_SOURCE_ID; sites?: string[] }
export interface BrowserCollectionDeps {
  capture: BrowserCapture;
  sleep?: (ms: number) => Promise<void>;
  now?: () => string;
}

export function validBrowserCollectionInput(input: any): input is BrowserCollectionInput {
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(key => !['sourceId', 'sites'].includes(key)) || input.sourceId !== BROWSER_SOURCE_ID) return false;
  const sites = input.sites;
  return sites === undefined || (Array.isArray(sites) && sites.length > 0 && new Set(sites).size === sites.length && sites.every((id: unknown) => typeof id === 'string' && BROWSER_SITES.some(site => site.id === id)));
}

/** Saved per-host pacing and robots.txt readings: only well-formed entries for our hosts, robots no older than a day. */
function savedBrowserState(value: any, nowMs: number) {
  const hosts = new Set(BROWSER_SITES.map(site => site.host));
  const pacing: Record<string, string> = {}, robots: Record<string, RobotsCacheEntry> = {};
  for (const [host, at] of Object.entries(value?.browser?.pacing ?? {})) if (hosts.has(host) && typeof at === 'string' && Number.isFinite(Date.parse(at))) pacing[host] = at;
  for (const [host, entry] of Object.entries<any>(value?.browser?.robots ?? {})) {
    const age = nowMs - Date.parse(entry?.checkedAt);
    if (hosts.has(host) && age >= 0 && age < ROBOTS_TTL_MS && (entry.status === 'missing' || (entry.status === 'ok' && typeof entry.text === 'string'))) robots[host] = { checkedAt: entry.checkedAt, status: entry.status, ...(entry.status === 'ok' ? { text: entry.text } : {}) };
  }
  return { pacing, robots };
}

/**
 * `procurement.collect.browser`: each selected site (all by default) in turn through the Zoer browser, under its own
 * state key `procurement:source:browser-sites:collection` (CONNECTORS.md §4, with portal status `waiting`). Pacing and
 * robots.txt readings are saved with the state on every update, so the next run keeps the same spacing.
 * The output has no top-level `failed`: a site waiting for a browser check must not turn a Zoer schedule off.
 */
export async function collectBrowserSources(host: Host, input: unknown, runId: string, deps: BrowserCollectionDeps) {
  if (!validBrowserCollectionInput(input)) throw new Error('Invalid browser collection request: use { sourceId: "browser-sites", sites?: [site ids] }.');
  const now = deps.now ?? (() => new Date().toISOString()), nowMs = () => Date.parse(now());
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms)));
  const key = connectorCollectionKey(BROWSER_SOURCE_ID);
  const previous = (await host('catalog.workspace', { keys: [key] })).entries?.find((entry: any) => entry.key === key)?.value;
  const saved = savedBrowserState(previous, nowMs());
  const pacer = createPacer({ now: nowMs, sleep }, saved.pacing), robots = saved.robots;
  // Layout samples from earlier runs stay until that site parses again.
  const layoutSamples: Record<string, any> = Object.fromEntries(Object.entries<any>(previous?.browser?.layoutSamples ?? {}).filter(([id, sample]) => BROWSER_SITES.some(site => site.id === id) && typeof sample?.page === 'string'));
  const connector = browserSitesConnector({ capture: deps.capture, pacer, robots, nowMs, layoutSamples });
  const startedAt = now();
  const state = await collectConnectorSource(host, { sourceId: BROWSER_SOURCE_ID, ...(input.sites ? { portals: input.sites } : {}) }, runId, now, {
    connector, softDeadlineAt: Date.parse(startedAt) + SOFT_DEADLINE_MS,
    stateExtras: () => ({ browser: { pacing: pacer.snapshot(), robots: { ...robots }, layoutSamples: { ...layoutSamples } } }),
  });
  const ids = input.sites ?? BROWSER_SITES.map(site => site.id);
  const count = (test: (entry: any) => boolean) => ids.filter(id => test(state.portals?.[id])).length;
  return {
    sourceId: BROWSER_SOURCE_ID, status: state.status, startedAt, finishedAt: now(),
    summary: {
      total: ids.length,
      collected: count(entry => entry?.status === 'complete' || entry?.status === 'incomplete'),
      waitingForYou: count(entry => entry?.status === 'waiting'),
      outsideVisitingHours: count(entry => entry?.status === 'not-run' && entry?.error?.code === 'outside_visit_window'),
      notRun: count(entry => entry?.status === 'not-run' && entry?.error?.code !== 'outside_visit_window'),
      failedSites: count(entry => entry?.status === 'failed'),
    },
    // Counts only for sites collected in this run; a waiting or failed site keeps its earlier count in the state only.
    sites: ids.map(id => { const entry = state.portals?.[id]; return { id, status: entry?.status ?? 'not-run', ...(['complete', 'incomplete'].includes(entry?.status) ? { recordCount: entry.recordCount } : {}), error: entry?.error ?? null }; }),
  };
}
