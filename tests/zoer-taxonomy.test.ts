import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { validateCatalogSelect } from '../../zoer/backend/src/catalog-reader';
import { procurementAlertQuery } from '../../zoer/backend/src/procurement-alert-query';
import { classifyCatalogRecords } from '../zoer/src/taxonomy';
import { saveCatalogDocument } from '../zoer/src/catalog';
import { buildProcurementQuery } from '../zoer/dashboard/procurement/catalog';
import { TAXONOMY_ACTIVE_KEY, matchTaxonomy, releaseId, taxonomyFilter, taxonomyPredicate, taxonomyNodesQuery, taxonomyChangesQuery, termId, type TaxonomyTerm } from '../zoer/dashboard/procurement/taxonomy-contract';
import { pageOf, sectionOf } from '../zoer/dashboard/review-workspace/nav';
import { parseDetailPage } from '../packages/shared/src/parsers/detail';

const version = 'UNv260801', release = releaseId(version);
const term = (code: string, title: string, path = `|43000000|43210000|43211500|${code}|`): { id: string; kind: string; title: string; data: TaxonomyTerm } => ({ id: termId(version, code), kind: 'taxonomy-term', title, data: { schemaVersion: 1, scheme: 'UNSPSC', version, releaseId: release, code, title, level: 'commodity', parentId: termId(version, '43211500'), ancestors: [{ code: '43000000', title: 'IT', level: 'segment' }, { code: '43210000', title: 'Equipment', level: 'family' }, { code: '43211500', title: 'Computers', level: 'class' }], path, definition: 'Definition', sourceRow: 8 } });
function fixture() {
  const rows = new Map<string, any>(), state = new Map<string, any>(); let revision = 0;
  rows.set(release, { id: release, kind: 'taxonomy-release', title: version, data: { status: 'ready', scheme: 'UNSPSC', version, provenance: { sourceSha256: 'known' } } });
  state.set(TAXONOMY_ACTIVE_KEY, { schemaVersion: 1, releaseId: release });
  for (let index = 0; index < 256; index++) state.set(`procurement:taxonomy:index:${version}:${index.toString(16).padStart(2, '0')}`, { schemaVersion: 1, releaseId: release, items: [] });
  const add = (node: ReturnType<typeof term>) => {
    rows.set(node.id, node);
    const key = `procurement:taxonomy:index:${version}:${createHash('sha256').update(node.data.title).digest('hex').slice(0, 2)}`;
    const items = state.get(key).items, found = items.find((item: any) => item.title === node.data.title);
    if (found) found.termIds.push(node.id); else items.push({ title: node.data.title, termIds: [node.id] });
  };
  const call = async (method: string, input: any): Promise<any> => {
    if (method === 'catalog.workspace') return { revision, entries: input.keys.filter((key: string) => state.has(key)).map((key: string) => ({ key, value: structuredClone(state.get(key)) })) };
    if (method === 'catalog.read') return { revision, primary: true, records: [...rows.values()].filter(row => input.ids ? input.ids.includes(row.id) : input.match ? row.kind === input.match.kind && row.data[input.match.field] === input.match.value : true).map(row => structuredClone(row)) };
    if (method === 'catalog.commit') {
      if (input.revision !== revision) return { conflict: true };
      expect(input.records.length).toBeLessThanOrEqual(200);
      for (const row of input.records) rows.set(row.id, JSON.parse(JSON.stringify(row)));
      for (const item of input.entries || []) state.set(item.key, structuredClone(item.value));
      return { revision: ++revision };
    }
    throw Error('The worker must use only existing bounded read/workspace/commit grants.');
  };
  return { rows, state, call, add };
}
const notice = (names = ['Personal computer']) => ({ id: 'opportunity:1', kind: 'opportunity', title: 'Computers', data: { sourceKey: '1', processId: '1', description: 'Computers', detailUrl: 'https://bcbid.gov.bc.ca/page.aspx/en/bpm/process_manage_extranet/1', commodities: names, detailFields: [{ label: 'Main Commodity', value: names[0] }], attachments: [{ url: 'keep.pdf' }], starred: true } });

describe('versioned procurement taxonomy', () => {
  it('reads each visible source commodity table row intact, including commas, and preserves main/other roles', () => {
    const page = parseDetailPage(`<table><thead><tr><th>Main Commodity</th></tr></thead><tbody><tr><td>Engineering, Research and Technology Based Services</td></tr></tbody></table><table><thead><tr><th>Other Commodities</th></tr></thead><tbody><tr><td>Personal computer</td></tr><tr><td>Tablet</td></tr></tbody></table><div hidden><table><thead><tr><th>Main Commodity</th></tr></thead><tbody><tr><td>Hidden</td></tr></tbody></table></div>`, 'https://bcbid.gov.bc.ca', 'https://bcbid.gov.bc.ca/page.aspx/en/bpm/process_manage_extranet/1');
    expect(page).toMatchObject({ commodityTablesCaptured: true, mainCommodity: 'Engineering, Research and Technology Based Services', commodities: ['Engineering, Research and Technology Based Services', 'Personal computer', 'Tablet'] });
    expect(parseDetailPage('<p>No tables supplied</p>', 'https://bcbid.gov.bc.ca', 'https://bcbid.gov.bc.ca/page.aspx/en/bpm/process_manage_extranet/1')).not.toHaveProperty('commodities');
  });
  it('leaves unknown/ambiguous labels unresolved and preserves family-level specificity', () => {
    const family = term('43210000', 'Equipment', '|43000000|43210000|'); family.data.level = 'family'; family.data.ancestors = family.data.ancestors.slice(0, 1);
    const matches = matchTaxonomy(['Equipment', 'Duplicate', 'Missing'], [family, term('43211508', 'Duplicate'), term('43211509', 'Duplicate')]);
    expect(matches[0].term?.data.level).toBe('family');
    expect(matches[1]).toMatchObject({ term: null, candidates: ['43211508', '43211509'] });
    expect(matches[2]).toMatchObject({ term: null, candidates: [] });
  });
  it('automatically derives links using existing worker grants, retains main/other roles and is deterministic', async () => {
    const db = fixture(); db.add(term('43211508', 'Personal computer')); db.add(term('43211509', 'Tablet'));
    const first = await classifyCatalogRecords(db.call, [notice(['Personal computer', 'Tablet'])]);
    expect(first.links.map(row => row.data.role)).toEqual(['main', 'other']);
    expect(first.records[0].data).toMatchObject({ starred: true, attachments: [{ url: 'keep.pdf' }], taxonomyReleaseId: release, classificationCodes: ['43211508', '43211509'] });
    expect(await classifyCatalogRecords(db.call, first.records)).toEqual(first);
    const changed = await classifyCatalogRecords(db.call, [notice(['Tablet'])]);
    expect(changed.records[0].data.classificationLinkSet).not.toBe(first.records[0].data.classificationLinkSet);
    expect(changed.links[0].data.role).toBe('main');
  });
  it('retains the original scrape behavior when no release is activated and refuses an incomplete activated release', async () => {
    const db = fixture(), source = notice(); db.state.delete(TAXONOMY_ACTIVE_KEY);
    expect(await classifyCatalogRecords(db.call, [source])).toEqual({ records: [source], links: [] });
    db.state.set(TAXONOMY_ACTIVE_KEY, { schemaVersion: 1, releaseId: release }); db.rows.get(release).data.status = 'importing';
    await expect(classifyCatalogRecords(db.call, [notice()])).rejects.toThrow('not ready');
  });
  it('stages a large link batch before publishing the opportunity, keeping old links harmless', async () => {
    const db = fixture(); for (let i = 0; i < 205; i++) db.add(term(String(43211000 + i), 'Label ' + i));
    const source = notice(Array.from({ length: 205 }, (_, i) => 'Label ' + i)); db.rows.set(source.id, source);
    await saveCatalogDocument(db.call, { kind: 'detail', record: { processId: '1', commodities: source.data.commodities, detailFields: source.data.detailFields } }, 'run');
    expect([...db.rows.values()].filter(row => row.kind === 'opportunity-classification')).toHaveLength(205);
    expect(db.rows.get(source.id).data.classificationCodes).toHaveLength(205);
    expect(db.rows.get(source.id).data.starred).toBe(true);
  });
  it('keeps an interrupted link set invisible and resumes without duplicate links', async () => {
    const db = fixture(); for (let i = 0; i < 205; i++) db.add(term(String(43211000 + i), 'Label ' + i));
    const source = notice(Array.from({ length: 205 }, (_, i) => 'Label ' + i));
    Object.assign(source.data, { classificationLinkSet: 'old' }); db.rows.set(source.id, source);
    const document = { kind: 'detail', record: { processId: '1', commodities: source.data.commodities, detailFields: source.data.detailFields } };
    let staged = 0;
    const interrupted = async (method: string, input: any) => {
      if (method === 'catalog.commit' && input.records[0]?.kind === 'opportunity-classification' && ++staged === 2) throw Error('Interrupted');
      return db.call(method, input);
    };
    await expect(saveCatalogDocument(interrupted, document, 'run')).rejects.toThrow('Interrupted');
    expect(db.rows.get(source.id).data.classificationLinkSet).toBe('old');
    expect([...db.rows.values()].filter(row => row.kind === 'opportunity-classification')).toHaveLength(200);
    await saveCatalogDocument(db.call, document, 'run');
    expect([...db.rows.values()].filter(row => row.kind === 'opportunity-classification')).toHaveLength(205);
    expect(db.rows.get(source.id).data.classificationLinkSet).not.toBe('old');
  });
  it('retries a concurrent star change without overwriting it during link publication', async () => {
    const db = fixture(); db.add(term('43211508', 'Personal computer')); const source = notice(); db.rows.set(source.id, source);
    const document = { kind: 'detail', record: { processId: '1', commodities: source.data.commodities, detailFields: source.data.detailFields } };
    let changed = false;
    const concurrent = async (method: string, input: any) => {
      if (method === 'catalog.commit' && input.records[0]?.kind === 'opportunity' && !changed) {
        changed = true;
        await db.call(method, { revision: input.revision, records: [{ ...source, data: { ...source.data, starred: false } }] });
      }
      return db.call(method, input);
    };
    await expect(saveCatalogDocument(concurrent, document, 'run')).rejects.toThrow('retry transaction');
    await saveCatalogDocument(db.call, document, 'run');
    expect(db.rows.get(source.id).data.starred).toBe(false);
    expect(db.rows.get(source.id).data.classificationCodes).toEqual(['43211508']);
  });
  it('parent filters and saved alerts agree, exclude stale links/other versions, and count each opportunity once', () => {
    const db = new DatabaseSync(':memory:'); db.exec('CREATE TABLE records(id TEXT PRIMARY KEY,kind TEXT,title TEXT,data TEXT,hash TEXT,updated_at TEXT); CREATE TABLE workspace_state(key TEXT,data TEXT,updated_at TEXT)');
    const add = (id: string, kind: string, data: any) => db.prepare('INSERT INTO records VALUES(?,?,?,?,?,?)').run(id, kind, id, JSON.stringify(data), 'h', '2026-10-10');
    for (const node of [term('43211508', 'PC'), term('43211509', 'Tablet')]) add(node.id, node.kind, node.data);
    add('opportunity:current', 'opportunity', { classificationLinkSet: 'current' }); add('opportunity:stale', 'opportunity', { classificationLinkSet: 'new' });
    for (const [id, recordId, code, inputFingerprint] of [['a', 'opportunity:current', '43211508', 'current'], ['b', 'opportunity:current', '43211509', 'current'], ['c', 'opportunity:stale', '43211508', 'old']]) add(id, 'opportunity-classification', { recordId, termId: termId(version, code), inputFingerprint });
    const read = (q: { statement: string; parameters: (string | number)[] }) => { validateCatalogSelect(q.statement, q.parameters); return (db.prepare(q.statement).all(...q.parameters) as any[]).map(row => row.id); };
    const classification = taxonomyFilter(version, '43210000');
    expect(read(buildProcurementQuery({ classification }))).toEqual(['opportunity:current']);
    expect(read(procurementAlertQuery({ classification }))).toEqual(['opportunity:current']);
    const old = buildProcurementQuery({ classification: taxonomyFilter('UNv250901', '43210000') }); expect(read(old)).toEqual([]);
    const predicate = taxonomyPredicate(classification); expect(db.prepare(`SELECT count(*) AS total FROM records WHERE kind='opportunity' AND ${predicate.sql}`).get(...predicate.parameters)).toMatchObject({ total: 1 });
    db.close();
  });
  it('exposes a taxonomy section and direct detail route', () => { expect(sectionOf('/taxonomy?code=43211508')).toBe('taxonomy'); expect(pageOf('/taxonomy')).toBe('taxonomy'); });
  it('browses, searches literal wildcard characters and reads version changes through the real bounded SQL validator', () => {
    const db = new DatabaseSync(':memory:'); db.exec('CREATE TABLE records(id TEXT PRIMARY KEY,kind TEXT,data TEXT)');
    const add = (id: string, kind: string, data: any) => db.prepare('INSERT INTO records VALUES(?,?,?)').run(id, kind, JSON.stringify(data));
    for (const node of [term('43211508', 'Personal computer'), term('43211509', '100%_literal')]) add(node.id, node.kind, node.data);
    add('change:1', 'taxonomy-change', { releaseId: release, change_type: 'MOVE', changed_code: 60105915, effective_code: 43211508 });
    add('change:old', 'taxonomy-change', { releaseId: releaseId('UNv250901'), change_type: 'ADD', effective_code: 43211508 });
    const read = (q: ReturnType<typeof taxonomyNodesQuery>) => { validateCatalogSelect(q.statement, q.parameters); return db.prepare(q.statement).all(...q.parameters) as any[]; };
    expect(read(taxonomyNodesQuery(version, '43211500')).map(row => row.id)).toEqual([termId(version, '43211508'), termId(version, '43211509')]);
    expect(read(taxonomyNodesQuery(version, '', '%_')).map(row => row.id)).toEqual([termId(version, '43211509')]);
    expect(read(taxonomyNodesQuery(version, '', 'computer', termId(version, '43211508')))).toEqual([]);
    expect(read(taxonomyChangesQuery(version, '43211508'))).toMatchObject([{ type: 'MOVE', total: 1 }]);
    expect(read(taxonomyChangesQuery(version, '60105915', false)).map(row => row.id)).toEqual(['change:1']);
    db.close();
  });
});
