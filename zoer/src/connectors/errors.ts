/**
 * A portal-level failure with a stable code the Sources page can show (`source_http_error`, `source_schema`, …).
 * `procurement.collect` records `{ code, message }` on that portal and carries on with the next one.
 */
export class ConnectorError extends Error {
  constructor(readonly code: string, message: string) { super(message); this.name = 'ConnectorError'; }
}

/** HTTP failures by status: 403/429 are worth telling apart from "the site changed". */
export function httpFailure(what: string, status: number): ConnectorError {
  const code = status === 403 ? 'source_forbidden' : status === 429 ? 'source_rate_limited' : 'source_http_error';
  return new ConnectorError(code, `${what} returned HTTP ${status}. Saved records are kept.`);
}
