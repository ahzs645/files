/**
 * Evidence anchoring: align model quotes to immutable extraction text and validate stored spans.
 *
 * Alignment is deliberately narrow: an exact substring, or a match after whitespace/quote/dash/NFC
 * normalization mapped back to original code point offsets. Anything looser is `unverified`.
 */
import type { Alignment, ID } from './contracts';
import { codePoints } from './text';

export interface QuoteAlignment {
  alignment: Alignment;
  /** Code point offsets into the original text, half-open; null when unverified. */
  start: number | null;
  end: number | null;
  /** The original source passage for aligned quotes; the supplied quote when unverified. */
  quote: string;
}

/** Preferred start (code points) used to choose between repeated matches, e.g. a chunk offset. */
export type AlignmentHint = number | { start?: number | null } | null | undefined;

const IGNORABLE = /^[­​-‍⁠﻿]$/u;
const WHITESPACE = /^\s$/u;
const MARK = /^\p{M}$/u;
const FOLD: Record<string, string> = {
  '‘': "'", '’': "'", '‚': "'", '‛': "'", '′': "'", 'ʼ': "'", '`': "'", '´': "'",
  '“': '"', '”': '"', '„': '"', '‟': '"', '″': '"', '«': '"', '»': '"',
  '‐': '-', '‑': '-', '‒': '-', '–': '-', '—': '-', '―': '-', '−': '-', '﹘': '-', '﹣': '-', '－': '-',
  '…': '...', 'ﬀ': 'ff', 'ﬁ': 'fi', 'ﬂ': 'fl', 'ﬃ': 'ffi', 'ﬄ': 'ffl',
};

interface NormalizedText {
  /** One code point per unit. */
  units: string[];
  /** Original code point range each unit came from. */
  starts: number[];
  ends: number[];
}

/** Normalize for alignment while keeping a map from each normalized code point to its original range. */
function normalizeWithMap(text: string): NormalizedText {
  const chars = codePoints(text);
  const out: NormalizedText = { units: [], starts: [], ends: [] };
  const emit = (value: string, start: number, end: number) => {
    for (const unit of codePoints(value)) {
      out.units.push(unit);
      out.starts.push(start);
      out.ends.push(end);
    }
  };
  let i = 0;
  while (i < chars.length) {
    const char = chars[i]!;
    if (IGNORABLE.test(char)) { i++; continue; }
    if (WHITESPACE.test(char)) {
      let j = i + 1;
      while (j < chars.length && (WHITESPACE.test(chars[j]!) || IGNORABLE.test(chars[j]!))) j++;
      const last = out.units.length - 1;
      if (last >= 0 && out.units[last] === ' ') out.ends[last] = j;
      else emit(' ', i, j);
      i = j;
      continue;
    }
    let j = i + 1;
    while (j < chars.length && MARK.test(chars[j]!)) j++;
    const cluster = chars.slice(i, j).join('').normalize('NFC');
    let folded = '';
    for (const unit of codePoints(cluster)) folded += FOLD[unit] ?? unit;
    emit(folded, i, j);
    i = j;
  }
  return out;
}

function normalizeQuote(quote: string): string {
  return normalizeWithMap(quote).units.join('').trim();
}

function hintStart(hint: AlignmentHint): number | null {
  if (typeof hint === 'number') return Number.isFinite(hint) ? hint : null;
  if (hint && typeof hint === 'object' && typeof hint.start === 'number' && Number.isFinite(hint.start)) return hint.start;
  return null;
}

/** All (possibly overlapping) UTF-16 match positions of `needle` in `haystack`. */
function findAll(haystack: string, needle: string): number[] {
  const found: number[] = [];
  if (!needle) return found;
  let from = 0;
  for (;;) {
    const at = haystack.indexOf(needle, from);
    if (at < 0) return found;
    found.push(at);
    from = at + 1;
  }
}

/** Convert ascending UTF-16 positions to code point positions in one pass. */
function toCodePointPositions(s: string, positions: number[]): number[] {
  const result: number[] = [];
  let u = 0;
  let cp = 0;
  for (const target of positions) {
    while (u < target) {
      const unit = s.charCodeAt(u);
      const pair = unit >= 0xd800 && unit <= 0xdbff && u + 1 < s.length && (s.charCodeAt(u + 1) & 0xfc00) === 0xdc00;
      u += pair ? 2 : 1;
      cp++;
    }
    result.push(cp);
  }
  return result;
}

function closest(starts: number[], hint: number | null): number {
  if (hint === null || starts.length < 2) return 0;
  let best = 0;
  for (let i = 1; i < starts.length; i++) if (Math.abs(starts[i]! - hint) < Math.abs(starts[best]! - hint)) best = i;
  return best;
}

/**
 * Locate `quote` in `text`. Exact search first (the occurrence nearest `hint` wins when repeated);
 * then a whitespace/quote/dash/NFC-normalized search mapped back to original code point offsets
 * (`normalized_mapped`); otherwise `unverified` with null offsets.
 */
export function alignQuote(text: string, quote: string, hint?: AlignmentHint): QuoteAlignment {
  const unverified: QuoteAlignment = { alignment: 'unverified', start: null, end: null, quote };
  if (typeof text !== 'string' || typeof quote !== 'string' || !quote.trim()) return unverified;
  const preferred = hintStart(hint);

  const exact = findAll(text, quote);
  if (exact.length) {
    const starts = toCodePointPositions(text, exact);
    const start = starts[closest(starts, preferred)]!;
    const length = codePoints(quote).length;
    return { alignment: 'exact', start, end: start + length, quote };
  }

  const needle = normalizeQuote(quote);
  if (!needle) return unverified;
  const normalized = normalizeWithMap(text);
  const haystack = normalized.units.join('');
  const positions = findAll(haystack, needle);
  if (!positions.length) return unverified;
  const unitStarts = toCodePointPositions(haystack, positions);
  const needleUnits = codePoints(needle).length;
  const candidates = unitStarts.map(unit => ({ start: normalized.starts[unit]!, end: normalized.ends[unit + needleUnits - 1]! }));
  const chosen = candidates[closest(candidates.map(c => c.start), preferred)]!;
  const chars = codePoints(text);
  return { alignment: 'normalized_mapped', start: chosen.start, end: chosen.end, quote: chars.slice(chosen.start, chosen.end).join('') };
}

/** The span fields `validateSpan` checks. */
export interface SpanLike {
  recordId: ID;
  lotId?: ID | null;
  extractionId: ID;
  textSha256: string;
  offsetUnit?: string;
  start: number | null;
  end: number | null;
  quote: string;
}

/** The extraction a span claims to point into. */
export interface SpanSource {
  recordId: ID;
  lotId?: ID | null;
  extractionId: ID;
  textSha256: string;
  text: string;
}

/**
 * True only when the span belongs to this record/lot/extraction/text version and its code point
 * offsets reproduce the quote exactly. Unverified spans (null offsets) never validate.
 */
export function validateSpan(span: SpanLike | null | undefined, source: SpanSource | null | undefined): boolean {
  if (!span || !source || typeof source.text !== 'string') return false;
  if (span.offsetUnit !== undefined && span.offsetUnit !== 'unicode_code_point') return false;
  if ((span.lotId ?? null) !== (source.lotId ?? null)) return false;
  if (span.recordId !== source.recordId || span.extractionId !== source.extractionId || span.textSha256 !== source.textSha256) return false;
  const { start, end } = span;
  if (typeof start !== 'number' || typeof end !== 'number' || !Number.isInteger(start) || !Number.isInteger(end)) return false;
  if (start < 0 || end <= start) return false;
  const chars = codePoints(source.text);
  if (end > chars.length) return false;
  return chars.slice(start, end).join('') === span.quote;
}
