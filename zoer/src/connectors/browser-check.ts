import { htmlToText } from './html';

/**
 * Pages that are not the site but a gate in front of it: a bot check ("Just a moment…"), an access-denied
 * interstitial, or nothing at all. Procurement never answers a check; it stops for that site and asks the person to
 * open the Zoer browser and complete it. Matching is on what the browser shows (title, text, element ids/classes),
 * because Zoer's capture drops scripts. A reCAPTCHA inside a page's own form (e.g. "Email a friend") is not a gate.
 */
export interface BrowserCheck { kind: 'challenge' | 'blocked' | 'empty'; reason: string }
export interface GatePage { title?: string; html: string; status?: number }

const CHALLENGE_TITLE = /^(?:just a moment|attention required|checking your browser|please wait while we (?:check|verify)|verify(?:ing)? (?:that )?you are (?:a )?human|security check|one more step|ddos-guard|human verification)\b/i;
const BLOCKED_TITLE = /^(?:access denied|403 forbidden|forbidden|request rejected|you have been blocked|error 1020)\b/i;
const CHALLENGE_MARKUP = /\b(?:cf-chl[\w-]*|challenge-platform|challenge-form|challenge-running|challenge-stage|cf-browser-verification|cf-turnstile|cf_chl_opt|px-captcha|captcha-container|ddos-guard|incap_ses|_incapsula_resource|sec-if-cpt-container|bm-verify)\b/i;
const CHALLENGE_TEXT = /needs to review the security of your connection|verify(?:ing)? (?:that )?you are (?:a )?human|checking (?:if the site connection is secure|your browser before accessing)|enable javascript and cookies to continue|press (?:&|and) hold|please complete the security check|pardon our interruption|are you a robot|this request was blocked by our security service|why have i been blocked|your request has been blocked|request unsuccessful\. incapsula/i;
const BLOCKED_TEXT = /\b(?:sorry, you have been blocked|access (?:to this page )?(?:has been )?denied|you don't have permission to access|error 1020|the requested url was rejected)\b/i;

export function detectBrowserCheck(page: GatePage): BrowserCheck | null {
  const title = String(page.title ?? '').trim(), html = String(page.html ?? '');
  const text = htmlToText(html);
  if (CHALLENGE_TITLE.test(title)) return { kind: 'challenge', reason: `page title “${title.slice(0, 80)}”` };
  // Ids and classes only: words in ordinary page text do not count as markup.
  const markup = [...html.matchAll(/\b(?:id|class)="([^"]*)"/gi)].map(match => match[1]).join(' ');
  if (CHALLENGE_MARKUP.test(markup)) return { kind: 'challenge', reason: 'the page is a bot-check page' };
  // A long page that mentions these words (an article about security, say) is content; gates are short.
  const short = text.length < 3000;
  if (short && CHALLENGE_TEXT.test(text)) return { kind: 'challenge', reason: 'the page asks to verify you are human' };
  if (BLOCKED_TITLE.test(title) || (short && BLOCKED_TEXT.test(text))) return { kind: 'blocked', reason: 'the site answered “access denied”' };
  if (page.status !== undefined && [401, 403, 429, 503].includes(page.status) && short) return { kind: 'blocked', reason: `the site answered HTTP ${page.status}` };
  if (text.replace(/\s+/g, '').length < 20) return { kind: 'empty', reason: 'the page was empty' };
  return null;
}

/** What the person should do, in plain words. */
export function browserCheckMessage(siteLabel: string, url: string, check: BrowserCheck): string {
  const what = check.kind === 'challenge' ? `${siteLabel} showed a browser check (${check.reason})`
    : check.kind === 'blocked' ? `${siteLabel} did not show its page (${check.reason})`
    : `${siteLabel} showed an empty page`;
  return `${what}. Procurement does not answer checks. Open the Zoer browser, go to ${url}, complete any check you see, return control to Procurement, then collect this site again.`;
}
