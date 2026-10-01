import { describe, expect, it } from 'vitest';
import {
  alignQuote, codePointLength, codePointToUtf16, codePoints, sliceCodePoints, utf16ToCodePoint, validateSpan,
} from '../../packages/procurement-core/src/index';

const source = (text: string) => ({ recordId: 'rec-1', lotId: null, extractionId: 'ext-1', textSha256: 'sha-1', text });
const spanFor = (text: string, quote: string, hint?: number) => {
  const aligned = alignQuote(text, quote, hint);
  return { aligned, span: { recordId: 'rec-1', lotId: null, extractionId: 'ext-1', textSha256: 'sha-1', offsetUnit: 'unicode_code_point', start: aligned.start, end: aligned.end, quote: aligned.quote } };
};

describe('code point helpers', () => {
  const s = 'a😀b👍🏽c';
  it('counts code points, not UTF-16 units', () => {
    expect(s.length).toBe(9);
    expect(codePointLength(s)).toBe(6);
    expect(codePoints(s)).toEqual(['a', '😀', 'b', '👍', '🏽', 'c']);
    expect(codePointLength('')).toBe(0);
  });
  it('converts between UTF-16 and code point offsets', () => {
    expect(codePointToUtf16(s, 0)).toBe(0);
    expect(codePointToUtf16(s, 2)).toBe(3);
    expect(codePointToUtf16(s, 6)).toBe(9);
    expect(utf16ToCodePoint(s, 3)).toBe(2);
    expect(utf16ToCodePoint(s, 9)).toBe(6);
    // An index inside a surrogate pair maps to that pair's code point.
    expect(utf16ToCodePoint(s, 2)).toBe(1);
    expect(() => codePointToUtf16(s, 7)).toThrow(RangeError);
    expect(() => utf16ToCodePoint(s, 10)).toThrow(RangeError);
    expect(() => codePointToUtf16(s, -1)).toThrow(RangeError);
  });
  it('slices by code points', () => {
    expect(sliceCodePoints(s, 1, 3)).toBe('😀b');
    expect(sliceCodePoints(s, 3)).toBe('👍🏽c');
  });
  it('agrees with Python str offsets for combining characters (e + U+0301 is two code points)', () => {
    expect(codePointLength('Café')).toBe(5);
    expect(codePointLength('Café')).toBe(4);
  });
});

describe('alignQuote', () => {
  it('finds exact quotes after emoji with code point offsets', () => {
    const text = 'Intro 😀😀 The Contractor shall maintain insurance.';
    const { aligned, span } = spanFor(text, 'The Contractor shall');
    expect(aligned).toEqual({ alignment: 'exact', start: 9, end: 29, quote: 'The Contractor shall' });
    expect(validateSpan(span, source(text))).toBe(true);
    // UTF-16 offsets would be off by two.
    expect(text.indexOf('The Contractor shall')).toBe(11);
  });

  it('aligns CJK text', () => {
    const text = '第一条：投标人必须提供保险证明。';
    const { aligned, span } = spanFor(text, '投标人必须提供保险证明');
    expect(aligned).toMatchObject({ alignment: 'exact', start: 4, end: 15 });
    expect(validateSpan(span, source(text))).toBe(true);
  });

  it('maps an NFC-normalized match back to decomposed source characters', () => {
    const text = 'Le soumissionnaire doit fournir un résumé de l’expérience.';
    const { aligned, span } = spanFor(text, 'un résumé de l\'expérience');
    expect(aligned.alignment).toBe('normalized_mapped');
    expect(aligned.quote).toBe('un résumé de l’expérience');
    expect(validateSpan(span, source(text))).toBe(true);
    expect(codePoints(text).slice(aligned.start!, aligned.end!).join('')).toBe(aligned.quote);
  });

  it('collapses whitespace, curly quotes, dashes and soft hyphens', () => {
    const text = 'Section 4 —\n“Proponents  must hold a valid COR cer­tificate” – at submission.';
    const { aligned, span } = spanFor(text, '"Proponents must hold a valid COR certificate" - at submission');
    expect(aligned.alignment).toBe('normalized_mapped');
    expect(aligned.quote).toBe('“Proponents  must hold a valid COR cer­tificate” – at submission');
    expect(validateSpan(span, source(text))).toBe(true);
  });

  it('keeps offsets correct for emoji inside a normalized match', () => {
    const text = 'x👍🏽y  must\tcomply 😀 fully';
    const { aligned, span } = spanFor(text, 'must comply 😀 fully');
    expect(aligned).toMatchObject({ alignment: 'normalized_mapped', start: 6, end: 25 });
    expect(validateSpan(span, source(text))).toBe(true);
  });

  it('retains a mandatory clause after character 18,000', () => {
    const clause = 'The Proponent shall provide proof of $5,000,000 commercial general liability insurance.';
    const text = `${'Background paragraph. '.repeat(900)}\n\n${clause}\n`;
    const exact = spanFor(text, clause);
    expect(exact.aligned.alignment).toBe('exact');
    expect(exact.aligned.start).toBeGreaterThan(18000);
    expect(validateSpan(exact.span, source(text))).toBe(true);
    const curly = `${'Ünïcödé 😀 filler. '.repeat(1000)}${clause.replace('Proponent shall', 'Proponent\n  shall')}`;
    const normalized = spanFor(curly, clause);
    expect(normalized.aligned.alignment).toBe('normalized_mapped');
    expect(normalized.aligned.start).toBe(codePointLength('Ünïcödé 😀 filler. ') * 1000);
    expect(validateSpan(normalized.span, source(curly))).toBe(true);
  });

  it('prefers the occurrence nearest the hint', () => {
    const text = 'must comply. Later: must comply. End: must comply.';
    expect(alignQuote(text, 'must comply').start).toBe(0);
    expect(alignQuote(text, 'must comply', 25).start).toBe(20);
    expect(alignQuote(text, 'must comply', { start: 100 }).start).toBe(38);
    expect(alignQuote(text.replace(/ comply/g, '  comply'), 'must comply', 25)).toMatchObject({ alignment: 'normalized_mapped', start: 21 });
  });

  it('is unverified for paraphrases, empty quotes and non-strings (no fuzzy matching)', () => {
    const text = 'The Contractor shall maintain insurance.';
    expect(alignQuote(text, 'The contractor must maintain insurance')).toEqual({ alignment: 'unverified', start: null, end: null, quote: 'The contractor must maintain insurance' });
    expect(alignQuote(text, '   ').alignment).toBe('unverified');
    expect(alignQuote(text, 'the contractor shall').alignment).toBe('unverified');
    expect(alignQuote(undefined as unknown as string, 'x').alignment).toBe('unverified');
  });
});

describe('validateSpan ownership and offsets', () => {
  const text = 'A😀 must comply.';
  const span = { recordId: 'rec-1', lotId: null, extractionId: 'ext-1', textSha256: 'sha-1', offsetUnit: 'unicode_code_point', start: 3, end: 7, quote: 'must' };
  it('accepts a correct span', () => expect(validateSpan(span, source(text))).toBe(true));
  it('checks record, extraction, text version and lot ownership', () => {
    expect(validateSpan({ ...span, recordId: 'rec-2' }, source(text))).toBe(false);
    expect(validateSpan({ ...span, extractionId: 'ext-2' }, source(text))).toBe(false);
    expect(validateSpan({ ...span, textSha256: 'sha-2' }, source(text))).toBe(false);
    expect(validateSpan({ ...span, lotId: 'lot-1' }, source(text))).toBe(false);
    expect(validateSpan({ ...span, lotId: 'lot-1' }, { ...source(text), lotId: 'lot-1' })).toBe(true);
  });
  it('rejects bad offsets, units and unverified spans', () => {
    expect(validateSpan({ ...span, offsetUnit: 'utf16' }, source(text))).toBe(false);
    expect(validateSpan({ ...span, start: null, end: null }, source(text))).toBe(false);
    expect(validateSpan({ ...span, start: 7, end: 7, quote: '' }, source(text))).toBe(false);
    expect(validateSpan({ ...span, start: -1 }, source(text))).toBe(false);
    expect(validateSpan({ ...span, start: 3.5 }, source(text))).toBe(false);
    expect(validateSpan({ ...span, end: 99 }, source(text))).toBe(false);
    expect(validateSpan({ ...span, start: 4, end: 8, quote: 'must' }, source(text))).toBe(false); // UTF-16 offsets
    expect(validateSpan(null, source(text))).toBe(false);
    expect(validateSpan(span, null)).toBe(false);
  });
});
