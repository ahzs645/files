import { isPauseError } from '../pause';
/**
 * A portal-level failure with a stable code the Sources page can show (`source_http_error`, `source_schema`, …).
 * `procurement.collect` records `{ code, message }` on that portal and carries on with the next one.
 * `portalStatus` records something other than `failed`: `waiting` (a person has to act first, e.g. complete a browser
 * check) or `not-run` (deliberately not visited, e.g. outside the site's visiting hours or disallowed by robots.txt).
 * `detail` keeps the HTTP status and the host's Retry-After, so a busy site can be retried later in the same run.
 */
export class ConnectorError extends Error {
  constructor(readonly code: string, message: string, readonly portalStatus?: 'waiting' | 'not-run', readonly detail: { status?: number; retryAfterMs?: number } = {}) {
    super(message); this.name = 'ConnectorError';
  }
}

/** HTTP failures by status: 403/429 are worth telling apart from "the site changed". */
export function httpFailure(what: string, status: number, retryAfterMs?: number): ConnectorError {
  const code = status === 403 ? 'source_forbidden' : status === 429 ? 'source_rate_limited' : 'source_http_error';
  return new ConnectorError(code, `${what} returned HTTP ${status}. Saved records are kept.`, undefined, { status, ...(retryAfterMs !== undefined ? { retryAfterMs } : {}) });
}

/**
 * Zoer's crawl policy (host service S4) refuses requests with these codes; robots.txt, visiting windows, pacing and
 * Retry-After are the host's job now. `crawl_wait` and `crawl_rate_limited` are temporary (retry later in the run).
 */
export const CRAWL_CODES = ['crawl_robots_disallowed', 'crawl_robots_unreadable', 'crawl_outside_window', 'crawl_wait', 'crawl_rate_limited'] as const;
const codeOf = (error: unknown) => typeof (error as any)?.code === 'string' ? (error as any).code as string : '';
const messageOf = (error: unknown) => String((error as Error)?.message ?? error ?? '');

/** The hint Zoer appends to crawl refusals (`[crawl retryAfterMs=12000]`, `[crawl nextWindowAt=…]`), because the runner forwards only code and message. */
export function crawlHints(message: string): { retryAfterMs?: number; nextWindowAt?: string } {
  const match = /\[crawl ([^\]]*)\]\s*$/.exec(String(message ?? ''));
  const hints: { retryAfterMs?: number; nextWindowAt?: string } = {};
  for (const part of match?.[1]?.split(/\s+/) ?? []) {
    const [key, value] = part.split('=', 2);
    if (key === 'retryAfterMs' && value && /^\d{1,9}$/.test(value)) hints.retryAfterMs = Number(value);
    if (key === 'nextWindowAt' && value && Number.isFinite(Date.parse(value))) hints.nextWindowAt = value;
  }
  return hints;
}
/** The host's message without its machine hint. */
const plainMessage = (message: string) => message.replace(/\s*\[crawl [^\]]*\]\s*$/, '');

/** Node/undici network failure codes Zoer forwards from a request that never got an answer. */
const NETWORK_CODES = /^(?:ECONNRESET|ECONNREFUSED|ECONNABORTED|ETIMEDOUT|EPIPE|EAI_AGAIN|ENETUNREACH|EHOSTUNREACH|ENETDOWN|EHOSTDOWN|UND_ERR_[A-Z_]+)$/;
const NETWORK_MESSAGES = /socket hang up|timed out|ended before completion|closed before completion|network is unreachable/i;

export interface TransientFailure { code: string; message: string; retryAfterMs?: number }
/**
 * A failure worth retrying later in the same run (resumable `retry`): the site asked us to slow down (429 or the host's
 * Retry-After block), Zoer's pacing could not fit the request into this slice, the site had a server error, or the
 * request never got an answer. Anything else (layout, schema, robots, 403) fails the portal at once.
 */
export function transientFailure(error: unknown): TransientFailure | null {
  const code = codeOf(error), message = plainMessage(messageOf(error)).slice(0, 2000);
  if (code === 'crawl_wait' || code === 'crawl_rate_limited') return { code, message, ...crawlHints(messageOf(error)).retryAfterMs !== undefined ? { retryAfterMs: crawlHints(messageOf(error)).retryAfterMs } : {} };
  const detail = (error as ConnectorError)?.detail;
  const retryAfterMs = Number.isInteger(detail?.retryAfterMs) ? { retryAfterMs: detail!.retryAfterMs } : {};
  if (code === 'source_rate_limited') return { code, message, ...retryAfterMs };
  if (code === 'source_http_error' && Number.isInteger(detail?.status) && (detail!.status! >= 500 || detail!.status === 408)) return { code, message, ...retryAfterMs };
  if (NETWORK_CODES.test(code) || (!code && NETWORK_MESSAGES.test(message))) return { code: code || 'network_error', message };
  return null;
}

/**
 * A crawl-policy refusal as the portal state the Sources page already knows:
 * - robots.txt disallows the page → `not-run` `robots_disallowed` (deliberately not collected; retrying will not help)
 * - robots.txt unreadable → `failed` `robots_unreadable`, or for a site read in the person's browser `waiting`
 *   `browser_check` (the host read robots.txt through the browser and got a page that is not robots.txt, usually a check)
 * - outside the site's visiting hours → `not-run` `outside_visit_window`
 * - pacing or Retry-After still blocking after the retries → `failed` `crawl_wait` / `source_rate_limited`
 * Returns null for anything that is not a crawl refusal.
 */
export function crawlRefusal(error: unknown, site: { label: string; url: string; host: string; browser?: boolean; visitTimeUtc?: string }): ConnectorError | null {
  const code = codeOf(error);
  if (!(CRAWL_CODES as readonly string[]).includes(code)) return null;
  const hints = crawlHints(messageOf(error)), host = plainMessage(messageOf(error));
  if (code === 'crawl_robots_disallowed') {
    return new ConnectorError('robots_disallowed', `${site.label}'s robots.txt does not allow automated collection of this page, so it was not loaded. Check it yourself: ${site.url} (Zoer: ${host})`, 'not-run');
  }
  if (code === 'crawl_robots_unreadable') {
    if (site.browser) {
      return new ConnectorError('browser_check', `${site.label}'s robots.txt could not be read in the Zoer browser (it may be showing a check), so its bids page was not loaded. Procurement does not answer checks. Open the Zoer browser, go to https://${site.host}/robots.txt, complete any check you see, return control to Procurement, then collect this site again.`, 'waiting');
    }
    return new ConnectorError('robots_unreadable', `${site.label}'s robots.txt could not be read, so what the site allows is unknown and nothing was requested. Zoer reads it again within the hour; saved records are kept.`);
  }
  if (code === 'crawl_outside_window') {
    const window = site.visitTimeUtc ? ` between ${site.visitTimeUtc.replace(/^(\d{2})(\d{2})-(\d{2})(\d{2})$/, '$1:$2–$3:$4')} UTC` : ' only at certain hours';
    const next = hints.nextWindowAt ? ` The next window opens ${hints.nextWindowAt}.` : '';
    return new ConnectorError('outside_visit_window', `${site.label} asks automated visitors to come${window} (its robots.txt Visit-time). Nothing was loaded; collect it again inside that window.${next} ${site.url}`, 'not-run');
  }
  if (code === 'crawl_rate_limited') return new ConnectorError('source_rate_limited', `${site.label} asked Zoer to wait before the next request (Retry-After). Saved records are kept; the next run collects it. (Zoer: ${host})`);
  return new ConnectorError('crawl_wait', `Zoer spaces requests to ${site.label} as its robots.txt and Procurement's pacing ask, and the next allowed request did not fit this run. Saved records are kept; the next run collects it. (Zoer: ${host})`);
}

/** Zoer's per-slice request or page budget is spent: the run's, not the portal's. */
export const isBudgetError = (error: unknown) => ['network_limit', 'browser_limit'].includes(codeOf(error)) || /budget exhausted|network_limit|browser_limit/i.test(messageOf(error));
/**
 * Inside a portal, a notice-page problem is only a warning, except a Zoer pause, a spent budget, or the site asking
 * to slow down (pacing or Retry-After): those end the portal so the run pauses, stops or retries it later.
 */
export function rethrowRunLimits(error: unknown) {
  if (isPauseError(error) || isBudgetError(error) || codeOf(error) === 'crawl_wait' || codeOf(error) === 'crawl_rate_limited') throw error;
}
