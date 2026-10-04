/**
 * Plain sentences for collection error codes (CONNECTORS.md §4 and its Changes; `zoer/src/connectors/errors.ts`,
 * `procurement-collection.ts`, `connector-collection.ts`). The Sources page shows the sentence and keeps the raw
 * `code: message` as `detail` (a tooltip or a details disclosure), because the raw text is what a bug report needs.
 * An unknown code falls back to the source's own message: we never invent a cause.
 */

export interface CollectionError { code?: string; message?: string }
export interface ErrorText { text: string; detail: string }

const status = (message: string) => /HTTP (\d{3})/.exec(message)?.[1];
const n = (message: string, pattern: RegExp) => { const match = pattern.exec(message); return match ? Number(match[1]) : 0; };
const portals = (count: number) => `${count} portal${count === 1 ? '' : 's'}`;

/** "3 failed, 1 incomplete, 2 not reached … of 22 portal(s)" from `connector-collection.ts`, as one sentence. */
function portalProblems(message: string): string | null {
  const total = n(message, /of (\d+) portal/);
  if (!total) return null;
  const failed = n(message, /(\d+) failed/), partly = n(message, /(\d+) incomplete/), notRun = n(message, /(\d+) not reached/), disallowed = n(message, /(\d+) disallowed by robots/);
  const verb = (count: number) => count === 1 ? 'was' : 'were';
  const parts = [failed && ['could not be collected', failed], partly && [`${verb(partly)} only partly collected`, partly],
    disallowed && [`${verb(disallowed)} not collected because ${disallowed === 1 ? 'its' : 'their'} robots.txt disallows it`, disallowed],
    notRun && [`${verb(notRun)} not reached before the time limit (the next run continues ${notRun === 1 ? 'it' : 'them'})`, notRun]]
    .filter(Boolean).map((part, index) => { const [what, count] = part as [string, number]; return index === 0 ? `${count} of ${portals(total)} ${what}` : `${count} ${what}`; });
  if (!parts.length) return null;
  const sentence = parts.length > 1 ? `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}` : parts[0];
  return `${sentence}. The other portals were saved; see the list below.`;
}

const TEXT: Record<string, (message: string) => string> = {
  source_http_error: message => `The site did not respond normally${status(message) ? ` (HTTP ${status(message)})` : ''}. Notices saved earlier are kept; try again later.`,
  source_forbidden: () => 'The site refused the request (HTTP 403); it may block automated access. Notices saved earlier are kept.',
  source_rate_limited: () => 'The site asked us to slow down (HTTP 429). Notices saved earlier are kept; try again later.',
  source_layout: () => 'The site’s pages changed, so its notices could not be read. The connector needs an update; saved notices are kept.',
  source_schema: () => 'The source’s data format changed, so its notices could not be read. The connector needs an update; saved notices are kept.',
  source_session: () => 'The site’s search session did not start. Try again later; saved notices are kept.',
  source_encoding: () => 'The site sent text that could not be decoded. Saved notices are kept.',
  source_size: () => 'The site’s response was too large or malformed to read. Saved notices are kept.',
  // Fallbacks for errors that carried no code of their own; the raw text stays in `detail`.
  portal_failed: () => 'This portal could not be collected because of an unexpected error. Notices saved earlier are kept; try again later.',
  collection_failed: () => 'The collection stopped because of an unexpected error. Notices saved earlier are kept; try again later.',
  connector_invalid: () => 'The connector returned data that failed its checks, so nothing new was saved. The connector needs an update.',
  source_records_excluded: message => { const count = /^(\d+)/.exec(message)?.[1]; return `${count ? `${count} notice${count === '1' ? ' was' : 's were'}` : 'Some notices were'} too large to save (over 250 kB). The rest were saved.`; },
  source_incomplete: message => { const m = /reported (\d+) open notices; (\d+) were saved/.exec(message); return m ? `The portal reports ${m[1]} open notices but listed ${m[2]}; those were saved.` : 'The portal listed fewer notices than it reports; the ones listed were saved.'; },
  source_changed: () => 'CanadaBuys published a new daily file. Start a new snapshot to collect it; saved notices are kept.',
  cursor_invalid: () => 'The saved place in the file no longer fits. Start a new snapshot; saved notices are kept.',
  catalog_conflict: () => 'Zoer’s database was busy with other changes. Run the collection again; nothing was lost.',
  receipt_mismatch: () => 'Saved notices did not verify after writing, so this was marked failed. Run it again.',
  collection_conflict: () => 'Another run took over this collection. Wait for it to finish.',
  collection_busy: () => 'Another collection of this source is already running. Wait for it to finish.',
  network_budget: () => 'The run used up its network request allowance before finishing. Notices saved so far are kept; the next run continues.',
  time_budget: message => portalProblems(message) ?? 'Stopped at the time limit; the next run continues where it stopped.',
  portals_failed: message => portalProblems(message) ?? 'Some portals could not be collected. The others were saved; see the list below.',
  portals_incomplete: message => portalProblems(message) ?? 'Some portals were only partly collected. See the list below.',
  waiting_for_user: () => 'Some sites showed a browser check and are waiting for you. Complete the check in the Zoer browser, then collect those sites again. The other sites were saved.',
  portals_skipped: () => 'Some sites were skipped on purpose (outside the hours their robots.txt allows). The other sites were saved.',
  outside_visit_window: message => message || 'Outside the hours this site allows automated visits. Nothing was loaded; collect it inside that window.',
  // Zoer's crawl policy (0.34+): robots.txt, pacing and Retry-After are applied by Zoer itself.
  robots_disallowed: message => portalProblems(message) ?? 'robots.txt disallows collection: this site asks automated visitors (including AI crawlers) not to load this page, so Procurement does not collect it. Notices saved earlier are kept; open the site to check it yourself.',
  robots_unreadable: () => 'The site’s robots.txt could not be read, so what it allows is unknown and nothing was collected. Zoer reads it again within the hour; saved notices are kept.',
  crawl_wait: () => 'Zoer spaces requests to this site as its robots.txt asks, and the next allowed request did not fit this run. Saved notices are kept; the next run collects it.',
  cancelled: () => 'The collection was cancelled. Saved notices are kept; the next run continues where it stopped.',
  network_limit: () => 'The run used up its network request allowance before finishing. Notices saved so far are kept; the next run continues.',
};

/** Sentence plus raw detail for an error saved in collection state; null when there is no error. */
export function sourceErrorText(error: CollectionError | null | undefined): ErrorText | null {
  if (!error || (!error.code && !error.message)) return null;
  const code = typeof error.code === 'string' ? error.code : '', message = typeof error.message === 'string' ? error.message : '';
  const detail = [code, message].filter(Boolean).join(': ');
  const text = TEXT[code]?.(message) ?? (message || `Collection failed (${code}).`);
  return { text, detail };
}
