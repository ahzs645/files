/** Public BC Bid tab labels requested after the initially loaded Overview.
 * This is an explicit compatibility list, not proof that the host discovered
 * every tab or paged through the grids inside it.
 */
export const BC_BID_DETAIL_TABS = [
  'Opportunity Details', 'Addenda', 'Interested Supplier List', 'Qualified Suppliers',
  'Process Rules', 'Responses', 'Pricing',
];

/** Listing changes that can invalidate previously captured notice details. */
const DETAIL_LISTING_FIELDS = [
  'amendments', 'lastUpdated', 'closingDate', 'description', 'status', 'type', 'issuedBy', 'issuedFor',
] as const;

/** A listing merge must not erase an outstanding detail refresh. */
export function needsDetail(saved: any, row: any = saved): 'new' | 'changed' | null {
  if (!saved) return 'new';
  if (saved.detailNeedsRefresh === true || !saved.detailFields?.length) return 'changed';
  return DETAIL_LISTING_FIELDS.some(key => (saved[key] ?? null) !== (row[key] ?? null)) ? 'changed' : null;
}

/** Keep this marker specific to BC Bid; other connectors have their own refresh rules. */
export function listingDetailRefresh(saved: any, row: any, capturedDetails = false) {
  // Legacy BC Bid records use either an absent sourceId or the empty string,
  // matching sourceMetadata and the document-candidate query.
  const sourceId = row.sourceId ?? saved?.sourceId;
  if (sourceId && sourceId !== 'bc-bid') return {};
  return { detailNeedsRefresh: capturedDetails ? false : needsDetail(saved, row) !== null };
}
