import { createHash } from 'node:crypto';
import { normalizeBuyer, titleTokens, tokenSimilarity } from '../dashboard/procurement/duplicates';
import { publisherLink, publisherLinks, type PublisherLink } from '../dashboard/procurement/publisher-links';
import { PUBLISHER_RECEIPT_PREFIX, type PublisherMatch, type PublisherOutcome, type PublisherReceipt } from '../dashboard/procurement/publisher-receipts';
import type { Host } from './procurement-collection';

type NoticeData = Parameters<typeof publisherLinks>[0] & {
  sourceId?: string;
  issuedBy?: string;
  processId?: string;
  opportunityId?: string;
  externalId?: string;
  detailUrl?: string;
  sourceUrl?: string;
};
export type PublisherRow = { id: string; kind: string; title: string; data: NoticeData };
type Identity = { buyer: string; numbers: string[]; round: string; title: string[] };
type Candidate = Identity & { id: string; url: string };
type Index = Record<string, Candidate[]>;
type MatchResult = { match?: PublisherMatch; review?: PublisherOutcome };
const INDEX_KEY = 'procurement:publisher-index';
const SHARDS = 12;
const BATCH_SIZE = 160;
const BUYER_ALIASES: Record<string, string> = {
  'interior health authority': 'interior health',
  'fraser health authority': 'fraser health',
  'vancouver island health authority': 'island health',
  'regional district of okanagan similkameen': 'okanagan similkameen regional district',
};
const RFx = '(?:NRFP|RFPQ|RFSQ|RFSOQ|RFEOI|RFP|RFQ|RFIQ|RFI|ITT|ITB|ITQ|NOI|RFT|EOI|RFx|TENDER|T)';
const TYPE = new RegExp(`^(?:request for (?:proposals?|quotations?)|invitation to tender|${RFx})[\\s:#._-]+|[\\s:#._-]+${RFx}$`, 'gi');
const HEADING = /^(?:[A-Z]{1,8}[-_]?)?\d[\dA-Z]*(?:[-_.][A-Z0-9]+){0,4}(?=\s|$)/i;
const ROUND = /\b(Intake|Lot|Phase)(?:s|\(s\))?\s*[-:#(]?\s*(\d{1,2}(?:(?:\s*(?:[,/&+-]|and)\s*|\s+)\d{1,2})*)\b/gi;

export function publisherIdentity(row: PublisherRow): Identity {
  const { data, title } = row;
  const buyer = normalizeBuyer(data.issuedBy);
  const scope = /\b(city|district|township|regional district)\s+of\b/i.exec(data.issuedBy ?? '')?.[1]?.toLowerCase();
  const fields = Array.isArray(data.detailFields) ? data.detailFields.filter(field =>
    /^(?:opportunity id|bid number|solicitation number|tender number|reference number)$/i.test(field?.label?.trim() ?? '')).map(field => field.value) : [];
  const references = [data.externalId, data.opportunityId, ...fields];
  const numbers = new Set<string>();
  const rounds = new Map<string, Set<string>>();
  for (const value of [...references, title ?? '']) {
    if (typeof value !== 'string') continue;
    for (const stage of value.matchAll(ROUND)) {
      const key = stage[1].toLowerCase();
      const values = rounds.get(key) ?? new Set<string>();
      for (const number of stage[2].match(/\d+/g) ?? []) values.add(String(Number(number)));
      rounds.set(key, values);
    }
  }
  const heading = HEADING.exec((title ?? '').replace(TYPE, ''))?.[0];
  for (const value of [...references, heading]) {
    if (typeof value !== 'string') continue;
    const base = value.normalize('NFKC').replace(ROUND, '').replace(TYPE, '').trim();
    if (base === data.processId || base === row.id.replace(/^opportunity:/, '') ||
      /^(?:19|20)\d{2}$/.test(base) || !/^(?=.*\d)[A-Z0-9][A-Z0-9._ -]{2,47}$/i.test(base)) continue;
    numbers.add(base.replace(/[^a-z0-9]/gi, '').toUpperCase());
  }
  // The type of local government separates, for example, the City and District of North Vancouver.
  const buyerKey = BUYER_ALIASES[buyer] ?? (scope && scope !== 'regional district' ? `${scope}:${buyer}` : buyer);
  const round = [...rounds].sort(([a], [b]) => a.localeCompare(b)).map(([key, values]) => `${key}:${[...values].sort().join(',')}`).join(';');
  return { buyer: buyerKey, numbers: [...numbers], round, title: titleTokens(title).slice(0, 70) };
}

function candidates(row: PublisherRow, verifiedUrl?: string): Candidate[] {
  const { data } = row;
  const identity = publisherIdentity(row);
  if (!identity.buyer || !identity.numbers.length) return [];
  const links = publisherLinks(data);
  if (data.sourceId && data.sourceId !== 'bc-bid') {
    const own = publisherLink(data.detailUrl || data.sourceUrl || '');
    if (own?.kind === 'notice') links.unshift(own);
  }
  const verified = verifiedUrl && publisherLink(verifiedUrl);
  if (!links.some(link => link.kind === 'notice') && verified && verified.kind === 'notice') links.push(verified);
  return links.filter(link => link.kind === 'notice').map(link => ({ ...identity, id: row.id, url: link.url }));
}

function bucket(buyer: string) {
  return createHash('sha256').update(buyer).digest()[0] % SHARDS;
}

/** Persist only a compact lookup in the existing catalog, outside the 64 KiB workflow checkpoint. */
export async function buildPublisherIndex(host: Host, runId: string) {
  const groups: Index[] = Array.from({ length: SHARDS }, () => Object.create(null));
  const verified = await verifiedMatches(host);
  let after = '';
  for (;;) {
    const page = await host('catalog.read', { kind: 'opportunity', after, limit: BATCH_SIZE });
    if (!page.primary) throw Error('Initialize the existing Procurement catalog before reconciling publishers.');
    const rows = page.records as PublisherRow[];
    if (!rows.length) break;
    for (const row of rows) for (const item of candidates(row, verified.get(row.id))) {
      const shard = groups[bucket(item.buyer)];
      (shard[item.buyer] ??= []).push(item);
    }
    const next = rows.at(-1)!.id;
    if (after === next) throw Error('Publisher catalog pagination stalled.');
    after = next;
  }
  const entries = groups.map((items, i) => ({ key: `${INDEX_KEY}:${i}`, value: { runId, items } }));
  if (entries.some(entry => JSON.stringify(entry.value).length > 1_400_000)) throw Error('Publisher catalog index exceeds the workspace storage limit.');
  await commitIndex(host, entries);
}

/** Only analyst-verified links are reusable as evidence on a different notice. */
async function verifiedMatches(host: Host) {
  const matches = new Map<string, string>();
  let after = PUBLISHER_RECEIPT_PREFIX;
  for (;;) {
    const page = await host('catalog.workspace', { after });
    const receipts = page.entries as Array<{ key: string; value: PublisherReceipt }>;
    for (const { key, value } of receipts) {
      if (!key.startsWith(PUBLISHER_RECEIPT_PREFIX)) return matches;
      if (value?.match?.source === 'verified' && value.recordId === key.slice(PUBLISHER_RECEIPT_PREFIX.length)) {
        matches.set(value.recordId, value.match.url);
      }
    }
    if (!page.next || page.next <= after) return matches;
    after = page.next;
  }
}

async function commitIndex(host: Host, entries: Array<{ key: string; value: unknown }>) {
  for (let offset = 0; offset < entries.length; offset += 4) {
    for (let attempt = 0; ; attempt++) {
      const { revision } = await host('catalog.workspace', { keys: [] });
      if (!(await host('catalog.commit', { revision, entries: entries.slice(offset, offset + 4) })).conflict) break;
      if (attempt === 3) throw Error('The catalog changed repeatedly while indexing publisher records.');
    }
  }
}

export async function loadPublisherCandidates(host: Host, runId: string, rows: PublisherRow[]): Promise<Index> {
  const keys = [...new Set(rows.map(row => `${INDEX_KEY}:${bucket(publisherIdentity(row).buyer)}`))];
  const selected: Index = Object.create(null);
  for (let start = 0; start < keys.length; start += 3) {
    const result = await host('catalog.workspace', { keys: keys.slice(start, start + 3) });
    for (const entry of result.entries) {
      if (entry.value?.runId !== runId) throw Error('A newer publisher check replaced this index. Start a fresh check.');
      Object.assign(selected, entry.value.items);
    }
  }
  return selected;
}

const candidateId = (link: PublisherLink) => link.recordId ?? link.url.replace(/\/portal\/(opportunities\/)/, '/$1');
const vendorHints = (row: PublisherRow) => {
  const data = row.data;
  const text = [data.description, data.descriptionText, data.sourceDescriptionText, ...(Array.isArray(data.detailFields) ? data.detailFields.map(field => field?.value) : [])].join(' ');
  return { bids: /bids\s*(?:&|&amp;|and)\s*tenders|bidsandtenders\./i.test(text), bonfire: /\bbonfire\b|bonfirehub\.|\bEuna Procurement\b/i.test(text) };
};

export function matchSavedPublisher(row: PublisherRow, index: Index, links: PublisherLink[]): MatchResult {
  if (links.some(link => link.kind === 'notice')) return {};
  const identity = publisherIdentity(row);
  const hints = vendorHints(row);
  const portals = new Set(links.map(link => new URL(link.url).origin));
  const exact = new Map<string, Candidate>();
  const possible = new Map<string, Candidate>();
  for (const item of index[identity.buyer] ?? []) {
    if (item.id === row.id || !item.numbers.some(number => identity.numbers.includes(number))) continue;
    const link = publisherLink(item.url)!;
    if ((portals.size && !portals.has(new URL(item.url).origin)) ||
      (hints.bids !== hints.bonfire && (link.label === 'bids&tenders') !== hints.bids)) continue;
    const similarity = tokenSimilarity(item.title, identity.title);
    if (similarity >= 0.55) possible.set(candidateId(link), item);
    if (identity.round === item.round && similarity >= 0.78) exact.set(candidateId(link), item);
  }
  const sameRound = [...possible.values()].filter(item => item.round === identity.round);
  if (exact.size === 1 && sameRound.length === 1) {
    const matched = [...exact.values()][0];
    return { match: { url: matched.url, source: 'catalog', evidence: matched.id } };
  }
  if (!possible.size && !links.length && !hints.bids && !hints.bonfire) return {};
  const urls = [...possible.values()].map(item => item.url).sort().slice(0, 8);
  const message = possible.size ? 'The saved results need a buyer, bid number or intake check.' : 'A publisher is mentioned. The matching project page needs review.';
  return { review: publisherMatchReview(row.id, urls, message, identity.numbers, identity.round) };
}

export function publisherMatchReview(id: string, urls: string[], message: string, numbers: string[] = [], round = ''): PublisherOutcome {
  return {
    url: `https://bcbid.gov.bc.ca/page.aspx/en/bpm/process_manage_extranet/${id.replace(/^opportunity:/, '')}`,
    state: 'unresolved', matchReview: true, candidates: urls, message,
    review: { evidence: createHash('sha256').update(JSON.stringify([urls, message, numbers, round])).digest('hex') },
  };
}
