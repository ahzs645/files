import { targetedLabel } from './model';

// BC regional districts as the old sbcontest scraper typed them into BC Bid. BC Bid's own tag names were not
// re-observed (its browser check blocks plain Playwright), so a mismatch is reported with BC Bid's exact name.
export const BC_REGIONS = ['Alberni-Clayoquot', 'Bulkley-Nechako', 'Capital', 'Cariboo', 'Central Coast', 'Central Kootenay', 'Central Okanagan',
  'Columbia Shuswap', 'Comox Valley', 'Cowichan Valley', 'East Kootenay', 'Fraser Valley', 'Fraser-Fort George', 'Kitimat-Stikine', 'Kootenay Boundary',
  'Metro Vancouver', 'Mount Waddington', 'Nanaimo', 'North Coast', 'North Okanagan', 'Northern Rockies', 'Okanagan-Similkameen', 'Peace River', 'qathet',
  'Squamish-Lillooet', 'Stikine', 'Strathcona', 'Sunshine Coast', 'Thompson-Nicola'];
const when = (value?: string) => value ? new Date(value).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '';

/** Receipt text for `checkpoint:targeted`: what was searched, what came back, and whether BC Bid's search was cleared. */
export function receiptSummary(receipt: any) {
  if (!receipt) return null;
  const counts = `${receipt.pages} page${receipt.pages === 1 ? '' : 's'} · ${receipt.listingCount} notices (${receipt.newCount} new, ${receipt.changedCount} changed) · ${receipt.detailsCompleted} details`;
  const notes = [
    receipt.truncated && 'More result pages remain; raise Pages to include them.',
    receipt.detailsSkipped > 0 && `${receipt.detailsSkipped} new or changed notices still need details.`,
    receipt.detailFailures > 0 && `${receipt.detailFailures} detail pages failed.`,
    receipt.filtersCleared === false && "BC Bid's search may still be filtered. Press Reset on BC Bid's Opportunities page before a full scrape.",
  ].filter(Boolean) as string[];
  return { title: `${receipt.status === 'complete' ? 'Last refresh' : 'Last refresh failed'}: ${targetedLabel(receipt.filters)} · ${when(receipt.finishedAt)}`, counts, notes, error: receipt.error as string | undefined };
}
