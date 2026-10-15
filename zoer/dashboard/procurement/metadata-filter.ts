/** Shared source-metadata predicates. Copied verbatim into the host's saved-search reader. */
export const METADATA_FILTER_KEYS = ['officialRegion','opportunityType','historicalType','gsin','status','issueFrom','issueTo','closingFrom','closingTo'] as const;
export type MetadataFilters = Partial<Record<typeof METADATA_FILTER_KEYS[number], string>>;
const f = (key: string) => `json_extract(data,'$.${key}')`;
export const jsonMemberPattern = (value: string) => '%' + JSON.stringify(value).replace(/[\\%_]/g, '\\$&') + '%';
export function metadataPredicates(input: MetadataFilters & { category?: unknown }) {
  const clauses: string[] = [], parameters: string[] = [];
  for (const key of METADATA_FILTER_KEYS) if (input[key] !== undefined && (typeof input[key] !== 'string' || input[key]!.length > 300 || input[key]!.includes('\0'))) throw Error(`Invalid ${key} filter.`);
  const category = input.category;
  if (category !== undefined && category !== '') {
    if (typeof category !== 'string' || category.length > 300) throw Error('Invalid category filter.');
    const scalar = `coalesce(${f('category')},${f('classification')},'')`, array = `coalesce(${f('industryCategories')},'[]')`;
    if (category === '__missing__') clauses.push(`${scalar}='' AND ${array}='[]'`);
    else { clauses.push(`CASE WHEN ${array}!='[]' THEN CASE WHEN ${array} LIKE ? ESCAPE '\\' THEN 1 ELSE 0 END ELSE CASE WHEN ${scalar}=? THEN 1 ELSE 0 END END=1`); parameters.push(jsonMemberPattern(category), category); }
  }
  for (const [key, expression] of [['status', f('status')], ['opportunityType', `coalesce(${f('type')},${f('opportunityType')})`], ['historicalType', f('historicalTypeReferenceId')]] as const) {
    const value = input[key]; if (value) { clauses.push(value === '__missing__' ? `coalesce(${expression},'')=''` : `${expression}=?`); if (value !== '__missing__') parameters.push(value); }
  }
  if (input.officialRegion) {
    if (input.officialRegion === '__missing__') clauses.push(`coalesce(${f('sourceRegionCodes')},'[]')='[]'`);
    else { if (!/^CA_(STATE_BC|BC_(R[1-8]|\d{4}))$/.test(input.officialRegion)) throw Error('Invalid official region.'); clauses.push(`coalesce(${f('sourceRegionPath')},'') LIKE ?`); parameters.push(`%|${input.officialRegion}|%`); }
  }
  if (input.gsin) { clauses.push(`coalesce(${f('gsinTermIds')},'[]') LIKE ? ESCAPE '\\'`); parameters.push(jsonMemberPattern(input.gsin)); }
  for (const [from, to, expression] of [['issueFrom','issueTo',`coalesce(${f('issueDate')},${f('issuedAt')})`], ['closingFrom','closingTo',`coalesce(${f('closingAt')},${f('closingDate')})`]] as const) {
    for (const key of [from,to]) if (input[key] && (!/^\d{4}-\d{2}-\d{2}$/.test(input[key]!) || !Number.isFinite(Date.parse(input[key]! + 'T00:00:00Z')) || new Date(input[key]! + 'T00:00:00Z').toISOString().slice(0,10) !== input[key])) throw Error(`Invalid ${key} date.`);
    if (input[from] && input[to] && input[from]! > input[to]!) throw Error('The minimum date must not follow the maximum date.');
    if (input[from]) { clauses.push(`${expression}>=?`); parameters.push(input[from]!); }
    if (input[to]) { const next = new Date(Date.parse(input[to]! + 'T00:00:00Z') + 86400000).toISOString().slice(0,10); clauses.push(`${expression}<?`); parameters.push(next); }
  }
  return { sql: clauses.length ? clauses.join(' AND ') : '1=1', parameters };
}
