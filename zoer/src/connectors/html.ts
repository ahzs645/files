/** HTML to text helpers shared by the listing connectors. */
const NAMED: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', ndash: '–', mdash: '—',
  hellip: '…', bull: '•', middot: '·', copy: '©', reg: '®', trade: '™', deg: '°', frac12: '½', frac14: '¼', frac34: '¾', times: '×',
  eacute: 'é', Eacute: 'É', egrave: 'è', Egrave: 'È', ecirc: 'ê', agrave: 'à', Agrave: 'À', acirc: 'â', ccedil: 'ç', Ccedil: 'Ç',
  ocirc: 'ô', icirc: 'î', iuml: 'ï', ucirc: 'û', ugrave: 'ù', uuml: 'ü', ouml: 'ö', auml: 'ä', laquo: '«', raquo: '»', sect: '§', para: '¶',
};
/** Decodes numeric and common named entities; unknown names are left as written rather than guessed. */
export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]{1,6}|#\d{1,7}|[a-z][a-z0-9]{1,8});/gi, (whole, name: string) => {
    if (name[0] !== '#') return NAMED[name] ?? whole;
    const code = name[1] === 'x' || name[1] === 'X' ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10);
    return code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff) ? String.fromCodePoint(code) : whole;
  });
}
/** Source HTML to readable text: block ends become single line breaks, list items keep a bullet, entities decoded. */
export function htmlToText(html: string): string {
  return decodeEntities(String(html ?? '')
    .replace(/<(script|style|svg)\b[\s\S]*?<\/\1\s*>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<li\b[^>]*>/gi, '\n• ')
    .replace(/<\/(p|div|h[1-6]|li|ul|ol|tr|table|blockquote|section)\s*>/gi, '\n')
    .replace(/<[^>]*>/g, ''))
    .replace(/[ \t \r\f\v]+/g, ' ')
    .split('\n').map(line => line.trim()).filter(Boolean)
    .join('\n').trim();
}
