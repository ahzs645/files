import type { ConnectorPortal } from '../../src/connectors/types';
import { BIDSANDTENDERS_PORTALS } from './portals';
import { SITE_PORTALS } from './site-portals';
import { regionalDistrictShort } from './place-data';
import { SOURCES } from './catalog';
import { connectorCollectionKey } from './source-adapters';
import { isLive, runState, type RecentRun } from './source-schedules';
import { sourceErrorText } from './source-errors';

/**
 * Sources page model for many sources and many portals (CONNECTORS.md §4). Pure: the page reads workspace state,
 * inventory counts and schedules, and these helpers turn them into statuses. Unknown is never shown as zero.
 */

export const collectionKey = connectorCollectionKey;
export { COLLECT_ACTION } from './source-schedules';

/** A source collected by `procurement.collect` from portals on one platform. Other connectors add rows here. */
export interface ConnectorSource { id: string; label: string; region: string; portals: readonly ConnectorPortal[]; coverage: string }
export const CONNECTOR_SOURCES: readonly ConnectorSource[] = [
  { id: 'bidsandtenders', label: SOURCES.find(source => source.id === 'bidsandtenders')?.label ?? 'bids&tenders', region: 'British Columbia · municipal and regional portals', portals: BIDSANDTENDERS_PORTALS,
    coverage: 'Public listings of each portal below. Documents and addenda stay on the portal (sign-in required there). A notice missing from a later listing is kept; missing is not proof of closure.' },
  { id: 'municipal-sites', label: SOURCES.find(source => source.id === 'municipal-sites')?.label ?? 'BC local government websites', region: 'British Columbia · local governments’ own websites', portals: SITE_PORTALS,
    coverage: 'The bids page of each website below, and the page of each open notice. Each site lists what it chooses (some show recently closed notices, some only open ones). Files are not downloaded. A notice missing from a later listing is kept; missing is not proof of closure.' },
];

/** `incomplete`: records saved, but fewer than the portal reported or some too large to save. `waiting`: a person must act first (browser check). */
export type PortalStatus = 'complete' | 'incomplete' | 'failed' | 'not-run' | 'waiting';
export interface PortalState { status: PortalStatus; retrievedAt?: string; recordCount?: number; totalReported?: number; lastSuccessAt?: string; error?: { code?: string; message?: string } }
export interface ConnectorCollection {
  sourceId: string; status: 'running' | 'complete' | 'incomplete' | 'failed' | 'paused';
  leaseUntil?: string | null; lastAttemptedAt?: string; lastSuccessAt?: string;
  error?: { code?: string; message?: string; at?: string } | null; portals: Record<string, PortalState>;
}

const object = (value: unknown): value is Record<string, any> => !!value && typeof value === 'object' && !Array.isArray(value);
const time = (value: unknown) => typeof value === 'string' && Number.isFinite(Date.parse(value)) ? value : undefined;
const count = (value: unknown) => typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : undefined;

/**
 * Reads `procurement:source:<id>:collection`. `null` = never collected (no state saved). Malformed state throws so
 * the page says it cannot be read, rather than showing every portal as never collected.
 */
export function readConnectorCollection(value: unknown, sourceId: string): ConnectorCollection | null {
  if (value === undefined || value === null) return null;
  if (!object(value) || value.version !== 1 || !['running', 'complete', 'incomplete', 'failed', 'paused'].includes(value.status)) throw Error(`Saved ${sourceId} collection state is not readable.`);
  const portals: Record<string, PortalState> = {};
  for (const [id, raw] of Object.entries(object(value.portals) ? value.portals : {})) {
    if (!object(raw)) continue;
    portals[id] = { status: ['complete', 'incomplete', 'failed', 'not-run', 'waiting'].includes(raw.status) ? raw.status : 'not-run', retrievedAt: time(raw.retrievedAt), recordCount: count(raw.recordCount),
      totalReported: count(raw.totalReported), lastSuccessAt: time(raw.lastSuccessAt), error: object(raw.error) ? { code: raw.error.code, message: raw.error.message } : undefined };
  }
  return { sourceId, status: value.status, leaseUntil: value.leaseUntil ?? null, lastAttemptedAt: time(value.lastAttemptedAt), lastSuccessAt: time(value.lastSuccessAt),
    error: object(value.error) ? { code: value.error.code, message: value.error.message, at: time(value.error.at) } : null, portals };
}

export type Tone = 'good' | 'busy' | 'warn' | 'idle';
/**
 * Source-level status for the overview. A live run of this source (`runs.recent`, S1/S6) says what it is doing now:
 * collecting, waiting to retry, paused, resume needed. Without one, a running lease that expired is a stopped run.
 */
export function connectorStatus(state: ConnectorCollection | null | undefined, now = Date.now(), run?: RecentRun): { tone: Tone; text: string } {
  const live = run && isLive(run) ? runState(run) : null;
  if (live) return { tone: live.tone, text: live.text };
  if (state === undefined) return { tone: 'idle', text: 'Status unknown' };
  if (state === null) return { tone: 'idle', text: 'Not collected yet' };
  switch (state.status) {
    case 'running': return state.leaseUntil && Date.parse(state.leaseUntil) < now ? { tone: 'warn', text: 'Stopped unexpectedly' } : { tone: 'busy', text: 'Collecting' };
    case 'complete': return { tone: 'good', text: 'Collected' };
    case 'incomplete': return { tone: 'warn', text: state.error?.code === 'time_budget' ? 'Stopped at the time limit; next run continues' : state.error?.code === 'portals_incomplete' ? 'Some portals partly collected'
      : state.error?.code === 'waiting_for_user' ? 'Waiting for you' : state.error?.code === 'portals_skipped' ? 'Some sites skipped'
      : state.error?.code === 'robots_disallowed' ? 'Some portals disallow collection (robots.txt)' : 'Some portals failed' };
    case 'failed': return { tone: 'warn', text: 'Last collection failed' };
    case 'paused': return { tone: 'idle', text: state.error?.code === 'cancelled' ? 'Cancelled; the next run continues' : 'Paused; resumes on next run' };
  }
}

export interface PortalRow {
  /** `disallowed`: the portal's robots.txt does not allow collecting it (Zoer's crawl policy); not a failure, not retried. */
  id: string; label: string; place: string; url: string; status: PortalStatus | 'disallowed' | 'unknown';
  statusText: string; tone: Tone; problem: boolean; counts: string; saved: number | null;
  retrievedAt?: string; lastSuccessAt?: string;
  /** Raw `code: message` (for a tooltip) and the same error in plain words (shown). */
  error?: string; errorText?: string;
}
const placeText = (portal: ConnectorPortal) => {
  const district = portal.place.regionalDistrict && regionalDistrictShort(portal.place.regionalDistrict);
  return [portal.place.municipality, district && district !== portal.place.municipality ? `${district} RD` : null].filter(Boolean).join(' · ') || 'Place not recorded';
};

/**
 * One row per portal. A portal is a problem when its last attempt failed or it has never been collected
 * successfully. `saved` is null while the saved counts are unknown.
 */
export function portalRows(portals: readonly ConnectorPortal[], state: ConnectorCollection | null | undefined, saved?: Map<string, number>): PortalRow[] {
  return portals.map(portal => {
    const entry = state?.portals[portal.id];
    const base = { id: portal.id, label: portal.label, place: placeText(portal), url: portal.url, saved: saved ? saved.get(portal.id) ?? 0 : null, retrievedAt: entry?.retrievedAt, lastSuccessAt: entry?.lastSuccessAt ?? (entry?.status === 'complete' || entry?.status === 'incomplete' ? entry.retrievedAt : undefined) };
    if (state === undefined) return { ...base, status: 'unknown' as const, statusText: 'Unknown', tone: 'idle' as const, problem: false, counts: 'Unknown' };
    // `not-run` only means the last attempt skipped this portal (e.g. a single-portal collect); earlier success stands.
    if (entry?.status === 'not-run' && entry.error?.code === 'robots_disallowed') {
      const explained = sourceErrorText(entry.error);
      return { ...base, status: 'disallowed' as const, statusText: 'robots.txt disallows collection', tone: 'idle' as const, problem: false,
        counts: base.lastSuccessAt ? (entry.recordCount === undefined ? 'Earlier notices kept' : `${entry.recordCount.toLocaleString()} listed earlier`) : 'Not collected', error: explained?.detail, errorText: explained?.text };
    }
    if (!entry || (entry.status === 'not-run' && !base.lastSuccessAt)) return { ...base, status: 'not-run' as const, statusText: 'Not collected yet', tone: 'idle' as const, problem: true, counts: 'Not collected' };
    if (entry.status === 'not-run') return { ...base, status: 'not-run' as const, statusText: 'Not in last run', tone: 'idle' as const, problem: false, counts: entry.recordCount === undefined ? 'Count not recorded' : `${entry.recordCount.toLocaleString()} listed` };
    const listed = entry.recordCount === undefined ? 'Count not recorded' : `${entry.recordCount.toLocaleString()} listed`;
    const counts = entry.totalReported === undefined ? listed : `${listed} · portal reports ${entry.totalReported.toLocaleString()}`;
    const explained = sourceErrorText(entry.error);
    if (entry.status === 'waiting') return { ...base, status: 'waiting' as const, statusText: 'Waiting for you', tone: 'warn' as const, problem: true, counts: base.lastSuccessAt ? 'Waiting for a browser check' : 'Never collected', error: explained?.detail, errorText: explained?.text };
    if (entry.status === 'failed') return { ...base, status: 'failed' as const, statusText: 'Failed', tone: 'warn' as const, problem: true, counts: base.lastSuccessAt ? 'Last attempt failed' : 'Never collected', error: explained?.detail ?? 'No error message recorded.', errorText: explained?.text ?? 'No error message recorded.' };
    if (entry.status === 'incomplete') return { ...base, status: 'incomplete' as const, statusText: 'Partly collected', tone: 'warn' as const, problem: true, counts, error: explained?.detail, errorText: explained?.text };
    return { ...base, status: 'complete' as const, statusText: 'Collected', tone: 'good' as const, problem: false, counts };
  });
}

export function portalSummary(rows: PortalRow[]) {
  const by = (status: string) => rows.filter(row => row.status === status).length;
  return { total: rows.length, complete: by('complete'), incomplete: by('incomplete'), failed: by('failed'), waiting: by('waiting'), notRun: by('not-run'), disallowed: by('disallowed'), unknown: by('unknown'), problems: rows.filter(row => row.problem).length };
}
export function portalSummaryText(rows: PortalRow[]): string {
  const s = portalSummary(rows);
  if (s.unknown === s.total) return `${s.total} portals · status unknown`;
  const never = rows.filter(row => row.status === 'not-run' && row.problem).length;
  return [`${s.complete + s.incomplete} of ${s.total} portals collected in the last run`, s.incomplete ? `${s.incomplete} partly` : '', s.failed ? `${s.failed} failed` : '', s.disallowed ? `${s.disallowed} disallowed by robots.txt` : '', never ? `${never} not collected yet` : ''].filter(Boolean).join(' · ');
}

/** Case-insensitive match on buyer, portal id and place; `problemsOnly` keeps failed, partly and never-collected portals. */
export function filterPortals(rows: PortalRow[], query: string, problemsOnly: boolean): PortalRow[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  return rows.filter(row => (!problemsOnly || row.problem) && words.every(word => `${row.label} ${row.id} ${row.place}`.toLowerCase().includes(word)));
}

/** Saved opportunities per portal for one connector source (read-only, bridge-safe). */
export const PORTAL_COUNT_SQL = "SELECT json_extract(data,'$.portalId') AS portalId, count(*) AS count FROM records WHERE kind='opportunity' AND json_extract(data,'$.sourceId')=? GROUP BY portalId";
