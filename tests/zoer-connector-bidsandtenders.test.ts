import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  bidsAndTenders, bidsAndTendersDate, bidsAndTendersInstant, collectBidsAndTendersPortal, decodeEntities, htmlToText, listingRecord,
  noticeNumber, parseListingPage, parseNoticePage, readSearchForm, searchUrl, splitZoned,
} from '../zoer/src/connectors/bidsandtenders';
import { CONNECTORS } from '../zoer/src/connectors';
import type { NetRequest, NetResponse } from '../zoer/src/connectors/types';
import { BIDSANDTENDERS_PORTALS } from '../zoer/dashboard/procurement/portals';
import manifest from '../zoer/manifest.json';

const fixture = (name: string) => readFileSync(new URL(`./fixtures/bidsandtenders/${name}`, import.meta.url), 'utf8');
const portal = (id: string) => BIDSANDTENDERS_PORTALS.find(item => item.id === id)!;
const listing = (id: string) => JSON.parse(fixture(`${id}-Open.json`));
const at = '2026-10-03T18:00:00.000Z';

describe('bids&tenders page parsing', () => {
  it('reads the search form NodeId and anti-forgery token from the homepage', () => {
    const form = readSearchForm(fixture('nanaimo-home.html'));
    expect(form.nodeId).toMatch(/^[0-9a-f-]{36}$/);
    expect(form.token.length).toBeGreaterThan(40);
    expect(searchUrl(portal('nanaimo'), form.nodeId, 100)).toBe(`https://nanaimo.bidsandtenders.ca/Module/Tenders/en/Tender/Search/${form.nodeId}?status=Open&limit=100&start=100&dir=ASC&from=&to=&sort=DateClosing%20ASC,Id`);
  });
  it.each(['<html>error</html>', fixture('nanaimo-home.html').replace('bidDetailAntiForgery', 'somethingElse'), fixture('nanaimo-home.html').replace(/id="NodeId" value="[^"]*"/, 'id="NodeId" value="x"')])('treats a homepage without the form as a layout failure', html => {
    expect(() => readSearchForm(html)).toThrow(expect.objectContaining({ code: 'source_layout' }));
  });
  it.each([
    ['not json', '<html>'], ['no success', '{"success":false,"total":0,"data":[]}'], ['no total', '{"success":true,"data":[]}'],
    ['data not a list', '{"success":true,"total":1,"data":{}}'], ['row without Id', '{"success":true,"total":1,"data":[{"Title":"x"}]}'],
    ['row with blank title', '{"success":true,"total":1,"data":[{"Id":"3d527422-9423-47e4-86a2-38c8fe7f94b7","Title":" "}]}'],
  ])('rejects malformed search responses (%s) instead of reading them as zero notices', (_, body) => {
    expect(() => parseListingPage(body)).toThrow(expect.objectContaining({ code: 'source_schema' }));
  });
  it('reads an empty portal as a reported total of zero', () => expect(parseListingPage(fixture('surrey-Open.json'))).toEqual({ total: 0, data: [] }));
  it('decodes entities and keeps paragraph breaks when turning descriptions into text', () => {
    expect(decodeEntities('A&amp;B&nbsp;&#8217;&#x2013;&rsquo;&unknownentity;')).toBe('A&B ’–’&unknownentity;');
    expect(htmlToText('<p style="x">One&nbsp;two.</p><p>Three<br>four</p><ul><li>a</li><li>b</li></ul><script>bad()</script>')).toBe('One two.\nThree\nfour\n• a\n• b');
  });
});

describe('bids&tenders dates', () => {
  it('builds closingAt from the displayed time and zone label, not the shifted /Date(ms)/ value', () => {
    const row = listing('nanaimo').data[0];
    expect(row.DateClosing).toBe('/Date(1791399600000)/');
    expect(bidsAndTendersInstant(row.DateClosingDisplay, row.TimeZoneLabel)).toBe('2026-10-07T15:00:00-07:00');
    expect(Date.parse(bidsAndTendersInstant(row.DateClosingDisplay, row.TimeZoneLabel)!)).toBe(Date.UTC(2026, 9, 7, 22));
  });
  it('handles PST, seconds, noon/midnight and mountain time', () => {
    expect(bidsAndTendersInstant('Fri Jan 29, 2027 2:00:00 PM', ' (PST)')).toBe('2027-01-29T14:00:00-08:00');
    expect(bidsAndTendersInstant('Thu Oct 8, 2026 12:00:00 PM', ' (PDT)')).toBe('2026-10-08T12:00:00-07:00');
    expect(bidsAndTendersInstant('Thu Oct 8, 2026 12:30 AM', ' (PDT)')).toBe('2026-10-08T00:30:00-07:00');
    expect(bidsAndTendersInstant('Thu Oct 8, 2026 3:00 PM', ' (MST)')).toBe('2026-10-08T15:00:00-07:00');
  });
  it.each([
    ['Wed Oct 7, 2026 3:00 PM', ''], ['Wed Oct 7, 2026 3:00 PM', ' (XYZ)'], ['Thu Oct 7, 2026 3:00 PM', ' (PDT)'],
    ['Wed Feb 30, 2026 3:00 PM', ' (PST)'], ['Wed Oct 7, 2026 13:00 PM', ' (PDT)'], ['2026-10-07T15:00:00', ' (PDT)'], ['', ' (PDT)'],
  ])('omits closingAt when %s / %s cannot be verified', (display, label) => expect(bidsAndTendersInstant(display, label)).toBeUndefined());
  it('splits zoned notice-page times and keeps only the date of unzoned listing times', () => {
    expect(splitZoned('Fri Sep 11, 2026 2:00 PM (PDT)')).toEqual({ display: 'Fri Sep 11, 2026 2:00 PM', label: ' (PDT)' });
    expect(bidsAndTendersDate('Tue Sep 1, 2026 1:40:00 PM')).toBe('2026-09-01');
  });
});

describe('bids&tenders notice numbers and notice pages', () => {
  it.each([
    ['4318 - Self-Contained Breathing Apparatus', undefined, '4318'], ['26-0583  - Data-Driven Analysis', undefined, '26-0583'],
    ['NOI#203-09-26 - Hexagon Software', undefined, 'NOI#203-09-26'], ['RFPQ-PM - RFPQ-Project Manager Services', undefined, undefined],
    ['2381183 - RFT - GC - Nanaimo Regional General Hospital', '2381183 - RFT - GC', '2381183 - RFT - GC'], ['No number here', undefined, undefined],
  ])('reads the notice number of %s', (title, bidNumber, expected) => expect(noticeNumber(title, bidNumber)).toBe(expected));
  it('reads type, classification, zoned published date and categories from a notice page', () => {
    const page = parseNoticePage(fixture('nanaimo-detail.html'))!;
    expect(page).toMatchObject({ bidNumber: '4318', type: 'Request for Proposal', classification: 'Services', published: 'Fri Sep 11, 2026 2:00 PM (PDT)' });
    expect(page.fields).toEqual(expect.arrayContaining([
      { label: 'Question Deadline', value: 'Wed Sep 30, 2026 12:00 PM (PDT)' }, { label: 'Duration in months', value: '60' },
      { label: 'Categories', value: 'Fire Services; Supplies; Sprinkler System; Maintenance' },
      { label: 'Trade Agreements', value: 'Please refer to Tender Description or Tender Documents' },
    ]));
    expect(page.fields.map(field => field.label)).not.toEqual(expect.arrayContaining(['Description', 'Bid Name', 'Bid Document Access']));
  });
  it('accepts a notice page without a published date and one whose bid number contains dashes', () => {
    expect(parseNoticePage(fixture('burnaby-detail.html'))).toMatchObject({ bidNumber: '197-09-26', published: undefined });
    expect(parseNoticePage(fixture('islandhealthfdc-detail.html'))).toMatchObject({ bidNumber: '2381183 - RFT - GC', type: 'Request for Tender', published: 'Tue Sep 1, 2026 1:40:59 PM (PDT)' });
  });
  it('does not mistake an error page for a notice', () => expect(parseNoticePage('<table><tr><th>Error:</th><td>Not found</td></tr></table>')).toBeUndefined());
});

describe('bids&tenders records', () => {
  it('maps a listing row and notice page to the shared record contract', () => {
    const row = listing('nanaimo').data[0], record = listingRecord(row, portal('nanaimo'), at, parseNoticePage(fixture('nanaimo-detail.html')));
    const key = 'bidsandtenders:nanaimo:3d527422-9423-47e4-86a2-38c8fe7f94b7';
    expect(record).toMatchObject({
      sourceId: 'bidsandtenders', sourceKey: key, processId: key, opportunityId: key, portalId: 'nanaimo', externalId: '4318',
      description: '4318 - Self-Contained Breathing Apparatus Filling Station Maintenance Services', issuedBy: 'City of Nanaimo', status: 'Open',
      type: 'Request for Proposal', category: 'Services', closingDate: 'Wed Oct 7, 2026 3:00 PM (PDT)', closingAt: '2026-10-07T15:00:00-07:00',
      publishedAt: '2026-09-11T14:00:00-07:00', detailUrl: 'https://nanaimo.bidsandtenders.ca/Module/Tenders/en/Tender/Detail/3d527422-9423-47e4-86a2-38c8fe7f94b7',
      sourceUrl: 'https://nanaimo.bidsandtenders.ca/Module/Tenders/en/Home/BidsHomepage', region: 'Nanaimo',
      place: { municipality: 'Nanaimo', regionalDistrict: 'Nanaimo', method: 'portal' }, documentsCount: 3, addendaCount: 1,
      sourceRetrievedAt: at, noticePageRetrievedAt: at, rawSourceData: row, attachments: [], addenda: [], detailFields: [], commodities: [],
    });
    expect(record.descriptionText).toBe('The purpose of this RFP is to obtain maintenance services for existing SCBA filling stations at various fire stations located within City of Nanaimo limits by a qualified Contractor.\nThis Request for Proposal is subject to the New West Partnership Trade Agreement, the Canadian Free Trade Agreement (Chapter 5), and the Canada-European Union Comprehensive Economic and Trade Agreement (Chapter 19).');
    expect(record.sourceDescriptionText).toBe(record.descriptionText);
    expect(record.sourceFields).toEqual(expect.arrayContaining([{ label: 'Plan takers', value: '3' }, { label: 'Documents', value: '3' }, { label: 'Addenda', value: '1' },
      { label: 'Bid scope', value: 'Public' }, { label: 'Published (source value)', value: 'Fri Sep 11, 2026 2:00 PM (PDT)' }, { label: 'Categories', value: 'Fire Services; Supplies; Sprinkler System; Maintenance' }]));
    expect(record.searchText).toContain('Sprinkler System');
    expect(record).not.toHaveProperty('contacts');
  });
  it('without a notice page keeps listing fields, a date-only published value and no invented type', () => {
    const record = listingRecord(listing('metrovancouver').data.find((row: any) => row.Title.startsWith('26-0227')), portal('metrovancouver'), at);
    expect(record).toMatchObject({ externalId: '26-0227', type: '', closingDate: 'Fri Jan 29, 2027 2:00:00 PM (PST)', closingAt: '2027-01-29T14:00:00-08:00', publishedAt: '2026-03-03', region: 'Metro Vancouver' });
    expect(record).not.toHaveProperty('category'); expect(record).not.toHaveProperty('noticePageRetrievedAt');
  });
  it('keeps unknown counts and places unknown rather than zero', () => {
    const row = { ...listing('nanaimo').data[0], Documents: null, Addendums: 'x', ShowPlanTakers: false, TimeZoneLabel: '' };
    const record = listingRecord(row, portal('islandhealthfdc'), at);
    expect(record).not.toHaveProperty('documentsCount'); expect(record).not.toHaveProperty('addendaCount'); expect(record).not.toHaveProperty('closingAt');
    expect(record.closingDate).toBe('Wed Oct 7, 2026 3:00 PM');
    expect(record.sourceFields.map((field: any) => field.label)).not.toContain('Plan takers');
    expect(record).toMatchObject({ region: null, place: { municipality: null, regionalDistrict: null, method: 'portal' } });
  });
  it('maps every saved fixture row with a parseable closing time', () => {
    for (const id of ['nanaimo', 'burnaby', 'richmond', 'metrovancouver', 'princegeorge', 'islandhealthfdc']) {
      for (const row of listing(id).data) expect(listingRecord(row, portal(id), at).closingAt, `${id} ${row.Title}`).toMatch(/^2\d{3}-\d\d-\d\dT\d\d:\d\d:\d\d-0[78]:00$/);
    }
  });
});

/** A scripted bids&tenders site: homepage, form search (paged) and notice pages. */
function site(options: { rows?: any[]; total?: number; search?: (request: NetRequest, start: number) => NetResponse | undefined; detail?: (id: string) => NetResponse } = {}) {
  const home = fixture('nanaimo-home.html'), { nodeId, token } = readSearchForm(home), requests: NetRequest[] = [];
  const rows = options.rows ?? listing('nanaimo').data, total = options.total ?? rows.length;
  const fetch = async (request: NetRequest): Promise<NetResponse> => {
    requests.push(request);
    const url = new URL(request.url);
    if (url.pathname.endsWith('/Home/BidsHomepage')) return { status: 200, headers: {}, text: home };
    if (url.pathname === `/Module/Tenders/en/Tender/Search/${nodeId}`) {
      expect(request).toMatchObject({ method: 'POST', form: { keywords: '', __RequestVerificationToken: token } });
      const start = Number(url.searchParams.get('start')), limit = Number(url.searchParams.get('limit'));
      return options.search?.(request, start) ?? { status: 200, headers: {}, text: JSON.stringify({ success: true, total, data: rows.slice(start, start + limit) }) };
    }
    const id = /\/Tender\/Detail\/(.+)$/.exec(url.pathname)?.[1];
    if (id) return options.detail?.(id) ?? { status: 200, headers: {}, text: fixture('nanaimo-detail.html') };
    throw new Error('unexpected ' + request.url);
  };
  return { fetch, requests };
}
const row = (i: number) => ({ ...listing('nanaimo').data[0], Id: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`, Title: `${i} - Notice ${i}` });

describe('bids&tenders portal collection', () => {
  it('collects a portal: homepage, one search page, then one notice page per notice', async () => {
    const { fetch, requests } = site();
    const result = await collectBidsAndTendersPortal(fetch, portal('nanaimo'), { now: () => at });
    expect(result).toMatchObject({ portalId: 'nanaimo', totalReported: 7, warnings: [] });
    expect(result.records).toHaveLength(7);
    expect(requests.map(request => request.method ?? 'GET')).toEqual(['GET', 'POST', ...Array(7).fill('GET')]);
    expect(requests.length).toBeLessThanOrEqual(bidsAndTenders.requestsPerPortal);
  });
  it('pages through more than 100 notices and de-duplicates rows that shift between pages', async () => {
    const rows = Array.from({ length: 150 }, (_, i) => row(i));
    const { fetch, requests } = site({ rows, search: (_, start) => start === 100 ? { status: 200, headers: {}, text: JSON.stringify({ success: true, total: 150, data: rows.slice(99, 150) }) } : undefined });
    const result = await collectBidsAndTendersPortal(fetch, portal('nanaimo'), { now: () => at });
    expect(result.records).toHaveLength(150);
    expect(requests.filter(request => request.method === 'POST').map(request => new URL(request.url).searchParams.get('start'))).toEqual(['0', '100']);
    expect(result.warnings).toEqual([expect.stringContaining('first 30 of 150 notice pages')]);
    expect(result.records.filter(record => record.type).length).toBe(30);
    expect(requests.length).toBe(bidsAndTenders.requestsPerPortal - 1);
  });
  it('reports a short listing as a warning with the portal total, never as complete', async () => {
    const { fetch } = site({ rows: listing('nanaimo').data.slice(0, 2), total: 9, detail: () => ({ status: 200, headers: {}, text: fixture('nanaimo-detail.html') }) });
    const result = await collectBidsAndTendersPortal(fetch, portal('nanaimo'), { now: () => at });
    expect(result.totalReported).toBe(9); expect(result.records).toHaveLength(2);
    expect(result.warnings).toEqual([expect.stringContaining('reports 9 open notices; 2 were listed')]);
  });
  it('keeps listing-only records when notice pages fail, and says so', async () => {
    const { fetch } = site({ detail: id => id.endsWith('7') ? { status: 302, headers: {}, text: '' } : { status: 200, headers: {}, text: '<html>Server error</html>' } });
    const result = await collectBidsAndTendersPortal(fetch, portal('nanaimo'), { now: () => at });
    expect(result.records).toHaveLength(7);
    expect(result.records.every(record => record.type === '' && !record.noticePageRetrievedAt)).toBe(true);
    expect(result.warnings[0]).toMatch(/Notice pages could not be read for 7 notice\(s\) \((HTTP 302; unrecognized page|unrecognized page; HTTP 302)\)/);
  });
  it.each([
    [{ status: 302, headers: { location: '/Module/Tenders/' }, text: '' }, 'source_session'], [{ status: 403, headers: {}, text: '' }, 'source_forbidden'],
    [{ status: 500, headers: {}, text: '' }, 'source_http_error'], [{ status: 200, headers: {}, text: '<html>' }, 'source_schema'],
  ])('fails the portal with a clear code when the search answers %o', async (response, code) => {
    const { fetch } = site({ search: () => response });
    await expect(collectBidsAndTendersPortal(fetch, portal('nanaimo'), { now: () => at })).rejects.toMatchObject({ code });
  });
  it('does not swallow a Zoer pause or an exhausted request budget while reading notice pages', async () => {
    for (const error of [Object.assign(new Error('Paused for Zoer update'), { code: 'ZOER_PAUSED' }), new Error('Network request budget exhausted.')]) {
      const { fetch } = site({ detail: () => { throw error; } });
      await expect(collectBidsAndTendersPortal(fetch, portal('nanaimo'), { now: () => at })).rejects.toBe(error);
    }
  });
});

describe('connector registry and manifest', () => {
  it('registers bids&tenders with all 25 BC portals', () => {
    expect(CONNECTORS.map(connector => connector.id)).toContain('bidsandtenders');
    expect(bidsAndTenders.portals).toHaveLength(25);
    for (const connector of CONNECTORS) expect(connector.id).toMatch(/^[a-z][a-z0-9-]{0,63}$/);
  });
  it('allowlists every connector host and budgets enough requests for every portal', () => {
    const allowlist: string[] = (manifest as any).integration.networkAllowlist;
    const action = (manifest as any).integration.actions.find((item: any) => item.id === 'procurement.collect');
    expect(allowlist.length).toBeLessThanOrEqual(64);
    for (const connector of CONNECTORS) {
      for (const item of connector.portals) { expect(allowlist).toContain(item.host); expect(new URL(item.url).hostname).toBe(item.host); }
      expect(action.resourceLimits.maxNetworkRequests).toBeGreaterThanOrEqual(connector.portals.length * connector.requestsPerPortal);
      expect(action.inputSchema.properties.sourceId.enum).toContain(connector.id);
      if (connector.needsSession) expect(action.networkSession).toEqual({ cookies: 'run', formPost: true });
    }
    expect(action.inputSchema.properties.portals).toMatchObject({ type: 'array', maxItems: 25, items: { pattern: '^[a-z0-9-]{1,63}$' } });
  });
});
