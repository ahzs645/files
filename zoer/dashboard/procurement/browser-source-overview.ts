import { BROWSER_SITES, type BrowserSite } from './browser-sites';
import type { ConnectorCollection, Tone } from './source-overview';
import { sourceErrorText } from './source-errors';

/**
 * Rows for the "Collect in your browser" card, from `procurement:source:browser-sites:collection` (read with
 * `readConnectorCollection`). Honest states: an unreadable state is "Unknown"; a site that waited, was skipped or
 * failed keeps its earlier count and last success, and none of them is ever shown as 0 notices.
 */
export type BrowserSiteStatus = 'collected' | 'waiting' | 'not-run' | 'failed' | 'outside-hours' | 'disallowed' | 'unknown';
export const BROWSER_STATUS_TEXT: Record<BrowserSiteStatus, string> = {
  collected: 'Collected', waiting: 'Waiting for you', 'not-run': 'Not run', failed: 'Failed', 'outside-hours': 'Outside visiting hours', disallowed: 'robots.txt disallows collection', unknown: 'Unknown',
};
const TONE: Record<BrowserSiteStatus, Tone> = { collected: 'good', waiting: 'warn', 'not-run': 'idle', failed: 'warn', 'outside-hours': 'idle', disallowed: 'idle', unknown: 'idle' };

export interface BrowserSiteRow {
  site: BrowserSite; status: BrowserSiteStatus; statusText: string; tone: Tone;
  /** Notices the site listed when it was last collected; null when never collected or unknown. */
  listed: number | null;
  /** Notices saved in Zoer for this site; null while unknown. */
  saved: number | null;
  lastSuccessAt?: string;
  /** Plain message (shown) and raw `code: message` (details). */
  message?: string; detail?: string;
}

export function browserSiteRows(state: ConnectorCollection | null | undefined, saved?: Map<string, number>): BrowserSiteRow[] {
  return BROWSER_SITES.map(site => {
    const entry = state?.portals[site.id];
    const base = { site, saved: saved ? saved.get(site.id) ?? 0 : null, lastSuccessAt: entry?.lastSuccessAt ?? (entry?.status === 'complete' || entry?.status === 'incomplete' ? entry.retrievedAt : undefined) };
    const listed = base.lastSuccessAt && entry?.recordCount !== undefined ? entry.recordCount : null;
    const make = (status: BrowserSiteStatus, extra: Partial<BrowserSiteRow> = {}): BrowserSiteRow => {
      const explained = sourceErrorText(entry?.error);
      return { ...base, status, statusText: BROWSER_STATUS_TEXT[status], tone: TONE[status], listed, ...(explained ? { message: explained.text, detail: explained.detail } : {}), ...extra };
    };
    if (state === undefined) return make('unknown', { listed: null });
    if (!entry) return make('not-run');
    if (entry.status === 'complete' || entry.status === 'incomplete') return make('collected');
    if (entry.status === 'waiting') return make('waiting');
    // Disallowed by robots.txt: older versions saved it as `failed`, 0.34+ as `not-run` (deliberately not loaded).
    if (entry.error?.code === 'robots_disallowed') return make('disallowed');
    if (entry.status === 'failed') return make('failed');
    return make(entry.error?.code === 'outside_visit_window' ? 'outside-hours' : 'not-run');
  });
}

export function browserSummaryText(rows: BrowserSiteRow[]): string {
  if (rows.every(row => row.status === 'unknown')) return `${rows.length} sites · status unknown`;
  const by = (status: BrowserSiteStatus) => rows.filter(row => row.status === status).length;
  return [`${by('collected')} of ${rows.length} collected`, by('waiting') && `${by('waiting')} waiting for you`, by('failed') && `${by('failed')} failed`,
    by('outside-hours') && `${by('outside-hours')} outside visiting hours`, by('disallowed') && `${by('disallowed')} disallowed by robots.txt`, by('not-run') && `${by('not-run')} not run`].filter(Boolean).join(' · ');
}

/** A `HHMM-HHMM` UTC window in the reader's own time, e.g. "2:00 a.m.–5:00 a.m." (date-independent enough for a hint). */
export function localVisitWindow(window: string, at = new Date()): string | null {
  const match = /^(\d{2})(\d{2})-(\d{2})(\d{2})$/.exec(window);
  if (!match) return null;
  const time = (h: string, m: string) => new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate(), Number(h), Number(m))).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  return `${time(match[1], match[2])}–${time(match[3], match[4])}`;
}

/** Saved opportunities per browser site (read-only, bridge-safe). */
export const BROWSER_SITE_COUNT_SQL = "SELECT json_extract(data,'$.portalId') AS portalId, count(*) AS count FROM records WHERE kind='opportunity' AND json_extract(data,'$.sourceId')='browser-sites' GROUP BY portalId";
