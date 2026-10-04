import type { ConnectorPortal } from '../../src/connectors/types';

/**
 * BC buyers whose own website lists their bids as server-rendered HTML (connector `municipal-sites`).
 * Each was checked on 2026-10-03: the listing answered 200 without a challenge and robots.txt allows the path.
 * Ids are part of saved sourceKeys: add portals, never rename them.
 */
export interface SitePortal extends ConnectorPortal {
  /** `table`: one HTML table with a header row (Drupal views, eSolutions). `cards`: Surrey's tender search cards. */
  layout: 'table' | 'cards';
  /** Listing pages fetched in order; each follows `rel="next"` up to the connector's page limit. */
  listUrls: string[];
  /** The buyer's IANA zone, used to check `<time datetime>` values against the time the page shows and for "local time". */
  timeZone: string;
  /** Status every listed row has because the list itself is filtered (e.g. an "open bids" page). */
  listStatus?: string;
  /** `link`: the notice page path is the stable id. `number`: the notice number in the title (rows carry no link). */
  keyBy: 'link' | 'number';
  /** `09/23/26` style dates are month/day/year on this site (checked against a day above 12 or a machine-readable date). */
  slashDates?: 'mdy';
  /** Read each not-yet-closed notice page for description, contacts and documents (and, for cards, the closing date). */
  details: boolean;
}

const PACIFIC = 'America/Vancouver';
const place = (municipality: string | null, regionalDistrict: string | null) => ({ municipality, regionalDistrict, method: 'portal' as const });

export const SITE_PORTALS: readonly SitePortal[] = [
  { id: 'rdn', label: 'Regional District of Nanaimo', host: 'rdn.bc.ca', url: 'https://rdn.bc.ca/current-bid-opportunities',
    listUrls: ['https://rdn.bc.ca/current-bid-opportunities'], place: place(null, 'Nanaimo'),
    layout: 'table', timeZone: PACIFIC, keyBy: 'link', details: true },
  // The default view shows "Open" only; "Open - Amended" is a separate status, so both are listed.
  { id: 'srd', label: 'Strathcona Regional District', host: 'www.srd.ca', url: 'https://www.srd.ca/government/bid-opportunities',
    listUrls: ['https://www.srd.ca/government/bid-opportunities?status=66', 'https://www.srd.ca/government/bid-opportunities?status=67'],
    place: place(null, 'Strathcona'), layout: 'table', timeZone: PACIFIC, keyBy: 'number', details: false },
  { id: 'penticton', label: 'City of Penticton', host: 'www.penticton.ca', url: 'https://www.penticton.ca/business-building/bid-opportunities/open-bid-opportunities',
    listUrls: ['https://www.penticton.ca/business-building/bid-opportunities/open-bid-opportunities'], place: place('Penticton', 'Okanagan-Similkameen'),
    layout: 'table', timeZone: PACIFIC, listStatus: 'Open', keyBy: 'link', slashDates: 'mdy', details: true },
  // Fernie keeps Mountain Time.
  { id: 'fernie', label: 'City of Fernie', host: 'www.fernie.ca', url: 'https://www.fernie.ca/EN/main/business/bid-opportunities.html',
    listUrls: ['https://www.fernie.ca/EN/main/business/bid-opportunities.html'], place: place('Fernie', 'East Kootenay'),
    layout: 'table', timeZone: 'America/Edmonton', keyBy: 'link', slashDates: 'mdy', details: true },
  { id: 'fvrd', label: 'Fraser Valley Regional District', host: 'www.fvrd.ca', url: 'https://www.fvrd.ca/EN/main/government/tenders-rfps.html',
    listUrls: ['https://www.fvrd.ca/EN/main/government/tenders-rfps.html'], place: place(null, 'Fraser Valley'),
    layout: 'table', timeZone: PACIFIC, keyBy: 'link', details: true },
  // Surrey also has a bids&tenders portal (empty on 2026-10-03); its own site lists the open tenders, most issued through BC Bid.
  { id: 'surrey', label: 'City of Surrey', host: 'www.surrey.ca', url: 'https://www.surrey.ca/business-economy/tenders-rfqs-rfps',
    listUrls: ['https://www.surrey.ca/business-economy/tenders-rfqs-rfps?status=191'], place: place('Surrey', 'Metro Vancouver'),
    layout: 'cards', timeZone: PACIFIC, keyBy: 'link', details: true },
];
