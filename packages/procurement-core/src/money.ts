/**
 * Semantic money handling. Unlike kinds (budget vs insurance limit), currencies, bases and tax
 * bases are never merged or summed together; unknown parts stay null/`unknown`.
 */
import { MONEY_KINDS, type Money, type MoneyBasis, type MoneyKind, type MoneyValue, type TaxBasis } from './contracts';

export { MONEY_KINDS };

/** The only kinds that may populate a notice header value. Each label must state its basis. */
export const HEADLINE_MONEY_KINDS = ['buyer_budget', 'buyer_estimated_value'] as const satisfies readonly MoneyKind[];
export type HeadlineMoneyKind = (typeof HEADLINE_MONEY_KINDS)[number];

export const MONEY_KIND_LABELS: Record<MoneyKind, string> = {
  buyer_budget: 'Buyer budget',
  buyer_estimated_value: 'Buyer estimated value',
  award_value: 'Award value',
  insurance_limit: 'Insurance limit',
  bid_security: 'Bid security',
  funding_program_amount: 'Funding program amount',
  internal_cost_estimate: 'Internal cost estimate',
};

export const MONEY_BASIS_LABELS: Record<MoneyBasis, string> = {
  total_contract: 'total contract',
  annual: 'per year',
  per_unit: 'per unit',
  unknown: 'basis not stated',
};

export interface ParsedMoney extends MoneyValue {
  /** True when the source frames the amount as a ceiling ("up to", "not to exceed"). */
  isMaximum: boolean;
}

export interface ParseMoneyOptions {
  /** Currency applied only when a bare `$` appears without a stated code. Default null (not assumed). */
  dollarCurrency?: string | null;
}

const CODE = /\b(CAD|USD|EUR|GBP|AUD|NZD|CHF|JPY|MXN)\b/i;
const MULTIPLIERS: Record<string, number> = { k: 1e3, thousand: 1e3, m: 1e6, mm: 1e6, mil: 1e6, million: 1e6, b: 1e9, bn: 1e9, billion: 1e9 };
const AMOUNT = /(C\$|CA\$|CDN\$|US\$|\$|€|£)?\s*(\d{1,3}(?:,\d{3})+|\d+)(\.\d+)?(?:\s*(thousand|million|billion|mil|mm|bn|k|m|b)\b)?(?:\s*(CAD|USD|EUR|GBP|AUD|NZD|CHF|JPY|MXN|CDN)\b)?/gi;
const MAXIMUM = /\b(up to|not to exceed|not exceeding|shall not exceed|no more than|maximum(?: of)?|max\.?|ceiling(?: of)?|capped at|less than|under)\b/i;
const MINIMUM = /\b(at least|minimum(?: of)?|min\.?|no less than|not less than|starting at|from|over|more than|in excess of)\b/i;
/** Bare numbers count as money only in an explicit money context and never when followed by a non-money unit. */
const MONEY_WORDS = /\b(dollars?|budget|value|amount|limit|price|cost|fees?|funding|security|deposit|per occurrence|aggregate|coverage|insurance|liability)\b/i;
const NON_MONEY_UNIT = /^\s*(%|percent|years?|yrs?|months?|days?|weeks?|hours?|hrs?|km|kilomet|met(er|re)s?|m2|m3|sq|square|units?|people|staff|persons?)\b/i;
const RANGE_JOIN =/^\s*(?:-|–|—|to|and|through)\s*$/i;

interface Amount { value: number; symbol: string | null; code: string | null; index: number; end: number }

function symbolCurrency(symbol: string | null, fallback: string | null): string | null {
  if (!symbol) return null;
  const s = symbol.toUpperCase();
  if (s === 'C$' || s === 'CA$' || s === 'CDN$') return 'CAD';
  if (s === 'US$') return 'USD';
  if (s === '€') return 'EUR';
  if (s === '£') return 'GBP';
  return fallback;
}

function basisOf(text: string): MoneyBasis {
  if (/\b(per\s+(year|annum)|annual(ly)?|yearly|\/\s*(yr|year)|p\.?a\.?)\b/i.test(text)) return 'annual';
  if (/\b(per\s+(unit|hour|hr|day|item|each|month|week|visit|km|tonne|m2|m3)|hourly|daily|monthly|per diem|\/\s*(hr|hour|day|unit|month))\b/i.test(text)) return 'per_unit';
  if (/\b(total|lump[\s-]?sum|aggregate|contract value|entire (contract|term))\b/i.test(text)) return 'total_contract';
  return 'unknown';
}

function taxBasisOf(text: string): TaxBasis {
  if (/\b(excl\.?|exclusive of|excluding|before|plus|net of)\s+(all\s+)?(applicable\s+)?(taxes|tax|gst|pst|hst|qst)\b/i.test(text) || /\+\s*(applicable\s+)?(taxes|tax|gst|pst|hst)\b/i.test(text)) return 'exclusive';
  if (/\b(incl\.?|inclusive of|including|includes)\s+(all\s+)?(applicable\s+)?(taxes|tax|gst|pst|hst|qst)\b/i.test(text) || /\btax(es)?\s+included\b/i.test(text)) return 'inclusive';
  return 'unknown';
}

/**
 * Parse a raw money phrase. Returns null when no amount is present. Currency is set only when the
 * text states it (code or unambiguous symbol); a bare `$` stays null unless `dollarCurrency` is given.
 */
export function parseMoney(raw: string | null | undefined, options: ParseMoneyOptions = {}): ParsedMoney | null {
  if (typeof raw !== 'string' || !raw.trim()) return null;
  const text = raw.replace(/\s+/g, ' ').trim();
  const amounts: Amount[] = [];
  for (const match of text.matchAll(AMOUNT)) {
    const [whole, symbol, integer, fraction, unit, code] = match;
    if (!integer) continue;
    let value = Number(integer.replace(/,/g, '') + (fraction ?? ''));
    if (unit) value *= MULTIPLIERS[unit.toLowerCase()] ?? 1;
    if (!Number.isFinite(value)) continue;
    const normalizedCode = code ? (code.toUpperCase() === 'CDN' ? 'CAD' : code.toUpperCase()) : null;
    amounts.push({ value, symbol: symbol ?? null, code: normalizedCode, index: match.index ?? 0, end: (match.index ?? 0) + whole.length });
  }
  // Prefer amounts marked as money; bare numbers (years, percentages, counts) are used only when nothing is marked.
  const marked = amounts.filter(a => a.symbol || a.code);
  const moneyContext = MONEY_WORDS.test(text);
  const unmarked = amounts.filter(a => moneyContext && !NON_MONEY_UNIT.test(text.slice(a.end)));
  const candidates = (marked.length ? marked : unmarked).filter(a => !/^\s*%/.test(text.slice(a.end)));
  if (!candidates.length) return null;

  const statedCode = candidates.find(a => a.code)?.code ?? (CODE.exec(text)?.[1]?.toUpperCase() ?? null);
  const symbol = candidates.find(a => a.symbol)?.symbol ?? null;
  const currency = statedCode ?? symbolCurrency(symbol, options.dollarCurrency ?? null);

  const first = candidates[0]!;
  const second = candidates[1];
  let lower: number | null = first.value;
  let upper: number | null = first.value;
  let isMaximum = false;
  const before = text.slice(0, first.index);
  if (second && (RANGE_JOIN.test(text.slice(first.end, second.index)) || /\bbetween\s*$/i.test(before))) {
    lower = Math.min(first.value, second.value);
    upper = Math.max(first.value, second.value);
  } else if (MAXIMUM.test(before)) {
    lower = null;
    isMaximum = true;
  } else if (MINIMUM.test(before)) {
    upper = null;
  }
  return { lower, upper, currency, basis: basisOf(text), taxBasis: taxBasisOf(text), raw, isMaximum };
}

export interface MoneyGroup<T extends Money = Money> {
  /** `kind|currency|basis|taxBasis` with `unknown` for a null currency. */
  key: string;
  kind: MoneyKind;
  currency: string | null;
  basis: MoneyBasis;
  taxBasis: TaxBasis;
  items: T[];
}

export function moneyGroupKey(item: Pick<Money, 'kind' | 'currency' | 'basis' | 'taxBasis'>): string {
  return [item.kind, item.currency ?? 'unknown', item.basis, item.taxBasis].join('|');
}

/** Partition money items so a group never mixes kind, currency, basis or tax basis. Groups keep first-seen order. */
export function partitionMoney<T extends Money>(items: readonly T[]): Array<MoneyGroup<T>> {
  const groups = new Map<string, MoneyGroup<T>>();
  for (const item of items) {
    const key = moneyGroupKey(item);
    let group = groups.get(key);
    if (!group) {
      group = { key, kind: item.kind, currency: item.currency, basis: item.basis, taxBasis: item.taxBasis, items: [] };
      groups.set(key, group);
    }
    group.items.push(item);
  }
  return [...groups.values()];
}

export interface MoneySummary {
  key: string;
  kind: MoneyKind;
  currency: string | null;
  basis: MoneyBasis;
  taxBasis: TaxBasis;
  count: number;
  /** Items with at least one bound. */
  known: number;
  /** Items with neither bound; reported, never counted as zero. */
  unknown: number;
  min: number | null;
  max: number | null;
  /** Sum only when every item is a known point value (lower === upper); otherwise null. */
  total: number | null;
  label: string;
}

/** Summarize one partition. Throws if handed a mixed group (use `partitionMoney` first). */
export function summarizeMoney<T extends Money>(group: MoneyGroup<T>): MoneySummary {
  for (const item of group.items) {
    if (moneyGroupKey(item) !== group.key) throw new Error(`Money group ${group.key} contains an unlike item (${moneyGroupKey(item)}).`);
  }
  const bounds: number[] = [];
  let known = 0;
  let pointsOnly = group.items.length > 0;
  let total = 0;
  for (const item of group.items) {
    const values = [item.lower, item.upper].filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
    if (values.length) known++;
    bounds.push(...values);
    if (item.lower !== null && item.lower === item.upper && Number.isFinite(item.lower)) total += item.lower;
    else pointsOnly = false;
  }
  const currency = group.currency ?? 'currency not stated';
  return {
    key: group.key, kind: group.kind, currency: group.currency, basis: group.basis, taxBasis: group.taxBasis,
    count: group.items.length, known, unknown: group.items.length - known,
    min: bounds.length ? Math.min(...bounds) : null,
    max: bounds.length ? Math.max(...bounds) : null,
    total: pointsOnly ? total : null,
    label: `${MONEY_KIND_LABELS[group.kind]} (${currency}, ${MONEY_BASIS_LABELS[group.basis]})`,
  };
}
