/** Versioned shared terms and immutable source-to-term links in the existing catalog. */
export const TAXONOMY_ACTIVE_KEY = 'procurement:taxonomy:active:unspsc';
export const TAXONOMY_KINDS = { release: 'taxonomy-release', term: 'taxonomy-term', change: 'taxonomy-change', link: 'opportunity-classification' } as const;
export type TaxonomyTerm = {
  schemaVersion: 1; scheme: 'UNSPSC'; version: string; releaseId: string; code: string;
  title: string; level: 'segment' | 'family' | 'class' | 'commodity';
  parentId: string | null; ancestors: { code: string; title: string; level: string }[];
  path: string; definition: string | null; sourceRow: number;
};
export const releaseId = (version: string) => `taxonomy-release:UNSPSC:${version}`;
export const termId = (version: string, code: string) => `taxonomy-term:UNSPSC:${version}:${code}`;
export const taxonomyFilter = (version: string, code: string) => `taxonomy:UNSPSC:${version}:${code}`;
export function taxonomyNodesQuery(version: string, code = '', search = '', after = '') {
  const where = ["kind='taxonomy-term'", "json_extract(data,'$.releaseId')=?", 'id>?'];
  const parameters: (string | number)[] = [releaseId(version), after];
  if (search.trim()) {
    // The host's bounded SQL reader rejects AND/OR directly before parentheses.
    where.push("CASE WHEN json_extract(data,'$.title') LIKE ? ESCAPE '\\' OR json_extract(data,'$.code') LIKE ? ESCAPE '\\' THEN 1 ELSE 0 END=1");
    const pattern = '%' + search.trim().replace(/[\\%_]/g, '\\$&') + '%'; parameters.push(pattern, pattern);
  } else if (code) { where.push("json_extract(data,'$.parentId')=?"); parameters.push(termId(version, code)); }
  else where.push("json_extract(data,'$.parentId') IS NULL");
  return { statement: `SELECT id,data FROM records WHERE ${where.join(' AND ')} ORDER BY id LIMIT 51`, parameters };
}
export function taxonomyChangesQuery(version: string, code = '', summary = true) {
  const parameters: (string | number)[] = [releaseId(version)];
  let where = "kind='taxonomy-change' AND json_extract(data,'$.releaseId')=?";
  if (code) {
    where += " AND CASE WHEN json_extract(data,'$.effective_code')=? OR json_extract(data,'$.changed_code')=? THEN 1 ELSE 0 END=1";
    parameters.push(Number(code), Number(code));
  }
  return { statement: summary
    ? `SELECT json_extract(data,'$.change_type') AS type,count(*) AS total FROM records WHERE ${where} GROUP BY json_extract(data,'$.change_type')`
    : `SELECT id,data FROM records WHERE ${where} ORDER BY id LIMIT 51`, parameters };
}
export function parseTaxonomyFilter(value: unknown) {
  const match = typeof value === 'string' && value.match(/^taxonomy:UNSPSC:(UNv[0-9]{6}):([0-9]{8})$/);
  return match ? { version: match[1], code: match[2] } : null;
}
/** Parent rollups use the imported path, including self, and only the current link set. */
export function taxonomyPredicate(value: string) {
  const selected = parseTaxonomyFilter(value);
  if (!selected) throw Error('Invalid taxonomy filter.');
  return {
    sql: `id IN (SELECT json_extract(l.data,'$.recordId') FROM records l JOIN records t ON t.id=json_extract(l.data,'$.termId') JOIN records r ON r.id=json_extract(l.data,'$.recordId') WHERE l.kind='opportunity-classification' AND t.kind='taxonomy-term' AND json_extract(t.data,'$.releaseId')=? AND json_extract(t.data,'$.path') LIKE ? AND json_extract(l.data,'$.inputFingerprint')=json_extract(r.data,'$.classificationLinkSet'))`,
    parameters: [releaseId(selected.version), `%|${selected.code}|%`],
  };
}
export function matchTaxonomy(labels: string[], terms: { id: string; data: TaxonomyTerm }[]) {
  return labels.map(label => {
    const candidates = terms.filter(term => term.data.title === label);
    return candidates.length === 1 ? { label, term: candidates[0], candidates: [] as string[] }
      : { label, term: null, candidates: candidates.map(term => term.data.code).sort() };
  });
}
