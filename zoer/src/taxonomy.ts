import { createHash } from 'node:crypto';
import { TAXONOMY_ACTIVE_KEY, TAXONOMY_KINDS, matchTaxonomy, type TaxonomyTerm } from '../dashboard/procurement/taxonomy-contract';
type Host = (method: string, input: any) => Promise<any>;

/** Derives links before the revision-checked scrape publication; no storage is created. */
export async function classifyCatalogRecords(call: Host, records: any[]) {
  for (const row of records) if (row.kind === 'opportunity' && (row.data.historical || row.data.commodityScheme === 'GSIN') && row.data.taxonomyReleaseId?.startsWith('taxonomy-release:UNSPSC:')) {
    for (const key of ['classificationLinkSet', 'taxonomyReleaseId', 'classificationCodes', 'commodityClassifications', 'commodityClassificationUnresolved', 'commodityClassificationProvenance']) delete row.data[key];
  }
  const eligible = records.filter(row => row.kind === 'opportunity' && (row.data.detailUrl || '').startsWith('https://bcbid.gov.bc.ca/') && !row.data.historical && row.data.commodityScheme !== 'GSIN' && !/^Historic Record/i.test(row.data.type || '') && !row.data.detailFields?.some((field: any) => /GSIN/i.test(field.label)));
  if (!eligible.length) return { records, links: [] };
  const state = await call('catalog.workspace', { keys: [TAXONOMY_ACTIVE_KEY] });
  const active = state.entries.find((entry: any) => entry.key === TAXONOMY_ACTIVE_KEY)?.value;
  if (!active) return { records, links: [] };
  if (active.schemaVersion !== 1 || typeof active.releaseId !== 'string') throw Error('The active taxonomy reference is invalid.');
  const release = (await call('catalog.read', { ids: [active.releaseId] })).records[0];
  if (release?.kind !== TAXONOMY_KINDS.release || release.data.status !== 'ready' || release.data.scheme !== 'UNSPSC') throw Error('The shared taxonomy import is not ready.');
  const labels = [...new Set(eligible.flatMap(row => (row.data.commodities || []).filter((label: unknown) => typeof label === 'string')))];
  if (labels.length > 1000) throw Error('Split commodity enrichment into smaller batches.');
  // Workers already have bounded workspace/read grants, not arbitrary SQL.
  // Immutable title-index shards keep a scrape from loading all 89,972 terms.
  const shardKey = (label: string) => `procurement:taxonomy:index:${release.data.version}:${createHash('sha256').update(label).digest('hex').slice(0, 2)}`;
  const keys = [...new Set(labels.map(shardKey))];
  const candidates = new Set<string>();
  for (let offset = 0; offset < keys.length; offset += 20) {
    const page = await call('catalog.workspace', { keys: keys.slice(offset, offset + 20) });
    for (const entry of page.entries) {
      if (entry.value.schemaVersion !== 1 || entry.value.releaseId !== active.releaseId || !Array.isArray(entry.value.items)) throw Error('A taxonomy lookup shard is invalid.');
      for (const item of entry.value.items) if (labels.includes(item.title)) for (const id of item.termIds) candidates.add(id);
    }
    if (page.entries.length !== keys.slice(offset, offset + 20).length) throw Error('A taxonomy lookup shard is missing.');
  }
  const terms: { id: string; data: TaxonomyTerm }[] = [];
  const ids = [...candidates];
  for (let offset = 0; offset < ids.length; offset += 50) {
    const page = await call('catalog.read', { ids: ids.slice(offset, offset + 50) });
    if (page.records.length !== ids.slice(offset, offset + 50).length || page.records.some((row: any) => row.kind !== TAXONOMY_KINDS.term || row.data.releaseId !== active.releaseId)) throw Error('The shared taxonomy lookup is incomplete.');
    terms.push(...page.records);
  }
  const links: any[] = [];
  for (const row of eligible) {
    const data = row.data;
    const names = (data.commodities || []).filter((name: unknown) => typeof name === 'string');
    const sourceMain = data.detailFields?.find((field: any) => field.label === 'Main Commodity')?.value;
    const main = data.commodityTablesCaptured ? (names.includes(data.mainCommodity) ? data.mainCommodity : null)
      : names.includes(sourceMain) ? sourceMain : names.includes(data.mainCommodity) ? data.mainCommodity : null;
    const fingerprint = createHash('sha256').update(JSON.stringify([active.releaseId, names, main])).digest('hex');
    const matches = matchTaxonomy(names, terms);
    data.mainCommodity = main;
    data.classificationLinkSet = fingerprint;
    data.taxonomyReleaseId = active.releaseId;
    data.classificationCodes = [...new Set(matches.flatMap(match => match.term ? [match.term.data.code] : []))].sort();
    data.commodityClassifications = matches.flatMap(match => match.term ? [{ sourceLabel: match.label, code: match.term.data.code, title: match.term.data.title, level: match.term.data.level, ancestors: match.term.data.ancestors, sourceRow: match.term.data.sourceRow }] : []);
    data.commodityClassificationUnresolved = matches.flatMap(match => match.term ? [] : [{ sourceLabel: match.label, reason: match.candidates.length ? 'ambiguous-title' : 'no-exact-title-match', candidateCodes: match.candidates }]);
    data.commodityClassificationProvenance = release.data.provenance;
    for (const match of matches) if (match.term) {
      const role = main === match.label ? 'main' : main ? 'other' : 'unspecified';
      const id = `opportunity-classification:${row.id}:UNSPSC:${release.data.version}:${fingerprint}:${match.term.data.code}`;
      const link = { schemaVersion: 1, recordId: row.id, termId: match.term.id, releaseId: active.releaseId, scheme: 'UNSPSC', version: release.data.version, code: match.term.data.code, role, rawLabel: match.label, inputFingerprint: fingerprint, method: 'unique-exact-title-match' };
      if (!links.some(existing => existing.id === id)) links.push({ id, kind: TAXONOMY_KINDS.link, title: match.label, data: link });
    }
  }
  return { records, links };
}
