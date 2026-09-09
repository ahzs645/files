import { parseListingPage, parseDetailPage, parseBrowserCheckPage } from '../../packages/shared/src/parsers/index';

export interface PageCapture { url: string; title: string; html: string; capturedAt: string; pagination?: { currentPage: number; hasNext: boolean; visiblePages: number[] } }
const BASE_URL = 'https://bcbid.gov.bc.ca';
const text = (value: unknown) => String(value ?? '').slice(0, 1000);

export function parseCapture(page: PageCapture, kind: 'listing' | 'detail') {
  const url = new URL(page.url);
  if (url.origin !== BASE_URL || url.username || url.password) throw new Error('Select a BC Bid public page.');
  if (url.pathname.includes('/browser_check') || parseBrowserCheckPage(page.html).isBrowserCheck) {
    throw new Error('BC Bid requires a browser check. Complete it manually in the Zoer browser, resume agent control, then capture again.');
  }
  if (kind === 'listing') {
    if (!url.pathname.includes('/rfp/request_browse_public')) throw new Error('Open the BC Bid public Opportunities page before capturing listings.');
    if (!/id=["']body_x_grid_grd["']/.test(page.html)) throw new Error('The opportunities grid is not loaded. Wait for the page or complete the browser check.');
    const parsed = parseListingPage(page.html, BASE_URL);
    if (parsed.opportunities.length > 200) throw new Error('Select a page size of 200 or fewer before capturing.');
    const records = parsed.opportunities.map(record => ({ ...record, listingUrl: page.url }));
    return {
      rows: records.map(record => ({
        opportunity_id: text(record.opportunityId), description: text(record.description),
        status: text(record.status), type: text(record.type), closing_date: text(record.closingDate),
        issued_by: text(record.issuedBy), detail_url: text(record.detailUrl),
      })),
      document: { version: 1, kind, sourceUrl: page.url, capturedAt: page.capturedAt, scope: 'current-page', records },
    };
  }
  if (!/\/(?:rfp|bpm)\/process_manage_extranet\/\d+(?:\/|$)/.test(url.pathname)) throw new Error('Open a BC Bid public opportunity detail page before capturing details.');
  const record = parseDetailPage(page.html, BASE_URL, page.url);
  if (!record.processId || (!record.detailFields.length && !record.descriptionText)) throw new Error('Opportunity details are not loaded yet.');
  const fields = [
    ...(record.descriptionText ? [{ label: 'Description', value: record.descriptionText }] : []),
    ...record.detailFields,
    ...record.addenda.map(item => ({ label: item.title, value: [item.date, item.link].filter(Boolean).join(' · ') })),
    ...record.attachments.map(item => ({ label: item.name, value: item.url })),
  ];
  return {
    rows: fields.slice(0, 200).map(field => ({ field: text(field.label), value: text(field.value) })),
    document: { version: 1, kind, sourceUrl: page.url, capturedAt: page.capturedAt, scope: 'current-page', record },
  };
}
