import { addDays, parseDeadline } from './deadline';
import { agree, findPlaces } from './places';

/**
 * Possible duplicate notices: the same opportunity posted on two portals, or reposted under a new number.
 * Ported from rfp-fullstack-project pipelines/deduplicator.py: an exact key first (normalised title + buyer + closing
 * day), then a weighted score — title 0.4, buyer 0.3, closing date 0.2, URL 0.1 — shown at 0.85 or more. Buyer names
 * are compared once legal forms ("Inc", "Ltd"), "City of"-style prefixes, punctuation and accents are gone
 * (LeadScout company-identity.ts). Two different municipalities with the same short name (City and District of
 * North Vancouver) never count as the same buyer. Nothing is merged; people decide.
 */
export const DUPLICATE_THRESHOLD = 0.85;
export const WEIGHTS = { title: 0.4, buyer: 0.3, date: 0.2, url: 0.1 } as const;
/** Candidates read per notice; the host returns at most 200 rows. */
export const CANDIDATE_LIMIT = 200;

export interface NoticeSummary { id: string; title: string; buyer: string; deadline: string | null; url: string | null; sourceId: string; externalId?: string | null; status?: string | null }
export interface DuplicateScore { score: number; exact: boolean; title: number; buyer: number; dayGap: number | null; sameUrl: boolean; reasons: string[] }

const accents = (text: string) => text.normalize('NFD').replace(/[̀-ͯ]/g, '');
const LEGAL = /(?<![\p{L}\p{N}])(?:inc|incorporated|ltd|limited|llc|llp|corp|corporation|co|company|plc|ulc)(?![\p{L}\p{N}])\.?/giu;
const MUNICIPAL_PREFIX = /^(?:the\s+)?(?:corporation\s+of\s+the\s+)?(?:city|town|village|township|district(?:\s+municipality)?|(?:resort|regional|island|mountain\s+resort)\s+municipality|municipality)\s+of\s+(?:the\s+)?/;
const MUNICIPAL_SUFFIX = /,\s*(?:the\s+)?(?:corporation\s+of\s+the\s+)?(?:city|town|village|township|district)\s+of$/;

/** Buyer in one comparable spelling: "The Corporation of the City of Nanaimo" and "Nanaimo, City of" → "nanaimo". */
export function normalizeBuyer(name: unknown): string {
  if (typeof name !== 'string') return '';
  let text = accents(name).toLowerCase().replace(/[’']/g, '').replace(/\s*\([^)]*\)/g, ' ').replace(/\s+/g, ' ').trim();
  text = text.replace(MUNICIPAL_SUFFIX, '').replace(MUNICIPAL_PREFIX, '');
  return text.replace(LEGAL, ' ').replace(/&/g, ' and ').replace(/[^\p{L}\p{N}]+/gu, ' ').replace(/\s+/g, ' ').trim();
}

// Notice-type words and filler say nothing about which job it is.
const TITLE_NOISE = new Set(['a', 'an', 'and', 'the', 'of', 'for', 'to', 'in', 'on', 'at', 'by', 'with', 'or', 'rfp', 'rfq', 'rfi', 'rft', 'itt', 'itq', 'rfsq', 'rfeoi', 'eoi', 'nrfp', 'request', 'requests', 'proposal', 'proposals', 'quotation', 'quotations', 'quote', 'quotes', 'tender', 'tenders', 'invitation', 'bid', 'bids', 'notice', 'repost', 'reposted', 're', 'reissue', 'reissued', 'amended', 'amendment', 'no', 'number']);
/**
 * Title words: accents and punctuation off, notice-type words dropped, plural "s" trimmed. Reference numbers
 * ("RFP 2026-14", "25.144", "#10234") are dropped too: each portal numbers its copy differently. Short numbers stay
 * ("Phase 2" is not "Phase 3").
 */
export function titleTokens(title: unknown): string[] {
  if (typeof title !== 'string') return [];
  return accents(title).toLowerCase().replace(/[’']/g, '').replace(/\d+(?:[-./]\d+)+/g, ' ').split(/[^\p{L}\p{N}]+/u)
    .filter(word => word && !TITLE_NOISE.has(word) && (word.match(/\d/g)?.length ?? 0) < 3).map(word => word.length > 4 && word.endsWith('s') && !word.endsWith('ss') ? word.slice(0, -1) : word);
}
/** Dice coefficient over word multisets: 1 for the same words in any order. */
export function tokenSimilarity(a: readonly string[], b: readonly string[]): number {
  if (!a.length || !b.length) return 0;
  const counts = new Map<string, number>();
  for (const word of a) counts.set(word, (counts.get(word) ?? 0) + 1);
  let shared = 0;
  for (const word of b) { const n = counts.get(word) ?? 0; if (n) { shared++; counts.set(word, n - 1); } }
  return (2 * shared) / (a.length + b.length);
}

/** Calendar day of a closing value (YYYY-MM-DD), from ISO text or the source's own date text. */
export function closingDay(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  const iso = value.trim().match(/^(\d{4}-\d{2}-\d{2})/);
  if (iso) return iso[1];
  const parsed = parseDeadline(value.trim());
  return parsed ? parsed.date : null;
}
const dayNumber = (day: string) => Date.parse(`${day}T00:00:00Z`) / 86_400_000;

const canonicalUrl = (url: string | null | undefined) => {
  if (!url) return '';
  try { const parsed = new URL(url); return `${parsed.host.toLowerCase().replace(/^www\./, '')}${parsed.pathname.replace(/\/+$/, '')}${parsed.search}`; } catch { return ''; }
};

/** Buyer similarity: same normalised name (unless they are different municipalities), else word overlap. */
function buyerSimilarity(a: string, b: string): number {
  const na = normalizeBuyer(a), nb = normalizeBuyer(b);
  if (!na || !nb) return 0;
  if (na === nb) {
    const pa = agree(findPlaces(a)), pb = agree(findPlaces(b));
    return pa?.municipality && pb?.municipality && pa.municipality !== pb.municipality ? 0 : 1;
  }
  return tokenSimilarity(na.split(' '), nb.split(' '));
}

export function scoreDuplicate(a: NoticeSummary, b: NoticeSummary): DuplicateScore {
  const title = tokenSimilarity(titleTokens(a.title), titleTokens(b.title)), buyer = buyerSimilarity(a.buyer, b.buyer);
  const da = closingDay(a.deadline), db = closingDay(b.deadline), dayGap = da && db ? Math.abs(dayNumber(da) - dayNumber(db)) : null;
  // A date without a time zone can be a day off the same deadline (UTC versus Pacific), so one day apart counts
  // in full unless both sides are exact instants; further apart is a different deadline.
  const instants = parseDeadline(a.deadline)?.precision === 'instant' && parseDeadline(b.deadline)?.precision === 'instant';
  const date = dayGap === 0 || (dayGap === 1 && !instants) ? 1 : dayGap === 1 ? 0.5 : 0;
  const ua = canonicalUrl(a.url), sameUrl = !!ua && ua === canonicalUrl(b.url);
  const exact = title === 1 && buyer === 1 && dayGap === 0;
  const score = exact || sameUrl ? 1 : WEIGHTS.title * title + WEIGHTS.buyer * buyer + WEIGHTS.date * date + WEIGHTS.url * (sameUrl ? 1 : 0);
  const pct = (value: number) => `${Math.round(value * 100)}%`;
  const reasons = [
    ...(sameUrl ? ['same notice link'] : []),
    buyer === 1 ? 'same buyer' : buyer >= 0.5 ? `buyer ${pct(buyer)} similar` : 'different buyer',
    title === 1 ? (a.title.trim().toLowerCase() === b.title.trim().toLowerCase() ? 'same title' : 'same title words') : `title ${pct(title)} similar`,
    dayGap === null ? 'closing date not comparable' : dayGap === 0 ? 'same closing day' : dayGap === 1 ? (instants ? 'closing dates 1 day apart' : 'closing within a day (a date has no time zone)') : `closing dates ${dayGap} days apart`,
  ];
  return { score: Math.round(score * 1000) / 1000, exact, title, buyer, dayGap, sameUrl, reasons };
}

/** "Same buyer, title 92% similar, same closing day". */
export const explainDuplicate = (score: DuplicateScore) => score.reasons.join(', ').replace(/^./, c => c.toUpperCase());

const field = (key: string) => `json_extract(data,'$.${key}')`;
const TITLE = `coalesce(${field('description')},${field('title')},title,'')`;
const BUYER = `coalesce(${field('issuedBy')},'')`;
const DEADLINE = `coalesce(${field('closingAt')},${field('closingDate')},'')`;
const SOURCE = `coalesce(CASE WHEN ${field('sourceId')}='' THEN NULL ELSE ${field('sourceId')} END,'bc-bid')`;
const PROJECTION = `id, ${TITLE} AS title, ${BUYER} AS buyer, ${DEADLINE} AS deadline, coalesce(${field('detailUrl')},${field('sourceUrl')}) AS url, ${SOURCE} AS sourceId, ${field('externalId')} AS externalId, ${field('status')} AS status`;
/** The longest distinctive word of a buyer name, for a bounded LIKE (SQL here has no normalising functions). */
export function buyerKeyword(name: string): string | null {
  const words = normalizeBuyer(name).split(' ').filter(word => word.length >= 4 && !['ministry', 'department', 'services', 'service', 'government', 'british', 'columbia', 'canada', 'regional', 'district', 'school', 'authority', 'society'].includes(word));
  return words.sort((a, b) => b.length - a.length)[0] ?? null;
}
const likeLiteral = (text: string) => text.replace(/[\\%_]/g, '\\$&');

/**
 * One bounded read of candidate opportunities for `notice`: same title (case-insensitive), closing within a day,
 * or a buyer sharing its most distinctive word. Title and date matches sort first, so the 200-row cap drops the
 * weakest candidates. Host rules: one SELECT, whitelisted functions, no keyword directly before "(".
 */
export function duplicateCandidatesQuery(notice: NoticeSummary) {
  const day = closingDay(notice.deadline), keyword = buyerKeyword(notice.buyer);
  const tests: string[] = [`lower(${TITLE})=?`], parameters: (string | number)[] = [notice.title.toLowerCase()];
  if (day) for (const d of [addDays(day, -1), day, addDays(day, 1)]) { tests.push(`${DEADLINE} LIKE ?`); parameters.push(`${d}%`); }
  const rank = `CASE WHEN ${tests.join(' OR ')} THEN 0 ELSE 1 END`, rankParameters = [...parameters];
  if (keyword) { tests.push(`lower(${BUYER}) LIKE ? ESCAPE '\\'`); parameters.push(`%${likeLiteral(keyword)}%`); }
  return {
    statement: `SELECT ${PROJECTION} FROM records WHERE kind='opportunity' AND id<>? AND CASE WHEN ${tests.join(' OR ')} THEN 1 ELSE 0 END=1 ORDER BY ${rank}, id LIMIT ${CANDIDATE_LIMIT}`,
    parameters: [notice.id, ...parameters, ...rankParameters],
  };
}

/** Rows read for the notice itself, in the same shape as candidates. */
export const noticeSummaryQuery = (id: string) => ({ statement: `SELECT ${PROJECTION} FROM records WHERE id=?`, parameters: [id] });

export interface DuplicateMatch { notice: NoticeSummary; score: DuplicateScore }
/** Candidates scoring at or above the threshold, best first. */
export function findDuplicates(notice: NoticeSummary, candidates: readonly NoticeSummary[], threshold = DUPLICATE_THRESHOLD): DuplicateMatch[] {
  return candidates.filter(candidate => candidate.id !== notice.id)
    .map(candidate => ({ notice: candidate, score: scoreDuplicate(notice, candidate) }))
    .filter(match => match.score.score >= threshold)
    .sort((a, b) => b.score.score - a.score.score || a.notice.id.localeCompare(b.notice.id));
}

/**
 * List-row indicator for one result page (≤ 25 rows) in one query: other opportunities with exactly the same title
 * (case-insensitive). Fuzzy-title duplicates are only found when a notice is opened; scanning the closing-date and
 * buyer candidates of 25 rows at once would exceed the host's 200-row read on a typical catalog.
 */
export function pageDuplicatesQuery(rows: readonly NoticeSummary[]) {
  const titles = [...new Set(rows.map(row => row.title.toLowerCase()).filter(Boolean))].slice(0, 25);
  if (!titles.length) return null;
  return { statement: `SELECT ${PROJECTION} FROM records WHERE kind='opportunity' AND lower(${TITLE}) IN (${titles.map(() => '?').join(',')}) ORDER BY id LIMIT ${CANDIDATE_LIMIT}`, parameters: titles };
}
export function pageDuplicates(rows: readonly NoticeSummary[], candidates: readonly NoticeSummary[]): Map<string, DuplicateMatch[]> {
  const byTitle = new Map<string, NoticeSummary[]>();
  for (const candidate of candidates) { const key = candidate.title.toLowerCase(); byTitle.set(key, [...(byTitle.get(key) ?? []), candidate]); }
  const result = new Map<string, DuplicateMatch[]>();
  for (const row of rows) { const matches = findDuplicates(row, byTitle.get(row.title.toLowerCase()) ?? []); if (matches.length) result.set(row.id, matches); }
  return result;
}
