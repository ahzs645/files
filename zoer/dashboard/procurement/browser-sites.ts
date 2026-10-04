import type { ConnectorPortal } from '../../src/connectors/types';

/**
 * BC procurement sites that answer plain HTTP requests with a bot check (Cloudflare and similar) or ask for slow
 * pacing in robots.txt. Procurement collects them through the person's own Zoer browser profile
 * (`procurement.collect.browser`): one listing page per site, spaced per host, and when a site shows a check the run
 * stops for that site and asks the person to complete it in the Zoer browser.
 *
 * - robots.txt is read through Zoer's browser on each run (kept for 24 hours) and decides whether the listing may be
 *   read and how far apart page loads must be. `minDelaySeconds`/`visitTimeUtc` are floors from the earlier survey
 *   notes (SOURCES-RESEARCH.md) and only ever make a run slower.
 * - `verified: true`: the listing was read from a page Zoer's own browser captured (2026-10-04, kept as
 *   tests/fixtures/browser-sites/zoer-<id>.html). `verified: false`: not confirmed against a captured listing yet; the
 *   parsers read defensively (a page they do not understand is reported, never "0 notices").
 *
 * Ids are part of saved sourceKeys: add sites, never rename them.
 */
export const BROWSER_SOURCE_ID = 'browser-sites';
export const BROWSER_COLLECT_ACTION = 'procurement.collect.browser';

export interface BrowserSite extends ConnectorPortal {
  /**
   * `auto`: a table with title and closing columns, else labelled blocks (one per notice), else a table whose column
   * headings are a plain row of cells. `blocks`: blocks only. `views`: a Drupal view of notices without closing dates.
   */
  layout: 'auto' | 'blocks' | 'views';
  /** The buyer's IANA zone, for "local time" and printed zone abbreviations. */
  timeZone: string;
  /** Floor for seconds between page loads on this host; robots.txt read at run time can raise it, never lower it. */
  minDelaySeconds: number;
  /** `HHMM-HHMM` UTC window the site asks visitors to keep to (robots Visit-time); also read from robots.txt. */
  visitTimeUtc?: string;
  /** Lists notices of many buyers: the buyer is whatever the notice names, otherwise unknown. */
  aggregator?: boolean;
  /** Listing layout confirmed against a page captured through Zoer. */
  verified: boolean;
}

/** Applied to every host, so even a site without a Crawl-delay never sees two Procurement page loads within 5 s. */
export const DEFAULT_MIN_DELAY_SECONDS = 5;
const PACIFIC = 'America/Vancouver';
const place = (municipality: string | null, regionalDistrict: string | null) => ({ municipality, regionalDistrict, method: 'portal' as const });
const site = (id: string, label: string, host: string, url: string, where: ReturnType<typeof place>, extra: Partial<BrowserSite> = {}): BrowserSite =>
  ({ id, label, host, url, place: where, layout: 'auto', timeZone: PACIFIC, minDelaySeconds: DEFAULT_MIN_DELAY_SECONDS, verified: false, ...extra });

export const BROWSER_SITES: readonly BrowserSite[] = [
  // Directory of BC local-government bids; robots.txt noted Crawl-delay 5 in the earlier survey.
  site('civicinfo', 'CivicInfo BC', 'www.civicinfo.bc.ca', 'https://www.civicinfo.bc.ca/bids', place(null, null), { layout: 'blocks', aggregator: true }),
  // A Drupal view of current notices ("Reference #: 13158. Name: …") without closing dates; read from Zoer's capture.
  site('kelowna', 'City of Kelowna', 'www.kelowna.ca', 'https://www.kelowna.ca/business-services/business-city/bidding-opportunities/current-bidding-opportunities', place('Kelowna', 'Central Okanagan'), { layout: 'views', verified: true }),
  // Zoer's capture of 2026-10-04 showed "Opportunities" / "None at the Moment"; no posted notice has been seen yet.
  site('rdkb', 'Regional District of Kootenay Boundary', 'rdkb.com', 'https://rdkb.com/Regional-Government/Organization/Opportunities', place(null, 'Kootenay Boundary')),
  // URL taken from the Zoer capture of https://www.yvr.ca/en/business/work-with-yvr on 2026-10-04; listing not yet captured.
  site('yvr', 'Vancouver Airport Authority (YVR)', 'www.yvr.ca', 'https://www.yvr.ca/en/business/work-with-yvr/airport-suppliers', place('Richmond', 'Metro Vancouver')),
  // Cranbrook prints times as "MT" (Mountain Time).
  site('cranbrook', 'City of Cranbrook', 'cranbrook.ca', 'https://cranbrook.ca/business/city-tenders', place('Cranbrook', 'East Kootenay'), { timeZone: 'America/Edmonton' }),
  // Paced: the earlier survey noted Crawl-delay 10 for these three and Visit-time 0900-1200 (UTC) for BC Ferries.
  // Chilliwack: "Current Bid Opportunities" and "Recently Closed" tables headed by plain cells; read from Zoer's capture.
  site('chilliwack', 'City of Chilliwack', 'www.chilliwack.com', 'https://www.chilliwack.com/main/page.cfm?id=400', place('Chilliwack', 'Fraser Valley'), { minDelaySeconds: 10, verified: true }),
  site('whistler', 'Resort Municipality of Whistler', 'www.whistler.ca', 'https://www.whistler.ca/business-development/bid-opportunities/', place('Whistler', 'Squamish-Lillooet'), { minDelaySeconds: 10 }),
  site('bcferries', 'BC Ferries', 'www.bcferries.com', 'https://www.bcferries.com/our-company/procurement', place(null, null), { minDelaySeconds: 10, visitTimeUtc: '0900-1200' }),
];

export const browserSiteById = (id: string) => BROWSER_SITES.find(item => item.id === id);
/** Page loads one site may use in a run: robots.txt (when not read in the last 24 hours) and the listing. */
export const BROWSER_PAGES_PER_SITE = 2;
