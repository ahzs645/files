// The host discovers enabled tabs from BC Bid's public secondary menu.
export const BC_BID_DETAIL_TABS = ['*'];
export const DETAIL_CAPTURE_VERSION = 3;

/** Listing changes that can invalidate previously captured notice details. */
const DETAIL_LISTING_FIELDS = [
  'amendments', 'lastUpdated', 'closingDate', 'description', 'status', 'type', 'issuedBy', 'issuedFor',
] as const;

/** A listing merge must not erase an outstanding detail refresh. */
export function needsDetail(saved: any, row: any = saved): 'new' | 'changed' | null {
  if (!saved) return 'new';
  if (saved.tabCoverage?.complete === false || saved.detailNeedsRefresh === true || !saved.detailFields?.length
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
  return { detailNeedsRefresh: row.tabCoverage?.complete !== true && captureVersion === DETAIL_CAPTURE_VERSION, ...(Number.isInteger(captureVersion) ? { detailCaptureVersion: captureVersion } : {}) };
}
