import { targetedLabel } from './model';

import reference from '../data/bc-bid-filter-reference.json';
export const BC_REGIONS = reference.regions.filter(t=>t.level==='regional-district' || t.level==='province').map(t=>t.title).sort();
import { formatWhen } from '../../apps/dashboard/src/lib/formatting';
import { plural } from './format';

/** Receipt text for `checkpoint:targeted`: what was searched, what came back, and whether BC Bid's search was cleared. */
export function receiptSummary(receipt: any) {
  if (!receipt) return null;
  const counts = `${plural(receipt.pages, 'page', 'pages')} · ${plural(receipt.listingCount, 'opportunity', 'opportunities')} (${Number(receipt.newCount || 0).toLocaleString()} new, ${Number(receipt.changedCount || 0).toLocaleString()} changed) · ${plural(receipt.detailsCompleted, 'detail', 'details')}`;
  const notes = [
    receipt.truncated && 'More result pages remain; raise Pages to include them.',
    receipt.detailsSkipped > 0 && `${plural(receipt.detailsSkipped, 'new or changed opportunity still needs', 'new or changed opportunities still need')} details.`,
    receipt.detailFailures > 0 && `${plural(receipt.detailFailures, 'detail page', 'detail pages')} failed.`,
    receipt.filtersCleared === false && "BC Bid's search may still be filtered. Press Reset on BC Bid's Opportunities page before a full scrape.",
  ].filter(Boolean) as string[];
  return { title: `${receipt.status === 'complete' ? 'Last targeted collection' : 'Last targeted collection failed'}: ${targetedLabel(receipt.filters)}${receipt.finishedAt ? ` · ${formatWhen(Date.parse(receipt.finishedAt))}` : ''}`, counts, notes, error: receipt.error as string | undefined };
}
