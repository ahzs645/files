/**
 * Procurement sites we cannot collect from (robots.txt, sign-in walls, no public listing), listed so people can check
 * them by hand. Sites that only block plain automated requests are collected in the person's Zoer browser instead
 * (browser-sites.ts, `procurement.collect.browser`) and are not listed here. The BC sources stream owns the entries; this module only fixes the shape the Sources page reads.
 * Each URL was opened on 2026-10-03 and showed its page to a person; zoer/src/connectors/SOURCES-RESEARCH.md has
 * the evidence for every reason.
 */
export interface LinkSource {
  id: string;
  /** The buyer or site as it names itself. */
  label: string;
  /** https page a person can open. */
  url: string;
  /** Municipality, regional district or other area, when known. */
  region?: string;
  /** Why it is not collected, in a few words (e.g. "Sign-in required"). */
  reason?: string;
  /** Buyers whose notices are found there, when the site serves more than its owner. */
  buyers?: string[];
  /** The longer explanation behind `reason`. */
  detail?: string;
}

/** The reason for sites whose robots.txt forbids collection; the browser-sites card lists these too. */
export const ROBOTS_REASON = 'robots.txt disallows collection';
const ROBOTS = ROBOTS_REASON;
const NOTHING_OPEN = 'Nothing open to check a reader against';
const bonfire = (host: string, label: string, region?: string): LinkSource => ({
  id: `bonfire-${host}`, label: `${label} (Bonfire)`, url: `https://${host}.bonfirehub.ca/portal/?tab=openOpportunities`, ...(region ? { region } : {}),
  reason: ROBOTS,
  detail: 'Bonfire\'s open-opportunity list answers without a login, but bonfirehub.ca robots.txt is "Disallow: /" for every agent. Documents need a free Bonfire vendor account.',
});
const site = (id: string, label: string, url: string, region: string, reason: string, detail: string): LinkSource => ({ id, label, url, region, reason, detail });

export const LINK_SOURCES: readonly LinkSource[] = [
  { id: 'jaggaer-vancouver', label: 'City of Vancouver (Jaggaer)', url: 'https://bids.sciquest.com/apps/Router/PublicEvent?CustomerOrg=CityofVancouver', region: 'Vancouver',
    reason: ROBOTS, detail: 'Server-rendered list with zoned closing times and contacts, but bids.sciquest.com robots.txt is "Disallow: /" for every agent.' },
  bonfire('victoria', 'City of Victoria', 'Victoria'),
  bonfire('saanich', 'District of Saanich', 'Saanich'),
  bonfire('centralsaanich', 'District of Central Saanich', 'Central Saanich'),
  bonfire('northcowichan', 'Municipality of North Cowichan', 'North Cowichan'),
  bonfire('cvrd', 'Cowichan Valley Regional District', 'Cowichan Valley'),
  bonfire('courtenay', 'City of Courtenay', 'Courtenay'),
  bonfire('comox', 'Town of Comox', 'Comox'),
  bonfire('vernon', 'City of Vernon', 'Vernon'),
  bonfire('kelowna', 'City of Kelowna', 'Kelowna'),
  bonfire('uvic', 'University of Victoria', 'Victoria'),
  bonfire('viu', 'Vancouver Island University', 'Nanaimo'),
  bonfire('bctransit', 'BC Transit'),
  bonfire('icbc', 'Insurance Corporation of British Columbia'),
  bonfire('islandhealth', 'Island Health', 'Vancouver Island'),
  bonfire('fraserhealth', 'Fraser Health', 'Fraser'),
  bonfire('phsa', 'Provincial Health Services Authority'),
  bonfire('fnha', 'First Nations Health Authority'),
  site('portalberni', 'City of Port Alberni', 'https://www.portalberni.ca/bid-opportunities', 'Port Alberni', 'Hand-edited table', 'Closing dates without times and no notice pages; nothing open on 2026-10-03.'),
  site('porthardy', 'District of Port Hardy', 'https://porthardy.ca/municipal-hall/staff/tender-and-bid-opportunities/', 'Port Hardy', 'No closing dates listed', 'Posts show only a title and posted date; two cooperative-purchasing notices of intent on 2026-10-03.'),
  site('scrd', 'Sunshine Coast Regional District', 'https://www.scrd.ca/bid/', 'Sunshine Coast', 'One-off page layout', 'WordPress page without a structured list; not built yet.'),
  site('qathet', 'qathet Regional District', 'https://www.qathet.ca/projects/bid-opportunities/', 'qathet', 'No closing dates listed', 'WordPress list without closing dates.'),
  site('hope', 'District of Hope', 'https://hope.ca/bids-and-tenders', 'Hope', 'One-off page layout', 'Prints closing times in "Pacific Time"; a one-off page not built yet.'),
  site('smithers', 'Town of Smithers', 'https://www.smithers.ca/business-development/bid-opportunities', 'Smithers', 'One-off page layout', 'Prints closing times in "PST"; a one-off page not built yet.'),
  site('acrd', 'Alberni-Clayoquot Regional District', 'https://www.acrd.bc.ca/bidopportunities', 'Alberni-Clayoquot', 'One-off page layout', 'A one-off page not built yet; links to BC Bid.'),
  site('pemberton', 'Village of Pemberton', 'https://www.pemberton.ca/government/bid-opportunities', 'Pemberton', 'One-off page layout', 'A one-off page that mostly links to BC Bid.'),
  site('terrace', 'City of Terrace', 'https://www.terrace.ca/business-development/procurement', 'Terrace', 'No closing dates listed', 'The list has no closing dates.'),
  site('slrd', 'Squamish-Lillooet Regional District', 'https://www.slrd.bc.ca/inside-slrd/contracting-opportunities', 'Squamish-Lillooet', 'Unlabelled date column', 'One notice on 2026-10-03, in a table whose only date column is headed "Date".'),
  site('oliver', 'Town of Oliver', 'https://www.oliver.ca/building-business-development/bids-tenders', 'Oliver', NOTHING_OPEN, 'Same Drupal template as Courtenay and Esquimalt; add it as a portal once a notice is posted.'),
  site('whiterock', 'City of White Rock', 'https://www.whiterockcity.ca/Bids.aspx', 'White Rock', NOTHING_OPEN, 'CivicPlus bid postings; its bids RSS returns the site\'s page feed instead.'),
  site('csrd', 'Columbia Shuswap Regional District', 'https://www.csrd.bc.ca/Bids.aspx', 'Columbia Shuswap', NOTHING_OPEN, 'CivicPlus bid postings.'),
  site('williamslake', 'City of Williams Lake', 'https://www.williamslake.ca/Bids.aspx', 'Williams Lake', NOTHING_OPEN, 'CivicPlus bid postings.'),
  site('nelson', 'City of Nelson', 'https://www.nelson.ca/Bids.aspx', 'Nelson', NOTHING_OPEN, 'CivicPlus bid postings (closed bids only on 2026-10-03).'),
  site('salmonarm', 'City of Salmon Arm', 'https://www.salmonarm.ca/Bids.aspx', 'Salmon Arm', NOTHING_OPEN, 'CivicPlus bid postings; Salmon Arm also uses bids&tenders.'),
];
