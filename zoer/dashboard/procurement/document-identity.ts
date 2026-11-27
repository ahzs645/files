/**
 * Which saved `documents` row stands for an attachment link: the downloader's own rule, ported verbatim from Zoer's
 * `backend/src/plugins/plugin-document-match.ts` (`documentFileKey` / `matchDocuments`) so the plugin's counts agree
 * with what "Keep documents current" acts on and with Documents › Download (`catalog.documentQueue`). Read-time only.
 * Within one record, a link and a row are the same file when
 *   - BC Bid: they name the same file GUID (`.../fil/download_public/<guid>`, or the plugin's `attachment.key` =
 *     "bcbid:file:<guid>"), compared lowercased. BC Bid GUIDs are stable while the order of their query parameters
 *     changes between captures;
 *   - any other source: the URLs are equal after sorting their query parameters and dropping the fragment.
 * Never by file name (different BC Bid files share names) and never across records (one GUID can appear on several
 * notices). Keep this file in step with the host's; `review-workspace/document-identity.test.ts` runs both against the same cases.
 */
export interface DocumentRow { url: string; status: string; error?: string | null; updated_at?: string | null }
export interface AttachmentLink { url: string; key?: unknown }
export interface DocumentMatch<T extends DocumentRow = DocumentRow> { document: T; by: 'url' | 'file-key' }

const BC_BID_FILE = /^\/(?:bare|popup)\.aspx\/[a-z-]+\/fil\/download_public\/([0-9a-f-]+)$/i;
const BC_BID_KEY = /^bcbid:file:([0-9a-f-]+)$/i;

/** The file identity of an attachment URL (or its plugin key): a BC Bid file GUID, else the URL with sorted query parameters. */
export function documentFileKey(value: string, key?: unknown): string {
  const declared = typeof key === 'string' ? BC_BID_KEY.exec(key.trim())?.[1] : undefined;
  if (declared) return `bcbid:file:${declared.toLowerCase()}`;
  try {
    const url = new URL(value);
    const guid = url.hostname.toLowerCase() === 'bcbid.gov.bc.ca' ? BC_BID_FILE.exec(url.pathname)?.[1] : undefined;
    if (guid) return `bcbid:file:${guid.toLowerCase()}`;
    url.hash = '';
    const params = [...url.searchParams].sort(([a, x], [b, y]) => a < b ? -1 : a > b ? 1 : x < y ? -1 : x > y ? 1 : 0);
    url.search = params.length ? new URLSearchParams(params).toString() : '';
    return url.href;
  } catch { return value; }
}
const newestFirst = (a: DocumentRow, b: DocumentRow) => String(b.updated_at ?? '').localeCompare(String(a.updated_at ?? ''));

/**
 * For each link URL of ONE record, given that record's rows: its downloaded row when one is the same file, else its
 * attempted (failed) row, if any.
 */
export function matchDocuments<T extends DocumentRow>(links: AttachmentLink[], documents: T[]): Map<string, DocumentMatch<T>> {
  const matches = new Map<string, DocumentMatch<T>>();
  const exact = new Map(documents.map(document => [document.url, document]));
  const byKey = new Map<string, T[]>();
  for (const document of [...documents].sort(newestFirst)) {
    const key = documentFileKey(document.url);
    byKey.set(key, [...(byKey.get(key) ?? []), document]);
  }
  for (const link of links) {
    const same = exact.get(link.url);
    if (same?.status === 'downloaded') { matches.set(link.url, { document: same, by: 'url' }); continue; }
    const equivalent = byKey.get(documentFileKey(link.url, link.key)) ?? [];
    const saved = equivalent.find(document => document.status === 'downloaded');
    if (saved) matches.set(link.url, { document: saved, by: 'file-key' });
    else if (same) matches.set(link.url, { document: same, by: 'url' });
    else if (equivalent[0]) matches.set(link.url, { document: equivalent[0], by: 'file-key' });
  }
  return matches;
}

/** One notice's links counted once per file (the downloader's `allowed` list), keeping the first spelling seen. */
export function distinctFiles<T extends AttachmentLink>(links: T[]): T[] {
  return [...new Map(links.map(link => [documentFileKey(link.url, link.key), link])).values()];
}

/** The host's `requiresBrowserVerification` (research-tasks.ts): the saved error says a browser check stopped it. */
export const requiresBrowserVerification = (error: unknown) => /document download did not start|requires a browser check|complete (?:it|the (?:browser check|verification)) manually|wrong captcha answer|manual browser verification required/i.test(String(error ?? ''));
