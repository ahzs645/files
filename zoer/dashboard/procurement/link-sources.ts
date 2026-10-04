/**
 * BC procurement pages Procurement does not collect, for people to check themselves (Sources page). Each URL was
 * opened on 2026-10-03 and showed its listing to a person; the reason says why it is a link and not a connector.
 * See zoer/src/connectors/SOURCES-RESEARCH.md for the evidence.
 */
export interface LinkSource {
  id: string;
  label: string;
  url: string;
  /** Buyers whose notices are found there. */
  buyers: string[];
  reason: string;
}

const ROBOTS = 'The platform\'s robots.txt disallows all automated access, so Procurement does not collect it.';
const bonfire = (host: string, buyer: string): LinkSource => ({
  id: `bonfire-${host}`, label: `${buyer} (Bonfire)`, url: `https://${host}.bonfirehub.ca/portal/?tab=openOpportunities`, buyers: [buyer],
  reason: `Bonfire portal. ${ROBOTS} Documents and submissions need a free Bonfire vendor account.`,
});

export const LINK_SOURCES: readonly LinkSource[] = [
  { id: 'civicinfo-bc', label: 'CivicInfo BC Bids & Tenders', url: 'https://www.civicinfo.bc.ca/bids',
    buyers: ['BC municipalities, regional districts and local boards that post there (23 current notices on 2026-10-03)'],
    reason: 'Directory of BC local-government bids. The site answers automated requests with a Cloudflare browser challenge, which Procurement does not bypass.' },
  { id: 'jaggaer-vancouver', label: 'City of Vancouver (Jaggaer)', url: 'https://bids.sciquest.com/apps/Router/PublicEvent?CustomerOrg=CityofVancouver',
    buyers: ['City of Vancouver'], reason: `Jaggaer public event list. ${ROBOTS}` },
  bonfire('victoria', 'City of Victoria'),
  bonfire('saanich', 'District of Saanich'),
  bonfire('centralsaanich', 'District of Central Saanich'),
  bonfire('northcowichan', 'Municipality of North Cowichan'),
  bonfire('cvrd', 'Cowichan Valley Regional District'),
  bonfire('courtenay', 'City of Courtenay'),
  bonfire('comox', 'Town of Comox'),
  bonfire('vernon', 'City of Vernon'),
  bonfire('kelowna', 'City of Kelowna'),
  bonfire('uvic', 'University of Victoria'),
  bonfire('viu', 'Vancouver Island University'),
  bonfire('bctransit', 'BC Transit'),
  bonfire('icbc', 'Insurance Corporation of British Columbia'),
  bonfire('islandhealth', 'Island Health'),
  bonfire('fraserhealth', 'Fraser Health'),
  bonfire('phsa', 'Provincial Health Services Authority'),
  bonfire('fnha', 'First Nations Health Authority'),
  { id: 'portalberni', label: 'City of Port Alberni bid opportunities', url: 'https://www.portalberni.ca/bid-opportunities', buyers: ['City of Port Alberni'],
    reason: 'A hand-edited table with closing dates but no times or notice pages; nothing was open on 2026-10-03, so no parser could be checked against a live notice.' },
  { id: 'porthardy', label: 'District of Port Hardy tender and bid opportunities', url: 'https://porthardy.ca/municipal-hall/staff/tender-and-bid-opportunities/', buyers: ['District of Port Hardy'],
    reason: 'Posts list only a title and posted date (no closing date); on 2026-10-03 it held two cooperative-purchasing notices of intent.' },
  { id: 'whiterock', label: 'City of White Rock bid postings', url: 'https://www.whiterockcity.ca/Bids.aspx', buyers: ['City of White Rock'],
    reason: 'CivicPlus bid postings; no open bids on 2026-10-03, so no parser could be checked against a live notice.' },
  { id: 'csrd', label: 'Columbia Shuswap Regional District bid postings', url: 'https://www.csrd.bc.ca/Bids.aspx', buyers: ['Columbia Shuswap Regional District'],
    reason: 'CivicPlus bid postings; no open bids on 2026-10-03, so no parser could be checked against a live notice.' },
];
