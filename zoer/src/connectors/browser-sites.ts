import { BROWSER_SITES, BROWSER_SOURCE_ID, BROWSER_PAGES_PER_SITE, type BrowserSite } from '../../dashboard/procurement/browser-sites';
import { isPauseError } from '../pause';
import { browserCheckMessage, detectBrowserCheck } from './browser-check';
import { ConnectorError } from './errors';
import { decodeEntities, htmlToText } from './html';
import { leadingNumber, parseTable, parseWallClock, readMoment, resolveUrl, type SiteRow } from './municipal-sites';
import type { Pacer } from './pacing';
import { insideVisitTime, robotsAllows, robotsPolicy, robotsTextFromCapture, visitTimeText, type RobotsPolicy } from './robots';
import type { ConnectorPortal, PortalResult, SourceConnector } from './types';

/**
 * Sites collected through the person's Zoer browser (`procurement.collect.browser`, see browser-sites.ts in the
 * dashboard for the list). Per site and run:
 *
 * 1. Outside the site's visiting hours (robots Visit-time) nothing is loaded: the site is `not-run`.
 * 2. robots.txt is read through the browser unless it was read in the last 24 hours. A path it disallows is not
 *    loaded; robots.txt that cannot be read (a check page, an error page) means the site is not collected.
 * 3. One listing page is loaded, at least the larger of the site's floor and robots Crawl-delay/Request-rate after the
 *    previous load on that host (in this run or an earlier one).
 * 4. A browser check, an access-denied page or an empty page stops the site as `waiting` with what the person should
 *    do. Nothing on a check page is clicked or answered.
 *
 * Listing pages are parsed as a table with title and closing columns (the municipal-sites reader), else as labelled
 * blocks (one block per notice with a link and a closing date), else as tables headed by a plain row of cells
 * (Chilliwack); Kelowna's Drupal view has its own reader (`views`). Chilliwack and Kelowna were confirmed against pages
 * Zoer's browser captured on 2026-10-04; a page no reader understands is a layout error, never "no notices".
 */
export const SOURCE_ID = BROWSER_SOURCE_ID;
export interface CapturedPage { url: string; title: string; html: string; capturedAt?: string; status?: number }
export type BrowserCapture = (url: string) => Promise<CapturedPage>;
export interface RobotsCacheEntry { checkedAt: string; status: 'ok' | 'missing'; text?: string }
export interface BrowserSitesContext {
  capture: BrowserCapture;
  pacer: Pacer;
  /** robots.txt per host, read this run or within ROBOTS_TTL_MS; updated in place. */
  robots: Record<string, RobotsCacheEntry>;
  nowMs: () => number;
  /**
   * Pages whose layout no reader understood, kept with the source state (bounded, scripts and styles removed) so the
   * reader can be fixed from what Zoer's browser actually saw instead of fetching the site again from elsewhere.
   */
  layoutSamples?: Record<string, LayoutSample>;
}
export interface LayoutSample { url: string; title: string; capturedAt: string; page: string; truncated: boolean }
const MAX_SAMPLE_CHARS = 60_000;
/** The page body without scripts, styles, SVG and comments, at most MAX_SAMPLE_CHARS. */
export function layoutSample(page: CapturedPage, at: string): LayoutSample {
  const body = contentOf(String(page.html ?? '').replace(/<(script|style|svg|noscript|template)\b[\s\S]*?<\/\1\s*>/gi, '')).replace(/\s+/g, ' ').trim();
  return { url: page.url, title: page.title, capturedAt: page.capturedAt ?? at, page: body.slice(0, MAX_SAMPLE_CHARS), truncated: body.length > MAX_SAMPLE_CHARS };
}
export const ROBOTS_TTL_MS = 24 * 60 * 60_000;
const MAX_ROBOTS_BYTES = 64_000;

const oneLine = (html: string) => htmlToText(html).replace(/\s*\n\s*/g, ' ').trim();
const slug = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 120);
const attr = (tag: string, name: string) => decodeEntities(new RegExp(`\\b${name}\\s*=\\s*"([^"]*)"`, 'i').exec(tag)?.[1] ?? '');

// ---------------------------------------------------------------------------------------------
// Listing pages
// ---------------------------------------------------------------------------------------------

export interface BrowserRow extends SiteRow { html: { closing?: string; posted?: string }; location?: string; buyer?: string }

/** The page without its header, menus, sidebars and footer; `<main>` when the page has one. */
export function contentOf(html: string): string {
  let page = String(html ?? '').replace(/<!--[\s\S]*?-->/g, '');
  for (const tag of ['header', 'nav', 'footer', 'aside']) {
    const innermost = new RegExp(`<${tag}\\b[^>]*>(?:(?!<${tag}\\b)[\\s\\S])*?<\\/${tag}\\s*>`, 'gi');
    for (let previous = ''; previous !== page;) { previous = page; page = page.replace(innermost, ''); }
  }
  return /<main\b[^>]*>([\s\S]*)<\/main>/i.exec(page)?.[1] ?? page;
}

// RDKB (Zoer capture 2026-10-04): an "Opportunities" heading followed by "None at the Moment".
const EMPTY = /there are (?:currently )?no (?:open |current |active )?(?:bid|tender|procurement|opportunit|rfp|rfq|solicitation)|no (?:open |current |active )?(?:bid|tender|procurement|opportunit|rfp|rfq|solicitation)[a-z ]*(?:at this time|currently|posted|available|to display)|nothing (?:is )?(?:currently )?(?:open|posted)|(?:opportunities|bids|tenders)\s*:?\s*none at (?:the|this) (?:moment|time)\b/i;
const BLOCK_START = /(?=<(?:li|article|tr|dl)\b)|(?=<div\b[^>]*\bclass="(?:[^"]*\s)?(?:views-row|card|item|list-item|listing-item|result|search-result|entry|post|opportunity|tender|bid)(?=[\s"]))/i;
const CLOSING = /^(?:(?:bid|tender|proposal|submission|quote|rfp|rfq)s?\s+)?(closing(?:\s+date)?(?:\s*(?:and|&)\s*time)?|closes(?:\s+on)?|closed|deadline|submission deadline|due(?:\s+date)?|expires|expiry(?:\s+date)?|expiration(?:\s+date)?)\s*:?\s*(.*)$/i;
const POSTED = /^(posted|issued|published|issue date|date posted|posting date|date issued|release date)\s*(?:date|on)?\s*:?\s*(.*)$/i;
const TYPE = /^(?:request for (?:proposals?|quotations?|quotes?|qualifications?|information|expressions? of interest|tenders?|standing offers?|supplier qualifications?)|invitation to (?:tender|bid|quote)|notice of intent|expression of interest|call for (?:proposals|tenders)|tender|RF[PQIES][A-Z]?|ITT|ITQ|ITB|NOI|EOI)\b/i;
const NUMBER = /^(?:bid|tender|rfp|rfq|competition|reference|file|project|solicitation|opportunity|contract)?\s*(?:no\.?|number|#|ref(?:erence)?)\s*:?\s*([A-Z0-9][A-Z0-9./ -]{0,38}[A-Z0-9])$/i;
const BUYER = /^(organization|organisation|buyer|issued by|owner|agency|purchaser|department)\s*:?\s*(.{2,100})$/i;
const LOCATION = /^(location|region|municipality|community|city)\s*:?\s*(.{2,80})$/i;
const STATUS = /^status\s*:?\s*(.{2,40})$/i;
const NOT_A_TITLE = /^(?:read more|more info(?:rmation)?|details?|view(?: details)?|download|learn more|open|pdf|login|sign in|bookmark|share)\b/i;

/** A labelled value: the rest of the line after the label, else the next line. */
function labelled(lines: string[], pattern: RegExp, needsDate = false): string | undefined {
  for (let i = 0; i < lines.length; i++) {
    const match = pattern.exec(lines[i]);
    if (!match) continue;
    const value = (match[2] ?? match[1] ?? '').trim() || lines[i + 1]?.trim() || '';
    if (value && (!needsDate || parseWallClock(value))) return value;
  }
  return undefined;
}

/**
 * Notices as repeated blocks (`li`, `article`, Drupal/WordPress rows, cards), each with a link and a labelled closing
 * date (`Closing date: …`, `Deadline: …`, `Expires: …`). Blocks without a dated closing label are not notices
 * (menus, news, contact boxes), so they are skipped.
 */
export function parseBlocks(html: string, pageUrl: string): { rows: BrowserRow[]; empty: boolean } {
  const content = contentOf(html), rows = new Map<string, BrowserRow>();
  for (const piece of content.split(BLOCK_START)) {
    const lines = htmlToText(piece).split('\n').map(line => line.trim()).filter(Boolean);
    const closing = labelled(lines, CLOSING, true);
    if (!closing) continue;
    const anchors = [...piece.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)]
      .map(match => ({ href: resolveUrl(attr(match[1], 'href'), pageUrl), text: oneLine(match[2]), html: match[0] }))
      .filter(anchor => anchor.href && anchor.text.length >= 4 && !NOT_A_TITLE.test(anchor.text));
    const heading = /<h[1-6]\b[^>]*>([\s\S]*?)<\/h[1-6]>/i.exec(piece);
    const headingLink = heading ? anchors.find(anchor => heading[1].includes(anchor.html)) : undefined;
    const bold = anchors.find(anchor => /<(?:b|strong)\b/i.test(anchor.html));
    const link = headingLink ?? bold ?? anchors[0];
    const title = (heading ? oneLine(heading[1]) : '') || link?.text || '';
    if (!title || CLOSING.test(title) || title.length > 400) continue;
    const posted = labelled(lines, POSTED, true);
    const typeLine = lines.find(line => line !== title && line.length < 80 && TYPE.test(line) && !CLOSING.test(line));
    const number = lines.map(line => NUMBER.exec(line)?.[1]).find(Boolean) ?? leadingNumber(title);
    const cells: Record<string, string> = { Title: title };
    for (const line of lines) {
      const match = /^([A-Z][A-Za-z /&]{1,30}):\s*(.{1,200})$/.exec(line);
      if (match && Object.keys(cells).length < 12) cells[match[1]] ??= match[2];
    }
    const row: BrowserRow = {
      title, href: link?.href, number, type: typeLine, status: labelled(lines, STATUS), closing, posted,
      cells, html: { closing, ...(posted ? { posted } : {}) },
      buyer: labelled(lines, BUYER), location: labelled(lines, LOCATION),
    };
    const key = row.href ?? `${row.number ?? ''}|${row.title}`;
    if (!rows.has(key)) rows.set(key, row);
  }
  if (rows.size) return { rows: [...rows.values()], empty: false };
  if (EMPTY.test(htmlToText(content))) return { rows: [], empty: true };
  throw new ConnectorError('source_layout', 'The page has no notice list Procurement can read (no table with title and closing columns, and no blocks with a link and a closing date). This site\'s layout has not been confirmed yet; saved records are kept.');
}

const isLayoutError = (error: unknown) => (error as ConnectorError)?.code === 'source_layout';
/** Status implied by the section a notice is listed under ("Current Bid Opportunities", "Recently Closed"). */
const sectionStatus = (section: string) => /^(?:current|open)\b/i.test(section) ? 'Open' : /\bclosed\b/i.test(section) ? 'Closed' : undefined;

/**
 * Tables whose column headings are an ordinary row of `<td>` cells (Chilliwack: `Title | Type | Closes`, and
 * `Title | Type | Status | Closed` for recently closed bids), every such table read with the municipal-sites table
 * reader. A one-cell row above the headings names the section; a row without a status column takes its status
 * from that name ("Current …" → Open).
 */
export function parseCellHeaderTables(html: string): BrowserRow[] {
  const rows: BrowserRow[] = [];
  for (const [table] of contentOf(html).matchAll(/<table\b[\s\S]*?<\/table>/gi)) {
    if (/<th\b/i.test(table)) continue;
    const trs = [...table.matchAll(/<tr\b[^>]*>[\s\S]*?<\/tr>/gi)].map(match => match[0]);
    for (let i = 0; i < trs.length; i++) {
      // Headings are plain text in two or more cells; data rows carry the notice links.
      if (/<a\b/i.test(trs[i]) || (trs[i].match(/<td\b/gi) ?? []).length < 2) continue;
      let parsed: ReturnType<typeof parseTable>;
      try { parsed = parseTable(`<table>${trs[i].replace(/<(\/?)td\b/gi, '<$1th')}${trs.slice(i + 1).join('')}</table>`); }
      catch (error) { if (isLayoutError(error)) continue; throw error; }
      const caption = i > 0 && (trs[i - 1].match(/<td\b/gi) ?? []).length === 1 ? oneLine(trs[i - 1]) : '';
      for (const row of parsed.rows) {
        const status = row.status ?? sectionStatus(caption);
        rows.push({ ...row, ...(status ? { status } : {}), cells: { ...(caption ? { Section: caption } : {}), ...row.cells }, html: { closing: row.html.closing, posted: row.html.posted } });
      }
      break;
    }
  }
  return rows;
}

/**
 * A Drupal view of bids without closing dates (Kelowna, Zoer capture 2026-10-04): one `views-row` per notice with a
 * `views-field-title` link (`Reference #: 13158. Name: Mechanical Contractor Services`) and a `views-field-body`
 * summary. Rows take their status from the view's heading ("Current opportunities" → Open); closing dates are only on
 * the notice pages, which are not read, so records carry none.
 */
export function parseViewRows(html: string, pageUrl: string): { rows: BrowserRow[]; empty: boolean } {
  const content = contentOf(html), start = content.search(/class="[^"]*\bview-id-[a-z_]*bid[a-z_]*\b/i);
  if (start < 0) {
    if (EMPTY.test(htmlToText(content))) return { rows: [], empty: true };
    throw new ConnectorError('source_layout', 'The page no longer has its bid list (a Drupal view of bids). This site\'s layout changed; saved records are kept.');
  }
  // The view ends at its footer or at the next view (Kelowna's contact box is a view too).
  const rest = content.slice(start + 1), end = rest.search(/class="view-footer"|class="view view-/i);
  const view = end < 0 ? rest : rest.slice(0, end);
  const heading = [...content.slice(0, start).matchAll(/<h[1-3]\b[^>]*>([\s\S]*?)<\/h[1-3]>/gi)].at(-1)?.[1];
  const listStatus = heading ? sectionStatus(oneLine(heading)) : undefined;
  const field = (part: string, name: string) => new RegExp(`<div\\b[^>]*class="[^"]*\\bviews-field-${name}\\b[^"]*"[^>]*>([\\s\\S]*?)<\\/div>`, 'i').exec(part)?.[1];
  const rows = new Map<string, BrowserRow>();
  for (const part of view.split(/<div\b[^>]*class="(?:[^"]*\s)?views-row(?=[\s"])[^"]*"[^>]*>/i).slice(1)) {
    const titleHtml = field(part, 'title') ?? '';
    const link = /<a\b([^>]*)>([\s\S]*?)<\/a>/i.exec(titleHtml);
    const published = oneLine(link ? link[2] : titleHtml);
    const named = /^Reference\s*#?\s*:?\s*([A-Z0-9][A-Z0-9-]*)\s*\.?\s*Name\s*:\s*(.+)$/i.exec(published);
    const title = named ? named[2].trim() : published;
    if (!title) continue;
    const summary = oneLine(field(part, 'body') ?? '').replace(/^Description\s*:\s*/i, '') || undefined;
    const number = named?.[1] ?? leadingNumber(title);
    const row: BrowserRow = {
      title, href: link ? resolveUrl(attr(link[1], 'href'), pageUrl) : undefined, number, status: listStatus, summary,
      cells: { Title: published, ...(summary ? { Description: summary } : {}) }, html: {},
    };
    const key = row.href ?? `${row.number ?? ''}|${row.title}`;
    if (!rows.has(key)) rows.set(key, row);
  }
  if (rows.size) return { rows: [...rows.values()], empty: false };
  if (/class="view-empty"/i.test(view) || EMPTY.test(htmlToText(view))) return { rows: [], empty: true };
  throw new ConnectorError('source_layout', 'The bid list shows no notice Procurement can read (no titled rows) and does not say it is empty. This site\'s layout changed; saved records are kept.');
}

/**
 * `auto`: a titled table with a closing column first (municipal-sites reader), then labelled blocks, then tables
 * headed by a plain row of cells (only when they hold notices, so pages the block reader already read are unchanged).
 */
export function parseBrowserListing(site: BrowserSite, html: string, pageUrl: string): { rows: BrowserRow[]; empty: boolean } {
  if (site.layout === 'views') return parseViewRows(html, pageUrl);
  if (site.layout === 'auto') {
    try {
      const table = parseTable(contentOf(html));
      return { rows: table.rows.map(row => ({ ...row, html: { closing: row.html.closing, posted: row.html.posted } })), empty: table.empty };
    } catch (error) { if (!isLayoutError(error)) throw error; }
  }
  try { return parseBlocks(html, pageUrl); }
  catch (error) {
    if (site.layout !== 'auto' || !isLayoutError(error)) throw error;
    const rows = parseCellHeaderTables(html);
    if (rows.length) return { rows, empty: false };
    throw error;
  }
}

// ---------------------------------------------------------------------------------------------
// Records
// ---------------------------------------------------------------------------------------------

/**
 * The site's own id for a notice: the last path segment of its link plus id-like query values
 * (`bids?bidid=11037` → `bids-bidid-11037`), else its number, else its title.
 */
export function browserNoticeId(row: Pick<SiteRow, 'href' | 'number' | 'title'>, base: string): string | undefined {
  const url = row.href ? resolveUrl(row.href, base) : undefined;
  if (url) {
    const parsed = new URL(url), last = parsed.pathname.replace(/\.html?$/i, '').split('/').filter(Boolean).at(-1) ?? '';
    const ids = [...parsed.searchParams].filter(([key, value]) => /id$|^(?:p|page|nid|ref|no)$/i.test(key) || /^\d{2,}$/.test(value)).sort(([a], [b]) => a.localeCompare(b));
    const id = slug([last, ...ids.flat()].join('-'));
    // A link back to the listing itself identifies nothing.
    if (id && url.split('#')[0] !== base.split('#')[0]) return id;
  }
  return slug(row.number ?? leadingNumber(row.title) ?? row.title) || undefined;
}
const CLOSED = /closed|award|cancel|evaluat|review|no award|shortlist/i;

export function browserRecord(row: BrowserRow, site: BrowserSite, pageUrl: string, retrievedAt: string) {
  const id = browserNoticeId(row, pageUrl)!, key = `${SOURCE_ID}:${site.id}:${id}`;
  const detailUrl = (row.href && resolveUrl(row.href, pageUrl)) || site.url;
  const closing = row.html.closing !== undefined ? readMoment(row.html.closing, site.timeZone) : undefined;
  const posted = row.html.posted !== undefined ? readMoment(row.html.posted, site.timeZone) : undefined;
  const number = row.number ?? leadingNumber(row.title);
  const sourceStatus = row.status;
  const derived = !sourceStatus && closing?.precision === 'instant' ? (Date.parse(closing.at!) < Date.parse(retrievedAt) ? 'Closed' : 'Open') : undefined;
  const status = sourceStatus ?? derived ?? 'Unknown';
  const issuedBy = row.buyer ?? (site.aggregator ? '' : site.label);
  const region = site.place.municipality ?? site.place.regionalDistrict ?? row.location ?? null;
  const descriptionText = row.summary ?? '';
  const fields: [string, string | undefined][] = [
    ['Source', `${site.label} website (collected in your Zoer browser)`], ['Notice number', number], ['Status', sourceStatus], ['Type', row.type],
    ['Buyer (source value)', row.buyer], ['Location (source value)', row.location],
    ['Closing date (source value)', closing?.text], ['Posted (source value)', posted?.text],
  ];
  return {
    sourceId: SOURCE_ID, sourceKey: key, processId: key, opportunityId: key, portalId: site.id,
    externalId: number ?? id, description: row.title, descriptionText, sourceDescriptionText: descriptionText,
    issuedBy, status, ...(derived ? { statusDerivedFrom: 'closingAt' } : {}), type: row.type ?? '',
    closingDate: closing?.text ?? '', ...(closing?.at ? { closingAt: closing.at } : {}), ...(posted?.at ? { publishedAt: posted.at } : {}),
    detailUrl, sourceUrl: site.url, region, place: { ...site.place },
    sourceFields: fields.filter(([, value]) => value).map(([label, value]) => ({ label, value: value! })),
    sourceRetrievedAt: retrievedAt, rawSourceData: { cells: row.cells, href: row.href ?? null, page: pageUrl },
    searchText: [number, row.title, descriptionText.slice(0, 4000), issuedBy || site.label, row.location, status, row.type, region].filter(Boolean).join(' '),
    attachments: [], addenda: [], detailFields: [], commodities: [],
  };
}

// ---------------------------------------------------------------------------------------------
// One site
// ---------------------------------------------------------------------------------------------

const isBudgetError = (error: unknown) => (error as any)?.code === 'network_limit' || (error as any)?.code === 'browser_limit' || /budget exhausted|network_limit|browser_limit/i.test(String((error as Error)?.message ?? ''));
const UNAVAILABLE = /unavailable or under manual control|resume the agent|a selected browser is required|select a running zoer browser/i;

function outsideHours(site: BrowserSite, window: string, url: string): ConnectorError {
  return new ConnectorError('outside_visit_window', `${site.label} asks automated visitors to come only between ${visitTimeText(window)} (its robots.txt Visit-time). Nothing was loaded; collect it again inside that window. ${url}`, 'not-run');
}

/** robots.txt for the site's host, read through the browser unless a reading from the last 24 hours is kept. */
async function robotsFor(ctx: BrowserSitesContext, site: BrowserSite, load: (url: string) => Promise<CapturedPage>): Promise<RobotsPolicy> {
  const cached = ctx.robots[site.host];
  if (cached && ctx.nowMs() - Date.parse(cached.checkedAt) < ROBOTS_TTL_MS && Date.parse(cached.checkedAt) <= ctx.nowMs()) {
    return cached.status === 'missing' ? { group: 'none', rules: [] } : robotsPolicy(cached.text ?? '');
  }
  const url = `https://${site.host}/robots.txt`, page = await load(url);
  const checkedAt = new Date(ctx.nowMs()).toISOString();
  // A missing robots.txt (404/410) allows everything; any other error status means the rules are unknown.
  if (page.status === 404 || page.status === 410) { ctx.robots[site.host] = { checkedAt, status: 'missing' }; return { group: 'none', rules: [] }; }
  const text = page.status === undefined || page.status === 200 ? robotsTextFromCapture(page.html) : undefined;
  if (text === undefined) {
    const check = detectBrowserCheck(page);
    if (check && check.kind !== 'empty') throw new ConnectorError('browser_check', browserCheckMessage(site.label, url, check), 'waiting');
    throw new ConnectorError('robots_unreadable', `${site.label}'s robots.txt could not be read${page.status ? ` (HTTP ${page.status})` : ''}, so Procurement does not know what the site allows and did not load its bids page. Saved records are kept.`);
  }
  ctx.robots[site.host] = { checkedAt, status: 'ok', text: text.slice(0, MAX_ROBOTS_BYTES) };
  return robotsPolicy(text);
}

export async function collectBrowserSite(ctx: BrowserSitesContext, portal: ConnectorPortal, context: { now: () => string }): Promise<PortalResult> {
  const site = BROWSER_SITES.find(candidate => candidate.id === portal.id);
  if (!site) throw new ConnectorError('source_config', `Unknown browser site ${portal.id}.`);
  let delaySeconds = site.minDelaySeconds, window = site.visitTimeUtc;
  // Static and cached windows are checked before anything is loaded, robots.txt included.
  const cachedWindow = ctx.robots[site.host]?.text ? robotsPolicy(ctx.robots[site.host].text!).visitTimeUtc : undefined;
  for (const value of [window, cachedWindow]) if (value && !insideVisitTime(value, ctx.nowMs())) throw outsideHours(site, value, site.url);
  const load = async (url: string): Promise<CapturedPage> => {
    await ctx.pacer.wait(site.host, delaySeconds);
    // A wait can cross the end of the window.
    if (window && !insideVisitTime(window, ctx.nowMs())) throw outsideHours(site, window, url);
    try {
      const page = await ctx.capture(url);
      if (!page || typeof page.html !== 'string' || typeof page.url !== 'string') throw new ConnectorError('browser_capture', `Zoer returned no page for ${url}.`);
      return page;
    } catch (error) {
      if (isPauseError(error) || isBudgetError(error) || error instanceof ConnectorError) throw error;
      const message = String((error as Error)?.message ?? error);
      if (UNAVAILABLE.test(message)) throw new ConnectorError('browser_unavailable', `Zoer's browser was not available to Procurement (${message.slice(0, 160)}). If you are using it, return control to Procurement; otherwise start the browser chosen in Procurement's settings. Then collect again.`, 'waiting');
      throw new ConnectorError('browser_capture', `${site.label} could not be loaded in Zoer's browser: ${message.slice(0, 300)}`);
    }
  };
  const robots = await robotsFor(ctx, site, load);
  delaySeconds = Math.max(site.minDelaySeconds, robots.delaySeconds ?? 0);
  if (robots.visitTimeUtc) {
    window = robots.visitTimeUtc;
    if (!insideVisitTime(window, ctx.nowMs())) throw outsideHours(site, window, site.url);
  }
  if (!robotsAllows(robots, site.url)) throw new ConnectorError('robots_disallowed', `${site.label}'s robots.txt does not allow ${new URL(site.url).pathname}, so its bids page was not loaded. Check it yourself: ${site.url}`);
  const page = await load(site.url);
  const check = detectBrowserCheck(page);
  if (check) throw new ConnectorError('browser_check', browserCheckMessage(site.label, site.url, check), 'waiting');
  const final = new URL(page.url);
  if (final.hostname !== site.host) throw new ConnectorError('source_redirect', `${site.label} sent the browser to ${final.hostname} instead of its bids page. Saved records are kept.`);
  if (!robotsAllows(robots, page.url)) throw new ConnectorError('robots_disallowed', `${site.label} redirected to ${final.pathname}, which its robots.txt does not allow. Nothing from it was saved.`);
  if (page.status !== undefined && page.status !== 200) throw new ConnectorError(page.status === 404 ? 'source_not_found' : 'source_http_error', `${site.label}'s bids page answered HTTP ${page.status}. Saved records are kept.`);
  const retrievedAt = page.capturedAt && Number.isFinite(Date.parse(page.capturedAt)) ? new Date(Date.parse(page.capturedAt)).toISOString() : context.now();
  let parsed: ReturnType<typeof parseBrowserListing>;
  try { parsed = parseBrowserListing(site, page.html, page.url); delete ctx.layoutSamples?.[site.id]; }
  catch (error) {
    if ((error as ConnectorError)?.code === 'source_layout' && ctx.layoutSamples) ctx.layoutSamples[site.id] = layoutSample(page, context.now());
    throw error;
  }
  const records = new Map<string, ReturnType<typeof browserRecord>>(), warnings: string[] = [];
  let unkeyed = 0;
  for (const row of parsed.rows) {
    if (!browserNoticeId(row, page.url)) { unkeyed++; continue; }
    const record = browserRecord(row, site, page.url, retrievedAt);
    if (!records.has(record.sourceKey)) records.set(record.sourceKey, record);
  }
  if (unkeyed) warnings.push(`${unkeyed} listed notice(s) had no link, number or title to identify them and were skipped.`);
  if (!site.verified) warnings.push(`${site.label}'s page layout has not been confirmed yet; check a few saved notices against ${site.url}.`);
  // One listing page per run; the site prints no total Procurement can trust, so the total stays unknown.
  return { portalId: site.id, records: [...records.values()], warnings };
}

export function browserSitesConnector(ctx: BrowserSitesContext): SourceConnector {
  return {
    id: SOURCE_ID,
    label: 'BC sites collected in your browser',
    jurisdiction: 'British Columbia',
    coverage: `The bids page of ${BROWSER_SITES.length} BC procurement sites that block plain automated requests (${BROWSER_SITES.map(site => site.label).join(', ')}), loaded in your Zoer browser one page at a time, spaced as each site's robots.txt asks. A site that shows a browser check waits for you to complete it. Notice pages and files are not read. A notice missing from a later listing is kept; absence is not proof of closure.`,
    portals: BROWSER_SITES,
    requestsPerPortal: BROWSER_PAGES_PER_SITE,
    needsSession: false,
    collectPortal: (_fetch, portal, context) => collectBrowserSite(ctx, portal, context),
  };
}
