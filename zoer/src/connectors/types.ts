/**
 * Listing connectors for procurement sources beyond BC Bid and CanadaBuys (see CONNECTORS.md).
 * A connector turns one portal's public listing into catalog opportunity records. It never writes to the
 * catalog itself: `procurement.collect` owns checkpoints, merging with saved enrichment and run receipts.
 */

/** Where a notice is, as far as the source or our BC place list can say. Nulls are "not known", never guesses. */
export interface Place {
  municipality: string | null;
  regionalDistrict: string | null;
  /** How it was decided: the portal owner, the buyer name, the notice text, or the source's own region field. */
  method: 'portal' | 'buyer' | 'description' | 'source-region';
}

/** A buyer contact published with a notice. Only values the source shows; nothing is inferred. */
export interface NoticeContact {
  name?: string; email?: string; phone?: string; role?: string;
  source: 'detail-field' | 'csv' | 'description' | 'listing';
}

/** One portal (one buyer's site) on a shared platform. */
export interface ConnectorPortal {
  /** Stable id, unique within the connector: [a-z0-9-]+. Part of every sourceKey, so never rename one. */
  id: string;
  /** The buyer as the portal names itself, used as `issuedBy`. */
  label: string;
  /** Exact hostname; must also be in the manifest's networkAllowlist (no wildcards in Zoer). */
  host: string;
  /** Public listing page a person can open. */
  url: string;
  place: Place;
}

export interface NetRequest {
  url: string;
  method?: 'GET' | 'POST';
  /** Sent as application/x-www-form-urlencoded. POST needs the action's networkSession opt-in. */
  form?: Record<string, string>;
  accept?: string;
}
/** `retryAfterMs`: the site's Retry-After (429/503), as Zoer reports it, capped at 5 minutes. */
export interface NetResponse { status: number; headers: Record<string, string>; text: string; retryAfterMs?: number }
/** network.fetch with the per-run cookie jar kept host-side; the connector never sees cookie values. */
export type NetFetch = (request: NetRequest) => Promise<NetResponse>;

export interface PortalResult {
  portalId: string;
  /** Catalog opportunity records (record contract in CONNECTORS.md). */
  records: any[];
  /** Count the portal itself reported, when it reports one; undefined means unknown, never zero. */
  totalReported?: number;
  warnings: string[];
}

export interface SourceConnector {
  /** Catalog sourceId: [a-z][a-z0-9-]{0,63}. */
  id: string;
  label: string;
  jurisdiction: string;
  /** Short honest statement of what the connector covers and what it does not. */
  coverage: string;
  portals: readonly ConnectorPortal[];
  /** Upper bound of network requests one portal may use; collect budgets maxNetworkRequests from this. */
  requestsPerPortal: number;
  /** True when the connector needs cookies or form POST (Zoer networkSession). */
  needsSession: boolean;
  collectPortal(fetch: NetFetch, portal: ConnectorPortal, context: { now: () => string; runId: string }): Promise<PortalResult>;
}
