import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  collectSitePortal, contactsFrom, leadingNumber, municipalSites, nextPage, parseCards, parseListing, parseNoticePage, parseTable, parseWallClock,
  readMoment, siteRecord, wallClockInstant,
} from '../zoer/src/connectors/municipal-sites';
import { CONNECTORS } from '../zoer/src/connectors/index';
import { SITE_PORTALS } from '../zoer/dashboard/procurement/site-portals';
import { LINK_SOURCES } from '../zoer/dashboard/procurement/link-sources';
import { SOURCES } from '../zoer/dashboard/procurement/catalog';
import { PROCUREMENT_SOURCE_ADAPTERS } from '../zoer/dashboard/procurement/source-adapters';
import { capabilityMatrix } from '../zoer/dashboard/procurement/source-health';
import type { NetFetch } from '../zoer/src/connectors/types';

// Pages saved on 2026-10-03 (scripts, styles and inline SVG emptied to keep the fixtures small).
const fixture = (name: string) => readFileSync(new URL(`./fixtures/municipal-sites/${name}`, import.meta.url), 'utf8');
const portal = (id: string) => SITE_PORTALS.find(p => p.id === id)!;
const NOW = '2026-10-04T01:40:00.000Z';
const recordsOf = (id: string, file: string) => {
  const p = portal(id);
  return parseListing(p, fixture(file)).rows.map(row => siteRecord(row, p, NOW));
};

describe('municipal-sites listings', () => {
  it('reads RDN closing instants from <time datetime> only after checking them against the printed time', () => {
    const records = recordsOf('rdn', 'rdn-listing.html');
    expect(records).toHaveLength(11);
    const daft = records[0];
    expect(daft).toMatchObject({
      sourceId: 'municipal-sites', sourceKey: 'municipal-sites:rdn:node-28806', externalId: '26-036', portalId: 'rdn',
      description: '26-036 GNPCC Wastewater DAFT Polymer RFP', issuedBy: 'Regional District of Nanaimo',
      closingDate: 'October 27, 2026 at 3:00 PM', closingAt: '2026-10-27T15:00:00-07:00', publishedAt: '2026-09-29',
      detailUrl: 'https://rdn.bc.ca/node/28806', sourceUrl: 'https://rdn.bc.ca/current-bid-opportunities',
      region: 'Nanaimo', place: { municipality: null, regionalDistrict: 'Nanaimo', method: 'portal' },
      attachments: [], addenda: [], detailFields: [], commodities: [],
    });
    expect(daft.processId).toBe(daft.sourceKey);
    expect(daft.opportunityId).toBe(daft.sourceKey);
    // RDN prints no status; open/closed comes from the verified closing instant and says so.
    expect(daft).toMatchObject({ status: 'Open', statusDerivedFrom: 'closingAt' });
    expect(records[1]).toMatchObject({ externalId: '26-039', status: 'Closed', closingAt: '2026-10-01T15:00:00-07:00' });
    // In winter RDN prints "1:00 AM" beside 08:00Z (= 00:00 PST): the two disagree, so only the date is claimed.
    expect(records.find(r => r.externalId === '26-006')).toMatchObject({ closingDate: 'December 31, 2026 at 1:00 AM', closingAt: '2026-12-31', status: 'Unknown' });
    expect(JSON.stringify(daft).length).toBeLessThan(250_000);
  });

  it('keys SRD rows by notice number (its rows carry no links) and keeps its status column', () => {
    const records = recordsOf('srd', 'srd-listing-all.html');
    expect(records).toHaveLength(15);
    expect(records[0]).toMatchObject({
      sourceKey: 'municipal-sites:srd:rfp-08-26', externalId: 'RFP-08-26', status: 'Closed', type: 'Request for proposal',
      closingDate: 'Oct 1, 2026 | 12:00 pm', closingAt: '2026-10-01T12:00:00-07:00', publishedAt: '2026-07-24',
      detailUrl: 'https://www.srd.ca/government/bid-opportunities',
    });
    expect(records[0]).not.toHaveProperty('statusDerivedFrom');
    expect(new Set(records.map(r => r.sourceKey)).size).toBe(15);
    expect(records.find(r => r.description === 'Disposal of Surplus Asset -- 1988 GMC Pumper Fire Truck')?.sourceKey).toBe('municipal-sites:srd:disposal-of-surplus-asset-1988-gmc-pumper-fire-truck');
  });

  it('treats a stated empty result as zero notices and anything else without a table as a layout change', () => {
    expect(parseTable(fixture('srd-listing-open.html'))).toEqual({ rows: [], empty: true });
    expect(() => parseTable('<html><body><h1>Bids</h1><p>Maintenance</p></body></html>')).toThrow(expect.objectContaining({ code: 'source_layout' }));
  });

  it('checks Penticton\'s time-only element against the date beside it', () => {
    const records = recordsOf('penticton', 'penticton-listing.html');
    expect(records.map(r => r.externalId)).toEqual(['2026-RFP-30', '2026-RFP-26', '2026-RFQ-05']);
    expect(records[0]).toMatchObject({
      sourceKey: 'municipal-sites:penticton:electric-utility-scada-digital-mimic', status: 'Open', description: 'ELECTRIC UTILITY SCADA DIGITAL MIMIC SOFTWARE',
      closingDate: '10/30/26 2:00pm', closingAt: '2026-10-30T14:00:00-07:00', publishedAt: '2026-10-01T16:56:01-07:00', region: 'Penticton',
    });
  });

  it('keeps only the date when eSolutions pages print a time without a zone', () => {
    const [fernie] = recordsOf('fernie', 'fernie-listing.html');
    expect(fernie).toMatchObject({ status: 'Open', closingDate: '10/14/26 2:00 pm', closingAt: '2026-10-14', publishedAt: '2026-09-23',
      externalId: 'sanitary-main-cctv-inspection-program-supply-service-rfp' });
    const fvrd = recordsOf('fvrd', 'fvrd-listing.html');
    expect(fvrd.length).toBeGreaterThan(5);
    expect(fvrd[0]).toMatchObject({ externalId: 'RFP - 26008', status: 'Open', closingDate: 'Oct 9, 2026 1:00pm', closingAt: '2026-10-09' });
    expect(fvrd[1]).toMatchObject({ status: 'Closed' });
  });

  it('reads Surrey cards across pages', () => {
    const first = parseCards(fixture('surrey-listing-0.html')), second = parseCards(fixture('surrey-listing-1.html'));
    expect(first.rows).toHaveLength(10);
    expect(second.rows).toHaveLength(3);
    expect(first.rows[1]).toMatchObject({ number: '4824-031-11', title: '60th Avenue Drainage Pump Station', type: 'ITT', status: 'Open',
      href: '/business-economy/tenders-rfqs-rfps/60th-avenue-drainage-pump-station' });
    const base = 'https://www.surrey.ca/business-economy/tenders-rfqs-rfps?status=191';
    expect(nextPage(fixture('surrey-listing-0.html'), base)).toBe('https://www.surrey.ca/business-economy/tenders-rfqs-rfps?status=191&page=1');
    expect(nextPage(fixture('surrey-listing-1.html'), base)).toBeUndefined();
    expect(nextPage('<a rel="next" href="https://elsewhere.example/?page=1">', base)).toBeUndefined();
  });
});

describe('municipal-sites portals added from the BC survey', () => {
  it('reads the Up&Up table whose title header is empty (Courtenay, Esquimalt)', () => {
    const courtenay = recordsOf('courtenay', 'courtenay-listing.html');
    expect(courtenay).toHaveLength(7);
    expect(courtenay[0]).toMatchObject({
      sourceKey: 'municipal-sites:courtenay:lake-trail-road', externalId: 'C26-158', description: 'Lake Trail Road Retaining Wall & Culvert Remediation',
      status: 'Open', closingDate: 'Oct 28, 2026 - 2:00pm', closingAt: '2026-10-28T14:00:00-07:00', publishedAt: '2026-09-29',
    });
    const esquimalt = recordsOf('esquimalt', 'esquimalt-listing.html');
    expect(esquimalt).toHaveLength(16);
    expect(esquimalt[1]).toMatchObject({ externalId: 'ITT No. ENG 26-04', closingAt: '2026-10-28T14:00:00-07:00', status: 'Open' });
    expect(esquimalt.find(r => r.status === 'Evaluating')).toBeTruthy();
  });

  it('reads Drupal list views (Quesnel, Comox) and ignores Quesnel\'s repeated deadline label', () => {
    const quesnel = recordsOf('quesnel', 'quesnel-listing.html');
    expect(quesnel).toHaveLength(8);
    expect(quesnel[0]).toMatchObject({ sourceKey: 'municipal-sites:quesnel:animal-shelter-services-eoi', status: 'Open', type: 'Expression of Interest',
      closingDate: 'October 30, 2026 - 2:00pm', closingAt: '2026-10-30T14:00:00-07:00' });
    const comox = recordsOf('comox', 'comox-listing.html');
    expect(comox.map(r => r.description)).toEqual(['2026.06 Comox Valley Workforce Development & Labour Market Alignment Initiative', 'Canoe Request for Proposals']);
    // The alerts banner above the list is not a notice; Comox prints no status, so it comes from the verified time.
    expect(comox[0]).toMatchObject({ closingAt: '2026-10-23T16:30:00-07:00', status: 'Open', statusDerivedFrom: 'closingAt',
      descriptionText: expect.stringMatching(/^The Town of Comox/) });
  });

  it('keeps dates only for Saanich and joins Dawson Creek\'s separate closing time column', () => {
    const saanich = recordsOf('saanich', 'saanich-listing.html');
    expect(saanich.length).toBeGreaterThan(50);
    expect(saanich[0]).toMatchObject({ externalId: 'RFQ 26-212', status: 'Open', closingDate: 'Oct 29, 2026 3:00pm', closingAt: '2026-10-29', publishedAt: '2026-10-02' });
    const dawson = recordsOf('dawsoncreek', 'dawsoncreek-listing.html');
    expect(dawson).toHaveLength(23);
    expect(dawson.find(r => r.description.includes('Kin Park Splash Park'))).toMatchObject({ status: 'Open', closingDate: 'October 27, 2026 2:00 PM', closingAt: '2026-10-27' });
  });

  it('reads their notice pages', () => {
    const courtenay = parseNoticePage(fixture('courtenay-detail.html'), 'https://www.courtenay.ca/x')!;
    expect(courtenay).toMatchObject({ number: 'C26-158', status: 'Open', contacts: [{ name: 'Graham Peterson', email: 'purchasing@courtenay.ca', source: 'detail-field' }] });
    expect(courtenay.description).toMatch(/^The City of Courtenay is seeking Proposals/);
    const quesnel = parseNoticePage(fixture('quesnel-detail.html'), 'https://www.quesnel.ca/x')!;
    expect(quesnel).toMatchObject({ closing: 'October 30, 2026 - 2:00pm', status: 'Open' });
    expect(quesnel.fields).toEqual([{ label: 'Type', value: 'Expression of Interest' }]);
    const comox = parseNoticePage(fixture('comox-detail.html'), 'https://www.comox.ca/government-bylaws/bid-opportunities/x')!;
    expect(comox.documents).toEqual([{ name: 'Final Town of Comox LMP RFP.pdf', url: 'https://www.comox.ca/media/4140' }]);
    const saanich = parseNoticePage(fixture('saanich-detail.html'), 'https://www.saanich.ca/x')!;
    expect(saanich).toMatchObject({ number: 'RFQ 26-212', contacts: [{ email: 'purchase@saanich.ca', source: 'detail-field' }] });
    expect(parseNoticePage(fixture('esquimalt-detail.html'), 'https://www.esquimalt.ca/x')).toMatchObject({ status: 'Open', closing: 'October 28, 2026 - 2:00pm' });
  });
});

describe('municipal-sites notice pages', () => {
  it('reads the RDN body, contact and documents', () => {
    const page = parseNoticePage(fixture('rdn-node-28806.html'), 'https://rdn.bc.ca/node/28806')!;
    expect(page.description).toMatch(/^The Regional District of Nanaimo is interested in procuring Dissolved Air Flotation/);
    expect(page.contacts).toEqual([{ name: 'Adrian Limpus', email: 'alimpus@rdn.bc.ca', role: 'Wastewater Program Coordinator - Operations', source: 'description' }]);
    expect(page.documents.map(d => d.name)).toEqual(['26-036 GNPCC Wastewater DAFT Polymer RFP', '26-036 GNPCC DAFT Polymer RFP Appendix A Submission Form']);
    expect(page.documents[0].url).toMatch(/^https:\/\/rdn\.bc\.ca\/sites\/default\/files\/2026-09\//);
    // Sidebar menus and the footer contact are not part of the notice.
    expect(JSON.stringify(page)).not.toMatch(/inquiries@rdn\.bc\.ca|Community Grants/);
  });

  it('reads eSolutions labelled fields', () => {
    const fernie = parseNoticePage(fixture('fernie-detail.html'), 'https://www.fernie.ca/EN/main/business/bid-opportunities/x.html')!;
    expect(fernie.contacts).toEqual([{ name: 'Zack Randell', role: 'Engineering Technologist', email: 'zack.randell@fernie.ca', phone: '250-946-7728', source: 'detail-field' }]);
    expect(fernie.documents).toEqual([{ name: '2026 Sanitary Mains CCTV Program RFP', url: 'https://fernie.civicweb.net/filepro/document/205338/2026%20Sanitary%20Mains%20CCTV%20Program%20RFP.pdf' }]);
    expect(fernie.status).toBe('Open');
    const fvrd = parseNoticePage(fixture('fvrd-detail.html'), 'https://www.fvrd.ca/EN/main/government/tenders-rfps/x.html')!;
    expect(fvrd.contacts).toEqual([{ name: 'Christina Vugteveen', role: 'Manager of Parks', email: 'cvugteveen@fvrd.ca', source: 'detail-field' }]);
    expect(fvrd.documents.map(d => d.name)).toEqual(['RFP-26008 - Operation and Maintenance of Vedder River Campground.pdf', 'ADDENDA 1 - RFP 26008.pdf']);
  });

  it('turns Surrey\'s "local time" into an instant and never decodes protected emails', () => {
    const p = portal('surrey');
    const pump = parseNoticePage(fixture('surrey-detail-pump-station.html'), 'https://www.surrey.ca/x')!;
    expect(pump.closing).toBe('OCtober 7, 2026 - 2:00pm local time');
    expect(pump.description).toMatch(/^INVITATION TO TENDERERS\nThe Owner invites tenders for:\nThe construction of a new 60th Avenue pump station/);
    expect(pump.contacts).toEqual([{ name: 'Tindi Sekhon', phone: '778-772-6964', source: 'detail-field' }]);
    const row = parseCards(fixture('surrey-listing-0.html')).rows[1];
    expect(siteRecord(row, p, NOW, pump)).toMatchObject({
      sourceKey: 'municipal-sites:surrey:60th-avenue-drainage-pump-station', externalId: '4824-031-11', status: 'Open', type: 'ITT',
      closingDate: 'OCtober 7, 2026 - 2:00pm local time', closingAt: '2026-10-07T14:00:00-07:00', documentsCount: 0,
      contacts: [{ name: 'Tindi Sekhon', phone: '778-772-6964', source: 'detail-field' }],
    });
    const housing = parseNoticePage(fixture('surrey-detail-housing-plan.html'), 'https://www.surrey.ca/x')!;
    expect(housing.contacts).toEqual([{ name: 'Sunny Kaila', role: 'Manager, Procurement & Payables', phone: '(604) 590-7274', source: 'detail-field' }]);
    expect(housing.documents.map(d => d.name)).toContain('ADD-2026-068-Addendum-No-1.pdf');
    expect(readMoment(housing.closingHtml!, p.timeZone).at).toBe('2026-10-16T15:00:00-07:00');
    const shortlist = parseNoticePage(fixture('surrey-detail-shortlist.html'), 'https://www.surrey.ca/x')!;
    const rolling = siteRecord({ title: 'Shortlist', href: '/x', cells: {}, html: {} }, p, NOW, shortlist);
    expect(rolling.closingDate).toBe('submissions can be received at any time');
    expect(rolling).not.toHaveProperty('closingAt');
  });
});

describe('municipal-sites dates', () => {
  it('parses the printed formats', () => {
    expect(parseWallClock('October 27, 2026 at 3:00 PM')).toEqual({ date: '2026-10-27', hour: 15, minute: 0 });
    expect(parseWallClock('OCtober 16th, 2026 - 3:00 p.m., local time')).toEqual({ date: '2026-10-16', hour: 15, minute: 0 });
    expect(parseWallClock('Tue, 10/27/2026 - 15:00', 'mdy')).toEqual({ date: '2026-10-27', hour: 15, minute: 0 });
    expect(parseWallClock('Oct 1, 2026 | 12:00 pm')).toEqual({ date: '2026-10-01', hour: 12, minute: 0 });
    expect(parseWallClock('12:00am Sep 11, 2026')).toEqual({ date: '2026-09-11', hour: 0, minute: 0 });
    // Slash dates are read only where the site is known to print month/day/year.
    expect(parseWallClock('10/14/26 2:00 pm')).toBeUndefined();
    expect(parseWallClock('February 30, 2026')).toBeUndefined();
  });

  it('claims an instant only when the zone is stated or the machine-readable time matches the printed one', () => {
    const zone = 'America/Vancouver';
    expect(readMoment('<time datetime="2026-10-27T22:00:00Z">October 27, 2026 at 3:00 PM</time>', zone)).toEqual({ text: 'October 27, 2026 at 3:00 PM', at: '2026-10-27T15:00:00-07:00', precision: 'instant' });
    // A datetime that disagrees with the printed time (wrong site zone) is not trusted.
    expect(readMoment('<time datetime="2026-10-27T15:00:00Z">October 27, 2026 at 3:00 PM</time>', zone)).toEqual({ text: 'October 27, 2026 at 3:00 PM', at: '2026-10-27', precision: 'date' });
    expect(readMoment('<time datetime="2026-10-27T22:00:00Z">October 27, 2026 at 3:00 PM</time>', 'America/Edmonton').precision).toBe('date');
    expect(readMoment('Nov 13, 2026 3:00 PM PST', zone).at).toBe('2026-11-13T15:00:00-08:00');
    expect(readMoment('November 13, 2026 at 3:00 PM Pacific Time', 'America/Edmonton').at).toBe('2026-11-13T15:00:00-08:00');
    expect(readMoment('November 13, 2026, 3:00pm local time', 'America/Edmonton').at).toBe('2026-11-13T15:00:00-07:00');
    expect(readMoment('November 13, 2026, 3:00pm', zone)).toEqual({ text: 'November 13, 2026, 3:00pm', at: '2026-11-13', precision: 'date' });
    expect(readMoment('To be announced', zone)).toEqual({ text: 'To be announced', precision: 'none' });
    // 02:30 on the spring-forward day does not exist in Vancouver.
    expect(wallClockInstant({ date: '2027-03-14', hour: 2, minute: 30 }, zone)).toBeUndefined();
    expect(wallClockInstant({ date: '2027-03-14', hour: 3, minute: 30 }, zone)).toBe('2027-03-14T03:30:00-07:00');
  });

  it('finds notice numbers at the start of titles only when they look like numbers', () => {
    expect(leadingNumber('26-036 GNPCC Wastewater DAFT Polymer RFP')).toBe('26-036');
    expect(leadingNumber('RFQ 07-25 Supply and Delivery of Enclosed Trailer')).toBe('RFQ 07-25');
    expect(leadingNumber('RFP-06-26 - Pre-Construction Management Services')).toBe('RFP-06-26');
    expect(leadingNumber('ITT No. ENG 26-04 - Gosper Sewer Upgrades')).toBe('ITT No. ENG 26-04');
    expect(leadingNumber('Disposal of Surplus Asset -- 1988 GMC Pumper Fire Truck')).toBeUndefined();
  });

  it('reads contacts only from what is published', () => {
    expect(contactsFrom('Questions to:\nJane Doe\nPurchasing Supervisor\nEmail: jane.doe@example.ca', 'description'))
      .toEqual([{ name: 'Jane Doe', role: 'Purchasing Supervisor', email: 'jane.doe@example.ca', source: 'description' }]);
    expect(contactsFrom('Sunny Kaila\nTel: (604) 590-7274\nEmail: [email protected]', 'detail-field')).toEqual([{ name: 'Sunny Kaila', phone: '(604) 590-7274', source: 'detail-field' }]);
    expect(contactsFrom('The City reserves the right to cancel.', 'description')).toEqual([]);
  });
});

describe('municipal-sites collection', () => {
  const routes = (map: Record<string, string>): NetFetch & { calls: string[] } => {
    const calls: string[] = [];
    const fetch = (async ({ url }) => {
      calls.push(url);
      return map[url] ? { status: 200, headers: {}, text: fixture(map[url]) } : { status: 404, headers: {}, text: 'Not found' };
    }) as NetFetch & { calls: string[] };
    fetch.calls = calls;
    return fetch;
  };
  const surrey = 'https://www.surrey.ca/business-economy/tenders-rfqs-rfps';

  it('follows pages, reads open notice pages and warns about the ones it could not read', async () => {
    const fetch = routes({
      [`${surrey}?status=191`]: 'surrey-listing-0.html', [`${surrey}?status=191&page=1`]: 'surrey-listing-1.html',
      [`${surrey}/60th-avenue-drainage-pump-station`]: 'surrey-detail-pump-station.html', [`${surrey}/affordable-housing-plan`]: 'surrey-detail-housing-plan.html',
    });
    const result = await collectSitePortal(fetch, portal('surrey'), { now: () => NOW });
    expect(result.portalId).toBe('surrey');
    expect(result.records).toHaveLength(13);
    expect(result.totalReported).toBeUndefined();
    expect(fetch.calls).toHaveLength(2 + 13);
    expect(fetch.calls.every(url => new URL(url).host === 'www.surrey.ca')).toBe(true);
    expect(result.records.find(r => r.externalId === '1220-030-2026-068')).toMatchObject({ closingAt: '2026-10-16T15:00:00-07:00', documentsCount: 3 });
    expect(result.records.find(r => r.externalId === '5525-001-11')).toMatchObject({ closingDate: '', descriptionText: expect.stringMatching(/^INVITATION TO TENDERERS/) });
    expect(result.warnings).toEqual([expect.stringMatching(/^Notice pages could not be read for 11 notice\(s\) \(HTTP 404\)/)]);
  });

  it('reads notice pages only for notices the listing does not already show as closed', async () => {
    const fetch = routes({ 'https://www.fvrd.ca/EN/main/government/tenders-rfps.html': 'fvrd-listing.html',
      'https://www.fvrd.ca/EN/main/government/tenders-rfps/operation-and-maintenance-of-vedder-river-campground.html': 'fvrd-detail.html' });
    const result = await collectSitePortal(fetch, portal('fvrd'), { now: () => NOW });
    const open = result.records.filter(r => r.status === 'Open');
    expect(fetch.calls).toHaveLength(1 + open.length);
    expect(result.records[0]).toMatchObject({ contacts: [{ name: 'Christina Vugteveen', email: 'cvugteveen@fvrd.ca' }], documentsCount: 2 });
  });

  it('fails the portal with a coded error on HTTP errors and layout changes', async () => {
    const forbidden: NetFetch = async () => ({ status: 403, headers: {}, text: '' });
    await expect(collectSitePortal(forbidden, portal('rdn'), { now: () => NOW })).rejects.toMatchObject({ code: 'source_forbidden' });
    const changed: NetFetch = async () => ({ status: 200, headers: {}, text: '<html><h1>New site</h1></html>' });
    await expect(collectSitePortal(changed, portal('penticton'), { now: () => NOW })).rejects.toMatchObject({ code: 'source_layout' });
  });

  it('lists SRD\'s open and amended statuses and returns no records when both are empty', async () => {
    const fetch = routes({ 'https://www.srd.ca/government/bid-opportunities?status=66': 'srd-listing-open.html', 'https://www.srd.ca/government/bid-opportunities?status=67': 'srd-listing-open.html' });
    expect(await collectSitePortal(fetch, portal('srd'), { now: () => NOW })).toEqual({ portalId: 'srd', records: [], warnings: [] });
    expect(fetch.calls).toHaveLength(2);
  });
});

describe('municipal-sites registration', () => {
  const manifest = JSON.parse(readFileSync(new URL('../zoer/manifest.json', import.meta.url), 'utf8'));
  const allowlist: string[] = manifest.integration.networkAllowlist;

  it('is registered and every portal host is allowlisted, within the host limit', () => {
    expect(CONNECTORS).toContain(municipalSites);
    expect(allowlist.length).toBeLessThanOrEqual(64);
    for (const p of SITE_PORTALS) {
      expect(allowlist).toContain(p.host);
      expect(p.id).toMatch(/^[a-z0-9-]+$/);
      expect(new URL(p.url).host).toBe(p.host);
      for (const url of p.listUrls) expect(new URL(url).host).toBe(p.host);
    }
    expect(new Set(SITE_PORTALS.map(p => p.id)).size).toBe(SITE_PORTALS.length);
    const collect = manifest.integration.actions.find((action: any) => action.id === 'procurement.collect');
    expect(collect.inputSchema.properties.sourceId.enum).toContain('municipal-sites');
    expect(municipalSites).toMatchObject({ needsSession: false, requestsPerPortal: 31 });
  });

  it('describes the source honestly on the Sources page', () => {
    expect(SOURCES.find(s => s.id === 'municipal-sites')).toBeTruthy();
    const adapter = PROCUREMENT_SOURCE_ADAPTERS.find(a => a.id === 'municipal-sites')!;
    expect(adapter.capabilities.attachments.status).toBe('unavailable');
    expect(capabilityMatrix('municipal-sites', adapter.capabilities).find(c => c.name === 'Addenda')?.status).toBe('partial');
  });

  it('keeps link-only sources to unique https pages', () => {
    expect(new Set(LINK_SOURCES.map(s => s.id)).size).toBe(LINK_SOURCES.length);
    for (const source of LINK_SOURCES) {
      expect(new URL(source.url).protocol).toBe('https:');
      expect(source.reason?.length).toBeGreaterThan(5);
      expect(source.reason!.length).toBeLessThanOrEqual(60);
      // A link-only page is never also collected.
      expect(allowlist).not.toContain(new URL(source.url).host);
    }
  });
});
