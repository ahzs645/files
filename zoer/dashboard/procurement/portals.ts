import type { ConnectorPortal } from '../../src/connectors/types';
import { regionalDistrictName } from './place-data';

/**
 * BC buyers publishing on bids&tenders, each checked on 2026-10-03 (BidsHomepage answered 200). Surrey's portal
 * answered but listed no open notices that day. Ids are part of saved sourceKeys: add portals, never rename them.
 */
const portal = (id: string, label: string, municipality: string | null, regionalDistrict: string | null): ConnectorPortal => ({
  id, label, host: `${id}.bidsandtenders.ca`, url: `https://${id}.bidsandtenders.ca/Module/Tenders/en/Home/BidsHomepage`,
  place: { municipality, regionalDistrict: regionalDistrict && regionalDistrictName(regionalDistrict), method: 'portal' },
});

export const BIDSANDTENDERS_PORTALS: readonly ConnectorPortal[] = [
  portal('abbotsford', 'City of Abbotsford', 'Abbotsford', 'Fraser Valley'),
  portal('burnaby', 'City of Burnaby', 'Burnaby', 'Metro Vancouver'),
  portal('campbellriver', 'City of Campbell River', 'Campbell River', 'Strathcona'),
  portal('comoxvalleyrd', 'Comox Valley Regional District', null, 'Comox Valley'),
  portal('coquitlam', 'City of Coquitlam', 'Coquitlam', 'Metro Vancouver'),
  portal('dnv', 'District of North Vancouver', 'North Vancouver (District)', 'Metro Vancouver'),
  portal('fortstjohn', 'City of Fort St. John', 'Fort St. John', 'Peace River'),
  portal('islandhealthfdc', 'Island Health', null, null),
  portal('lakecountry', 'District of Lake Country', 'Lake Country', 'Central Okanagan'),
  portal('mapleridge', 'City of Maple Ridge', 'Maple Ridge', 'Metro Vancouver'),
  portal('metrovancouver', 'Metro Vancouver', null, 'Metro Vancouver'),
  portal('nanaimo', 'City of Nanaimo', 'Nanaimo', 'Nanaimo'),
  portal('oakbay', 'District of Oak Bay', 'Oak Bay', 'Capital'),
  portal('portmoody', 'City of Port Moody', 'Port Moody', 'Metro Vancouver'),
  portal('princegeorge', 'City of Prince George', 'Prince George', 'Fraser-Fort George'),
  portal('rdco', 'Regional District of Central Okanagan', null, 'Central Okanagan'),
  portal('richmond', 'City of Richmond', 'Richmond', 'Metro Vancouver'),
  portal('salmonarm', 'City of Salmon Arm', 'Salmon Arm', 'Columbia Shuswap'),
  portal('sd72', 'School District 72 (Campbell River)', 'Campbell River', 'Strathcona'),
  portal('sechelt', 'District of Sechelt', 'Sechelt', 'Sunshine Coast'),
  portal('sidney', 'Town of Sidney', 'Sidney', 'Capital'),
  portal('squamish', 'District of Squamish', 'Squamish', 'Squamish-Lillooet'),
  portal('surrey', 'City of Surrey', 'Surrey', 'Metro Vancouver'),
  portal('vernon', 'City of Vernon', 'Vernon', 'North Okanagan'),
  portal('westkelowna', 'City of West Kelowna', 'West Kelowna', 'Central Okanagan'),
];
