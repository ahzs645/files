import { publisherLinks } from '../dashboard/procurement/publisher-links';
import { transientFailure } from './connectors/errors';
import type { PublisherOutcome } from '../dashboard/procurement/publisher-receipts';
import { refreshPublishers } from './publisher-refresh';
import { buildPublisherIndex, loadPublisherCandidates, matchSavedPublisher, type PublisherRow } from './publisher-match';
import { reconcileCatalogPublisher } from './publisher-catalog-reconcile';
import type { Host } from './procurement-collection';

type Scan = { after: string; scanned: number; linked: number; matched?: number; review?: number; indexed?: boolean; outcomes: Record<PublisherOutcome['state'], number> };
type SweepInput = { recordIds?: string[]; catalogOnly?: boolean };
const fresh = (): Scan => ({ after: '', scanned: 0, linked: 0, outcomes: { refreshed: 0, manual: 0, unresolved: 0, failed: 0 } });

/** Scheduled passes start from the beginning. Each slice limits both catalog and publisher operations. */
export async function sweepPublishers(host: Host, input: SweepInput, runId: string, step?: { checkpoint?: Scan; attempt?: number }) {
  const scan = step?.checkpoint ?? fresh();
  const selected = input.recordIds;
  if (input.catalogOnly && !scan.indexed) {
    await buildPublisherIndex(host, runId);
    scan.indexed = true;
  }
  if (selected && scan.scanned >= selected.length) return done(scan);
  const page = await host('catalog.read', selected ? { ids: [selected[scan.scanned]] } : { kind: 'opportunity', after: scan.after, limit: 160 });
  if (!page.primary) throw Error('Initialize the existing Procurement catalog before reconciling publishers.');
  const rows = page.records as PublisherRow[];
  const candidates = input.catalogOnly ? await loadPublisherCandidates(host, runId, rows.filter(eligibleRow)) : {};
  if (selected && !rows.length) throw Error('Choose existing BC Bid notices.');
  if (!rows.length) return done(scan);
  let checked = 0;
  for (const row of rows) {
    const eligible = eligibleRow(row);
    if (selected && !eligible) throw Error('Choose existing BC Bid notices.');
    const links = eligible ? publisherLinks(row.data) : [];
    if (eligible && input.catalogOnly) {
      const match = matchSavedPublisher(row, candidates, links);
      const receipt = (links.length || match.match || match.review)
        ? await reconcileCatalogPublisher(host, row, runId, candidates)
        : undefined;
      if (receipt?.match) scan.matched = (scan.matched ?? 0) + 1;
      if (receipt?.outcomes?.some((item: PublisherOutcome) => item.matchReview && !item.review?.reviewedAt)) scan.review = (scan.review ?? 0) + 1;
      if (links.length || receipt?.match) scan.linked++;
      if (receipt?.outcomes) for (const item of receipt.outcomes as PublisherOutcome[]) scan.outcomes[item.state]++;
      if (receipt) checked++;
    } else if (links.length) {
      try {
        const receipt = await refreshPublishers(host, row.id, runId, undefined, { retryTransient: (step?.attempt ?? 1) <= 2, catalogOnly: input.catalogOnly });
        for (const item of receipt.outcomes as PublisherOutcome[]) scan.outcomes[item.state]++;
      } catch (error) {
        const retry = transientFailure(error);
        if (!retry) throw error;
        const { retryAfterMs, ...failure } = retry;
        return { resumable: 'retry', checkpoint: scan, error: failure, ...(retryAfterMs ? { retryAfterMs } : {}) };
      }
      scan.linked++;
      checked++;
    }
    scan.after = row.id;
    scan.scanned++;
    if (checked >= (input.catalogOnly ? 40 : 1)) break;
  }
  return selected && scan.scanned >= selected.length ? done(scan) : { resumable: 'continue', checkpoint: scan, progress: progress(scan) };
}

function eligibleRow(row: PublisherRow) {
  return row.kind === 'opportunity' && (!row.data.sourceId || row.data.sourceId === 'bc-bid');
}

function progress(scan: Scan) {
  return { phase: 'Reconciling BC Bid and publisher records', done: scan.scanned, unit: 'rows', message: `${scan.linked} notices with publisher links` };
}

function done(scan: Scan) {
  return { resumable: 'done', output: { scanned: scan.scanned, linked: scan.linked, matched: scan.matched ?? 0, matchReview: scan.review ?? 0, ...scan.outcomes }, progress: progress(scan) };
}
