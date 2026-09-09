import { parseCapture, type PageCapture } from './capture';
import { parseListingPage, mergeOpportunityRecord } from '../../packages/shared/src/parsers/index';

export const LISTING_URL = 'https://bcbid.gov.bc.ca/page.aspx/en/rfp/request_browse_public';
/** One real listing page plus at most three detail pages. Persistence checkpoints survive later failures. */
export async function scrapeSample(browser: { captureUrl(url: string): Promise<PageCapture> }, save: (document: any) => Promise<string>, detailLimit = 3) {
  if (!Number.isInteger(detailLimit) || detailLimit < 0 || detailLimit > 3) throw new Error('Detail limit must be 0-3.');
  const page = await browser.captureUrl(LISTING_URL);
  const listing = parseCapture(page, 'listing');
  const pagination = parseListingPage(page.html, 'https://bcbid.gov.bc.ca');
  const records = listing.document.records!.map(record => mergeOpportunityRecord(record, null));
  const document = { version: 1, kind: 'scrape', sourceUrl: page.url, capturedAt: page.capturedAt,
    scope: 'listing-page-and-details', limited: true, currentPage: pagination.currentPage, totalPages: pagination.totalPages,
    detailLimit, detailsCompleted: 0, records, complete: false };
  let artifactId = await save(document);
  for (const record of records.filter(record => record.detailUrl).slice(0, detailLimit)) {
    const detailPage = await browser.captureUrl(record.detailUrl!);
    const detail = parseCapture(detailPage, 'detail').document.record!;
    if (detail.processId !== record.processId) throw new Error('BC Bid returned a different opportunity than requested.');
    Object.assign(record, mergeOpportunityRecord(record, detail));
    document.detailsCompleted++;
    artifactId = await save(document);
  }
  document.complete = true;
  artifactId = await save(document);
  return { artifactId, listingCount: records.length, detailCount: document.detailsCompleted, pageCount: 1 + document.detailsCompleted,
    scope: document.scope, limited: true, totalPages: pagination.totalPages };
}
