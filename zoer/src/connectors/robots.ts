import { decodeEntities } from './html';

/**
 * robots.txt as RFC 9309 reads it, plus the two non-standard lines BC sites use to ask for pacing: `Crawl-delay`
 * (seconds between requests) / `Request-rate` (`1/10` = one page per 10 s), and `Visit-time` (`0900-1200`, UTC).
 * Procurement identifies as `ZoerProcurement` for group selection; without a group naming it, the `*` group applies.
 * This collector was built and is run with AI help, so groups addressed to AI crawlers also bind it: a path any of
 * them disallows is never loaded, whatever the selected group allows (see `aiRules`).
 */
export const ROBOTS_AGENT = 'ZoerProcurement';
/** Product tokens of AI crawlers whose robots.txt groups Procurement also obeys. */
export const AI_CRAWLER_AGENTS = ['anthropic-ai', 'claudebot', 'claude-web', 'claude-user', 'claude-searchbot', 'gptbot', 'chatgpt-user', 'ccbot', 'google-extended', 'perplexitybot', 'bytespider'];

export interface RobotsRule { allow: boolean; pattern: string }
interface Group { agents: string[]; rules: RobotsRule[]; crawlDelay?: number; requestRate?: number; visitTime?: string }
export interface RobotsPolicy {
  /** Which group applied: our product token, `*`, or `none` (no group: everything allowed). */
  group: 'agent' | '*' | 'none';
  rules: RobotsRule[];
  /** Rules from groups naming AI crawlers; a URL must pass these on their own as well. */
  aiRules?: RobotsRule[];
  /** Seconds between page loads the site asks for (largest of Crawl-delay and Request-rate), when it asks. */
  delaySeconds?: number;
  /** `HHMM-HHMM` in UTC, when the site asks visitors to come only then. */
  visitTimeUtc?: string;
}

const seconds = (value: string) => {
  const number = Number(value.trim());
  return Number.isFinite(number) && number >= 0 && number <= 3600 ? number : undefined;
};
/** `1/10`, `1/10s`, `1/1m`: seconds per request. */
function rate(value: string) {
  const match = /^\s*(\d+)\s*\/\s*(\d+)\s*([smh])?/i.exec(value);
  if (!match || Number(match[1]) < 1) return undefined;
  const unit = { s: 1, m: 60, h: 3600 }[(match[3] ?? 's').toLowerCase() as 's' | 'm' | 'h'];
  return Math.min(3600, (Number(match[2]) * unit) / Number(match[1]));
}

export function parseRobots(text: string): Group[] {
  const groups: Group[] = [];
  let current: Group | undefined, collectingAgents = false;
  for (const raw of String(text ?? '').split(/\r\n|\r|\n/)) {
    const line = raw.replace(/#.*$/, '').trim();
    const match = /^([A-Za-z-]+)\s*:\s*(.*)$/.exec(line);
    if (!match) continue;
    const key = match[1].toLowerCase(), value = match[2].trim();
    if (key === 'user-agent') {
      if (!current || !collectingAgents) groups.push(current = { agents: [], rules: [] });
      current.agents.push(value.toLowerCase());
      collectingAgents = true;
      continue;
    }
    if (!current) continue;
    collectingAgents = false;
    if (key === 'allow' || key === 'disallow') { if (value) current.rules.push({ allow: key === 'allow', pattern: value }); }
    else if (key === 'crawl-delay') current.crawlDelay = seconds(value) ?? current.crawlDelay;
    else if (key === 'request-rate') current.requestRate = rate(value) ?? current.requestRate;
    else if (key === 'visit-time') current.visitTime = /(\d{4})\s*-\s*(\d{4})/.exec(value)?.slice(1).join('-') ?? current.visitTime;
  }
  return groups;
}

/** The rules that apply to `agent`: groups naming its product token, else `*` groups (merged, as RFC 9309 says). */
export function robotsPolicy(text: string, agent = ROBOTS_AGENT): RobotsPolicy {
  const groups = parseRobots(text), token = agent.toLowerCase();
  const own = groups.filter(group => group.agents.some(name => name !== '*' && name.split('/')[0].trim() === token));
  const chosen = own.length ? own : groups.filter(group => group.agents.includes('*'));
  const ai = groups.filter(group => group.agents.some(name => AI_CRAWLER_AGENTS.includes(name.split('/')[0].trim())));
  const aiRules = ai.flatMap(group => group.rules), withAi = aiRules.length ? { aiRules } : {};
  if (!chosen.length) return { group: 'none', rules: [], ...withAi };
  const delays = chosen.flatMap(group => [group.crawlDelay, group.requestRate]).filter((value): value is number => value !== undefined);
  const visitTimeUtc = chosen.map(group => group.visitTime).find(Boolean);
  return { group: own.length ? 'agent' : '*', rules: chosen.flatMap(group => group.rules), ...withAi, ...(delays.length ? { delaySeconds: Math.max(...delays) } : {}), ...(visitTimeUtc ? { visitTimeUtc } : {}) };
}

function patternRegex(pattern: string) {
  const anchored = pattern.endsWith('$'), body = anchored ? pattern.slice(0, -1) : pattern;
  return new RegExp('^' + body.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + (anchored ? '$' : ''));
}
/**
 * Longest matching rule wins; on a tie Allow wins; no match means allowed. `/robots.txt` is always allowed. The
 * AI-crawler rules are judged separately and must allow the URL too.
 */
export function robotsAllows(policy: RobotsPolicy, url: string): boolean {
  const target = new URL(url), path = target.pathname + target.search;
  if (target.pathname === '/robots.txt') return true;
  return allowedBy(policy.rules, path) && allowedBy(policy.aiRules ?? [], path);
}
function allowedBy(rules: RobotsRule[], path: string) {
  let best: RobotsRule | undefined;
  for (const rule of rules) {
    if (!patternRegex(rule.pattern).test(path)) continue;
    if (!best || rule.pattern.length > best.pattern.length || (rule.pattern.length === best.pattern.length && rule.allow)) best = rule;
  }
  return best?.allow ?? true;
}

/**
 * The robots.txt text in a page captured by Zoer's browser. Browsers show a text file as one `<pre>`; anything else
 * (a site's HTML error page, a check page) is not robots.txt and returns undefined.
 */
export function robotsTextFromCapture(html: string): string | undefined {
  const body = String(html ?? '').replace(/<!--[\s\S]*?-->/g, '');
  const pre = /<pre\b[^>]*>([\s\S]*?)<\/pre>/i.exec(body);
  if (!pre) return undefined;
  // Nothing but the <pre> (and empty wrappers) may be on the page.
  const outside = body.replace(pre[0], '').replace(/<[^>]*>/g, '').trim();
  if (outside) return undefined;
  return decodeEntities(pre[1].replace(/<[^>]*>/g, ''));
}

/** Minutes after UTC midnight for `HHMM`. */
const minutes = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(2, 4));
/** Whether `at` is inside a `HHMM-HHMM` UTC window (a window may wrap past midnight). Malformed windows count as closed. */
export function insideVisitTime(window: string, at: number): boolean {
  const match = /^(\d{4})-(\d{4})$/.exec(window);
  if (!match) return false;
  const start = minutes(match[1]), end = minutes(match[2]);
  if (start > 1440 || end > 1440) return false;
  const now = new Date(at), minute = now.getUTCHours() * 60 + now.getUTCMinutes();
  return start <= end ? minute >= start && minute < end : minute >= start || minute < end;
}
/** `09:00–12:00 UTC` for messages. */
export const visitTimeText = (window: string) => window.replace(/^(\d{2})(\d{2})-(\d{2})(\d{2})$/, '$1:$2–$3:$4 UTC');
