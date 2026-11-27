import { BIDSANDTENDERS_PORTALS } from '../dashboard/procurement/portals';
import { parseDeadline } from '../dashboard/procurement/deadline';
import { titleTokens, tokenSimilarity } from '../dashboard/procurement/duplicates';
import { resolvedPublisherLinks, type PublisherLink } from '../dashboard/procurement/publisher-links';
import { createHash } from 'node:crypto';
import { pendingPublisherReview, publisherReceiptKey, publisherSignInOrigin, type PublisherOutcome, type PublisherReceipt } from '../dashboard/procurement/publisher-receipts';
import { catalogTransaction, type Host } from './procurement-collection';
import { hostNetFetch } from './connector-collection';
import { detailRecord, detailUrl, noticeNumber, type ListingRow, parseListingPage, parseNoticePage, readSearchForm, searchUrl } from './connectors/bidsandtenders';
import { attachmentFields, mergeAttachments } from './connectors/attachments';
import { rethrowRunLimits, httpFailure, transientFailure } from './connectors/errors';
import type { ConnectorPortal, NetFetch } from './connectors/types';

const PAGE_LIMIT = 15;
const MAX_REFERENCES = 4;
const normalizeNumber = (value: string) => value.normalize('NFKC').trim().replace(/\s+/g, ' ').toUpperCase();

/** Older BC Bid rows store the buyer's reference as opportunityId. processId is the page ID. */
function sourceBidNumber(data: { externalId?: unknown; opportunityId?: unknown; processId?: unknown; detailFields?: { label?: string; value?: unknown }[] }, title: string) {
  const reference = Array.isArray(data.detailFields) ? data.detailFields.find(field => /^(opportunity id|bid number|solicitation number)$/i.test(field?.label?.trim() ?? ''))?.value : undefined;
  const heading = noticeNumber(title)?.replace(/^(?:NRFP|RFx|RFP|RFI|RFQ|ITB|ITT|NOI)\s+/i, '');
  return [data.externalId, reference, data.opportunityId, heading]
    .find(value => typeof value === 'string' && value.trim() && value !== data.processId)?.toString().trim() ?? '';
}

function matchingBidNumber(publishedNumber: string, sourceNumber: string, publishedTitle: string, sourceTitle: string) {
  if (normalizeNumber(publishedNumber) === normalizeNumber(sourceNumber)) return true;
  const base = /^(\d{4,}) [A-Z]{2,5}$/.exec(normalizeNumber(sourceNumber))?.[1];
  return base === normalizeNumber(publishedNumber) && tokenSimilarity(titleTokens(publishedTitle), titleTokens(sourceTitle)) === 1;
}

/** Search only a published buyer portal, and confirm a shortened reference with identical title words. */
async function findTender(fetch: NetFetch, portal: ConnectorPortal, number: string, title: string) {
  if (!number || number.length > 80 || !/\d/.test(number)) return;
  const keyword = /^(\d{4,}) [A-Z]{2,5}$/.exec(normalizeNumber(number))?.[1] ?? number;
  const home = await fetch({ url: portal.url, accept: 'text/html' });
  if (home.status !== 200) throw httpFailure(portal.label, home.status, home.retryAfterMs);
  const { nodeId, token } = readSearchForm(home.text);
  const matches = new Map<string, ListingRow>();
  for (const status of ['Open', 'Closed', 'Awarded']) {
    const response = await fetch({
      url: searchUrl(portal, nodeId, 0, status, PAGE_LIMIT), method: 'POST', accept: 'application/json',
      form: { keywords: keyword, __RequestVerificationToken: token },
    });
    if (response.status !== 200) throw httpFailure(`${portal.label} ${status} search`, response.status, response.retryAfterMs);
    const page = parseListingPage(response.text);
    if (page.total !== page.data.length || page.total > PAGE_LIMIT) return;
    for (const row of page.data) {
      const found = noticeNumber(row.Title);
      if (found && matchingBidNumber(found, number, row.Title, title)) matches.set(row.Id.toLowerCase(), row);
    }
  }
  return matches.size === 1 ? [...matches.keys()][0] : undefined;
}

export async function resolvePublisher(fetch: NetFetch, link: PublisherLink, number: string, retrievedAt: string, title = '') {
  const outcome = { url: link.url };
  if (link.label === 'Bonfire') {
    return { outcome: { ...outcome, state: 'manual', message: 'Open Bonfire to check deadlines and retrieve vendor files.',
      review: { signInOrigin: publisherSignInOrigin(link), evidence: link.url } } satisfies PublisherOutcome };
  }
  const host = new URL(link.url).hostname;
  const portal = BIDSANDTENDERS_PORTALS.find(candidate => candidate.host === host);
  if (!portal) return { outcome: { ...outcome, state: 'manual', message: 'This buyer portal is outside the configured collection hosts.' } satisfies PublisherOutcome };
  const tenderId = link.kind === 'notice' ? link.recordId?.split(':').at(-1) : await findTender(fetch, portal, number, title);
  if (!tenderId) return { outcome: { ...outcome, state: 'unresolved', message: 'No unique matching bid number was found among the open, closed and awarded listings.' } satisfies PublisherOutcome };
  const response = await fetch({ url: detailUrl(portal, tenderId), accept: 'text/html' });
  if (response.status !== 200) throw httpFailure(portal.label, response.status, response.retryAfterMs);
  const page = parseNoticePage(response.text);
  if (!page?.bidNumber || !page.bidName || (number && !matchingBidNumber(page.bidNumber, number, page.bidName, title))) {
    return { outcome: { ...outcome, state: 'unresolved', message: 'The published notice could not be verified.' } satisfies PublisherOutcome };
  }
  const row = detailRecord(tenderId, portal, retrievedAt, page);
  const files = row.attachments.filter(file => file.access === 'login').map(file => [file.url, file.name]).sort();
  const review = files.length ? {
    signInOrigin: publisherSignInOrigin(link),
    evidence: createHash('sha256').update(JSON.stringify([row.sourceKey, row.closingAt ?? row.closingDate, row.status, files])).digest('hex'),
  } : undefined;
  return { outcome: { ...outcome, state: 'refreshed', recordId: `opportunity:${row.sourceKey}`,
    ...(review ? { review, message: 'The publisher lists files that require a supplier sign-in.' } : {}) } satisfies PublisherOutcome, row };
}

/** Capture publisher evidence in the existing catalog. The originating BC Bid values remain independent. */
export async function refreshPublishers(host: Host, recordId: string, runId: string, now = () => new Date().toISOString(), options: { retryTransient?: boolean; catalogOnly?: boolean } = {}) {
  if (!/^opportunity:[a-z0-9:._-]{1,115}$/i.test(recordId)) throw Error('Choose a saved BC Bid opportunity.');
  const input = await host('catalog.read', { ids: [recordId] });
  if (!input.primary) throw Error('Initialize the existing Procurement catalog before refreshing publishers.');
  const source = input.records[0];
  if (source?.kind !== 'opportunity' || (source.data.sourceId && source.data.sourceId !== 'bc-bid')) {
    throw Error('Choose a saved BC Bid opportunity.');
  }
  const key = publisherReceiptKey(recordId);
  const entries = await host('catalog.workspace', { keys: [key] });
  const savedReceipt = entries.entries.find((entry: { key: string }) => entry.key === key)?.value as PublisherReceipt | undefined;
  const links = resolvedPublisherLinks(source.data, savedReceipt);
  const number = sourceBidNumber(source.data, source.title);
  const checkedAt = now(), outcomes: PublisherOutcome[] = [];
  const fresh = new Map<string, ReturnType<typeof detailRecord>>();
  for (const [index, link] of links.entries()) {
    if (options.catalogOnly) {
      outcomes.push({ url: link.url, state: 'manual', message: 'Open the publisher to check vendor files.',
        review: { signInOrigin: publisherSignInOrigin(link), evidence: link.url } });
      continue;
    }
    if (index >= MAX_REFERENCES) {
      outcomes.push({ url: link.url, state: 'manual', message: 'More publisher links were listed than this run can verify. Open the link to check it.' });
      continue;
    }
    try {
      const result = await resolvePublisher(hostNetFetch(host), link, number, checkedAt, source.title);
      outcomes.push(result.outcome);
      if (result.row && result.outcome.recordId) fresh.set(result.outcome.recordId, result.row);
    } catch (error) {
      if (options.retryTransient && transientFailure(error)) throw error;
      if (!transientFailure(error)) rethrowRunLimits(error);
      outcomes.push({ url: link.url, state: 'failed', message: String((error as Error)?.message ?? error).slice(0, 500) });
    }
  }
  return catalogTransaction(host, key, async (previous, revision) => {
    const { records: [origin] } = await host('catalog.read', { ids: [recordId], revision });
    if (!origin || JSON.stringify(resolvedPublisherLinks(origin.data, previous)) !== JSON.stringify(links) || sourceBidNumber(origin.data, origin.title) !== number || origin.title !== source.title) {
      throw Error('The BC Bid references changed. Refresh the notice and try again.');
    }
    const records = [];
    for (const [id, row] of fresh) {
      const { records: [existing] } = await host('catalog.read', { ids: [id], revision });
      const saved = existing?.data;
      const { rawSourceData: _detailOnly, ...publisher } = row;
      records.push({ id, kind: 'opportunity', title: row.description, data: {
        ...saved, ...publisher,
        ...(parseDeadline(row.closingAt ?? row.closingDate) ? { closingAt: row.closingAt } : { closingAt: saved?.closingAt, closingDate: saved?.closingDate }),
        descriptionText: saved?.descriptionText && saved.descriptionText !== saved.sourceDescriptionText ? saved.descriptionText : row.descriptionText,
        ...attachmentFields(mergeAttachments(row.attachments, saved?.attachments)),
        detailFields: saved?.detailFields ?? row.detailFields, addenda: saved?.addenda ?? row.addenda,
        ...(saved?.place && saved.place.method !== 'portal' ? { place: saved.place } : {}),
      } });
    }
    const priorOutcomes = new Map<string, PublisherOutcome>((previous.outcomes ?? []).map((item: PublisherOutcome) => [item.url, item]));
    const reconciled = outcomes.map(item => {
      const prior = priorOutcomes.get(item.url);
      if (options.catalogOnly && prior) return { ...item, recordId: prior.recordId, review: prior.review ?? (prior.recordId ? undefined : item.review) };
      if (item.state === 'failed' && prior) return { ...item, recordId: prior.recordId, review: prior.review };
      if (item.review && prior?.review?.evidence === item.review.evidence) return { ...item, review: prior.review };
      return item;
    });
    const pendingMatch = (previous.outcomes as PublisherOutcome[] | undefined)?.filter(item => item.matchReview) ?? [];
    const combined = [...reconciled, ...(!links.some(link => link.kind === 'notice') ? pendingMatch : [])];
    const receipt: PublisherReceipt = { recordId, lastRunId: runId, checkedAt, ...(previous.match ? { match: previous.match } : {}),
      outcomes: combined, needsReview: pendingPublisherReview(combined) };
    return { records, history: records.map(record => ({ runId, id: record.data.sourceKey, data: record.data })), entries: [{ key, value: receipt }] };
  });
}
