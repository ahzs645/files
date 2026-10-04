import { BIDSANDTENDERS_PORTALS } from './portals';
import { SITE_PORTALS } from './site-portals';
import { BROWSER_SITES } from './browser-sites';

export const CANADABUYS_DATASET_URL = 'https://canadabuys.canada.ca/opendata/pub/openTenderNotice-ouvertAvisAppelOffres.csv';
export const CANADABUYS_DOCUMENTATION_URL = 'https://donnees-data.tpsgc-pwgsc.gc.ca/ba2/ac-cb/soutien-support-eng.html';
export const CANADABUYS_CATALOG_URL = 'https://open.canada.ca/data/en/dataset/6abd20d4-7a1c-4b38-baa2-9525d0bb2fd2';
export const COLLECTION_KEY = 'procurement:source:canadabuys:collection';
/**
 * Workspace state key of a connector's collection (CONNECTORS.md §4): status, lease, last success and a
 * `portals` record per portal. Read it with `catalog.workspace`. CanadaBuys keeps its own shape under the same pattern.
 */
export const connectorCollectionKey = (sourceId: string) => `procurement:source:${sourceId}:collection`;

export interface ProcurementSourceAdapter {
  id: string; label: string;
  capabilities: Record<'listing' | 'detail' | 'attachments' | 'awards' | 'auth', { status: 'available' | 'partial' | 'unavailable'; method: string }>;
  coverage: string; documentation?: string;
}
export const PROCUREMENT_SOURCE_ADAPTERS: ProcurementSourceAdapter[] = [
  { id: 'bc-bid', label: 'BC Bid', coverage: 'Public pages captured by configured browser; saved records are not proof of portal completeness.', capabilities: {
    listing: { status: 'available', method: 'Existing browser listing/full scrape actions' },
    detail: { status: 'available', method: 'Existing browser detail capture' },
    attachments: { status: 'partial', method: 'Existing BC Bid attachment download; availability depends on published links and browser access' },
    awards: { status: 'available', method: 'Existing historical/recent award scrape actions' },
    auth: { status: 'partial', method: 'User-managed browser checks/session; no automatic portal login' },
  } },
  { id: 'canadabuys', label: 'CanadaBuys', documentation: CANADABUYS_DOCUMENTATION_URL,
    coverage: 'Federal open-tender dataset snapshot only. Daily publisher refresh; absence is not proof of closure. Saved old records are retained.', capabilities: {
      listing: { status: 'available', method: 'procurement.collect: official open-tenders CSV, bounded and checksummed; manual CSV fallback' },
      detail: { status: 'partial', method: 'Published bilingual CSV fields; no notice-page scraping' },
      attachments: { status: 'unavailable', method: 'Original attachment fields retained as data; files are not downloaded by this connector' },
      awards: { status: 'unavailable', method: 'Official award dataset exists but is not connected' },
      auth: { status: 'unavailable', method: 'Public CSV requires no credentials; HTTP 403 is reported without bypass' },
    } },
  { id: 'bidsandtenders', label: 'bids&tenders (BC)',
    coverage: `Open notices listed by ${BIDSANDTENDERS_PORTALS.length} BC public buyers on bids&tenders, one portal at a time; a failed portal does not stop the others. Closed and awarded notices are not listed; absence is not proof of closure. Saved records are retained.`, capabilities: {
      listing: { status: 'available', method: 'procurement.collect: each portal\'s open-notice search (homepage session, then form search), paged' },
      detail: { status: 'partial', method: 'Public notice page per notice (up to 30 per portal per run): type, classification, categories, question deadline, zoned published date. Buyer contacts and document lists need a vendor login and are not read' },
      attachments: { status: 'unavailable', method: 'Document and addenda counts from the listing only; files need a vendor login and are not downloaded' },
      awards: { status: 'unavailable', method: 'Awarded and closed notices are not collected' },
      auth: { status: 'unavailable', method: 'Public pages only; no vendor login. The search needs a per-run cookie session kept by Zoer (networkSession)' },
    } },
  { id: 'municipal-sites', label: 'BC local government websites',
    coverage: `Bids listed on the own websites of ${SITE_PORTALS.length} BC local governments (${SITE_PORTALS.map(portal => portal.label).join(', ')}), one site at a time; a failed site does not stop the others. Some sites also list recently closed notices, others only open ones. Absence is not proof of closure. Saved records are retained.`, capabilities: {
      listing: { status: 'available', method: 'procurement.collect: each site\'s public bids page (server-rendered HTML), following its next-page links up to 3 pages' },
      detail: { status: 'partial', method: 'Public notice page per not-yet-closed notice (up to 25 per site per run): description, published contacts and document links. Closing times are exact only where the page states the zone; otherwise only the date is used' },
      attachments: { status: 'unavailable', method: 'Document links are saved with each notice; files are not downloaded' },
      awards: { status: 'unavailable', method: 'Award results are not collected; an "Awarded" column is kept as text where a site shows one' },
      auth: { status: 'unavailable', method: 'Public pages only; no login, cookies or browser checks' },
    } },
  { id: 'browser-sites', label: 'BC sites (your browser)',
    coverage: `The bids page of ${BROWSER_SITES.length} BC sites that block plain automated requests (${BROWSER_SITES.map(site => site.label).join(', ')}), loaded in your Zoer browser, one page per site, spaced as each site's robots.txt asks. A site that shows a browser check waits for you; the others still run. Page layouts are not confirmed yet, so check saved notices against the site. Absence is not proof of closure. Saved records are retained.`, capabilities: {
      listing: { status: 'partial', method: 'procurement.collect.browser: each site\'s bids page as your Zoer browser shows it (one page; later pages are not read). Read as a table with title and closing columns, else as one block per notice' },
      detail: { status: 'unavailable', method: 'Notice pages are not read; each notice links to its page on the site. Closing times are exact only where the page states the zone' },
      attachments: { status: 'unavailable', method: 'Documents stay on the site; files are not downloaded' },
      awards: { status: 'unavailable', method: 'Award results are not collected' },
      auth: { status: 'partial', method: 'Your Zoer browser profile. Browser checks are completed by you in the Zoer browser, never answered by Procurement; no logins' },
    } },
];

/** The documented fixed UTC−05:00 applies only to verified downloaded CanadaBuys source files. */
export function canadaBuysClosingAt(raw: string): string | undefined {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(raw)) return undefined;
  const local = new Date(`${raw}Z`);
  if (!Number.isFinite(local.getTime()) || local.toISOString().slice(0, 19) !== raw) return undefined;
  return `${raw}-05:00`;
}
