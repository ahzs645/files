/**
 * Unicode code point helpers. Evidence offsets are code points, never JavaScript UTF-16 units, so
 * spans agree with Python `str` indexing and survive emoji/astral characters.
 */

/** The string split into code points (astral characters stay whole; combining marks are separate). */
export function codePoints(s: string): string[] {
  return Array.from(s);
}

export function codePointLength(s: string): number {
  let count = 0;
  for (let i = 0; i < s.length; i++) {
    const unit = s.charCodeAt(i);
    if (unit >= 0xd800 && unit <= 0xdbff && i + 1 < s.length) {
      const next = s.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) i++;
    }
    count++;
  }
  return count;
}

function isHighSurrogatePair(s: string, i: number): boolean {
  const unit = s.charCodeAt(i);
  if (unit < 0xd800 || unit > 0xdbff || i + 1 >= s.length) return false;
  const next = s.charCodeAt(i + 1);
  return next >= 0xdc00 && next <= 0xdfff;
}

function assertIndex(name: string, value: number, max: number): void {
  if (!Number.isInteger(value) || value < 0 || value > max) throw new RangeError(`${name} ${value} is outside 0..${max}.`);
}

/** Code point index of UTF-16 index `i` (0 ≤ i ≤ s.length). An index inside a surrogate pair maps to that pair's code point. */
export function utf16ToCodePoint(s: string, i: number): number {
  assertIndex('UTF-16 index', i, s.length);
  let cp = 0;
  let u = 0;
  while (u < i) {
    const step = isHighSurrogatePair(s, u) ? 2 : 1;
    if (u + step > i) break;
    u += step;
    cp++;
  }
  return cp;
}

/** UTF-16 index of code point index `cp` (0 ≤ cp ≤ codePointLength(s)). */
export function codePointToUtf16(s: string, cp: number): number {
  if (!Number.isInteger(cp) || cp < 0) throw new RangeError(`Code point index ${cp} is invalid.`);
  let u = 0;
  for (let n = 0; n < cp; n++) {
    if (u >= s.length) throw new RangeError(`Code point index ${cp} is outside 0..${codePointLength(s)}.`);
    u += isHighSurrogatePair(s, u) ? 2 : 1;
  }
  return u;
}

/** Substring by code point offsets, clamped like `String.prototype.slice` (negative values count from the end). */
export function sliceCodePoints(s: string, start: number, end?: number): string {
  const chars = codePoints(s);
  return chars.slice(start, end).join('');
}
