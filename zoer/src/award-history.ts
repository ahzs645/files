import * as cheerio from 'cheerio';
import { createHash } from 'node:crypto';
import { parseContractAwardsJson, buildContractAwardImportKey } from '../../packages/shared/src/contractAwards';
import type { PageCapture } from './capture';
export const AWARDS_URL = 'https://bcbid.gov.bc.ca/page.aspx/en/ctr/contract_browse_public';
export const AWARD_SEARCH = [{ selector: '#body_x_txtCtrEffectiveDate', value: '1900-01-01' }];
export interface AwardCheckpoint { page: number; count: number; fingerprint: string; complete: boolean }
export function parseAwardPage(page: PageCapture, options: { allowEmpty?: boolean } = {}) {
  if (new URL(page.url).origin !== new URL(AWARDS_URL).origin || !new URL(page.url).pathname.endsWith('/ctr/contract_browse_public')) throw new Error('Award search is unavailable. Complete any browser check manually.');
  const $ = cheerio.load(page.html), grid = $('#body_x_grid_grd');
  const empty = $('#body_x_grid_upgrid .pager.empty [aria-label="0 Record(s)"]').length === 1 && !$('#body_x_grid_upgrid .iv-grid-view tbody tr').length;
  if (options.allowEmpty && empty && page.pagination?.currentPage === 1 && !page.pagination.hasNext) return { records: [], fingerprint: createHash('sha256').update('').digest('hex') };
  const headers = grid.find('thead th').map((_, el) => $(el).text().replace(/\s+/g, ' ').trim()).get();
  for (const required of ['Opportunity Description', 'Successful Supplier', 'Award Date', 'Contract Value']) if (!headers.includes(required)) throw new Error(`Award grid is not loaded or changed: missing ${required}.`);
  const rows = grid.find('tbody tr').toArray().map(el => $(el).children('td').map((_, td) => $(td).text().replace(/\s+/g, ' ').trim()).get()).filter(row => row.length === headers.length);
  const records = parseContractAwardsJson(JSON.stringify({ headers, rows }));
  if (!records.length && !(options.allowEmpty && /\b(?:No records? (?:found|available)|No results found)\b/i.test(grid.find('tbody').text()) && !page.pagination?.hasNext && page.pagination?.currentPage === 1)) throw new Error('The award search returned no readable records. History has not been marked complete.');
  if (!page.pagination || !Number.isInteger(page.pagination.currentPage)) throw new Error('Award pagination is unavailable.');
  return { records, fingerprint: createHash('sha256').update(records.map(buildContractAwardImportKey).join('\n')).digest('hex') };
}
export async function scrapeAwardHistory(capture: (options: any) => Promise<PageCapture>, save: (doc: any) => Promise<string>, resume?: AwardCheckpoint, maxPages = 3500) {
  if (resume && (!Number.isInteger(resume.page) || resume.page < 1 || resume.page >= 10000 || !Number.isInteger(resume.count) || resume.count < 1 || !/^[a-f0-9]{64}$/.test(resume.fingerprint) || resume.complete !== false)) throw new Error('Invalid history checkpoint.');
  let checkpoint: AwardCheckpoint = resume ?? { page: 0, count: 0, fingerprint: '', complete: false };
  let artifactId = '';
  // Only the host's explicit persisted-state errors permit restoring the public
  // search. Verification, cancellation and budget errors must reach the operator.
  const stateChanged = (error: unknown) => error instanceof Error &&
    /^(?:Error: )?The saved (?:search|pager) changed\. Start the history search again\.$/.test(error.message);
  let restored = false;
  const restoreSavedPage = async (observed?: PageCapture) => {
    if (!resume || restored) throw new Error('The saved award page changed. Start a fresh history search; saved awards are retained.');
    restored = true;
    const reuse = observed && observed.pagination!.currentPage < resume.page;
    let page = reuse ? observed : await capture({ pageNumber: Math.min(20, resume.page), applySearch: true, searchFields: AWARD_SEARCH });
    parseAwardPage(page);
    if (!reuse && page.pagination!.currentPage !== Math.min(20, resume.page)) throw new Error('The saved award page changed. Start a fresh history search; saved awards are retained.');
    while (page.pagination!.currentPage < resume.page) {
      const previous = page.pagination!.currentPage;
      const target = Math.min(resume.page, previous + 20);
      page = await capture({ pageNumber: target, searchFields: AWARD_SEARCH });
      parseAwardPage(page); // Verification and malformed rows must stop restoration.
      if (page.pagination!.currentPage !== target) throw new Error('The saved award page changed. Start a fresh history search; saved awards are retained.');
    }
    const parsed = parseAwardPage(page);
    if (page.pagination?.currentPage !== resume.page || parsed.fingerprint !== resume.fingerprint) throw new Error('The saved award page changed. Start a fresh history search; saved awards are retained.');
  };
  if (resume) {
    let page: PageCapture | undefined;
    try { page = await capture({ searchFields: AWARD_SEARCH }); }
    catch (error) { if (!stateChanged(error)) throw error; await restoreSavedPage(); }
    if (page) {
      // Validate before restoring: a browser-check response is not a pager reset.
      const parsed = parseAwardPage(page);
      if (page.pagination?.currentPage !== resume.page && page.pagination?.currentPage !== resume.page + 1) await restoreSavedPage(page);
      else if (page.pagination?.currentPage === resume.page && parsed.fingerprint !== resume.fingerprint) throw new Error('The saved award page changed. Start a fresh history search; saved awards are retained.');
    }
  }
  for (let captured = 0; captured < maxPages; captured++) {
    const next = checkpoint.page + 1;
    const options = { ...(next === 1 ? { pageNumber: 1, applySearch: true } : { continuePage: next }), searchFields: AWARD_SEARCH };
    let page: PageCapture;
    try { page = await capture(options); }
    catch (error) {
      if (!resume || restored || checkpoint.page !== resume.page || !stateChanged(error)) throw error;
      await restoreSavedPage();
      page = await capture(options);
    }
    let parsed = parseAwardPage(page);
    // A pager can update before its rows. Re-read only; never click Next again
    // or reset the search while confirming this page. Any capture error escapes.
    for (let attempt = 0; attempt < 2 && page.pagination!.currentPage === next && parsed.fingerprint === checkpoint.fingerprint; attempt++) {
      await new Promise(resolve => setTimeout(resolve, 750));
      page = await capture({ searchFields: AWARD_SEARCH });
      parsed = parseAwardPage(page);
    }
    if (page.pagination!.currentPage !== next || parsed.fingerprint === checkpoint.fingerprint) throw new Error('Award pagination did not advance. Saved history can be resumed.');
    checkpoint = { page: next, count: checkpoint.count + parsed.records.length, fingerprint: parsed.fingerprint, complete: !page.pagination!.hasNext };
    artifactId = await save({ version: 1, kind: 'awards', scope: 'public-award-history', records: parsed.records, checkpoint, fileName: 'BC Bid public award history', sourceUrl: AWARDS_URL, capturedAt: page.capturedAt });
    if (checkpoint.complete) return { artifactId, count: checkpoint.count, pages: checkpoint.page, complete: true };
    if (captured % 25 === 0) (globalThis as any).Bun?.gc(false);
  }
  throw new Error('History reached this run’s page limit. Resume to continue; saved records are retained.');
}
