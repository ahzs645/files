import { parseDeadline } from './deadline';
import type { PublisherReceipt } from './publisher-receipts';

export type PublisherLink = {
  url: string;
  label: 'bids&tenders' | 'Bonfire';
  kind: 'notice' | 'portal';
  recordId?: string;
};

type NoticeFields = {
  sourceDescriptionText?: unknown;
  descriptionText?: unknown;
  opportunityDescription?: unknown;
  description?: unknown;
  sourcePublisherUrls?: unknown;
  sourceTabs?: Array<{ text?: unknown }>;
  attachments?: Array<{ url?: unknown }>;
  addenda?: Array<{ link?: unknown }>;
  detailFields?: Array<{ label?: string; value?: unknown }>;
};

const GUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const BID_DETAIL = new RegExp(`^/module/tenders/(en|fr)/tender/detail/(${GUID})/?$`, 'i');
const BID_HOME = /^\/(?:module\/tenders\/(?:en|fr)(?:\/home\/bidshomepage)?\/?)?$/i;
const BONFIRE_DETAIL = /^\/(?:portal\/)?(?:opportunities\/(\d{1,15})|projects?\/(\d{1,15})(?:\/details)?)\/?$/i;
const BONFIRE_HOME = /^\/(?:(?:portal|opportunities|projects)\/?)?$/i;
// Some older BC Bid tab captures join a link directly to the next labelled text block.
const CAPTURE_LABEL = '(?:Submissions?|Delivery|Summary|SUMMARY|Note|Please|Click|Need|Reference|Ref|Direct|The|In|It)(?=$|[:.]|[A-Z])';
const BID_CAPTURE_JOIN = new RegExp(`^(/Module/Tenders/(?:en|fr)(?:/Tender/Detail/${GUID}|/Home/BidsHomepage)?/?|/)(?:\\.)?${CAPTURE_LABEL}`);
const BONFIRE_CAPTURE_JOIN = new RegExp(`^(\/(?:portal\/)?(?:opportunities(?:/\\d{1,15})?|projects?(?:/\\d{1,15}(?:/details)?)?)/?|/portal/?)(?:\\.)?${CAPTURE_LABEL}`);

export function publisherLink(raw: string): PublisherLink | undefined {
  let url: URL;
  try { url = new URL(raw.replace(/(?:%E2%80%A6|[.…,;:!?\])}])+$/i, '')); }
  catch { return undefined; }
  if (url.protocol !== 'https:' || url.username || url.password || url.port) return undefined;
  const bids = /^([a-z0-9-]+)\.bidsandtenders\.(ca|net)$/.exec(url.hostname);
  if (bids && bids[1] !== 'www') {
    const path = BID_CAPTURE_JOIN.exec(url.pathname)?.[1] ?? url.pathname;
    const detail = BID_DETAIL.exec(path);
    if (detail) {
      const id = detail[2].toLowerCase();
      return { url: `${url.origin}/Module/Tenders/${detail[1].toLowerCase()}/Tender/Detail/${id}`, label: 'bids&tenders', kind: 'notice', recordId: `opportunity:bidsandtenders:${bids[1]}${bids[2] === 'net' ? '.net' : ''}:${id}` };
    }
    if (BID_HOME.test(path)) return { url: `${url.origin}/Module/Tenders/en/Home/BidsHomepage`, label: 'bids&tenders', kind: 'portal' };
  }
  const bonfire = /^[a-z0-9-]+\.bonfirehub\.(?:ca|com)$/.test(url.hostname);
  if (bonfire) {
    const path = BONFIRE_CAPTURE_JOIN.exec(url.pathname)?.[1] ?? url.pathname;
    if (BONFIRE_DETAIL.test(path)) return { url: `${url.origin}${path.replace(/\/$/, '')}`, label: 'Bonfire', kind: 'notice' };
    if (BONFIRE_HOME.test(path)) return { url: `${url.origin}/portal/?tab=openOpportunities`, label: 'Bonfire', kind: 'portal' };
  }
  return undefined;
}

/** Extract only recognizable publisher notices and listings from existing BC Bid captures. */
export function publisherLinks(notice: NoticeFields): PublisherLink[] {
  const fields: unknown[] = [notice.sourceDescriptionText, notice.descriptionText, notice.opportunityDescription, notice.description];
  if (Array.isArray(notice.sourcePublisherUrls)) fields.push(...notice.sourcePublisherUrls.slice(0, 12));
  if (Array.isArray(notice.detailFields)) for (const field of notice.detailFields) fields.push(field?.value);
  if (Array.isArray(notice.sourceTabs)) for (const tab of notice.sourceTabs) fields.push(tab?.text);
  if (Array.isArray(notice.attachments)) for (const attachment of notice.attachments) fields.push(attachment?.url);
  if (Array.isArray(notice.addenda)) for (const addendum of notice.addenda) fields.push(addendum?.link);
  const found = new Map<string, PublisherLink>();
  for (const field of fields) {
    if (typeof field !== 'string') continue;
    // Split concatenated older captures before parsing. A bare hostname is used only with a recognizable project path.
    const absolute = [...field.matchAll(/https:\/\/[^\s<>"'“”’`]+/gi)].flatMap(match => match[0].split(/(?<=.)(?=https:\/\/)/gi));
    const bare = [...field.matchAll(/(?<![\w@./:-])([a-z0-9-]+\.(?:bidsandtenders\.(?:ca|net)|bonfirehub\.(?:ca|com))\/[^\s<>"'“”’`]+)/gi)]
      .map(match => `https://${match[0]}`);
    for (const token of [...absolute, ...bare]) {
      const link = publisherLink(token);
      if (link && (absolute.includes(token) || link.kind === 'notice')) found.set(link.recordId ?? link.url, found.get(link.recordId ?? link.url) ?? link);
    }
  }
  const noticeOrigins = new Set([...found.values()].filter(link => link.kind === 'notice').map(link => new URL(link.url).origin));
  return [...found.values()].filter(link => link.kind === 'notice' || !noticeOrigins.has(new URL(link.url).origin)).slice(0, 12);
}

/** Source links take precedence over a match inferred from the catalog. */
export function resolvedPublisherLinks(notice: NoticeFields, receipt?: PublisherReceipt | null): PublisherLink[] {
  const links = publisherLinks(notice);
  const savedMatch = receipt?.match && publisherLink(receipt.match.url);
  if (savedMatch?.kind !== 'notice' || links.some(link => link.kind === 'notice')) return links;
  return [savedMatch, ...links.filter(link => new URL(link.url).origin !== new URL(savedMatch.url).origin)];
}

/** Compare exact times when both sources publish offsets, otherwise compare the stated dates. */
export function publisherDeadlinesDiffer(bcBid: unknown, publisher: unknown): boolean {
  const a = parseDeadline(bcBid), b = parseDeadline(publisher);
  if (!a || !b) return false;
  return a.precision === 'instant' && b.precision === 'instant' ? a.time !== b.time : a.date !== b.date;
}
