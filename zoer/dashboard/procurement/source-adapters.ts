export const CANADABUYS_DATASET_URL = 'https://canadabuys.canada.ca/opendata/pub/openTenderNotice-ouvertAvisAppelOffres.csv';
export const CANADABUYS_DOCUMENTATION_URL = 'https://donnees-data.tpsgc-pwgsc.gc.ca/ba2/ac-cb/soutien-support-eng.html';
export const CANADABUYS_CATALOG_URL = 'https://open.canada.ca/data/en/dataset/6abd20d4-7a1c-4b38-baa2-9525d0bb2fd2';
export const COLLECTION_KEY = 'procurement:source:canadabuys:collection';

export interface ProcurementSourceAdapter {
  id: string; label: string;
  capabilities: Record<'listing' | 'detail' | 'attachments' | 'awards' | 'auth', { status: 'available' | 'partial' | 'unavailable'; method: string }>;
  coverage: string; documentation?: string;
}
export const PROCUREMENT_SOURCE_ADAPTERS: ProcurementSourceAdapter[] = [
  { id: 'bc-bid', label: 'BC Bid', coverage: 'Public pages captured by configured browser; saved records are not proof of portal completeness.', capabilities: {
    listing: { status: 'available', method: 'Existing browser listing/full scrape actions' },
    detail: { status: 'available', method: 'Existing browser detail capture' },
    attachments: { status: 'partial', method: 'Existing BC Bid attachment download; availability depends on published links and browser access' },
    awards: { status: 'available', method: 'Existing historical/recent award scrape actions' },
    auth: { status: 'partial', method: 'User-managed browser checks/session; no automatic portal login' },
  } },
  { id: 'canadabuys', label: 'CanadaBuys', documentation: CANADABUYS_DOCUMENTATION_URL,
    coverage: 'Federal open-tender dataset snapshot only. Daily publisher refresh; absence is not proof of closure. Saved old records are retained.', capabilities: {
      listing: { status: 'available', method: 'procurement.collect: official open-tenders CSV, bounded and checksummed; manual CSV fallback' },
      detail: { status: 'partial', method: 'Published bilingual CSV fields; no notice-page scraping' },
      attachments: { status: 'unavailable', method: 'Original attachment fields retained as data; files are not downloaded by this connector' },
      awards: { status: 'unavailable', method: 'Official award dataset exists but is not connected' },
      auth: { status: 'unavailable', method: 'Public CSV requires no credentials; HTTP 403 is reported without bypass' },
    } },
];

/** The documented fixed UTC−05:00 applies only to verified downloaded CanadaBuys source files. */
export function canadaBuysClosingAt(raw: string): string | undefined {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(raw)) return undefined;
  const local = new Date(`${raw}Z`);
  if (!Number.isFinite(local.getTime()) || local.toISOString().slice(0, 19) !== raw) return undefined;
  return `${raw}-05:00`;
}
