/**
 * Run and download errors in words a person can act on. Hosts and workers report developer-facing messages (DNS
 * codes, JSON Schema paths, worker cleanup races, ISO timestamps); callers show `plainError` and keep the original
 * one tap away (a Hint or a "Details" disclosure) for bug reports. `shortError` is the one-line form for lists.
 */

/** Exact or near-exact host/worker messages, mapped to one plain sentence. First match wins. */
const PLAIN: [RegExp, string][] = [
  [/browser verification required|requires a browser check|manual browser verification|complete (?:the|any required) (?:browser )?check/i, 'BC Bid asked for a browser check. Open the download browser in Zoer, complete the check, then hand control back; the run continues from where it stopped.'],
  [/browser transport does not support|select a native saved browser|native[- ]transport|not a native browser/i, 'This browser cannot download attachments. Downloads need a native browser (Clearcote, Camoufox, Patchright or Playwright); choose one under Settings › Browsers.'],
  [/browser control changed/i, 'Downloads stopped because the download browser was taken over by a person. Hand control back to the agent in Zoer, then retry.'],
  [/saved browser is unavailable or under manual control|browser is (?:busy|under (?:manual|user) control)/i, 'The download browser was stopped or under your control. Hand control back to the agent in Zoer, then retry.'],
  [/did not match its JSON Schema|must NOT have additional properties|output.*schema|schema mismatch/i, 'The run finished, but its result did not match what this plugin version expects. Saved records are kept; this is a plugin bug fixed by updating the plugin.'],
  [/prior plugin worker cleanup|worker is still present|worker failed to start/i, 'Zoer was still cleaning up the previous run, so this one could not start. It is retried automatically; nothing was lost.'],
  [/plan (?:is )?stale|stale plan|plan .*no longer (?:valid|current)|re-?plan/i, 'Plugin settings changed after this run was planned. The next run uses the current settings.'],
  [/EAI_AGAIN|ENOTFOUND|getaddrinfo|ECONNRESET|ECONNREFUSED|ETIMEDOUT|socket hang up|fetch failed|network (?:error|request failed)/i, 'The site could not be reached (network or DNS problem). Nothing is wrong with your setup; it is retried on the next run.'],
  [/no attachment links (?:are )?saved|no attachment links saved for this record/i, 'No attachment links are saved for this notice yet. Capture its details first; this is not a download failure.'],
  [/attachment control is missing or ambiguous/i, 'The attachment link was not found on the notice page. Capture the notice details again.'],
  [/document request guard|did not finish setting up/i, 'The download browser timed out while starting. Check it in Zoer, then retry.'],
  [/download did not start|no document download completed|could not finish the attachment download/i, 'The download did not finish. The attachment page may be waiting in the download browser; open it in Zoer, then retry.'],
  [/browser downloaded an empty file/i, 'BC Bid returned an empty file. Retry later; saved files are kept.'],
  [/HTTP 429|limited attachment requests|too many requests/i, 'BC Bid asked Zoer to slow down. Downloads continue later; saved files are kept.'],
  [/exceeds the \d+ MiB limit/i, 'This file is larger than Zoer saves (150 MiB). Open it on BC Bid instead.'],
  [/operation was aborted|aborterror/i, 'The step was stopped before it finished. Saved work is kept.'],
  [/stopped from plugin dashboard/i, 'Stopped.'],
  [/unknown action|action .{0,80}(?:not found|not declared|is not available)/i, 'This Zoer version cannot run that yet. Update Zoer and the plugin, then try again.'],
];

/** One line for lists; the full plain sentence still reads well, so lists use the same text except where shorter forms exist. */
const SHORT: [RegExp, string][] = [
  [/browser verification required|requires a browser check|manual browser verification/i, 'Browser check needed. Complete it in the Zoer browser, then retry.'],
  [/attachment control is missing or ambiguous/i, 'Attachment link not found. Capture the notice details again.'],
  [/document request guard|did not finish setting up/i, 'The download browser timed out. Check it, then retry.'],
  [/download did not start|no document download completed/i, 'Download did not start. Check the download browser, then retry.'],
  [/stopped from plugin dashboard/i, 'Stopped.'],
];

const ISO = /\b\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})\b/g;
/** Far-future placeholders some checkpoints use for "no end date"; they are never shown as dates. */
export const isSentinelDate = (value: unknown) => typeof value === 'string' && /^9999-12-31/.test(value);

/** Local time for ISO timestamps, no sentinel dates, single full stops and whitespace. */
export function tidyMessage(message: string): string {
  return message
    .replace(ISO, iso => Number.isFinite(Date.parse(iso)) ? new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : iso)
    .replace(/\b9999-12-31\b(?:\s*to\s*9999-12-31\b)?/g, 'open-ended')
    .replace(/(?<!\.)\.\.(?!\.)/g, '.')
    .replace(/\s+/g, ' ')
    .trim();
}

function translate(message: string, table: [RegExp, string][]): string {
  const text = tidyMessage(message);
  // "11 of 25 records failed: <reason>" keeps its counts and explains the reason.
  const counted = /^(\d[\d,]*) of (\d[\d,]*) records? failed:\s*(.+)$/is.exec(text);
  if (counted && /no attachment links/i.test(counted[3])) return `${counted[1]} of ${counted[2]} notices have no attachment links saved yet. Capture their details first; this is not a download failure.`;
  if (counted) return `${counted[1]} of ${counted[2]} notices did not finish: ${translate(counted[3], table).replace(/^./, c => c.toLowerCase())}`;
  return table.find(([pattern]) => pattern.test(text))?.[1] ?? PLAIN.find(([pattern]) => pattern.test(text))?.[1] ?? text;
}

/** A host or worker message in plain words; unknown messages keep their text, tidied (local times, no ".."). */
export function plainError(message: string | null | undefined): string {
  return message ? translate(message, PLAIN) : '';
}
/** The plain sentence only when the message is a recognised one (network, browser, schema…); null otherwise. */
export function knownError(message: string | null | undefined): string | null {
  if (!message) return null;
  const text = tidyMessage(message);
  return PLAIN.find(([pattern]) => pattern.test(text))?.[1] ?? null;
}
/** Short labels for long, repeated run errors; callers keep the full message in a title tooltip. */
export function shortError(message: string | null | undefined): string {
  return message ? translate(message, SHORT) : '';
}
