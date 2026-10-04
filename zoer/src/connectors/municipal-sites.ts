import { SITE_PORTALS, type SitePortal } from '../../dashboard/procurement/site-portals';
import { isPauseError } from '../pause';
import { ConnectorError, httpFailure } from './errors';
import { decodeEntities, htmlToText } from './html';
import type { ConnectorPortal, NetFetch, NoticeContact, PortalResult, SourceConnector } from './types';

/**
 * BC local governments that list bids on their own websites (Drupal views, eSolutions, Surrey's tender search).
 * One portal = one buyer's listing page, read as server-rendered HTML with plain GETs (no session, no scripts).
 *
 * 1. GET the listing, following `rel="next"` pages up to MAX_PAGES.
 * 2. GET the notice page of each notice that is not already closed (up to MAX_DETAILS) for the description,
 *    contacts and document links. A notice page that cannot be read leaves that record with listing fields only.
 *
 * Times: `closingAt` is an instant only when the page states the zone, either machine-readably (`<time datetime>`
 * whose wall-clock time in the buyer's zone equals the time printed beside it) or in words ("local time", "PDT").
 * Otherwise it is the calendar date alone, which the dashboard judges by date and labels "time unverified".
 */
export const SOURCE_ID = 'municipal-sites';
const MAX_PAGES = 3;
/** Notice pages read per portal per run; the busiest of these sites listed 13 open notices on 2026-10-03. */
const MAX_DETAILS = 25;

const oneLine = (html: string) => htmlToText(html).replace(/\s*\n\s*/g, ' ').trim();
const attr = (tag: string, name: string) => decodeEntities(new RegExp(`\\b${name}\\s*=\\s*"([^"]*)"`, 'i').exec(tag)?.[1] ?? '');
/** An https URL on the web, resolved against the page; anything else (mailto:, javascript:, credentials) is dropped. */
export function resolveUrl(href: string, base: string): string | undefined {
  try {
    const url = new URL(href.trim(), base);
    return url.protocol === 'https:' && !url.username && !url.password ? url.href : undefined;
  } catch { return undefined; }
}

// ---------------------------------------------------------------------------------------------
// Dates and zones
// ---------------------------------------------------------------------------------------------

const MONTHS: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12 };
const pad = (n: number) => String(n).padStart(2, '0');
const validDay = (y: number, m: number, d: number) => {
  const date = new Date(Date.UTC(y, m - 1, d));
  return m >= 1 && m <= 12 && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
};

export interface WallClock { date: string; hour?: number; minute?: number }
/**
 * Date and optional time printed on these sites: `October 27, 2026 at 3:00 PM`, `Oct 1, 2026 | 12:00 pm`,
 * `OCtober 16th, 2026 - 3:00 p.m.`, `10/14/26 2:00 pm` (only with `slash: 'mdy'`), `Tue, 10/27/2026 - 15:00`.
 */
export function parseWallClock(text: string, slash?: 'mdy'): WallClock | undefined {
  const value = text.replace(/\s+/g, ' ');
  let y = 0, m = 0, d = 0;
  const named = /\b(jan|feb|mar|apr|may|jun|jul|aug|sept?|oct|nov|dec)[a-z]*\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s*(\d{4})\b/i.exec(value);
  const slashed = slash === 'mdy' ? /\b(\d{1,2})\/(\d{1,2})\/(\d{4}|\d{2})\b/.exec(value) : null;
  const iso = /\b(\d{4})-(\d{2})-(\d{2})\b/.exec(value);
  if (named) [y, m, d] = [Number(named[3]), MONTHS[named[1].toLowerCase()], Number(named[2])];
  else if (slashed) [y, m, d] = [Number(slashed[3].length === 2 ? `20${slashed[3]}` : slashed[3]), Number(slashed[1]), Number(slashed[2])];
  else if (iso) [y, m, d] = [Number(iso[1]), Number(iso[2]), Number(iso[3])];
  else return undefined;
  if (!validDay(y, m, d)) return undefined;
  return { date: `${y}-${pad(m)}-${pad(d)}`, ...timeOf(value) };
}
/** Clock time in `3:00 PM`, `2:00pm`, `3:00 p.m.` or 24-hour `15:00` form. */
export function timeOf(text: string): { hour: number; minute: number } | {} {
  const twelve = /\b(\d{1,2}):(\d{2})\s*([ap])\.?\s*m\b\.?/i.exec(text);
  if (twelve) {
    const h = Number(twelve[1]), min = Number(twelve[2]);
    return h < 1 || h > 12 || min > 59 ? {} : { hour: (h % 12) + (twelve[3].toLowerCase() === 'p' ? 12 : 0), minute: min };
  }
  const day = /\b([01]?\d|2[0-3]):([0-5]\d)\b/.exec(text.replace(/\b\d{1,2}\/\d{1,2}\/\d{2,4}\b/, ''));
  return day ? { hour: Number(day[1]), minute: Number(day[2]) } : {};
}

const formatters = new Map<string, Intl.DateTimeFormat>();
function partsIn(ms: number, zone: string) {
  let f = formatters.get(zone);
  if (!f) formatters.set(zone, f = new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }));
  const p = Object.fromEntries(f.formatToParts(ms).filter(x => x.type !== 'literal').map(x => [x.type, Number(x.value)]));
  return { y: p.year, m: p.month, d: p.day, h: p.hour, min: p.minute, s: p.second };
}
/** `ms` as ISO with the zone's offset at that instant, e.g. `2026-10-27T15:00:00-07:00`. */
export function zonedIso(ms: number, zone: string): string {
  const p = partsIn(ms, zone);
  const offset = Math.round((Date.UTC(p.y, p.m - 1, p.d, p.h, p.min, p.s) - Math.floor(ms / 1000) * 1000) / 60000);
  const sign = offset < 0 ? '-' : '+', abs = Math.abs(offset);
  return `${p.y}-${pad(p.m)}-${pad(p.d)}T${pad(p.h)}:${pad(p.min)}:${pad(p.s)}${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
}
/** The instant of a wall-clock time in `zone` (offset from Intl, so daylight saving is handled); undefined in a DST gap. */
export function wallClockInstant(clock: WallClock, zone: string): string | undefined {
  if (clock.hour === undefined || clock.minute === undefined) return undefined;
  const [y, m, d] = clock.date.split('-').map(Number);
  const guess = Date.UTC(y, m - 1, d, clock.hour, clock.minute);
  let ms = guess;
  for (let i = 0; i < 2; i++) {
    const p = partsIn(ms, zone);
    ms = guess - (Date.UTC(p.y, p.m - 1, p.d, p.h, p.min) - ms);
  }
  const p = partsIn(ms, zone);
  return p.y === y && p.m === m && p.d === d && p.h === clock.hour && p.min === clock.minute ? zonedIso(ms, zone) : undefined;
}
const ABBREVIATIONS: Record<string, string> = { PST: '-08:00', PDT: '-07:00', MST: '-07:00', MDT: '-06:00' };

export interface Moment { text: string; at?: string; precision: 'instant' | 'date' | 'none' }
/**
 * A date cell or value as source text plus what can be claimed about it. `<time datetime>` counts only when its
 * instant, shown in the buyer's zone, has the same date and time as the page prints: then it is an instant.
 */
export function readMoment(html: string, zone: string, slash?: 'mdy'): Moment {
  const text = oneLine(html);
  const clock = parseWallClock(text, slash);
  for (const [, tag, inner] of html.matchAll(/(<time\b[^>]*>)([\s\S]*?)<\/time>/gi)) {
    const datetime = attr(tag, 'datetime'), shownText = oneLine(inner);
    const shown = timeOf(shownText) as { hour?: number; minute?: number };
    // A time-only element (Penticton's `2:00pm`) is checked against the date printed elsewhere in the cell.
    const date = parseWallClock(shownText, slash)?.date ?? clock?.date;
    if (shown.hour === undefined || !date || !/(?:Z|[+-]\d{2}:\d{2})$/i.test(datetime)) continue;
    const ms = Date.parse(datetime);
    if (!Number.isFinite(ms)) continue;
    const p = partsIn(ms, zone);
    if (p.h === shown.hour && p.min === shown.minute && date === `${p.y}-${pad(p.m)}-${pad(p.d)}`) return { text, at: zonedIso(ms, zone), precision: 'instant' };
  }
  if (!clock) return { text, precision: 'none' };
  const abbreviation = /\b(PST|PDT|MST|MDT)\b/.exec(text)?.[1];
  if (abbreviation && clock.hour !== undefined) {
    return { text, at: `${clock.date}T${pad(clock.hour)}:${pad(clock.minute!)}:00${ABBREVIATIONS[abbreviation]}`, precision: 'instant' };
  }
  const stated = /\blocal time\b|\bpacific(?: time)?\b|\bPT\b/i.test(text);
  const pacific = /\bpacific\b|\bPT\b/i.test(text) ? 'America/Vancouver' : zone;
  const at = stated ? wallClockInstant(clock, pacific) : undefined;
  return at ? { text, at, precision: 'instant' } : { text, at: clock.date, precision: 'date' };
}

// ---------------------------------------------------------------------------------------------
// Listings
// ---------------------------------------------------------------------------------------------

export interface SiteRow {
  title: string; href?: string; number?: string; type?: string; status?: string; awarded?: string; summary?: string;
  closing?: string; posted?: string; updated?: string;
  /** Header → cell text, as published. */
  cells: Record<string, string>;
}
type Role = 'title' | 'number' | 'posted' | 'updated' | 'closing' | 'status' | 'type' | 'awarded';
const ROLES: [Role, RegExp][] = [
  ['title', /title|bid opportunit|^opportunit/i], ['number', /number|reference|competition|file no/i],
  ['posted', /posted|issue/i], ['updated', /updated|modified/i], ['closing', /closing|closes|closed/i],
  ['status', /status/i], ['type', /^type$/i], ['awarded', /award/i],
];
/** Pages that say so are an empty list; anything else without a listing is a layout change, never "no notices". */
const EMPTY = /There are no results|no (?:open|current) (?:bid|tender|opportunit)[a-z ]*(?:at this time|posted)|No (?:bids|tenders|opportunities) (?:are )?(?:currently )?(?:available|posted)/i;

const cellsOf = (row: string) => [...row.matchAll(/<(t[dh])\b[^>]*>([\s\S]*?)<\/\1>/gi)].map(m => m[2]);

/** The first table with a title and a closing column, rows keyed by header role. */
export function parseTable(html: string): { rows: Array<SiteRow & { html: Partial<Record<Role, string>> }>; empty: boolean } {
  for (const [table] of html.matchAll(/<table\b[\s\S]*?<\/table>/gi)) {
    const rows = [...table.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)].map(m => m[1]);
    const headerIndex = rows.findIndex(row => /<th\b/i.test(row));
    if (headerIndex < 0) continue;
    const headers = cellsOf(rows[headerIndex]).map(oneLine);
    const roles = new Map<number, Role>(), taken = new Set<Role>();
    headers.forEach((header, i) => {
      const role = ROLES.find(([name, test]) => !taken.has(name) && test.test(header))?.[0];
      if (role) { roles.set(i, role); taken.add(role); }
    });
    if (!taken.has('title') || !taken.has('closing')) continue;
    const parsed = rows.slice(headerIndex + 1).map(row => cellsOf(row)).filter(cells => cells.length === headers.length).map(cells => {
      const byRole: Partial<Record<Role, string>> = {};
      cells.forEach((cell, i) => { const role = roles.get(i); if (role) byRole[role] = cell; });
      const titleHtml = byRole.title ?? '';
      const link = /<a\b([^>]*)>([\s\S]*?)<\/a>/i.exec(titleHtml);
      // SRD prints the issue date inside the title cell; Penticton prints the number after the link.
      const issue = /<div\b[^>]*>[\s\S]*?Issue Date[\s\S]*?<\/div>/i.exec(titleHtml)?.[0];
      const bare = issue ? titleHtml.replace(issue, '') : titleHtml;
      const title = link ? oneLine(link[2]) : oneLine(bare);
      const trailing = link ? oneLine(bare.replace(link[0], '')) : '';
      const value = (role: Role) => byRole[role] !== undefined ? oneLine(byRole[role]!) : undefined;
      const number = value('number') ?? (trailing || undefined);
      return {
        title, href: link ? attr(link[1], 'href') || undefined : undefined,
        number: number && number !== '--' ? number : undefined, type: value('type') || undefined,
        status: value('status') || undefined, awarded: value('awarded') && value('awarded') !== '--' ? value('awarded') : undefined,
        closing: value('closing'), posted: value('posted') ?? (issue ? oneLine(issue).replace(/^Issue Date:\s*/i, '') : undefined), updated: value('updated'),
        cells: Object.fromEntries(headers.map((header, i) => [header || `Column ${i + 1}`, oneLine(cells[i])])),
        html: { ...byRole, ...(issue && !byRole.posted ? { posted: issue } : {}) },
      };
    }).filter(row => row.title);
    return { rows: parsed, empty: parsed.length === 0 };
  }
  if (EMPTY.test(htmlToText(html))) return { rows: [], empty: true };
  throw new ConnectorError('source_layout', 'The bids page no longer has a table with title and closing columns. The site layout changed; saved records are kept.');
}

/** Surrey's tender search: one card per notice (number, title, summary, type/status/year tags, Details link). */
export function parseCards(html: string): { rows: Array<SiteRow & { html: Partial<Record<Role, string>> }>; empty: boolean } {
  const parts = html.split(/<div\b[^>]*class="listing-view__item-body"[^>]*>/i).slice(1);
  const rows = parts.map(part => {
    const body = part.split(/<div\b[^>]*listing-view__item-link/i)[0];
    const link = /<div\b[^>]*listing-view__item-link[^>]*>\s*<a\b([^>]*)>/i.exec(part);
    const heading = /<h4\b[^>]*>([\s\S]*?)<\/h4>/i.exec(body);
    const tags = [...body.matchAll(/<span\b[^>]*class="tag"[^>]*>([\s\S]*?)<\/span>/gi)].map(m => oneLine(m[1]));
    const number = heading ? oneLine(body.slice(0, heading.index)) : '';
    const summary = heading ? oneLine(body.slice(heading.index + heading[0].length).replace(/<div\b[^>]*class="tags"[\s\S]*$/i, '')) : '';
    return {
      title: heading ? oneLine(heading[1]) : '', href: link ? attr(link[1], 'href') || undefined : undefined,
      number: number || undefined, type: tags[0], status: tags[1], summary: summary || undefined,
      cells: { Number: number, Title: heading ? oneLine(heading[1]) : '', Tags: tags.join(' · ') }, html: {},
    };
  }).filter(row => row.title && row.href);
  if (rows.length) return { rows, empty: false };
  if (EMPTY.test(htmlToText(html)) || /class="view-empty"/i.test(html)) return { rows: [], empty: true };
  throw new ConnectorError('source_layout', 'The tender search no longer shows notice cards. The site layout changed; saved records are kept.');
}

/** `rel="next"` page on the same host, if any. */
export function nextPage(html: string, current: string): string | undefined {
  const tag = /<a\b[^>]*\brel="next"[^>]*>/i.exec(html)?.[0];
  const url = tag && resolveUrl(attr(tag, 'href'), current);
  return url && new URL(url).host === new URL(current).host ? url : undefined;
}

// ---------------------------------------------------------------------------------------------
// Notice pages
// ---------------------------------------------------------------------------------------------

export interface NoticePage {
  description?: string; closing?: string; closingHtml?: string; number?: string; status?: string;
  contacts: NoticeContact[]; documents: Array<{ name: string; url: string }>; fields: Array<{ label: string; value: string }>;
}
const LABELS = [
  // eSolutions labels carry a class; plain bold text ending in a colon is part of a description.
  /<strong\b[^>]*class="[^"]*title[^"]*"[^>]*>\s*([^<]{2,60}?)\s*:\s*<\/strong>/gi,
  /<h4\b[^>]*>\s*([^<]{2,60}?)\s*<\/h4>/gi,
  /<div\b[^>]*class="field__label"[^>]*>\s*([^<]{2,60}?)\s*<\/div>/gi,
  /<span\b[^>]*class="views-label\b[^"]*"[^>]*>\s*([^<]{2,60}?)\s*<\/span>/gi,
  /<div\b[^>]*class="view-header"[^>]*>\s*([^<]{2,60}?)\s*<\/div>/gi,
];
const KEYS: Record<string, keyof NoticePage | 'skip'> = {
  description: 'description', contactinformation: 'contacts', contact: 'contacts', contacts: 'contacts', documents: 'documents', addendum: 'documents', addenda: 'documents',
  closingdate: 'closing', closingtime: 'closing', status: 'status', competitionnumber: 'number',
  tendertitle: 'skip', tenderrfptitle: 'skip', posteddate: 'skip', share: 'skip',
};
const FILE = /\.(pdf|docx?|xlsx?|zip|dwg|pptx?)(?:[?#]|$)|\/filepro\/document|\/sites\/default\/files\/|\/assets\//i;

/**
 * Labelled sections of a notice page (eSolutions `<strong>Label:</strong>`, Drupal field and view labels, Surrey's
 * `<h4>`). Only the notice itself is read: menus, sidebars and everything after the content end are dropped.
 */
export function parseNoticePage(html: string, pageUrl: string): NoticePage | undefined {
  const start = html.search(/<h1\b/i);
  if (start < 0) return undefined;
  let region = html.slice(start);
  const end = region.search(/<!--\s*ZOOMSTOP\s*-->|<\/main>|<footer\b|id="share-links"/i);
  if (end > 0) region = region.slice(0, end);
  region = region.replace(/<(nav|aside|script|style|svg)\b[\s\S]*?<\/\1\s*>/gi, '')
    // Drupal body fields and Surrey's text block are the description even without a label.
    .replace(/<div\b[^>]*class="[^"]*(?:field--name-body|section__content wysiwyg)[^"]*"[^>]*>/gi, '\u0001Description\u0002$&');
  for (const pattern of LABELS) region = region.replace(pattern, (_, label: string) => `\u0001${decodeEntities(label)}\u0002`);
  const pieces = region.split(/\u0001([^\u0002]*)\u0002/);
  const page: NoticePage = { contacts: [], documents: [], fields: [] };
  const descriptions: string[] = [], links: string[] = [];
  for (let i = 1; i < pieces.length; i += 2) {
    const label = pieces[i].trim(), body = pieces[i + 1] ?? '', key = KEYS[label.toLowerCase().replace(/[^a-z]/g, '')];
    const text = htmlToText(body);
    if (key === 'description') { if (text) descriptions.push(text); links.push(body); }
    else if (key === 'contacts') { page.contacts.push(...contactsFrom(text, 'detail-field')); links.push(body); }
    else if (key === 'documents') links.push(body);
    else if (key === 'closing') {
      // Only the first value: Surrey adds "Revised <date>" below the closing date.
      page.closingHtml = body.split(/<\/(?:div|p)\s*>|<br\s*\/?>/i).find(part => htmlToText(part)) ?? body;
      page.closing = text.split('\n')[0];
    }
    else if (key === 'status') page.status = text.split('\n')[0];
    else if (key === 'number') page.number = text.split('\n')[0] !== '--' ? text.split('\n')[0] : undefined;
    else if (key !== 'skip' && text && text !== '--' && text.length <= 300 && page.fields.length < 10) page.fields.push({ label, value: text.split('\n')[0] });
  }
  if (descriptions.length) page.description = descriptions.join('\n\n').slice(0, 20_000);
  if (!page.contacts.length && page.description) page.contacts.push(...contactsFrom(page.description, 'description'));
  const seen = new Set<string>();
  for (const [, tag, inner] of links.join('\n').matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)) {
    const url = resolveUrl(attr(tag, 'href'), pageUrl);
    if (!url || !FILE.test(url) || seen.has(url)) continue;
    seen.add(url);
    page.documents.push({ name: (oneLine(inner) || attr(tag, 'title') || decodeURIComponent(url.split('/').pop() ?? '')).slice(0, 300), url });
  }
  return page.closing || page.description || page.status || page.documents.length || page.contacts.length ? page : undefined;
}

const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;
const PHONE = /(?:\+?1[\s.-]?)?\(?\b\d{3}\)?[\s.-]?\d{3}[\s.-]\d{4}\b/;
const NOT_A_NAME = /\b(city|district|regional|town|village|department|services?|manager|coordinator|officer|director|supervisor|technologist|engineer|purchasing|procurement|program|operations|finance|division|the|of|and|tel|email|phone|fax)\b/i;
const nameLike = (line: string) => /^[A-Z][A-Za-z'’.-]+(?:\s+[A-Z][A-Za-z'’.-]+){1,3}$/.test(line) && line.length <= 40 && !NOT_A_NAME.test(line);
/**
 * Contacts as published: each email (or, without one, a phone) with the person's name when a name-shaped line
 * (`Zack Randell, Engineering Technologist`) precedes it. Addresses hidden by a site's email protection are not decoded.
 */
export function contactsFrom(text: string, source: NoticeContact['source']): NoticeContact[] {
  const lines = text.split('\n').map(line => line.trim()).filter(Boolean);
  const contacts: NoticeContact[] = [];
  let block: string[] = [];
  const flush = () => {
    const email = block.map(line => EMAIL.exec(line)?.[0]).find(Boolean);
    const phone = block.map(line => PHONE.exec(line.replace(EMAIL, ''))?.[0]).find(Boolean);
    let name: string | undefined, role: string | undefined;
    for (let i = 0; i < block.length && !name; i++) {
      const [head, ...rest] = block[i].replace(/,\s*$/, '').split(/,\s*/);
      if (nameLike(head)) {
        name = head;
        const next = block[i + 1];
        const after = rest.join(', ');
        role = (after && !/\d|@/.test(after) ? after : undefined) || (next && !EMAIL.test(next) && !PHONE.test(next) && !/\d/.test(next) && /\b(manager|coordinator|officer|director|supervisor|technologist|engineer|analyst|specialist|buyer|clerk|lead|superintendent|planner|advisor)\b/i.test(next) ? next : undefined);
      }
    }
    if (email || (phone && name)) contacts.push({ ...(name ? { name } : {}), ...(email ? { email: email.toLowerCase() } : {}), ...(phone ? { phone } : {}), ...(role ? { role } : {}), source });
    block = [];
  };
  for (const line of lines) {
    block.push(line);
    if (EMAIL.test(line)) flush();
  }
  if (block.length && source === 'detail-field') flush();
  return contacts.slice(0, 5);
}

// ---------------------------------------------------------------------------------------------
// Records
// ---------------------------------------------------------------------------------------------

/** Notice number at the start of a title: `26-036 GNPCC …`, `RFP-08-26 Cortes …`, `RFQ 07-25 Supply …`. */
export function leadingNumber(title: string): string | undefined {
  return /^((?:[A-Z]{2,6}[\s-]?)?\d[\dA-Z]*(?:-[\dA-Z]+)+)(?=\s|$)/.exec(title.trim())?.[1];
}
const slug = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 120);
/** The portal's own id for a notice: its page path (`node-28806`, `electric-utility-scada-digital-mimic`) or its number. */
export function noticeId(portal: SitePortal, row: SiteRow): string | undefined {
  if (portal.keyBy === 'link') {
    const url = row.href && resolveUrl(row.href, portal.url);
    if (!url) return undefined;
    const segments = new URL(url).pathname.replace(/\.html?$/i, '').split('/').filter(Boolean), last = segments.at(-1) ?? '';
    return slug(segments.at(-2) === 'node' ? `node-${last}` : last) || undefined;
  }
  // Rows without a number (SRD's asset disposals) fall back to their title, which they keep while listed.
  return slug(row.number ?? leadingNumber(row.title) ?? row.title) || undefined;
}
const CLOSED = /closed|award|cancel|evaluat|review|sold|no award|shortlist|challenge/i;

export function siteRecord(row: SiteRow & { html: Partial<Record<Role, string>> }, portal: SitePortal, retrievedAt: string, page?: NoticePage) {
  const id = noticeId(portal, row)!, key = `${SOURCE_ID}:${portal.id}:${id}`;
  const detailUrl = (row.href && resolveUrl(row.href, portal.url)) || portal.url;
  const closingHtml = row.html.closing ?? (row.closing === undefined ? page?.closingHtml : undefined);
  const closing = closingHtml !== undefined ? readMoment(closingHtml, portal.timeZone, portal.slashDates) : undefined;
  const posted = row.html.posted !== undefined ? readMoment(row.html.posted, portal.timeZone, portal.slashDates) : undefined;
  const number = row.number ?? page?.number ?? leadingNumber(row.title);
  const sourceStatus = row.status ?? portal.listStatus;
  // Without a published status, a verified closing instant is the only basis for open/closed.
  const derived = !sourceStatus && closing?.precision === 'instant' ? (Date.parse(closing.at!) < Date.parse(retrievedAt) ? 'Closed' : 'Open') : undefined;
  const status = sourceStatus ?? derived ?? 'Unknown';
  const descriptionText = page?.description ?? row.summary ?? '';
  const region = portal.place.municipality ?? portal.place.regionalDistrict ?? null;
  const fields: [string, string | undefined][] = [
    ['Source', `${portal.label} website`], ['Notice number', number], ['Status', sourceStatus], ['Type', row.type],
    ['Closing date (source value)', closing?.text], ['Posted (source value)', posted?.text], ['Updated (source value)', row.updated && row.updated !== 'N/A' ? row.updated : undefined],
    ['Awarded', row.awarded],
  ];
  const sourceFields = [
    ...fields.filter(([, value]) => value).map(([label, value]) => ({ label, value: value! })),
    ...(page?.fields ?? []),
    ...(page?.documents ?? []).map(doc => ({ label: `Document: ${doc.name}`, value: doc.url })),
  ];
  return {
    sourceId: SOURCE_ID, sourceKey: key, processId: key, opportunityId: key, portalId: portal.id,
    externalId: number ?? id, description: row.title, descriptionText, sourceDescriptionText: descriptionText,
    issuedBy: portal.label, status, ...(derived ? { statusDerivedFrom: 'closingAt' } : {}), type: row.type ?? '',
    closingDate: closing?.text ?? '', ...(closing?.at ? { closingAt: closing.at } : {}), ...(posted?.at ? { publishedAt: posted.at } : {}),
    detailUrl, sourceUrl: portal.url, region, place: { ...portal.place },
    ...(page?.contacts.length ? { contacts: page.contacts } : {}),
    sourceFields, ...(page ? { documentsCount: page.documents.length, noticePageRetrievedAt: retrievedAt } : {}),
    sourceRetrievedAt: retrievedAt, rawSourceData: { cells: row.cells, href: row.href ?? null, ...(row.summary ? { summary: row.summary } : {}) },
    searchText: [number, row.title, descriptionText.slice(0, 4000), portal.label, status, row.type, region].filter(Boolean).join(' '),
    attachments: [], addenda: [], detailFields: [], commodities: [],
  };
}

/** Whether a listed notice is already over, judged from what the listing itself says. */
export function listedAsClosed(row: SiteRow & { html: Partial<Record<Role, string>> }, portal: SitePortal, now: string): boolean {
  if (row.status && CLOSED.test(row.status)) return true;
  if (row.html.closing === undefined) return false;
  const closing = readMoment(row.html.closing, portal.timeZone, portal.slashDates);
  if (closing.precision === 'instant') return Date.parse(closing.at!) < Date.parse(now);
  return closing.precision === 'date' && closing.at! < zonedIso(Date.parse(now), portal.timeZone).slice(0, 10);
}

const rethrowHostLimits = (error: unknown) => {
  // A Zoer pause or an exhausted request budget ends the portal; any other notice-page problem is only a warning.
  if (isPauseError(error) || /budget exhausted|network_limit/i.test(String((error as Error)?.message ?? '')) || (error as any)?.code === 'network_limit') throw error;
};

export async function collectSitePortal(fetch: NetFetch, base: ConnectorPortal, context: { now: () => string }): Promise<PortalResult> {
  const portal = SITE_PORTALS.find(candidate => candidate.id === base.id);
  if (!portal) throw new ConnectorError('source_config', `Unknown municipal site portal ${base.id}.`);
  const retrievedAt = context.now(), warnings: string[] = [];
  const rows = new Map<string, SiteRow & { html: Partial<Record<Role, string>> }>();
  let unkeyed = 0;
  for (const first of portal.listUrls) {
    let url: string | undefined = first;
    for (let n = 0; url && n < MAX_PAGES; n++) {
      const response = await fetch({ url, accept: 'text/html' });
      if (response.status !== 200) throw httpFailure(`${portal.label} bids page`, response.status);
      const parsed = portal.layout === 'cards' ? parseCards(response.text) : parseTable(response.text);
      for (const row of parsed.rows) {
        const id = noticeId(portal, row);
        if (id) rows.set(id, row); else unkeyed++;
      }
      const next = nextPage(response.text, url);
      if (next && n === MAX_PAGES - 1) warnings.push(`${portal.label} has more than ${MAX_PAGES} listing pages; later pages were not read.`);
      url = next;
    }
  }
  if (unkeyed) warnings.push(`${unkeyed} listed notice(s) had no link or notice number to identify them and were skipped.`);
  const pages = new Map<string, NoticePage>(), failures: string[] = [];
  if (portal.details) {
    const open = [...rows].filter(([, row]) => row.href && !listedAsClosed(row, portal, retrievedAt));
    for (const [id, row] of open.slice(0, MAX_DETAILS)) {
      const url = resolveUrl(row.href!, portal.url);
      if (!url || new URL(url).host !== portal.host) continue;
      try {
        const response = await fetch({ url, accept: 'text/html' });
        const page = response.status === 200 ? parseNoticePage(response.text, url) : undefined;
        if (page) pages.set(id, page); else failures.push(response.status === 200 ? 'unrecognized page' : `HTTP ${response.status}`);
      } catch (error) { rethrowHostLimits(error); failures.push((error as Error)?.message?.slice(0, 120) || 'request failed'); }
    }
    if (open.length > MAX_DETAILS) warnings.push(`Only the first ${MAX_DETAILS} of ${open.length} notice pages were read this run; the rest carry listing fields only.`);
  }
  if (failures.length) warnings.push(`Notice pages could not be read for ${failures.length} notice(s) (${[...new Set(failures)].slice(0, 3).join('; ')}); those records carry listing fields only.`);
  // These listings print no total; the count is unknown rather than the number of rows read.
  return { portalId: portal.id, records: [...rows].map(([id, row]) => siteRecord(row, portal, retrievedAt, pages.get(id))), warnings };
}

export const municipalSites: SourceConnector = {
  id: SOURCE_ID,
  label: 'BC local government websites',
  jurisdiction: 'British Columbia',
  coverage: `Bids listed on the own websites of ${SITE_PORTALS.length} BC local governments (${SITE_PORTALS.map(p => p.label).join(', ')}), with each open notice's page (description, contacts, document links). Each site lists what it chooses: some show recently closed notices, some only open ones. Files are not downloaded. A notice missing from a later listing is kept; absence is not proof of closure.`,
  portals: SITE_PORTALS,
  requestsPerPortal: 2 * MAX_PAGES + MAX_DETAILS,
  needsSession: false,
  collectPortal: collectSitePortal,
};
