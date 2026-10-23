/** Versioned source-money parser. Decimal text/minor units are authoritative; numbers are bounded projections. */
export const AWARD_MONEY_PARSER_VERSION = 'award-money-v2';
const scales = { CAD: 2, USD: 2, EUR: 2, GBP: 2, AUD: 2, NZD: 2, CHF: 2, CNY: 2, HKD: 2, SGD: 2, JPY: 0, KRW: 0, KWD: 3, BHD: 3, OMR: 3 };
/** The source must choose its locale; separator guessing is deliberately disallowed. */
export function parseContractAwardMoney(raw, options = {}) {
    const original = typeof raw === 'string' ? raw : null;
    let text = original?.replace(/[\u00a0\u202f]/g, ' ').trim() ?? '';
    let currency = options.currency?.trim().toUpperCase() || null;
    let scale = currency ? scales[currency] : 2;
    const result = (status, decimal = null, minorUnits = null, value = null) => ({ raw: original, status, currency, scale: scale ?? 2, decimal, minorUnits, value, parserVersion: AWARD_MONEY_PARSER_VERSION });
    if (!text || /^(?:n\/?a|not (?:stated|disclosed|provided)|unknown|tbd|[-—])$/i.test(text))
        return result('missing');
    if (text.length > 512)
        return result('out_of_bounds');
    // Only a leading/trailing ISO code is accepted, never letters silently stripped from the middle.
    const code = /^([A-Za-z]{3})\s+/.exec(text) ?? /\s+([A-Za-z]{3})$/.exec(text);
    if (code) {
        const stated = code[1].toUpperCase();
        if (!(stated in scales) || currency && currency !== stated)
            return result('ambiguous');
        currency = stated;
        scale = scales[stated];
        text = text.replace(code[0], '').trim();
    }
    if (scale === undefined)
        return result('ambiguous');
    let negative = false;
    if (text.startsWith('(') && text.endsWith(')')) {
        negative = true;
        text = text.slice(1, -1).trim();
    }
    if (text.startsWith('-')) {
        if (negative)
            return result('invalid');
        negative = true;
        text = text.slice(1).trim();
    }
    // A dollar sign alone does not establish which dollar currency applies.
    const symbol = /^([$€£¥])\s*/.exec(text);
    if (symbol) {
        const implied = symbol[1] === '€' ? 'EUR' : symbol[1] === '£' ? 'GBP' : null;
        if (implied && currency && currency !== implied || symbol[1] === '$' && currency && !['CAD', 'USD', 'AUD', 'NZD', 'HKD', 'SGD'].includes(currency))
            return result('ambiguous');
        if (implied) {
            currency = implied;
            scale = scales[implied];
        }
        text = text.slice(symbol[0].length);
    }
    let multiplier = 1n;
    const suffix = /\s*(thousand|million|billion)$/i.exec(text);
    if (suffix) {
        multiplier = { thousand: 1000n, million: 1000000n, billion: 1000000000n }[suffix[1].toLowerCase()];
        text = text.slice(0, -suffix[0].length);
    }
    const french = options.locale === 'fr-CA';
    const expression = french ? /^(\d{1,3}(?: \d{3})+|\d+)(?:,(\d+))?$/ : /^(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d+))?$/;
    const match = expression.exec(text);
    if (!match)
        return result('invalid');
    const whole = match[1].replace(french ? / /g : /,/g, ''), fraction = match[2] ?? '';
    // Exact decimal arithmetic: no rounding and no exponent/multiplier float errors.
    const numerator = BigInt(whole + fraction) * multiplier * 10n ** BigInt(scale);
    const denominator = 10n ** BigInt(fraction.length);
    if (numerator % denominator !== 0n)
        return result('ambiguous');
    let minor = numerator / denominator;
    if (minor > BigInt(Number.MAX_SAFE_INTEGER))
        return result('out_of_bounds');
    if (negative)
        minor = -minor;
    const digits = (minor < 0n ? -minor : minor).toString().padStart(scale + 1, '0');
    const decimal = `${minor < 0n ? '-' : ''}${scale ? digits.slice(0, -scale) + '.' + digits.slice(-scale) : digits}`;
    return result('parsed', decimal, minor.toString(), Number(minor) / 10 ** scale);
}
