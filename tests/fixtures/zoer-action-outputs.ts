/**
 * Real outputs of the worker actions that declare an outputSchema, produced by the same functions the worker
 * calls (with fake browser/catalog hosts). The host enforces outputSchema after a run finishes, so an output
 * field missing from the manifest fails a run that did all its work (scrape.full's `reconciliation`, 2026-11).
 */
import { readFileSync } from 'node:fs';
import { scrapeFull } from '../../zoer/src/full-scrape';
import { scrapeSample, LISTING_URL } from '../../zoer/src/scrape';
import { scrapeTargeted, type CaptureOptions } from '../../zoer/src/targeted-scrape';
import { captureMissingDetails } from '../../zoer/src/missing-details';
import { parseCapture } from '../../zoer/src/capture';

const fixture = (name: string) => readFileSync(new URL(`./${name}`, import.meta.url), 'utf8');
const listing = (number: number, last: number, prefix = '') => ({ url: LISTING_URL, title: 'BC Bid', capturedAt: '2026-11-13T18:00:00Z',
  html: prefix + fixture('listing/page1.html').replace(/\b(\d{6})\b/g, value => String(Number(value) + number * 100)),
  pagination: { currentPage: number, hasNext: number < last, visiblePages: [1, 2] } });
const detail = (url: string) => ({ url, title: 'BC Bid', capturedAt: '2026-11-13T18:01:00Z',
  tabCoverage: { mode: 'discovered-public-tabs', available: ['Overview'], visited: ['Overview'], failures: [], complete: true },
  html: fixture('detail/with-addenda.html').replace(/226320/g, url.match(/(\d+)$/)![1]!) });
const save = async () => 'catalog:run';
const tags = (pairs: [string, string[]][]) => `<div class="iv-filter-summary">${pairs.map(([label, values]) =>
  `<span class="tag-label">${label} :</span><ul class="tag-summary">${values.map(value => `<li class="tag-value"><span class="tag-text">${value}</span></li>`).join('')}</ul>`).join('')}</div>`;
const detailUrl = (id: string) => 'https://bcbid.gov.bc.ca/page.aspx/en/bpm/process_manage_extranet/' + id;
const opportunity = (id: string, data: Record<string, unknown> = {}) => ({ id: 'opportunity:' + id, kind: 'opportunity',
  data: { processId: id, status: 'Open', closingDate: '2099-01-01', detailUrl: detailUrl(id), detailFields: [], ...data } });

export async function workerActionOutputs(): Promise<{ actionId: string; label: string; output: unknown }[]> {
  const outputs: { actionId: string; label: string; output: unknown }[] = [];
  const add = (actionId: string, label: string, output: unknown) => outputs.push({ actionId, label, output });

  // Exact displayed total → reconciliation "complete"; the shape the host rejected on every finished crawl.
  const full = await scrapeFull({ captureUrl: async (url, number) => url === LISTING_URL
    ? (({ html, ...page }) => ({ ...page, html: html + (number === 1 ? '<div class="record-count">4 Record(s)</div>' : '') }))(listing(number!, 2)) : detail(url) }, save);
  add('scrape.full', 'complete crawl', full);

  add('scrape.sample', 'one page and details', await scrapeSample({ captureUrl: async url => url === LISTING_URL ? listing(1, 2) : detail(url) }, save, 2));

  const filters = tags([['Status', ['Open']], ['Organization', ['Ministry of Health']]]);
  add('scrape.targeted', 'buyer search', await scrapeTargeted({ capture: async (options: CaptureOptions) => options.url !== LISTING_URL ? detail(options.url)
    : options.pickFields?.length || options.continuePage ? listing(options.continuePage ?? 1, 2, filters) : listing(1, 1, tags([['Status', ['Open']]])) },
  { save, existing: async () => new Map(), receipt: async () => undefined }, { organization: 'Ministry of Health', maxPages: 2 }, { runId: 'run-schema' }));

  const rows = [opportunity('500101'), opportunity('500102', { closingDate: '2099-02-01' }), opportunity('500103', { status: 'Closed' })];
  const host = { read: async (ids: string[]) => ({ records: rows.filter(row => ids.includes(row.id)) }), capture: async (url: string) => detail(url), save,
    list: async (after: string) => ({ records: rows.filter(row => row.id > after) }) };
  add('scrape.details', 'selected notices', await captureMissingDetails({ recordIds: ['opportunity:500101'] }, host));
  add('scrape.details', 'missing details', await captureMissingDetails({ missing: { limit: 50 } }, host));
  add('scrape.details', 'nothing missing', await captureMissingDetails({ missing: { limit: 5 } }, { ...host, list: async () => ({ records: [] }) }));

  // listing.capture / detail.capture: the worker's output object around parseCapture.
  for (const [actionId, page, kind] of [['listing.capture', listing(1, 1), 'listing'], ['detail.capture', detail(detailUrl('226320')), 'detail']] as const) {
    const captured = parseCapture(page, kind);
    add(actionId, 'current page', { rows: captured.rows, artifactId: 'catalog:run', sourceUrl: page.url, capturedAt: page.capturedAt, scope: 'current-page' });
  }
  add('awards.import', 'batch', { artifactId: 'catalog:run', count: 3 });
  return outputs;
}
