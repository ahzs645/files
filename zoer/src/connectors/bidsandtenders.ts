import { BIDSANDTENDERS_PORTALS } from '../../dashboard/procurement/portals';
import { cleanAttachments } from './attachments';
import { ConnectorError, httpFailure, rethrowRunLimits } from './errors';
import { decodeEntities, htmlToText } from './html';
import type { ConnectorPortal, NetFetch, PortalResult, SourceConnector } from './types';

/**
 * bids&tenders (eSolutions Group) public listings. One portal = one buyer's subdomain.
 *
 * 1. GET the bids homepage: sets the anti-forgery cookie (kept host-side by Zoer's networkSession) and holds the
 *    search form's NodeId and `__RequestVerificationToken`.
 * 2. POST the form to `Tender/Search/<NodeId>` for open notices, 100 per page.
 * 3. GET each notice page (public, no session needed) for type, classification, categories, question deadline,
 *    a zoned published date and the names of its documents and addenda. A notice page that cannot be read leaves that
 *    record with listing fields only.
 *
 * Documents: the notice page lists every file (name, upload time) in its Documents and Addenda grids, but the download
 * (`Tender/DownloadBidDocument`) redirects anyone not signed in to the portal's Login page (checked 2026-11-13 on
 * islandhealthfdc and metrovancouver), so the links are saved with `access: 'login'` and never downloaded here.
 */
export { decodeEntities, htmlToText };
export const SOURCE_ID = 'bidsandtenders';
const PAGE_SIZE = 100;
const MAX_PAGES = 3;
/** Notice pages read per portal per run; the busiest BC portal listed 21 open notices on 2026-10-03. */
const MAX_DETAILS = 30;
const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** NodeId and anti-forgery form token from the bids homepage. */
export function readSearchForm(html: string): { nodeId: string; token: string } {
  const nodeTag = /<input\b[^>]*\bid="NodeId"[^>]*>/i.exec(html)?.[0];
  const nodeId = nodeTag && /\bvalue="([^"]*)"/i.exec(nodeTag)?.[1];
  const block = /<div\b[^>]*\bid="bidDetailAntiForgery"[^>]*>([\s\S]*?)<\/div>/i.exec(html)?.[1] ?? '';
  const tokenTag = /<input\b[^>]*\bname="__RequestVerificationToken"[^>]*>/i.exec(block)?.[0];
  const token = tokenTag && /\bvalue="([^"]*)"/i.exec(tokenTag)?.[1];
  if (!nodeId || !GUID.test(nodeId) || !token || !/^[A-Za-z0-9_\-+/=]{16,1000}$/.test(token)) {
    throw new ConnectorError('source_layout', 'The bids&tenders homepage no longer carries the search form (NodeId and form token). The portal layout changed; saved records are kept.');
  }
  return { nodeId, token };
}

export const searchUrl = (portal: ConnectorPortal, nodeId: string, start: number) =>
  `https://${portal.host}/Module/Tenders/en/Tender/Search/${nodeId}?status=Open&limit=${PAGE_SIZE}&start=${start}&dir=ASC&from=&to=&sort=DateClosing%20ASC,Id`;
export const detailUrl = (portal: ConnectorPortal, id: string) => `https://${portal.host}/Module/Tenders/en/Tender/Detail/${id}`;

export interface ListingRow { Id: string; Title: string; [key: string]: unknown }
/** One search response page. Anything but the documented shape is a schema failure, never "no notices". */
export function parseListingPage(text: string): { total: number; data: ListingRow[] } {
  let body: any;
  try { body = JSON.parse(text); } catch { throw new ConnectorError('source_schema', 'bids&tenders search did not return JSON. The portal may have changed or refused the session.'); }
  if (!body || typeof body !== 'object' || body.success !== true) throw new ConnectorError('source_schema', 'bids&tenders search did not report success.');
  if (!Number.isInteger(body.total) || body.total < 0 || !Array.isArray(body.data)) throw new ConnectorError('source_schema', 'bids&tenders search response is missing its total or data list.');
  for (const row of body.data) {
    if (!row || typeof row !== 'object' || typeof row.Id !== 'string' || !GUID.test(row.Id) || typeof row.Title !== 'string' || !row.Title.trim()) {
      throw new ConnectorError('source_schema', 'A bids&tenders notice has no valid Id or Title; the listing format changed.');
    }
  }
  return { total: body.total, data: body.data };
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
/**
 * Canadian zone labels bids&tenders prints after its times. Since BC stopped changing its clocks (UTC−07 all year from
 * March 2026) the BC portals print `(YST)`, Windows' "Yukon Standard Time" (UTC−07 all year, the zone Yukon has kept
 * since 2020); seen on all 25 portals on 2026-11-13. RDN's own site agrees: "November 27, 2026 at 3:00 PM" is
 * `2026-11-27T22:00:00Z`.
 */
const ZONE_OFFSETS: Record<string, string> = { PST: '-08:00', PDT: '-07:00', YST: '-07:00', MST: '-07:00', MDT: '-06:00', CST: '-06:00', CDT: '-05:00', EST: '-05:00', EDT: '-04:00', AST: '-04:00', ADT: '-03:00', NST: '-03:30', NDT: '-02:30' };
const pad = (n: number) => String(n).padStart(2, '0');

/** `Wed Oct 7, 2026 3:00 PM` / `Thu Oct 8, 2026 12:00:00 PM` as wall-clock parts; the weekday must match the date. */
function wallClock(display: unknown) {
  const m = /^(Sun|Mon|Tue|Wed|Thu|Fri|Sat) (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) (\d{1,2}), (\d{4}) (\d{1,2}):(\d{2})(?::(\d{2}))? (AM|PM)$/.exec(String(display ?? '').trim());
  if (!m) return undefined;
  const [year, month, day, hour, minute, second] = [Number(m[4]), MONTHS.indexOf(m[2]) + 1, Number(m[3]), Number(m[5]), Number(m[6]), Number(m[7] ?? 0)];
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day || DAYS[date.getUTCDay()] !== m[1] || hour < 1 || hour > 12 || minute > 59 || second > 59) return undefined;
  return { date: `${year}-${pad(month)}-${pad(day)}`, time: `${pad(hour % 12 + (m[8] === 'PM' ? 12 : 0))}:${pad(minute)}:${pad(second)}` };
}
/**
 * ISO instant from the displayed time and its zone label (` (PDT)`). The JSON `/Date(ms)/` values are not used:
 * they encode the wall-clock time as if it were Eastern time (Nanaimo 4318: 19:00Z for 3:00 PM PDT = 22:00Z).
 */
export function bidsAndTendersInstant(display: unknown, label: unknown): string | undefined {
  const zone = /^\s*\(\s*([A-Za-z]{2,5})\s*\)\s*$/.exec(String(label ?? ''))?.[1]?.toUpperCase();
  const parts = wallClock(display), offset = zone && ZONE_OFFSETS[zone];
  return parts && offset ? `${parts.date}T${parts.time}${offset}` : undefined;
}
/** Calendar date of a displayed time that has no zone label (the listing's published date). */
export const bidsAndTendersDate = (display: unknown) => wallClock(display)?.date;
/** `Fri Sep 11, 2026 2:00 PM (PDT)` → display + label, as printed on notice pages. */
export function splitZoned(text: string): { display: string; label: string } {
  const m = /^(.*?)\s*(\([A-Z]{2,5}\))$/.exec(text.trim());
  return m ? { display: m[1], label: ` ${m[2]}` } : { display: text.trim(), label: '' };
}

/** The notice number people quote: the notice page's Bid Number, else the title's leading number (`4318 - …`). */
export function noticeNumber(title: string, bidNumber?: string): string | undefined {
  if (bidNumber?.trim()) return bidNumber.trim();
  // Titles are "<Bid Number> - <Bid Name>"; a number may itself contain " - ", which only the notice page resolves.
  const head = /^(.{1,60}?)\s+-\s+\S/.exec(title.trim())?.[1]?.trim();
  return head && /\d/.test(head) ? head : undefined;
}

/** Notice page rows (`<th>Label:</th><td>…</td>`) shown on records; boilerplate and duplicated listing values are skipped. */
const SKIP_DETAIL = new Set(['Bid Name', 'Bid Status', 'Bid Number', 'Description', 'Bid Document Access', 'Bid Closing Date', 'Published Date']);
export interface NoticeDocument { id: string; name: string; created?: string; kind: 'document' | 'addendum' }
export interface NoticePage { bidNumber?: string; type?: string; classification?: string; published?: string; fields: Array<{ label: string; value: string }>; documents: NoticeDocument[] }

/** The JSON array starting at `start` (a `[`), found by matching brackets outside strings; undefined if unbalanced. */
function jsonArrayAt(text: string, start: number): unknown[] | undefined {
  let depth = 0, quoted = false;
  for (let i = start; i < text.length && i < start + 2_000_000; i++) {
    const char = text[i];
    if (quoted) { if (char === '\\') i++; else if (char === '"') quoted = false; continue; }
    if (char === '"') quoted = true;
    else if (char === '[') depth++;
    else if (char === ']' && --depth === 0) {
      try { const value = JSON.parse(text.slice(start, i + 1)); return Array.isArray(value) ? value : undefined; } catch { return undefined; }
    }
  }
  return undefined;
}
/**
 * Files listed in the notice page's Ext.NET grids: the `Documents` and `Addendums` stores carry their rows inline
 * (`proxyId:"Documents" … PagingMemoryProxy([{"Id":"<guid>","Created":"…","DisplayName":"…","Pages":0}], false)`).
 * A page without the grids (the notice has none, or the portal hides them) lists nothing.
 */
export function parseNoticeDocuments(html: string): NoticeDocument[] {
  const documents: NoticeDocument[] = [], seen = new Set<string>();
  for (const [store, kind] of [['Documents', 'document'], ['Addendums', 'addendum']] as const) {
    const at = html.indexOf(`proxyId:"${store}"`);
    if (at < 0) continue;
    const proxy = html.indexOf('PagingMemoryProxy(', at);
    // The rows belong to this store only if no other store starts before them.
    if (proxy < 0 || html.slice(at + 1, proxy).includes('proxyId:"')) continue;
    for (const row of jsonArrayAt(html, proxy + 'PagingMemoryProxy('.length) ?? []) {
      const id = typeof (row as any)?.Id === 'string' ? (row as any).Id.toLowerCase() : '', name = typeof (row as any)?.DisplayName === 'string' ? decodeEntities((row as any).DisplayName).trim() : '';
      if (!GUID.test(id) || !name || seen.has(id)) continue;
      seen.add(id);
      const created = typeof (row as any).Created === 'string' && /^\d{4}-\d{2}-\d{2}T/.test((row as any).Created) ? (row as any).Created : undefined;
      documents.push({ id, name: name.slice(0, 300), ...(created ? { created } : {}), kind });
    }
  }
  return documents;
}
/** The portal's download link for one file; it needs a signed-in supplier (anonymous requests go to Login). */
export const documentUrl = (portal: ConnectorPortal, tenderId: string, documentId: string) =>
  `https://${portal.host}/Module/Tenders/en/Tender/DownloadBidDocument?Id=${tenderId}&DocumentId=${documentId}&fa=`;
export function parseNoticePage(html: string): NoticePage | undefined {
  const rows = new Map<string, string>();
  for (const [, th, td] of html.matchAll(/<th\b[^>]*>([\s\S]*?)<\/th>\s*<td\b[^>]*>([\s\S]*?)<\/td>/gi)) {
    const label = htmlToText(th).replace(/:\s*$/, '').trim();
    if (!label || label.length > 80 || rows.has(label)) continue;
    const cell = td.replace(/<a\b[^>]*>\s*(?:Show|Hide)\b[^<]*\[[+-]\]\s*<\/a>/gi, '');
    const items = [...cell.matchAll(/<li\b[^>]*>([^<]*)/gi)].map(m => htmlToText(m[1])).filter(Boolean);
    const value = (items.length ? items.join('; ') : htmlToText(cell).replace(/\s*\n\s*/g, ' ')).slice(0, 2000);
    if (value) rows.set(label, value);
  }
  // A page without its Bid Number row is an error or login page, not a notice.
  if (!rows.has('Bid Number')) return undefined;
  return { bidNumber: rows.get('Bid Number'), type: rows.get('Bid Type'), classification: rows.get('Bid Classification'), published: rows.get('Published Date'),
    fields: [...rows].filter(([label]) => !SKIP_DETAIL.has(label)).map(([label, value]) => ({ label, value })), documents: parseNoticeDocuments(html) };
}

const count = (value: unknown) => Number.isInteger(value) && (value as number) >= 0 ? value as number : undefined;
const text = (value: unknown) => typeof value === 'string' ? value.trim() : '';

/** One catalog opportunity (CONNECTORS.md §3) from a listing row and, when read, its notice page. */
export function listingRecord(row: ListingRow, portal: ConnectorPortal, retrievedAt: string, page?: NoticePage) {
  const id = row.Id.toLowerCase(), key = `${SOURCE_ID}:${portal.id}:${id}`, title = row.Title.trim();
  const externalId = noticeNumber(title, page?.bidNumber) ?? id;
  const descriptionText = htmlToText(text(row.Description));
  const closingDisplay = text(row.DateClosingDisplay), zoneLabel = typeof row.TimeZoneLabel === 'string' ? row.TimeZoneLabel : '';
  const closingDate = closingDisplay ? `${closingDisplay}${zoneLabel.replace(/\s+$/, '')}` : '';
  const closingAt = bidsAndTendersInstant(closingDisplay, zoneLabel);
  // The listing's published time has no zone (and the closing label can be in the other DST period); only the
  // notice page prints one, so without it only the date is claimed.
  const zonedPublished = page?.published ? splitZoned(page.published) : undefined;
  const publishedAt = (zonedPublished && bidsAndTendersInstant(zonedPublished.display, zonedPublished.label)) ?? bidsAndTendersDate(row.DateAvailableDisplay);
  const plan = row.ShowPlanTakers === true ? count(row.PlanTakers) : undefined, documents = count(row.Documents), addenda = count(row.Addendums);
  const region = portal.place.municipality ?? portal.place.regionalDistrict ?? null;
  const fields: [string, string | number | undefined][] = [
    ['Source', `bids&tenders · ${portal.label}`], ['Notice number', externalId === id ? undefined : externalId],
    ['Status', text(row.Status)], ['Bid scope', text(row.Scope)], ['Closing date (source value)', closingDate],
    ['Published (source value)', page?.published ?? text(row.DateAvailableDisplay)],
    ['Plan takers', plan], ['Documents', documents], ['Addenda', addenda],
  ];
  const sourceFields = [...fields.filter(([, value]) => value !== undefined && value !== '').map(([label, value]) => ({ label, value: String(value) })), ...(page?.fields ?? [])];
  const category = page?.classification ?? '';
  // Addenda are files like the others; a name that does not say so is marked.
  const attachments = cleanAttachments((page?.documents ?? []).map(doc => ({
    name: doc.kind === 'addendum' && !/addend/i.test(doc.name) ? `Addendum: ${doc.name}` : doc.name, url: documentUrl(portal, id, doc.id), access: 'login' as const })));
  return {
    sourceId: SOURCE_ID, sourceKey: key, processId: key, opportunityId: key, portalId: portal.id,
    externalId, description: title, descriptionText, sourceDescriptionText: descriptionText,
    issuedBy: portal.label, status: text(row.Status) || 'Unknown', type: page?.type ?? '',
    closingDate, ...(closingAt ? { closingAt } : {}), ...(publishedAt ? { publishedAt } : {}),
    detailUrl: detailUrl(portal, id), sourceUrl: portal.url,
    region, place: { ...portal.place }, ...(category ? { category, sourceCategory: category } : {}),
    sourceFields, ...(documents !== undefined ? { documentsCount: documents } : {}), ...(addenda !== undefined ? { addendaCount: addenda } : {}),
    ...(page ? { noticePageRetrievedAt: retrievedAt } : {}),
    sourceRetrievedAt: retrievedAt, rawSourceData: row,
    searchText: [externalId, title, descriptionText, portal.label, text(row.Status), page?.type, region, category,
      page?.fields.find(field => field.label === 'Categories')?.value].filter(Boolean).join(' '),
    attachments, ...(attachments.length ? { attachmentsAccess: 'login' as const } : {}), addenda: [], detailFields: [], commodities: [],
  };
}


export async function collectBidsAndTendersPortal(fetch: NetFetch, portal: ConnectorPortal, context: { now: () => string }): Promise<PortalResult> {
  const retrievedAt = context.now(), warnings: string[] = [];
  const home = await fetch({ url: portal.url, accept: 'text/html' });
  if (home.status !== 200) throw httpFailure(`${portal.label} bids homepage`, home.status, home.retryAfterMs);
  const form = readSearchForm(home.text);
  const rows = new Map<string, ListingRow>();
  let total = -1;
  for (let page = 0; page < MAX_PAGES; page++) {
    const response = await fetch({ url: searchUrl(portal, form.nodeId, page * PAGE_SIZE), method: 'POST', form: { keywords: '', __RequestVerificationToken: form.token }, accept: 'application/json' });
    if (response.status >= 300 && response.status < 400) {
      throw new ConnectorError('source_session', `${portal.label} refused the search (HTTP ${response.status}): the session cookie from its homepage was not sent back. This needs Zoer's networkSession support.`);
    }
    if (response.status !== 200) throw httpFailure(`${portal.label} search`, response.status, response.retryAfterMs);
    const parsed = parseListingPage(response.text);
    if (total < 0) total = parsed.total;
    else if (parsed.total !== total) warnings.push(`Open-notice total changed from ${total} to ${parsed.total} while paging.`);
    const before = rows.size;
    for (const row of parsed.data) rows.set(row.Id.toLowerCase(), row);
    if (rows.size >= parsed.total || rows.size === before) break;
  }
  if (rows.size < total) warnings.push(`${portal.label} reports ${total} open notices; ${rows.size} were listed (limit ${MAX_PAGES * PAGE_SIZE}).`);
  const pages = new Map<string, NoticePage>(), failures: string[] = [];
  for (const id of [...rows.keys()].slice(0, MAX_DETAILS)) {
    try {
      const response = await fetch({ url: detailUrl(portal, id), accept: 'text/html' });
      const page = response.status === 200 ? parseNoticePage(response.text) : undefined;
      if (page) pages.set(id, page); else failures.push(response.status === 200 ? 'unrecognized page' : `HTTP ${response.status}`);
    } catch (error) { rethrowRunLimits(error); failures.push((error as Error)?.message?.slice(0, 120) || 'request failed'); }
  }
  if (failures.length) warnings.push(`Notice pages could not be read for ${failures.length} notice(s) (${[...new Set(failures)].slice(0, 3).join('; ')}); those records carry listing fields only.`);
  if (rows.size > MAX_DETAILS) warnings.push(`Only the first ${MAX_DETAILS} of ${rows.size} notice pages were read this run; the rest carry listing fields only.`);
  return { portalId: portal.id, records: [...rows].map(([id, row]) => listingRecord(row, portal, retrievedAt, pages.get(id))), totalReported: total, warnings };
}

export const bidsAndTenders: SourceConnector = {
  id: SOURCE_ID,
  label: 'bids&tenders (BC)',
  jurisdiction: 'British Columbia',
  coverage: `Open notices listed by ${BIDSANDTENDERS_PORTALS.length} BC public buyers on bids&tenders, with each notice's public page (type, classification, categories, question deadline, and the names and links of its documents and addenda). The files themselves need a free supplier sign-in on the portal and are not downloaded. Closed and awarded notices and plan-taker lists are not collected. A notice missing from a later listing is kept; absence is not proof of closure.`,
  portals: BIDSANDTENDERS_PORTALS,
  requestsPerPortal: 1 + MAX_PAGES + MAX_DETAILS,
  needsSession: true,
  collectPortal: collectBidsAndTendersPortal,
};
