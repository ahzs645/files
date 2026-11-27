import { publisherLink, publisherLinks, resolvedPublisherLinks } from '../dashboard/procurement/publisher-links';
import { pendingPublisherReview, publisherReceiptKey, type PublisherOutcome, type PublisherReceipt } from '../dashboard/procurement/publisher-receipts';
import { matchSavedPublisher, publisherMatchReview, type PublisherRow, type loadPublisherCandidates } from './publisher-match';
import { catalogTransaction, type Host } from './procurement-collection';

/** Attach metadata only. An inferred link never supplies dates or files to the BC Bid record. */
export async function reconcileCatalogPublisher(host: Host, row: PublisherRow, runId: string, index: Awaited<ReturnType<typeof loadPublisherCandidates>>) {
  const key = publisherReceiptKey(row.id);
  return catalogTransaction(host, key, async (previous: Partial<PublisherReceipt>, revision) => {
    const input = await host('catalog.read', { ids: [row.id], revision });
    const origin = input.records[0] as PublisherRow | undefined;
    if (!origin || origin.kind !== 'opportunity' || (origin.data.sourceId && origin.data.sourceId !== 'bc-bid')) {
      return { entries: [{ key, value: previous }], unchanged: true };
    }
    const sourceLinks = publisherLinks(origin.data);
    const result = matchSavedPublisher(origin, index, sourceLinks);
    const direct = sourceLinks.some(link => link.kind === 'notice');
    const verified = previous.match?.source === 'verified' ? previous.match : undefined;
    const match = verified ?? result.match;
    const links = resolvedPublisherLinks(origin.data, match ? { ...previous, match } as PublisherReceipt : undefined);
    const prior = previous.outcomes ?? [];
    const outcomes: PublisherOutcome[] = links.map(link => prior.find(item => item.url === link.url) ?? {
      url: link.url,
      state: link.recordId && result.match?.evidence === link.recordId ? 'refreshed' : 'manual',
      ...(link.recordId && result.match?.evidence === link.recordId ? { recordId: link.recordId } : {}),
      message: link.kind === 'notice' ? 'Publisher project linked.' : 'Buyer listing available for review.',
    });
    if (!direct && !match) {
      const earlier = prior.find(item => item.matchReview);
      const savedLeads = earlier?.candidates?.filter(url => publisherLink(url)?.kind === 'notice') ?? [];
      const urls = [...new Set([...(result.review?.candidates ?? []), ...savedLeads])].sort().slice(0, 8);
      if (result.review || earlier) {
        const review = urls.length === (result.review?.candidates?.length ?? 0) && result.review
          ? result.review
          : publisherMatchReview(row.id, urls, urls.length ? 'Review the suggested publisher project.' : 'The publisher project needs review.');
        if (earlier?.review?.evidence === review.review?.evidence) review.review = earlier?.review;
        outcomes.push(review);
      }
    }
    const value: PublisherReceipt = {
      recordId: row.id, lastRunId: runId, checkedAt: new Date().toISOString(),
      ...(match ? { match } : {}), outcomes, needsReview: pendingPublisherReview(outcomes),
    };
    const unchanged = JSON.stringify(previous.match) === JSON.stringify(value.match) &&
      JSON.stringify(previous.outcomes) === JSON.stringify(value.outcomes) && previous.needsReview === value.needsReview;
    return { entries: [{ key, value: unchanged ? previous : value }], unchanged };
  });
}
