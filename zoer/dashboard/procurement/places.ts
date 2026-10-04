import type { Place } from '../../src/connectors/types';
import { COMMUNITIES, MUNICIPAL_ALIASES, MUNICIPALITIES, NOT_A_PLACE, QUALIFIED_ONLY, REGIONAL_DISTRICTS, SCHOOL_DISTRICTS, SHARED_NAMES } from './place-data';

/**
 * BC place tagging for notices whose source does not say where they are (BC Bid, CanadaBuys). Ported from the
 * idea in sbcontest2 lib/utils.py (longest name first, whole words, buyer before description) with stricter rules:
 * - names that are also words or surnames ("Mission", "Hope", "Golden") need a qualifier ("City of Mission",
 *   "Mission, BC"); "Central", "Peace River" or "Fraser Valley" alone never match;
 * - a field naming places in different municipalities gives only their shared regional district, and places in
 *   different regional districts give nothing: we never pick one;
 * - phrases such as "Vancouver Island" or "<name> First Nation" tag nothing.
 */
export type PlaceTarget = { municipality: string | null; regionalDistrict: string | null };
type Entry = { muni?: PlaceTarget; rd?: PlaceTarget; bare: boolean; caseSensitive?: boolean; shared?: (typeof SHARED_NAMES)[string]; block?: boolean };

const rdName = new Map(REGIONAL_DISTRICTS.map(rd => [rd.id, rd.name]));
const muniTarget = new Map(MUNICIPALITIES.map(([name, rd]) => [name, { municipality: name, regionalDistrict: rd ? rdName.get(rd)! : null }]));
/** Municipality short names → their regional district (null: none). */
export const BC_MUNICIPALITIES: ReadonlyMap<string, string | null> = new Map([...muniTarget].map(([name, target]) => [name, target.regionalDistrict]));
export const BC_REGIONAL_DISTRICTS: readonly string[] = REGIONAL_DISTRICTS.map(rd => rd.name);

/** Accents, curly quotes, dashes and spacing unified; same length as the input for anything we match. */
const fold = (text: string) => text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[\u2018\u2019\u02bc]/g, "'").replace(/[\u2010-\u2015]/g, '-').replace(/\s+/g, ' ');
/** One key per spelling family: "Fort St. John" = "fort st john", "Hudson's Hope" = "hudsons hope", "Columbia-Shuswap" = "columbia shuswap". */
const keyOf = (name: string) => fold(name).toLowerCase().replace(/'/g, '').replace(/\bst\./g, 'st').replace(/\bsaint\b/g, 'st').replace(/[- ]+/g, ' ').trim();

const entries = new Map<string, Entry>(), spellings = new Set<string>();
const entry = (name: string) => { spellings.add(fold(name).toLowerCase()); const key = keyOf(name); let found = entries.get(key); if (!found) entries.set(key, found = { bare: false }); return found; };
for (const [name] of MUNICIPALITIES) if (!/ \((City|Township|District)\)$/.test(name)) Object.assign(entry(name), { muni: muniTarget.get(name), bare: !QUALIFIED_ONLY.has(name) });
for (const [name, shared] of Object.entries(SHARED_NAMES)) Object.assign(entry(name), { shared, bare: true });
for (const [alias, name] of MUNICIPAL_ALIASES) Object.assign(entry(alias), { muni: muniTarget.get(name)!, bare: !QUALIFIED_ONLY.has(name) });
for (const rd of REGIONAL_DISTRICTS) {
  const target = { municipality: null, regionalDistrict: rd.name };
  for (const core of rd.cores) entry(core).rd = target;
  for (const name of rd.bare ?? []) Object.assign(entry(name), { rd: target, bare: true });
  for (const acronym of rd.acronyms ?? []) Object.assign(entry(acronym), { rd: target, bare: true, caseSensitive: true });
}
for (const [name, rd] of COMMUNITIES) Object.assign(entry(name), { rd: { municipality: null, regionalDistrict: rdName.get(rd)! }, bare: true });
for (const name of NOT_A_PLACE) Object.assign(entry(name), { block: true, bare: true });

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** Spelling → pattern: hyphens and spaces interchangeable, "St." also "St"/"Saint", apostrophes optional. */
const namePattern = (spelling: string) => escape(spelling).replace(/\bst\\\./g, '(?:st\\.?|saint)').replace(/'/g, "'?").replace(/(?:-| )+/g, '[- ]+');
// Longest first, so "Port Coquitlam" wins over "Coquitlam" and "Vancouver Island" over "Vancouver".
const NAMES = [...spellings].sort((a, b) => b.length - a.length || a.localeCompare(b)).map(namePattern).join('|');
const MUNI_WORD = String.raw`(?:city|town|village|township|district(?: municipality)?|(?:resort|regional|island|mountain resort) municipality|municipality)`;
const RD_WORD = String.raw`(?:regional district|rd)`;
const QUALIFIER = String.raw`(?:the )?(?:corporation of the )?(?<q>${MUNI_WORD}|${RD_WORD}) of (?:the )?`;
const BC = String.raw`,? (?:b\.? ?c\.?|british columbia)(?![\p{L}])`;
const SUFFIX = String.raw`(?<s> ${RD_WORD}(?![\p{L}])|${BC}|, (?:the )?(?:corporation of the )?(?<sq>${MUNI_WORD}) of(?![\p{L}])| (?<sm>(?:(?:district|regional|resort|island|mountain resort) )?municipality)(?![\p{L}]))`;
const NATION = String.raw` (?:first nations?|nation|indian band|band|indian government district)(?![\p{L}])`;
const MATCHER = new RegExp(String.raw`(?<![\p{L}\p{N}])(?:${QUALIFIER})?(?<n>${NAMES})(?![\p{L}\p{N}])(?:${SUFFIX})?(?<nation>${NATION})?`, 'gud');
const SCHOOL = /\b(?:school district|sd)\s*(?:no\.?|number|#)?\s*(\d{1,2})\b/i;

/** Every place named in one text, after blocked phrases are removed. `requireBc`: only "<place>, BC" forms count. */
export function findPlaces(text: string, options: { requireBc?: boolean; caseSensitiveBare?: boolean } = {}): PlaceTarget[] {
  if (!text) return [];
  const original = fold(text), found: PlaceTarget[] = [];
  for (const match of original.toLowerCase().matchAll(MATCHER)) {
    const groups = match.groups!, at = (name: string) => { const [a, b] = match.indices!.groups![name]!; return original.slice(a, b); };
    const hit = entries.get(keyOf(groups.n));
    if (!hit || hit.block || groups.nation) continue;
    const shown = at('n');
    if (hit.caseSensitive && shown !== shown.toUpperCase()) continue;
    // "Rd" is usually a road ("Nanaimo Rd"); only the capitalised abbreviation means regional district.
    if ((groups.q === 'rd' && at('q') !== 'RD') || (groups.s?.trim() === 'rd' && at('s').trim() !== 'RD')) continue;
    const qualified = !!(groups.q || groups.s);
    // In free text a lower-case "golden" or "delta" is a word, not a place.
    if (options.caseSensitiveBare && !qualified && shown === shown.toLowerCase() && !/^qathet/.test(shown)) continue;
    const bc = !!groups.s && !groups.sq && !groups.sm && groups.s.trim() !== 'rd' && groups.s.trim() !== 'regional district';
    if (options.requireBc && !bc) continue;
    const rdWord = /^(regional district|rd)$/.test(groups.q ?? '') || /^(regional district|rd)$/.test(groups.s?.trim() ?? '');
    const muniWord = (rdWord ? '' : groups.q) || groups.sq || groups.sm || '';
    let target: PlaceTarget | undefined;
    if (rdWord) target = hit.rd;
    else if (muniWord) target = hit.shared ? sharedByWord(hit.shared, muniWord) : hit.muni;
    else if (hit.shared) target = { municipality: null, regionalDistrict: rdName.get(hit.shared.regionalDistrict)! };
    else if (hit.bare || bc) target = hit.muni ?? (hit.bare ? hit.rd : undefined);
    if (target) found.push(target);
  }
  return found;
}
function sharedByWord(shared: (typeof SHARED_NAMES)[string], word: string): PlaceTarget | undefined {
  const kind = /township/.test(word) ? 'township' : /city/.test(word) ? 'city' : /district/.test(word) ? 'district' : '';
  const name = shared.byQualifier[kind];
  return name ? muniTarget.get(name) : undefined;
}

/** One answer for a field: one municipality, or the regional district they all share, or nothing. */
export function agree(targets: PlaceTarget[]): PlaceTarget | null {
  if (!targets.length) return null;
  const districts = new Set(targets.map(t => t.regionalDistrict)), municipalities = new Set(targets.map(t => t.municipality).filter(Boolean));
  // Different regional districts (Northern Rockies, with none, counts as its own): we do not pick one.
  if (districts.size > 1) return null;
  const regionalDistrict = targets[0].regionalDistrict;
  if (municipalities.size === 1) return { municipality: [...municipalities][0]!, regionalDistrict };
  return regionalDistrict ? { municipality: null, regionalDistrict } : null;
}

function schoolDistrict(buyer: string): PlaceTarget | null {
  const match = buyer.match(SCHOOL), known = match ? SCHOOL_DISTRICTS[Number(match[1])] : undefined;
  return known ? { municipality: known[1], regionalDistrict: rdName.get(known[0])! } : null;
}

export interface TagInput {
  /** Buyer names, most specific first (BC Bid: issued for, then issued by). */
  buyer?: string | null | readonly (string | null | undefined)[];
  /** The source's own region text. */
  region?: string | null;
  /** Title, then description text. */
  text?: string | null | readonly (string | null | undefined)[];
  /** Only accept "<place>, BC" forms in text (CanadaBuys notices not delivered in BC). */
  requireBcInText?: boolean;
}

/** Where a BC notice is, or null when the buyer, region and text do not say so unambiguously. */
export function tagPlace(input: TagInput): Place | null {
  const list = (value: TagInput['buyer']) => (Array.isArray(value) ? value : [value]).filter((item): item is string => typeof item === 'string' && !!item.trim());
  for (const buyer of list(input.buyer)) {
    const school = schoolDistrict(buyer);
    if (school) return { ...school, method: 'buyer' };
    const place = agree(findPlaces(buyer));
    if (place) return { ...place, method: 'buyer' };
  }
  if (input.region?.trim()) {
    const place = agree(findPlaces(input.region));
    if (place) return { ...place, method: 'source-region' };
  }
  for (const text of list(input.text)) {
    const place = agree(findPlaces(text, { requireBc: input.requireBcInText, caseSensitiveBare: true }));
    if (place) return { ...place, method: 'description' };
  }
  return null;
}

const BC_REGION = /british columbia|colombie-britannique/i;

/**
 * Place for a saved BC Bid or CanadaBuys record (catalog `data`). A place a connector set from its portal is kept.
 * CanadaBuys is federal: its text is used only when BC is a region of delivery, otherwise only "<place>, BC" counts.
 */
export function placeForRecord(data: any): Place | null {
  if (data?.place?.method === 'portal') return data.place;
  const canada = data?.sourceId === 'canadabuys';
  const text = [data?.description, data?.sourceDescriptionText || data?.descriptionText];
  if (canada) return tagPlace({ buyer: null, text, requireBcInText: !BC_REGION.test(String(data?.region ?? '')) });
  // A region we filled from an earlier tag is not evidence; re-tagging must not confirm itself.
  return tagPlace({ buyer: [data?.issuedFor, data?.issuedBy], region: data?.regionFromPlace ? null : data?.region, text });
}

/** Place filter options: every tagged place among saved opportunities (≤ 160 municipalities + 27 districts). */
export type PlaceRow = { regionalDistrict: string | null; municipality: string | null; count: number };
export const PLACE_OPTIONS_SQL = "SELECT json_extract(data,'$.place.regionalDistrict') AS regionalDistrict, json_extract(data,'$.place.municipality') AS municipality, count(*) AS count FROM records WHERE kind='opportunity' AND json_extract(data,'$.place') IS NOT NULL GROUP BY regionalDistrict, municipality ORDER BY regionalDistrict, municipality LIMIT 200";
/** `rd:` options summed over their municipalities, then each municipality; values are the `place` URL parameter. */
export function placeOptions(rows: readonly PlaceRow[]): { value: string; label: string; description?: string }[] {
  const districts = new Map<string, number>();
  for (const row of rows) if (row.regionalDistrict) districts.set(row.regionalDistrict, (districts.get(row.regionalDistrict) ?? 0) + Number(row.count));
  const options: { value: string; label: string; description?: string }[] = [];
  for (const [district, count] of districts) options.push({ value: `rd:${district}`, label: `${district} · ${count.toLocaleString()}`, description: 'Whole regional district' });
  // One option per municipality (its filter matches the municipality alone), even when saved notices name its
  // regional district two ways, e.g. portal places saved before they used official district names.
  const municipalities = new Map<string, { count: number; district: string | null }>();
  for (const row of rows) if (row.municipality) {
    const seen = municipalities.get(row.municipality);
    municipalities.set(row.municipality, { count: (seen?.count ?? 0) + Number(row.count), district: seen?.district && BC_REGIONAL_DISTRICTS.includes(seen.district) ? seen.district : row.regionalDistrict ?? seen?.district ?? null });
  }
  for (const [municipality, { count, district }] of municipalities) options.push({ value: `m:${municipality}`, label: `${municipality} · ${count.toLocaleString()}`, description: district ?? 'No regional district' });
  return options.sort((a, b) => a.label.localeCompare(b.label));
}
