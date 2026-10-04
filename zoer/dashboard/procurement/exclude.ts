/**
 * Exclude words: cheap literal filters that drop notices before anyone (or any AI call) reads them.
 *
 * Terms are comma, semicolon or line separated and matched case-insensitively (ASCII, like SQLite `lower`) as whole
 * words over the notice title, description and buyer: "golf" skips "Golf course mowing" but not "golfing".
 * A trailing `*` matches word starts ("fertiliz*" → fertilizer, fertilizing). Words inside a phrase are separated
 * by exactly one non-letter/digit ("snow removal" also matches "snow-removal").
 *
 * The SQL uses GLOB with `[^a-z0-9]` boundaries so it passes the host's bridge reader (no `NOT (`, no extra
 * functions). `procurementAlertQuery` in Zoer's backend repeats this exactly; tests/zoer-procurement-alert-parity
 * runs both against the same rows.
 */
// Each term repeats the text expression (the bridge allows no derived tables), so terms are capped to keep a fully
// filtered list statement under the host's 10,000-character limit.
export const EXCLUDE_MAX_TERMS = 15;
export const EXCLUDE_MAX_TEXT = 2000;
export const EXCLUDE_MAX_TERM = 60;

/**
 * A starter list adapted from an earlier BC Bid monitor's "unrelated" lists (sbcontest2 lib/utils.py), trimmed to
 * notices most small BC firms never bid on. Offered with one tap; never applied silently.
 */
export const NOISE_TERMS = ['frozen food', 'hygiene products', 'physician billing', 'venture capital', 'silviculture', 'snow removal', 'security guard', 'janitorial', 'live animals', 'golf', 'fertiliz*', 'wound care'] as const;

/** SQLite `lower()` only folds ASCII, so terms are folded the same way. */
const asciiLower = (value: string) => value.replace(/[A-Z]/g, c => c.toLowerCase());

/** Every usable, de-duplicated term. One-letter terms and a bare `*` are ignored. */
export function allExcludeTerms(text: unknown): string[] {
  if (typeof text !== 'string') return [];
  const out: string[] = [];
  for (const raw of text.split(/[,;\n]+/)) {
    const term = asciiLower(raw.replace(/\s+/g, ' ').trim()).replace(/\*+$/, '*').slice(0, EXCLUDE_MAX_TERM);
    if (term.replace(/\*$/, '').trim().length < 2 || out.includes(term)) continue;
    out.push(term);
  }
  return out;
}
/** The terms that are applied: the first EXCLUDE_MAX_TERMS (callers warn when more were given). */
export const parseExcludeTerms = (text: unknown) => allExcludeTerms(text).slice(0, EXCLUDE_MAX_TERMS);

/** GLOB pattern for one term over text padded with a space on both sides. */
export function excludePattern(term: string): string {
  const prefix = term.endsWith('*'), stem = prefix ? term.slice(0, -1).trimEnd() : term;
  const body = stem.replace(/[*?[]/g, c => `[${c}]`).replace(/ /g, '[^a-z0-9]');
  return `*[^a-z0-9]${body}${prefix ? '*' : '[^a-z0-9]*'}`;
}

/**
 * Title, description text and buyer as one lower-cased string with a space at each end (unaliased `records`).
 * Every source stores the plain description in `descriptionText` (CanadaBuys and bids&tenders also keep an identical
 * `sourceDescriptionText`), so one field keeps the per-term expression short.
 */
export const EXCLUDE_TEXT = "lower(' '||title||' '||coalesce(json_extract(data,'$.descriptionText'),'')||' '||coalesce(json_extract(data,'$.issuedBy'),json_extract(data,'$.issuingOrganization'),'')||' ')";

/** WHERE fragment: none of the terms appears. Null when there are no usable terms. */
export function excludeSql(text: unknown): { sql: string; parameters: string[] } | null {
  const terms = parseExcludeTerms(text);
  return terms.length ? { sql: terms.map(() => `${EXCLUDE_TEXT} NOT GLOB ?`).join(' AND '), parameters: terms.map(excludePattern) } : null;
}

/** SELECT expression: the 1-based index of the first matching term, else 0 (used to explain profile filters). */
export function excludeMatchSql(terms: string[]): { sql: string; parameters: string[] } {
  return terms.length ? { sql: `CASE ${terms.map((_, i) => `WHEN ${EXCLUDE_TEXT} GLOB ? THEN ${i + 1}`).join(' ')} ELSE 0 END`, parameters: terms.map(excludePattern) } : { sql: '0', parameters: [] };
}

/** Text to append the starter list to an existing field (keeps the user's own words first, no duplicates). */
export function withNoiseTerms(text: string): string {
  const have = new Set(parseExcludeTerms(text));
  const add = NOISE_TERMS.filter(term => !have.has(term));
  return [text.trim(), ...add].filter(Boolean).join('\n');
}
