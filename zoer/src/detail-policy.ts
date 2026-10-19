/** Public BC Bid tab labels requested after the initially loaded Overview.
 * This is an explicit compatibility list, not proof that the host discovered
 * every tab or paged through the grids inside it.
 */
export const BC_BID_DETAIL_TABS = [
  'Opportunity Details', 'Addenda', 'Interested Supplier List', 'Qualified Suppliers',
  'Process Rules', 'Responses', 'Pricing',
];

/** Stamped on details saved by the automatic paths that request BC_BID_DETAIL_TABS.
 * Bump it when that tab list or detail parsing changes enough that older saved
 * details should be recaptured. Unstamped details came from the original
 * three-tab capture (version 1) or a manual current-page capture.
 */
export const DETAIL_CAPTURE_VERSION = 2;

/** Listing changes that can invalidate previously captured notice details. */
const DETAIL_LISTING_FIELDS = [
  'amendments', 'lastUpdated', 'closingDate', 'description', 'status', 'type', 'issuedBy', 'issuedFor',
] as const;

/** A listing merge must not erase an outstanding detail refresh. */
export function needsDetail(saved: any, row: any = saved): 'new' | 'changed' | null {
  if (!saved) return 'new';
  if (saved.detailNeedsRefresh === true || !saved.detailFields?.length
    || (saved.detailCaptureVersion ?? 1) < DETAIL_CAPTURE_VERSION) return 'changed';
  return DETAIL_LISTING_FIELDS.some(key => (saved[key] ?? null) !== (row[key] ?? null)) ? 'changed' : null;
}

/** Keep this marker specific to BC Bid; other connectors have their own refresh rules. */
export function listingDetailRefresh(saved: any, row: any, capturedDetails = false, captureVersion?: unknown) {
  // Legacy BC Bid records use either an absent sourceId or the empty string,
  // matching sourceMetadata and the document-candidate query.
  const sourceId = row.sourceId ?? saved?.sourceId;
  if (sourceId && sourceId !== 'bc-bid') return {};
  if (!capturedDetails) return { detailNeedsRefresh: needsDetail(saved, row) !== null };
  // A manual current-page capture clears the listing marker but keeps the saved
  // version, so the notice stays eligible for a full-tab recapture.
  return { detailNeedsRefresh: false, ...(Number.isInteger(captureVersion) ? { detailCaptureVersion: captureVersion } : {}) };
}
